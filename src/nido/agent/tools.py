"""Function tools the agent calls. They return plain dicts (what ADK sends back to the model);
every value carries its source so the model can cite it and never has to invent one."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from itertools import zip_longest
from typing import Any
from urllib.parse import quote_plus

from google.adk.tools import ToolContext

from nido.catalog import SERVICES_BY_KEY, SYSTEMS
from nido.config import Settings
from nido.models import FamilyProfile, GuidanceCategory, MediaType, Rating, TitleRef
from nido.ranking import Candidate, Ranked, near_misses, shortlist
from nido.sources import tmdb as tmdb_source
from nido.sources.omdb import OmdbClient
from nido.sources.tmdb import TmdbClient
from nido.store import Store

# Session state key holding the family's banned title keys; the server sets it on every chat turn.
HIDDEN_STATE_KEY = "hidden_titles"

# Details requests per search: discover returns 20 per page, the shortlist needs 5.
MAX_DETAILS = 12


# Cache lifetimes. Offers change monthly, so details (which carry them) are re-fetched daily; the
# OMDb free key allows about 1,000 calls a day, so IMDb scores are kept for a week.
DETAILS_TTL = timedelta(days=1)
PROVIDERS_TTL = timedelta(days=7)
RATING_TTL = timedelta(days=7)


# Discover filters by one country's certification. US ratings are the most complete on TMDB, so
# they pre-filter the pool one step looser than the child's age (a title that is US PG-13 can
# still have a median of 11); the homologated baseline decides afterwards. Orders follow TMDB's
# /certification/{movie,tv}/list, which `certification.lte` compares by.
US_ORDER = {
    MediaType.MOVIE: ("G", "PG", "PG-13", "R", "NC-17"),
    MediaType.TV: ("TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"),
}


def prefilter_certification(youngest: int, kind: MediaType = MediaType.MOVIE) -> str:
    """Loosest US rating worth fetching details for, given the youngest child's age."""
    us = SYSTEMS["US"]
    order = US_ORDER[kind]
    allowed = [i for i, v in enumerate(order) if (us.age_for(v) or 0) <= youngest]
    return order[min(max(allowed, default=-1) + 1, len(order) - 1)]


class Toolbox:
    def __init__(self, settings: Settings, cache: Store | None = None) -> None:
        self._settings = settings
        self._cache = cache
        self._tmdb: TmdbClient | None = None
        self._omdb: OmdbClient | None = None

    def _clients(self) -> tuple[TmdbClient, OmdbClient | None]:
        if not self._settings.tmdb_token:
            raise RuntimeError("TMDB_API_TOKEN is not set")
        if self._tmdb is None:
            self._tmdb = TmdbClient(
                self._settings.tmdb_token,
                language=self._settings.language,
                timeout_s=self._settings.http_timeout_s,
            )
        if self._omdb is None and self._settings.omdb_key:
            self._omdb = OmdbClient(
                self._settings.omdb_key, timeout_s=self._settings.http_timeout_s
            )
        return self._tmdb, self._omdb

    async def _cached(
        self, key: str, ttl: timedelta, fetch: Any
    ) -> tuple[dict[str, Any], datetime]:
        """`fetch()` through the cache; returns the payload and when it was really retrieved."""
        if self._cache is not None:
            hit = await self._cache.cache_get(key, ttl)
            if hit is not None:
                return hit.data, hit.retrieved_at
        data = await fetch()
        if self._cache is not None:
            return data, await self._cache.cache_put(key, data, ttl)
        return data, datetime.now(UTC)

    async def _details(
        self, media_type: MediaType, tmdb_id: int
    ) -> tuple[dict[str, Any], datetime]:
        tmdb, _ = self._clients()
        key = f"tmdb:details:{media_type}:{tmdb_id}:{self._settings.language}"
        return await self._cached(key, DETAILS_TTL, lambda: tmdb.details(media_type, tmdb_id))

    async def _provider_ids(self, kind: MediaType, region: str) -> dict[str, list[int]]:
        tmdb, _ = self._clients()
        data, _ = await self._cached(
            f"tmdb:providers:{kind}:{region}",
            PROVIDERS_TTL,
            lambda: tmdb.provider_ids(kind, region),
        )
        return data

    async def _genres(self, kind: MediaType) -> dict[str, int]:
        tmdb, _ = self._clients()
        data, _ = await self._cached(
            f"tmdb:genres:{kind}:{self._settings.language}",
            PROVIDERS_TTL,
            lambda: tmdb.genres(kind),
        )
        return data

    async def _imdb_rating(self, ref: TitleRef, imdb_id: str) -> Rating | None:
        _, omdb = self._clients()
        if omdb is None:
            return None

        async def fetch() -> dict[str, Any]:
            rating = await omdb.imdb_rating(ref, imdb_id)
            # A miss is cached too, so a title OMDb lacks does not spend a call on every search.
            return {"rating": rating.model_dump(mode="json") if rating else None}

        data, _ = await self._cached(f"omdb:{imdb_id}", RATING_TTL, fetch)
        return Rating.model_validate(data["rating"]) if data.get("rating") else None

    async def _candidate(
        self, media_type: MediaType, tmdb_id: int, regions: list[str]
    ) -> Candidate:
        data, retrieved_at = await self._details(media_type, tmdb_id)
        title = tmdb_source.parse_title(media_type, data)
        rating = None
        if title.imdb_id:
            rating = await self._imdb_rating(
                TitleRef(media_type=media_type, tmdb_id=tmdb_id), title.imdb_id
            )
        return Candidate(
            title=title,
            classifications=tmdb_source.parse_classifications(media_type, data, now=retrieved_at),
            availability=[
                offer
                for region in regions
                for offer in tmdb_source.parse_availability(
                    media_type, data, region, now=retrieved_at
                )
            ],
            rating=rating,
        )

    async def find_titles(
        self,
        media_type: str,
        children_ages: list[int],
        services: list[str],
        genres: list[str] | None = None,
        max_runtime_min: int | None = None,
        min_imdb_rating: float | None = None,
        avoid: list[str] | None = None,
        regions: list[str] | None = None,
        prefer_genres: list[str] | None = None,
        tool_context: ToolContext | None = None,
    ) -> dict[str, Any]:
        """Find a short, ranked list of movies or series for the family.

        Args:
            media_type: "movie" or "tv".
            children_ages: ages of the children who will watch, e.g. [6, 9].
            services: subscribed services, any of: netflix, disney_plus, hbo_max, prime_video,
                apple_tv_plus.
            genres: only titles with at least one of these genres, e.g. ["Adventure", "Comedy"].
            max_runtime_min: longest acceptable runtime in minutes (episode length for series).
            min_imdb_rating: lowest acceptable IMDb score, 0-10.
            avoid: content categories to avoid, any of: violence, frightening, language,
                sex_nudity, romance, substances, bullying_discrimination, death_grief,
                imitable_behavior.
            regions: catalog regions to search, ISO codes like ["SE"]; omit for the family's
                default. Only affects where titles can be watched, not age ratings.
            prefer_genres: genres to rank higher without excluding others, e.g. the family's
                favourites.
        """
        # Banned titles come from session state the server writes each turn, never from the model.
        hidden = tool_context.state.get(HIDDEN_STATE_KEY, []) if tool_context else []
        return await self.search(
            media_type=media_type,
            children_ages=children_ages,
            services=services,
            genres=genres,
            max_runtime_min=max_runtime_min,
            min_imdb_rating=min_imdb_rating,
            avoid=avoid,
            regions=regions,
            prefer_genres=prefer_genres,
            hidden=hidden,
        )

    async def search(
        self,
        media_type: str,
        children_ages: list[int],
        services: list[str],
        genres: list[str] | None = None,
        max_runtime_min: int | None = None,
        min_imdb_rating: float | None = None,
        avoid: list[str] | None = None,
        regions: list[str] | None = None,
        prefer_genres: list[str] | None = None,
        hidden: list[str] | None = None,
    ) -> dict[str, Any]:
        """find_titles without the model: `hidden` lists title keys ("movie:123") the family
        banned, which never reach details, ranking or near misses."""
        kind = MediaType(media_type)
        regions = [r.upper() for r in regions or self._settings.regions]
        available = await self._genres(kind) if genres or prefer_genres else {}
        required = tmdb_source.resolve_genres(genres or [], available)
        preferred = tmdb_source.resolve_genres(prefer_genres or [], available)
        profile = FamilyProfile(
            children_ages=children_ages,
            regions=regions,
            services=[s for s in services if s in SERVICES_BY_KEY],
            preferred_genres=sorted({*required, *preferred}),
            avoid_categories=[GuidanceCategory(a) for a in avoid or [] if a in GuidanceCategory],
            max_runtime_min=max_runtime_min,
            min_imdb_rating=min_imdb_rating,
        )
        tmdb, _ = self._clients()
        per_region = await asyncio.gather(
            *(
                self._discover(tmdb, kind, region, profile, list(required.values()))
                for region in regions
            )
        )
        skip = set(hidden or [])
        tmdb_ids = [
            tmdb_id
            for tmdb_id in _interleave(per_region)
            if TitleRef(media_type=kind, tmdb_id=tmdb_id).key not in skip
        ][:MAX_DETAILS]
        candidates = await asyncio.gather(
            *(self._candidate(kind, tmdb_id, regions) for tmdb_id in tmdb_ids)
        )
        ranked = shortlist(list(candidates), profile)
        # Nothing to suggest is a dead end: show the closest titles, labelled with what they miss.
        missed = [] if ranked else near_misses(list(candidates), profile)
        ignored = [g for g in genres or [] if not tmdb_source.resolve_genres([g], available)]
        return {
            "regions": regions,
            **({"ignored_genres": ignored} if ignored else {}),
            "results": [_present(r, regions) for r in ranked],
            "near_misses": [_present(r, regions) for r in missed],
            "attribution": "Metadata: TMDB. Streaming availability: JustWatch via TMDB.",
        }

    async def _discover(
        self,
        tmdb: TmdbClient,
        kind: MediaType,
        region: str,
        profile: FamilyProfile,
        genre_ids: list[int],
    ) -> list[int]:
        providers = await self._provider_ids(kind, region)
        provider_ids = [pid for key in profile.services for pid in providers.get(key, [])]
        found = await tmdb.discover(
            kind,
            region=region,
            provider_ids=provider_ids,
            genre_ids=genre_ids,
            max_certification=prefilter_certification(profile.youngest, kind),
            certification_country="US",
            max_runtime_min=profile.max_runtime_min if kind is MediaType.MOVIE else None,
        )
        return [t.tmdb_id for t in found]

    def guidance_links(self, title: str, imdb_id: str | None = None) -> dict[str, Any]:
        """Links to parental guidance sources for one title. Use them to point parents to the
        source; do not claim anything about the content that these links do not support.

        Args:
            title: the title's name.
            imdb_id: the IMDb id (tt...), when known.
        """
        q = quote_plus(title)
        links = {
            "Common Sense Media": f"https://www.commonsensemedia.org/search/{q}",
        }
        if imdb_id:
            links["IMDb Parents Guide"] = f"https://www.imdb.com/title/{imdb_id}/parentalguide"
        return {"links": links, "evidence": "none collected yet; links only"}


def _interleave(lists: list[list[int]]) -> list[int]:
    """Round-robin merge without duplicates, so every region contributes its top titles."""
    seen: set[int] = set()
    out: list[int] = []
    for group in zip_longest(*lists):
        for tmdb_id in group:
            if tmdb_id is not None and tmdb_id not in seen:
                seen.add(tmdb_id)
                out.append(tmdb_id)
    return out


def _present(ranked: Ranked, regions: list[str]) -> dict[str, Any]:
    c = ranked.candidate
    t = c.title
    return {
        "title": t.name,
        "media_type": t.media_type,
        "tmdb_id": t.tmdb_id,
        "imdb_id": t.imdb_id,
        "year": t.year,
        "runtime_min": t.runtime_min,
        "genres": t.genres,
        "synopsis": t.synopsis,
        "poster_url": str(t.poster_url) if t.poster_url else None,
        "imdb": (
            {
                "score": c.rating.score,
                "votes": c.rating.votes,
                "source": c.rating.source,
                "url": str(c.rating.source_url) if c.rating.source_url else None,
                "retrieved_at": c.rating.retrieved_at.isoformat(),
            }
            if c.rating
            else None
        ),
        "age_baseline": ranked.baseline.describe() if ranked.baseline else None,
        "age_baseline_min": ranked.baseline.age if ranked.baseline else None,
        "official_classifications": [
            {"value": x.value, "issuer": x.issuer, "country": x.region, "source": x.source}
            for x in c.classifications
        ],
        "where_to_watch": [
            {
                "region": a.region,
                "provider": a.provider_name,
                "service": a.service_key,
                "access": a.access,
                "link": str(a.link) if a.link else None,
                "source": a.source,
                "verified_at": a.verified_at.isoformat(),
            }
            for a in c.availability
            if a.region in regions
        ],
        "included_in_subscriptions": ranked.included,
        "why": ranked.reasons,
        "cautions": ranked.cautions,
        "misses": ranked.misses,
    }
