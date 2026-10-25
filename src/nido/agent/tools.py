"""Function tools the agent calls. They return plain dicts (what ADK sends back to the model);
every value carries its source so the model can cite it and never has to invent one."""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import quote_plus

from nido.catalog import SERVICES_BY_KEY, SYSTEMS
from nido.config import Settings
from nido.models import FamilyProfile, GuidanceCategory, MediaType, TitleRef
from nido.ranking import Candidate, Ranked, shortlist
from nido.sources import tmdb as tmdb_source
from nido.sources.omdb import OmdbClient
from nido.sources.tmdb import TmdbClient

# Details requests per search: discover returns 20 per page, the shortlist needs 5.
MAX_DETAILS = 12


def max_certification(region: str, youngest: int) -> str | None:
    """Highest official value the youngest child is old enough for, in TMDB's spelling."""
    system = SYSTEMS.get(region.upper())
    if system is None:
        return None
    allowed = [(age, value) for value, age in system.min_age.items() if age <= youngest]
    value = max(allowed)[1] if allowed else None
    return value.capitalize() if value == "btl" else value


class Toolbox:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
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

    async def _candidate(self, media_type: MediaType, tmdb_id: int, region: str) -> Candidate:
        tmdb, omdb = self._clients()
        data = await tmdb.details(media_type, tmdb_id)
        title = tmdb_source.parse_title(media_type, data)
        rating = None
        if omdb and title.imdb_id:
            rating = await omdb.imdb_rating(
                TitleRef(media_type=media_type, tmdb_id=tmdb_id), title.imdb_id
            )
        return Candidate(
            title=title,
            classifications=tmdb_source.parse_classifications(media_type, data, region),
            availability=tmdb_source.parse_availability(media_type, data, region),
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
    ) -> dict[str, Any]:
        """Find a short, ranked list of movies or series for the family.

        Args:
            media_type: "movie" or "tv".
            children_ages: ages of the children who will watch, e.g. [6, 9].
            services: subscribed services, any of: netflix, disney_plus, hbo_max, prime_video,
                apple_tv_plus.
            genres: TMDB genre names the family wants, e.g. ["Adventure", "Comedy"].
            max_runtime_min: longest acceptable runtime in minutes (episode length for series).
            min_imdb_rating: lowest acceptable IMDb score, 0-10.
            avoid: content categories to avoid, any of: violence, frightening, language,
                sex_nudity, romance, substances, bullying_discrimination, death_grief,
                imitable_behavior.
        """
        kind = MediaType(media_type)
        region = self._settings.region
        profile = FamilyProfile(
            children_ages=children_ages,
            region=region,
            services=[s for s in services if s in SERVICES_BY_KEY],
            preferred_genres=genres or [],
            avoid_categories=[GuidanceCategory(a) for a in avoid or [] if a in GuidanceCategory],
            max_runtime_min=max_runtime_min,
            min_imdb_rating=min_imdb_rating,
        )
        tmdb, _ = self._clients()
        providers = await tmdb.provider_ids(kind, region)
        provider_ids = [pid for key in profile.services for pid in providers.get(key, [])]
        found = await tmdb.discover(
            kind,
            region=region,
            provider_ids=provider_ids,
            max_certification=max_certification(region, profile.youngest),
            max_runtime_min=max_runtime_min if kind is MediaType.MOVIE else None,
            min_vote_average=min_imdb_rating,
        )
        candidates = await asyncio.gather(
            *(self._candidate(kind, t.tmdb_id, region) for t in found[:MAX_DETAILS])
        )
        ranked = shortlist(list(candidates), profile)
        return {
            "region": region,
            "results": [_present(r, region) for r in ranked],
            "attribution": "Metadata: TMDB. Streaming availability: JustWatch via TMDB.",
        }

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
            "Statens medieråd": "https://www.statensmedierad.se/",
        }
        if imdb_id:
            links["IMDb Parents Guide"] = f"https://www.imdb.com/title/{imdb_id}/parentalguide"
        return {"links": links, "evidence": "none collected yet; links only"}


def _present(ranked: Ranked, region: str) -> dict[str, Any]:
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
        "imdb": (
            {"score": c.rating.score, "votes": c.rating.votes, "source": c.rating.source}
            if c.rating
            else None
        ),
        "official_classification": [
            {"value": x.value, "issuer": x.issuer, "region": x.region, "source": x.source}
            for x in c.classifications
        ],
        "where_to_watch": [
            {
                "provider": a.provider_name,
                "access": a.access,
                "link": str(a.link) if a.link else None,
            }
            for a in c.availability
            if a.region == region.upper()
        ],
        "included_in_subscriptions": ranked.included,
        "why": ranked.reasons,
        "cautions": ranked.cautions,
    }
