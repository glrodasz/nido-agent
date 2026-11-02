"""Function tools the agent calls. They return plain dicts (what ADK sends back to the model);
every value carries its source so the model can cite it and never has to invent one."""

from __future__ import annotations

import asyncio
import re
from datetime import UTC, datetime, timedelta
from itertools import zip_longest
from typing import Any
from urllib.parse import quote_plus

from google.adk.tools import ToolContext

from nido.catalog import SERVICES_BY_KEY, SYSTEMS
from nido.config import Settings
from nido.models import FamilyProfile, GuidanceCategory, MediaType, Rating, TitleRef
from nido.ranking import (
    Candidate,
    Ranked,
    age_baseline,
    assess,
    evaluate,
    near_misses,
    shortlist,
)
from nido.sources import tmdb as tmdb_source
from nido.sources.omdb import OmdbClient
from nido.sources.tmdb import TmdbClient
from nido.store import Store

# Session state key holding the family's banned title keys; the server sets it on every chat turn.
HIDDEN_STATE_KEY = "hidden_titles"
# Session state key holding the saved profile's limits ({"children_ages": [...], "avoid": [...]});
# the server sets it on every chat turn. The model writes the tool arguments and whatever the chat
# says can steer it ("my kid is 17 now", "violence is fine"), so the tools hold the saved profile
# as the floor: the model may narrow a search, never loosen it.
GUARD_STATE_KEY = "family_guard"

# Regions one search may cover: each one multiplies the TMDB calls a search makes.
MAX_REGIONS = 5
IMDB_ID = re.compile(r"tt\d{5,10}")


def guarded_ages(requested: list[int], guard: dict[str, Any] | None) -> list[int]:
    """The children who watch this time: only children in the saved profile ("only the 9-year-old
    tonight" keeps [9]); an age the profile does not have falls back to the whole family."""
    saved = [int(a) for a in (guard or {}).get("children_ages") or []]
    if not saved:
        return requested
    kept = [a for a in requested if a in saved]
    return kept or saved


def guarded_avoid(requested: list[str] | None, guard: dict[str, Any] | None) -> list[str]:
    """Categories to avoid: the saved ones always, plus any the parent adds in the chat."""
    saved = list((guard or {}).get("avoid") or [])
    return list(dict.fromkeys([*saved, *(requested or [])]))


def clean_regions(regions: list[str] | None) -> list[str]:
    """Two-letter codes only, at most MAX_REGIONS of them."""
    out = [r.strip().upper() for r in regions or [] if isinstance(r, str)]
    return list(dict.fromkeys(r for r in out if len(r) == 2 and r.isalpha()))[:MAX_REGIONS]


# Discover sorts by worldwide popularity, so for young children its first page is mostly titles
# rated older (a 4-year-old's series pool opens with Raw, Friends and Seinfeld). Details are read
# page by page until ENOUGH_ELIGIBLE titles pass the age and availability rules, so the shortlist
# ranks among titles the family can actually watch, not among whatever happens to be popular.
DISCOVER_PAGE_SIZE = 20
MAX_DISCOVER_PAGES = 8
ENOUGH_ELIGIBLE = 30


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
        # v2: payloads carry videos (trailers); older cached ones do not.
        key = f"tmdb:details:v2:{media_type}:{tmdb_id}:{self._settings.language}"
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
        """Title, ratings and offers from TMDB; the IMDb score is added later (see _rate)."""
        data, retrieved_at = await self._details(media_type, tmdb_id)
        return Candidate(
            title=tmdb_source.parse_title(media_type, data),
            classifications=tmdb_source.parse_classifications(media_type, data, now=retrieved_at),
            availability=[
                offer
                for region in regions
                for offer in tmdb_source.parse_availability(
                    media_type, data, region, now=retrieved_at
                )
            ],
        )

    async def _rate(self, candidate: Candidate) -> None:
        title = candidate.title
        if title.imdb_id:
            candidate.rating = await self._imdb_rating(
                TitleRef(media_type=title.media_type, tmdb_id=title.tmdb_id), title.imdb_id
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
        released_since: int | None = None,
        exclude_genres: list[str] | None = None,
        match_all_genres: bool = False,
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
                For short films ("shorts", "something quick for the little one") use 40.
            min_imdb_rating: lowest acceptable IMDb score, 0-10.
            avoid: content categories to avoid, any of: violence, frightening, language,
                sex_nudity, romance, substances, bullying_discrimination, death_grief,
                imitable_behavior.
            regions: catalog regions to search, ISO codes like ["SE"]; omit for the family's
                default. Only affects where titles can be watched, not age ratings.
            prefer_genres: genres to rank higher without excluding others, e.g. the family's
                favourites.
            released_since: only titles released in this year or later (series: that aired an
                episode since then, so a series still running counts as recent).
            exclude_genres: leave out every title with any of these genres, e.g. ["Comedy"] for
                "animation but no comedy".
            match_all_genres: true when a title needs every genre in `genres`, e.g. a romantic
                comedy is genres ["Comedy", "Romance"] with match_all_genres true.
        """
        # Banned titles and the profile's limits come from session state the server writes each
        # turn, never from the model.
        hidden = tool_context.state.get(HIDDEN_STATE_KEY, []) if tool_context else []
        guard = tool_context.state.get(GUARD_STATE_KEY) if tool_context else None
        return await self.search(
            media_type=media_type,
            children_ages=guarded_ages(children_ages, guard),
            services=services,
            genres=genres,
            max_runtime_min=max_runtime_min,
            min_imdb_rating=min_imdb_rating,
            avoid=guarded_avoid(avoid, guard),
            regions=regions,
            prefer_genres=prefer_genres,
            released_since=released_since,
            exclude_genres=exclude_genres,
            match_all_genres=match_all_genres,
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
        released_since: int | None = None,
        exclude_genres: list[str] | None = None,
        match_all_genres: bool = False,
        hidden: list[str] | None = None,
    ) -> dict[str, Any]:
        """find_titles without the model: `hidden` lists title keys ("movie:123") the family
        banned, which never reach details, ranking or near misses."""
        kind = MediaType(media_type)
        regions = clean_regions(regions) or clean_regions(list(self._settings.regions))
        wanted = genres or prefer_genres or exclude_genres
        available = await self._genres(kind) if wanted else {}
        excluded = tmdb_source.resolve_genres(exclude_genres or [], available)
        # A genre both asked for and excluded is excluded: leaving it out is what was said last.
        required = {
            n: i
            for n, i in tmdb_source.resolve_genres(genres or [], available).items()
            if n not in excluded
        }
        preferred = tmdb_source.resolve_genres(prefer_genres or [], available)
        profile = FamilyProfile(
            children_ages=children_ages,
            regions=regions,
            services=[s for s in services if s in SERVICES_BY_KEY],
            preferred_genres=sorted({*required, *preferred} - set(excluded)),
            avoid_categories=[GuidanceCategory(a) for a in avoid or [] if a in GuidanceCategory],
            max_runtime_min=max_runtime_min,
            min_imdb_rating=min_imdb_rating,
        )
        candidates = await self._pool(
            kind,
            regions,
            profile,
            required,
            set(hidden or []),
            released_since,
            excluded,
            match_all_genres,
        )
        # OMDb's free key allows about 1,000 calls a day: only titles that pass the age and
        # availability rules are worth an IMDb lookup.
        unrated = profile.model_copy(update={"min_imdb_rating": None})
        await asyncio.gather(*(self._rate(c) for c in candidates if evaluate(c, unrated)))
        ranked = shortlist(candidates, profile)
        # Nothing to suggest is a dead end: show the closest titles, labelled with what they miss.
        missed = [] if ranked else near_misses(candidates, profile)
        ignored = [g for g in genres or [] if not tmdb_source.resolve_genres([g], available)]
        return {
            "regions": regions,
            **({"ignored_genres": ignored} if ignored else {}),
            "results": [_present(r, regions) for r in ranked],
            "near_misses": [_present(r, regions) for r in missed],
            "attribution": "Metadata: TMDB. Streaming availability: JustWatch via TMDB.",
        }

    async def _pool(
        self,
        kind: MediaType,
        regions: list[str],
        profile: FamilyProfile,
        genres: dict[str, int],
        hidden: set[str],
        released_since: int | None = None,
        excluded: dict[str, int] | None = None,
        all_genres: bool = False,
    ) -> list[Candidate]:
        """Candidates read one discover page at a time (every region's page interleaved), until
        ENOUGH_ELIGIBLE pass the age and availability rules or discover runs out. Banned titles
        are skipped before their details are read; titles with an excluded genre never count."""
        excluded = excluded or {}
        tmdb, _ = self._clients()
        unrated = profile.model_copy(update={"min_imdb_rating": None})
        seen: set[int] = set()
        candidates: list[Candidate] = []
        for page in range(1, MAX_DISCOVER_PAGES + 1):
            pages = await asyncio.gather(
                *(
                    self._discover(
                        tmdb,
                        kind,
                        region,
                        profile,
                        list(genres.values()),
                        page,
                        released_since,
                        list(excluded.values()),
                        all_genres,
                    )
                    for region in regions
                )
            )
            ids = [
                tmdb_id
                for tmdb_id in _interleave(pages)
                if tmdb_id not in seen
                and TitleRef(media_type=kind, tmdb_id=tmdb_id).key not in hidden
            ]
            seen.update(ids)
            fetched = await asyncio.gather(
                *(self._candidate(kind, tmdb_id, regions) for tmdb_id in ids)
            )
            # Discover already leaves them out; the details are checked too, so an excluded
            # genre can never slip in, not even as a near miss.
            candidates += [
                c
                for c in fetched
                if not set(c.title.genres) & set(excluded)
                and (not all_genres or set(genres) <= set(c.title.genres))
            ]
            eligible = sum(1 for c in candidates if evaluate(c, unrated))
            if eligible >= ENOUGH_ELIGIBLE or all(len(p) < DISCOVER_PAGE_SIZE for p in pages):
                break
        return candidates

    async def _discover(
        self,
        tmdb: TmdbClient,
        kind: MediaType,
        region: str,
        profile: FamilyProfile,
        genre_ids: list[int],
        page: int,
        released_since: int | None = None,
        without_genre_ids: list[int] | None = None,
        all_genres: bool = False,
    ) -> list[int]:
        providers = await self._provider_ids(kind, region)
        provider_ids = [pid for key in profile.services for pid in providers.get(key, [])]
        found = await tmdb.discover(
            kind,
            region=region,
            provider_ids=provider_ids,
            genre_ids=genre_ids,
            without_genre_ids=without_genre_ids or [],
            all_genres=all_genres,
            max_certification=prefilter_certification(profile.youngest, kind),
            certification_country="US",
            max_runtime_min=profile.max_runtime_min if kind is MediaType.MOVIE else None,
            min_year=released_since,
            page=page,
        )
        return [t.tmdb_id for t in found]

    async def look_up_title(
        self,
        name: str,
        media_type: str,
        children_ages: list[int],
        services: list[str],
        max_runtime_min: int | None = None,
        min_imdb_rating: float | None = None,
        avoid: list[str] | None = None,
        regions: list[str] | None = None,
        tool_context: ToolContext | None = None,
    ) -> dict[str, Any]:
        """Check one title the parent names, e.g. "is Bluey OK for us?". Use it instead of
        find_titles when the parent asks about a specific movie or series.

        Args:
            name: the title's name, e.g. "Gabby's Dollhouse".
            media_type: "movie" or "tv".
            children_ages: ages of the children who will watch, e.g. [6, 9].
            services: subscribed services, any of: netflix, disney_plus, hbo_max, prime_video,
                apple_tv_plus.
            max_runtime_min: longest acceptable runtime in minutes (episode length for series).
                For short films ("shorts", "something quick for the little one") use 40.
            min_imdb_rating: lowest acceptable IMDb score, 0-10.
            avoid: content categories to avoid (same values as find_titles).
            regions: catalog regions, ISO codes like ["SE"]; omit for the family's default.
        """
        hidden = tool_context.state.get(HIDDEN_STATE_KEY, []) if tool_context else []
        guard = tool_context.state.get(GUARD_STATE_KEY) if tool_context else None
        return await self.look_up(
            name,
            media_type,
            guarded_ages(children_ages, guard),
            services,
            max_runtime_min=max_runtime_min,
            min_imdb_rating=min_imdb_rating,
            avoid=guarded_avoid(avoid, guard),
            regions=regions,
            hidden=hidden,
        )

    async def look_up(
        self,
        name: str,
        media_type: str,
        children_ages: list[int],
        services: list[str],
        max_runtime_min: int | None = None,
        min_imdb_rating: float | None = None,
        avoid: list[str] | None = None,
        regions: list[str] | None = None,
        hidden: list[str] | None = None,
    ) -> dict[str, Any]:
        """look_up_title without the model. The title lands in "results" when it fits the family
        and in "near_misses", with what it misses, when it does not."""
        kind = MediaType(media_type)
        regions = clean_regions(regions) or clean_regions(list(self._settings.regions))
        profile = FamilyProfile(
            children_ages=children_ages,
            regions=regions,
            services=[s for s in services if s in SERVICES_BY_KEY],
            avoid_categories=[GuidanceCategory(a) for a in avoid or [] if a in GuidanceCategory],
            max_runtime_min=max_runtime_min,
            min_imdb_rating=min_imdb_rating,
        )
        out: dict[str, Any] = {
            "regions": regions,
            "results": [],
            "near_misses": [],
            "attribution": "Metadata: TMDB. Streaming availability: JustWatch via TMDB.",
        }
        tmdb, _ = self._clients()
        found = await tmdb.search(kind, name)
        if not found:
            return {**out, "not_found": name}
        ref = TitleRef(media_type=kind, tmdb_id=found[0].tmdb_id)
        if ref.key in set(hidden or []):
            return {
                **out,
                "hidden": found[0].name,
                "note": "The family marked this title Don't suggest: say so, never recommend it.",
            }
        candidate = await self._candidate(kind, ref.tmdb_id, regions)
        await self._rate(candidate)
        ranked = assess(candidate, profile)
        if ranked is None:
            return {**out, "not_available": candidate.title.name}
        bucket = "near_misses" if ranked.misses else "results"
        return {**out, bucket: [_present(ranked, regions)]}

    async def details(
        self, media_type: str, tmdb_id: int, profile: FamilyProfile
    ) -> dict[str, Any]:
        """One title the family already knows (from the watchlist or its marks), as a result card
        judged against its profile. Unlike look_up it never drops the title: one that is not
        streaming in the family's regions still opens, with a caution saying so."""
        kind = MediaType(media_type)
        regions = clean_regions(profile.regions) or clean_regions(list(self._settings.regions))
        profile = profile.model_copy(update={"regions": regions})
        candidate = await self._candidate(kind, tmdb_id, regions)
        await self._rate(candidate)
        ranked = assess(candidate, profile)
        if ranked is None:
            baseline = age_baseline(candidate.classifications)
            misses = (
                [f"Rated {baseline.age}+, and your youngest is {profile.youngest}."]
                if baseline and baseline.age > profile.youngest
                else []
            )
            ranked = Ranked(
                candidate=candidate,
                score=0.0,
                included=False,
                baseline=baseline,
                reasons=[],
                cautions=["Not streaming in your regions right now."],
                misses=misses,
            )
        return _present(ranked, regions)

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
        # The id lands in a URL path, so only a real IMDb id is used.
        if imdb_id and IMDB_ID.fullmatch(imdb_id):
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
        # Movie release, or a series' latest episode: what the Find page sorts newest first by.
        "released_on": t.latest_date.isoformat() if t.latest_date else None,
        "runtime_min": t.runtime_min,
        "genres": t.genres,
        "synopsis": t.synopsis,
        "poster_url": str(t.poster_url) if t.poster_url else None,
        "trailers": t.trailers,
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
