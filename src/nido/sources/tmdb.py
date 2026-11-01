"""TMDB API v3: titles, per-country certifications and watch providers.

Watch provider data on TMDB comes from JustWatch; anything that displays it must credit JustWatch.
TMDB's free API is for non-commercial use with attribution (https://www.themoviedb.org/api-terms-of-use).
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, date, datetime
from typing import Any

import httpx

from nido.catalog import SYSTEMS, min_age_for, service_for_provider
from nido.models import (
    AccessType,
    Availability,
    Classification,
    MediaType,
    Title,
    TitleRef,
)

BASE_URL = "https://api.themoviedb.org/3"
IMAGE_BASE = "https://image.tmdb.org/t/p/w342"
SOURCE = "TMDB"
PROVIDER_SOURCE = "TMDB (JustWatch)"

# TMDB watch provider buckets -> how the family would get the title.
_ACCESS = {
    "flatrate": AccessType.SUBSCRIPTION,
    "ads": AccessType.ADS,
    "rent": AccessType.RENT,
    "buy": AccessType.BUY,
}


class TmdbClient:
    def __init__(
        self,
        token: str,
        *,
        language: str = "en-US",
        timeout_s: float = 20.0,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self._language = language
        self._http = http or httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=timeout_s,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _get(self, path: str, **params: Any) -> dict[str, Any]:
        params = {k: v for k, v in params.items() if v is not None}
        params.setdefault("language", self._language)
        response = await self._http.get(path, params=params)
        response.raise_for_status()
        return response.json()

    async def provider_ids(self, media_type: MediaType, region: str) -> dict[str, list[int]]:
        """Supported service key -> TMDB provider ids in `region`."""
        data = await self._get(f"/watch/providers/{media_type}", watch_region=region)
        out: dict[str, list[int]] = {}
        for provider in data.get("results", []):
            service = service_for_provider(provider.get("provider_name", ""))
            if service:
                out.setdefault(service.key, []).append(int(provider["provider_id"]))
        return out

    async def discover(
        self,
        media_type: MediaType,
        *,
        region: str,
        provider_ids: Iterable[int] = (),
        genre_ids: Iterable[int] = (),
        max_certification: str | None = None,
        certification_country: str | None = None,
        max_runtime_min: int | None = None,
        min_vote_average: float | None = None,
        min_year: int | None = None,
        page: int = 1,
    ) -> list[Title]:
        params: dict[str, Any] = {
            "watch_region": region,
            "sort_by": "popularity.desc",
            "include_adult": "false",
            "page": page,
            "with_watch_providers": "|".join(str(p) for p in provider_ids) or None,
            "with_watch_monetization_types": "flatrate|ads" if provider_ids else None,
            "with_genres": "|".join(str(g) for g in genre_ids) or None,
            "with_runtime.lte": max_runtime_min,
            # TMDB stores an unknown runtime as 0, which would pass any limit.
            "with_runtime.gte": 1 if max_runtime_min else None,
            "vote_average.gte": min_vote_average,
            "vote_count.gte": 200 if min_vote_average else None,
        }
        if max_certification:
            # The certification scale is a country's own: "PG-13" means nothing in SE.
            params["certification_country"] = certification_country or region
            params["certification.lte"] = max_certification
        if min_year:
            # A series counts as recent while it still airs: Bluey started in 2018 but is new
            # every season, so series are filtered by any episode's air date, not the first.
            key = "primary_release_date.gte" if media_type is MediaType.MOVIE else "air_date.gte"
            params[key] = f"{min_year}-01-01"
        data = await self._get(f"/discover/{media_type}", **params)
        return [parse_title(media_type, item) for item in data.get("results", [])]

    async def search(self, media_type: MediaType, query: str) -> list[Title]:
        """Titles matching a name, best match first."""
        data = await self._get(f"/search/{media_type}", query=query, include_adult="false")
        return [parse_title(media_type, item) for item in data.get("results", [])]

    async def genres(self, media_type: MediaType) -> dict[str, int]:
        """TMDB genre name -> id. Movies and series have different lists."""
        data = await self._get(f"/genre/{media_type}/list")
        return {g["name"]: int(g["id"]) for g in data.get("genres", []) if "name" in g}

    async def details(self, media_type: MediaType, tmdb_id: int) -> dict[str, Any]:
        """Raw details with certifications, external ids and watch providers in one request."""
        ratings = "release_dates" if media_type is MediaType.MOVIE else "content_ratings"
        return await self._get(
            f"/{media_type}/{tmdb_id}",
            append_to_response=f"{ratings},external_ids,watch/providers",
        )


# Series genres are compound ("Action & Adventure", "Sci-Fi & Fantasy"); these spellings name
# the same part.
_GENRE_ALIASES = {"science fiction": "sci-fi"}


def resolve_genres(requested: Iterable[str], available: dict[str, int]) -> dict[str, int]:
    """Requested genre names -> the matching TMDB genres (name -> id) for one media type.

    "Adventure" matches the movie genre "Adventure" and the series genre "Action & Adventure".
    Names TMDB does not have for this media type are dropped.
    """
    out: dict[str, int] = {}
    for wanted in requested:
        key = wanted.strip().lower()
        # Movies call it "Science Fiction", series "Sci-Fi & Fantasy": match either spelling.
        keys = {key, _GENRE_ALIASES.get(key, key)}
        for name, genre_id in available.items():
            parts = {p.strip().lower() for p in name.split("&")}
            if name.lower() in keys or keys & parts:
                out[name] = genre_id
    return out


def _access_for(bucket: str, provider_name: str) -> AccessType:
    """Subscription channels sold inside another service ("HBO Max Amazon Channel") cost extra."""
    if bucket == "flatrate" and "channel" in provider_name.lower():
        return AccessType.ADDON
    return _ACCESS[bucket]


def _year(date: str | None) -> int | None:
    return int(date[:4]) if date and len(date) >= 4 and date[:4].isdigit() else None


def _date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def parse_title(media_type: MediaType, data: dict[str, Any]) -> Title:
    """A discover result or a details payload -> Title."""
    is_movie = media_type is MediaType.MOVIE
    runtime = data.get("runtime")
    if not is_movie and not runtime:
        episode_runtimes = data.get("episode_run_time") or []
        runtime = episode_runtimes[0] if episode_runtimes else None
    genres = [g["name"] for g in data.get("genres", []) if "name" in g]
    poster = data.get("poster_path")
    released = data.get("release_date") if is_movie else data.get("first_air_date")
    imdb_id = data.get("imdb_id") or (data.get("external_ids") or {}).get("imdb_id")
    return Title(
        media_type=media_type,
        tmdb_id=int(data["id"]),
        imdb_id=imdb_id or None,
        name=data.get("title") or data.get("name") or "",
        year=_year(released),
        release_date=_date(released),
        last_air_date=None if is_movie else _date(data.get("last_air_date")),
        runtime_min=runtime or None,
        season_count=None if is_movie else data.get("number_of_seasons"),
        genres=genres,
        synopsis=data.get("overview") or "",
        poster_url=f"{IMAGE_BASE}{poster}" if poster else None,
    )


def parse_classifications(
    media_type: MediaType,
    data: dict[str, Any],
    regions: Iterable[str] | None = None,
    *,
    now: datetime | None = None,
) -> list[Classification]:
    """Official certifications from a details payload, for `regions` (default: every country in
    catalog.SYSTEMS). Empty values are dropped; one record per (country, value)."""
    now = now or datetime.now(UTC)
    wanted = {r.upper() for r in regions} if regions is not None else set(SYSTEMS)
    ref = TitleRef(media_type=media_type, tmdb_id=int(data["id"]))
    out: dict[tuple[str, str], Classification] = {}

    def add(country: str, value: str, descriptors: list[str], version: str | None) -> None:
        value = value.strip()
        if country not in wanted or not value or (country, value) in out:
            return
        system = SYSTEMS.get(country)
        out[(country, value)] = Classification(
            title=ref,
            region=country,
            issuer=system.issuer if system else f"{country} classification (via TMDB)",
            value=value,
            min_age=min_age_for(country, value),
            descriptors=descriptors,
            version=version,
            source=SOURCE,
            retrieved_at=now,
        )

    if media_type is MediaType.MOVIE:
        for country in (data.get("release_dates") or {}).get("results", []):
            for release in country.get("release_dates", []):
                add(
                    country.get("iso_3166_1", ""),
                    release.get("certification") or "",
                    list(release.get("descriptors") or []),
                    release.get("note") or None,
                )
    else:
        for rating in (data.get("content_ratings") or {}).get("results", []):
            add(
                rating.get("iso_3166_1", ""),
                rating.get("rating") or "",
                list(rating.get("descriptors") or []),
                None,
            )
    return list(out.values())


def parse_availability(
    media_type: MediaType, data: dict[str, Any], region: str, *, now: datetime | None = None
) -> list[Availability]:
    now = now or datetime.now(UTC)
    ref = TitleRef(media_type=media_type, tmdb_id=int(data["id"]))
    country = ((data.get("watch/providers") or {}).get("results") or {}).get(region.upper())
    if not country:
        return []
    out: list[Availability] = []
    for bucket in _ACCESS:
        for provider in country.get(bucket, []):
            name = provider.get("provider_name", "")
            service = service_for_provider(name)
            out.append(
                Availability(
                    title=ref,
                    region=region.upper(),
                    service_key=service.key if service else None,
                    provider_name=name,
                    access=_access_for(bucket, name),
                    link=country.get("link"),
                    source=PROVIDER_SOURCE,
                    verified_at=now,
                )
            )
    return out
