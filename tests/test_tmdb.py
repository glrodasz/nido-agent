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
    "last_air_date": "2024-04-21",
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
    # A series still airing is as recent as its latest episode, not its first.
    assert str(title.latest_date) == "2024-04-21"


def test_movie_recency_is_its_release_date():
    title = parse_title(MediaType.MOVIE, MOVIE)
    assert title.latest_date == title.release_date and title.release_date.year == 2017


@respx.mock
async def test_release_filter_uses_release_for_movies_and_any_episode_for_series():
    movies = respx.get(f"{BASE_URL}/discover/movie").mock(
        return_value=httpx.Response(200, json={"results": []})
    )
    series = respx.get(f"{BASE_URL}/discover/tv").mock(
        return_value=httpx.Response(200, json={"results": []})
    )
    client = TmdbClient("token")
    await client.discover(MediaType.MOVIE, region="SE", min_year=2021)
    await client.discover(MediaType.TV, region="SE", min_year=2021)
    await client.aclose()
    assert movies.calls.last.request.url.params["primary_release_date.gte"] == "2021-01-01"
    params = series.calls.last.request.url.params
    assert params["air_date.gte"] == "2021-01-01" and "first_air_date.gte" not in params


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
async def test_discover_leaves_out_excluded_genres():
    route = respx.get(f"{BASE_URL}/discover/movie").mock(
        return_value=httpx.Response(200, json={"results": []})
    )
    client = TmdbClient("token")
    await client.discover(MediaType.MOVIE, region="SE", genre_ids=[16], without_genre_ids=[35, 18])
    params = route.calls.last.request.url.params
    assert params["with_genres"] == "16"
    assert params["without_genres"] == "35,18"
    await client.discover(MediaType.MOVIE, region="SE", genre_ids=[35, 10749], all_genres=True)
    await client.aclose()
    assert route.calls.last.request.url.params["with_genres"] == "35,10749"


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
    assert "without_genres" not in params
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


# TMDB's genre lists (/genre/movie/list, /genre/tv/list) and the genres the web app offers per
# type (web/src/logic/format.ts GENRE_TYPES): every offered genre must filter its type.
_TMDB_MOVIE_GENRES = {
    "Action": 28, "Adventure": 12, "Animation": 16, "Comedy": 35, "Crime": 80,
    "Documentary": 99, "Drama": 18, "Family": 10751, "Fantasy": 14, "History": 36,
    "Horror": 27, "Music": 10402, "Mystery": 9648, "Romance": 10749, "Science Fiction": 878,
    "TV Movie": 10770, "Thriller": 53, "War": 10752, "Western": 37,
}  # fmt: skip
_TMDB_TV_GENRES = {
    "Action & Adventure": 10759, "Animation": 16, "Comedy": 35, "Crime": 80,
    "Documentary": 99, "Drama": 18, "Family": 10751, "Kids": 10762, "Mystery": 9648,
    "News": 10763, "Reality": 10764, "Sci-Fi & Fantasy": 10765, "Soap": 10766, "Talk": 10767,
    "War & Politics": 10768, "Western": 37,
}  # fmt: skip
_BOTH = ["Action", "Adventure", "Animation", "Comedy", "Documentary", "Drama", "Family",
         "Fantasy", "Mystery", "Science Fiction", "Western"]  # fmt: skip


def test_every_offered_genre_resolves_for_its_media_type():
    from nido.sources.tmdb import resolve_genres

    for genre in [*_BOTH, "History", "Music", "Romance"]:
        assert resolve_genres([genre], _TMDB_MOVIE_GENRES), genre
    for genre in [*_BOTH, "Kids", "Reality"]:
        assert resolve_genres([genre], _TMDB_TV_GENRES), genre
    assert resolve_genres(["Action"], _TMDB_TV_GENRES) == {"Action & Adventure": 10759}


def _video(lang, key, kind="Trailer", official=True, published="2024-01-01", site="YouTube"):
    return {
        "iso_639_1": lang,
        "key": key,
        "type": kind,
        "official": official,
        "published_at": published,
        "site": site,
    }


def test_trailers_pick_the_best_youtube_trailer_per_language():
    data = {
        **MOVIE,
        "videos": {
            "results": [
                _video("en", "teaserAAAAA", kind="Teaser"),
                _video("en", "trailerBBBB"),
                _video("en", "fanCCCCCCCC", official=False, published="2025-01-01"),
                _video("es", "spanishDDDD", published="2023-01-01"),
                _video("es", "spanishEEEE", published="2024-06-01"),
                _video("pt", "vimeoFFFFFF", site="Vimeo"),
                _video("de", "germanGGGGG"),
                _video("en", "featurette1", kind="Featurette"),
                _video("pt", "bad key!"),
            ]
        },
    }
    assert parse_title(MediaType.MOVIE, data).trailers == {
        "en": "trailerBBBB",
        "es": "spanishEEEE",
    }


def test_no_videos_means_no_trailers():
    assert parse_title(MediaType.MOVIE, MOVIE).trailers == {}


def _translation(lang: str, country: str, **data: str) -> dict:
    return {"iso_639_1": lang, "iso_3166_1": country, "data": data}


TOTORO = {
    **MOVIE,
    "title": "My Neighbor Totoro",
    "original_title": "となりのトトロ",
    "overview": "Two sisters move to the country.",
    "translations": {
        "translations": [
            _translation("es", "ES", title="Mi vecino Totoro", overview="Dos hermanas (ES)."),
            _translation("es", "MX", title="Mi vecino Totoro", overview="Dos hermanas (MX)."),
            _translation("pt", "PT", title="O Meu Vizinho Totoro", overview="Duas irmãs (PT)."),
            _translation("pt", "BR", title="Meu Amigo Totoro", overview=""),
        ]
    },
}


def test_translations_prefer_latin_american_spanish_and_brazilian_portuguese():
    title = parse_title(MediaType.MOVIE, TOTORO)
    assert title.translations["es"].synopsis == "Dos hermanas (MX)."
    assert title.translations["pt"].name == "Meu Amigo Totoro"
    # Brazil has no synopsis: Portugal's fills it before English does.
    assert title.translations["pt"].synopsis == "Duas irmãs (PT)."


def test_a_blank_name_keeps_the_original_instead_of_another_countrys():
    data = {
        **MOVIE,
        "title": "Zootopia 2",
        "translations": {
            "translations": [
                _translation("es", "ES", title="Zootrópolis 2", overview="Judy (ES)."),
                _translation("es", "MX", title="", overview="Judy (MX)."),
            ]
        },
    }
    title = parse_title(MediaType.MOVIE, data)
    assert title.text("es") == ("Zootopia 2", "Judy (MX).", None)


def test_text_falls_back_to_english_and_shows_a_readable_original_title():
    title = parse_title(MediaType.MOVIE, TOTORO)
    # A Japanese original gives way to the English name under the Spanish one.
    assert title.text("es") == ("Mi vecino Totoro", "Dos hermanas (MX).", "My Neighbor Totoro")
    # In English the name is the English one; the Japanese original is not shown.
    assert title.text("en") == ("My Neighbor Totoro", "Two sisters move to the country.", None)
    french = parse_title(
        MediaType.MOVIE,
        {**MOVIE, "title": "The Little Prince", "original_title": "Le Petit Prince"},
    )
    assert french.text("en") == ("The Little Prince", "A bear.", "Le Petit Prince")
    # No translation at all: English name and synopsis, no subtitle for the same name.
    assert parse_title(MediaType.MOVIE, {**MOVIE, "original_title": "Paddington 2"}).text("es") == (
        "Paddington 2",
        "A bear.",
        None,
    )


@respx.mock
async def test_details_keep_only_the_app_languages_translations():
    respx.get(f"{BASE_URL}/movie/1").mock(
        return_value=httpx.Response(
            200,
            json={
                **MOVIE,
                "translations": {
                    "translations": [
                        _translation("es", "MX", title="Paddington 2"),
                        _translation("de", "DE", title="Paddington 2"),
                    ]
                },
            },
        )
    )
    client = TmdbClient("token")
    data = await client.details(MediaType.MOVIE, 1)
    assert [t["iso_639_1"] for t in data["translations"]["translations"]] == ["es"]
    assert "translations" in respx.calls.last.request.url.params["append_to_response"]
    await client.aclose()
