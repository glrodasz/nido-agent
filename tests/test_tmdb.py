from datetime import UTC, datetime

import httpx
import respx

from nido.models import AccessType, MediaType
from nido.sources.tmdb import (
    BASE_URL,
    TmdbClient,
    parse_availability,
    parse_classifications,
    parse_title,
)

NOW = datetime(2026, 10, 25, tzinfo=UTC)

MOVIE = {
    "id": 1,
    "imdb_id": "tt0000001",
    "title": "Paddington 2",
    "release_date": "2017-11-10",
    "runtime": 103,
    "genres": [{"id": 12, "name": "Adventure"}, {"id": 35, "name": "Comedy"}],
    "overview": "A bear.",
    "poster_path": "/p.jpg",
    "release_dates": {
        "results": [
            {
                "iso_3166_1": "SE",
                "release_dates": [
                    {"certification": "Btl", "type": 3, "note": ""},
                    {"certification": "Btl", "type": 4, "note": "Digital"},
                    {"certification": "", "type": 5},
                ],
            },
            {"iso_3166_1": "GB", "release_dates": [{"certification": "PG", "type": 3}]},
        ]
    },
    "watch/providers": {
        "results": {
            "SE": {
                "link": "https://www.themoviedb.org/movie/1/watch?locale=SE",
                "flatrate": [
                    {"provider_id": 8, "provider_name": "Netflix"},
                    {"provider_id": 1, "provider_name": "HBO Max Amazon Channel"},
                ],
                "rent": [{"provider_id": 2, "provider_name": "Apple TV"}],
            }
        }
    },
}

SERIES = {
    "id": 2,
    "name": "Bluey",
    "first_air_date": "2018-10-01",
    "episode_run_time": [7],
    "number_of_seasons": 3,
    "external_ids": {"imdb_id": "tt7678620"},
    "content_ratings": {"results": [{"iso_3166_1": "SE", "rating": "Btl", "descriptors": []}]},
}


def test_parse_movie_title():
    title = parse_title(MediaType.MOVIE, MOVIE)
    assert (title.name, title.year, title.runtime_min) == ("Paddington 2", 2017, 103)
    assert title.genres == ["Adventure", "Comedy"]
    assert str(title.poster_url).endswith("/p.jpg")


def test_parse_series_title_uses_episode_runtime_and_external_imdb_id():
    title = parse_title(MediaType.TV, SERIES)
    assert (title.runtime_min, title.season_count, title.imdb_id) == (7, 3, "tt7678620")


def test_classifications_for_one_region_collapse_duplicates():
    found = parse_classifications(MediaType.MOVIE, MOVIE, ["SE"], now=NOW)
    assert [(c.value, c.min_age, c.issuer) for c in found] == [("Btl", 0, "Statens medieråd")]
    assert found[0].retrieved_at == NOW


def test_classifications_default_to_all_reference_countries():
    found = parse_classifications(MediaType.MOVIE, MOVIE, now=NOW)
    assert sorted((c.region, c.value, c.min_age) for c in found) == [
        ("GB", "PG", 8),
        ("SE", "Btl", 0),
    ]


def test_series_classification():
    found = parse_classifications(MediaType.TV, SERIES, now=NOW)
    assert [c.value for c in found] == ["Btl"]


def test_availability_separates_subscription_addon_and_rent():
    offers = parse_availability(MediaType.MOVIE, MOVIE, "SE", now=NOW)
    by_name = {o.provider_name: o for o in offers}
    assert by_name["Netflix"].access is AccessType.SUBSCRIPTION
    assert by_name["Netflix"].service_key == "netflix"
    assert by_name["HBO Max Amazon Channel"].access is AccessType.ADDON
    assert by_name["Apple TV"].access is AccessType.RENT
    assert all(o.source == "TMDB (JustWatch)" for o in offers)


def test_no_availability_outside_region():
    assert parse_availability(MediaType.MOVIE, MOVIE, "NO", now=NOW) == []


@respx.mock
async def test_discover_pairs_certification_with_its_own_country():
    route = respx.get(f"{BASE_URL}/discover/movie").mock(
        return_value=httpx.Response(200, json={"results": [MOVIE]})
    )
    client = TmdbClient("token")
    titles = await client.discover(
        MediaType.MOVIE,
        region="SE",
        provider_ids=[8, 337],
        max_certification="PG",
        certification_country="US",
    )
    await client.aclose()
    params = route.calls.last.request.url.params
    assert params["watch_region"] == "SE"
    assert params["certification_country"] == "US"
    assert params["certification.lte"] == "PG"
    assert params["with_watch_providers"] == "8|337"
    assert route.calls.last.request.headers["Authorization"] == "Bearer token"
    assert [t.name for t in titles] == ["Paddington 2"]


@respx.mock
async def test_provider_ids_by_service():
    respx.get(f"{BASE_URL}/watch/providers/movie").mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    {"provider_id": 8, "provider_name": "Netflix"},
                    {"provider_id": 337, "provider_name": "Disney Plus"},
                    {"provider_id": 3, "provider_name": "Google Play Movies"},
                ]
            },
        )
    )
    client = TmdbClient("token")
    ids = await client.provider_ids(MediaType.MOVIE, "SE")
    await client.aclose()
    assert ids == {"netflix": [8], "disney_plus": [337]}


def test_resolve_genres_matches_compound_series_genres():
    from nido.sources.tmdb import resolve_genres

    tv = {"Action & Adventure": 10759, "Sci-Fi & Fantasy": 10765, "Comedy": 35}
    assert resolve_genres(["Adventure", "comedy"], tv) == {
        "Action & Adventure": 10759,
        "Comedy": 35,
    }
    assert resolve_genres(["Science Fiction", "Fantasy"], tv) == {"Sci-Fi & Fantasy": 10765}
    assert resolve_genres(["Music"], tv) == {}
