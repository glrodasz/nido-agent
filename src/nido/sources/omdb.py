"""OMDb API: IMDb rating and vote count by IMDb id (https://www.omdbapi.com/).

OMDb is an unofficial mirror of IMDb data; ratings are always shown with "IMDb (via OMDb)" as
their source. The free key allows about 1,000 requests a day, so callers cache results.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx

from nido.models import Rating, TitleRef

BASE_URL = "https://www.omdbapi.com/"
SOURCE = "IMDb (via OMDb)"


class OmdbClient:
    def __init__(
        self, api_key: str, *, timeout_s: float = 20.0, http: httpx.AsyncClient | None = None
    ) -> None:
        self._key = api_key
        self._http = http or httpx.AsyncClient(timeout=timeout_s)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def imdb_rating(self, ref: TitleRef, imdb_id: str) -> Rating | None:
        response = await self._http.get(BASE_URL, params={"apikey": self._key, "i": imdb_id})
        response.raise_for_status()
        return parse_rating(ref, imdb_id, response.json())


def _number(value: str | None) -> float | None:
    if not value or value == "N/A":
        return None
    try:
        return float(value.replace(",", ""))
    except ValueError:
        return None


def parse_rating(
    ref: TitleRef, imdb_id: str, data: dict[str, Any], *, now: datetime | None = None
) -> Rating | None:
    """None when OMDb has no rating: Nido never shows a score it cannot source."""
    if data.get("Response") != "True":
        return None
    score = _number(data.get("imdbRating"))
    if score is None:
        return None
    votes = _number(data.get("imdbVotes"))
    return Rating(
        title=ref,
        source=SOURCE,
        score=score,
        votes=int(votes) if votes is not None else None,
        source_url=f"https://www.imdb.com/title/{imdb_id}/",
        retrieved_at=now or datetime.now(UTC),
    )


__all__ = ["SOURCE", "OmdbClient", "parse_rating"]
