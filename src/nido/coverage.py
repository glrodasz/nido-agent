"""Phase 0 data check: how much of each service's catalog in a region has what Nido needs.

For the most popular titles per service it measures the share with an official classification
for the region and for any reference country (catalog.SYSTEMS), an IMDb id (needed for ratings)
and a watch link. Run: `nido coverage`.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from nido.catalog import SERVICES
from nido.models import MediaType
from nido.sources import tmdb as tmdb_source
from nido.sources.tmdb import TmdbClient


@dataclass
class CoverageRow:
    service: str
    media_type: MediaType
    sampled: int
    rated_local: int
    rated_any: int
    imdb_ids: int
    links: int

    def pct(self, n: int) -> str:
        return f"{100 * n / self.sampled:.0f}%" if self.sampled else "n/a"


async def measure(
    tmdb: TmdbClient, region: str, *, per_service: int = 20
) -> tuple[list[CoverageRow], list[str]]:
    rows: list[CoverageRow] = []
    unmatched: list[str] = []
    for kind in MediaType:
        providers = await tmdb.provider_ids(kind, region)
        for service in SERVICES:
            ids = providers.get(service.key)
            if not ids:
                unmatched.append(f"{service.name} ({kind})")
                continue
            titles = (await tmdb.discover(kind, region=region, provider_ids=ids))[:per_service]
            details = await asyncio.gather(*(tmdb.details(kind, t.tmdb_id) for t in titles))
            rows.append(
                CoverageRow(
                    service=service.name,
                    media_type=kind,
                    sampled=len(details),
                    rated_local=sum(
                        bool(tmdb_source.parse_classifications(kind, d, [region])) for d in details
                    ),
                    rated_any=sum(
                        bool(tmdb_source.parse_classifications(kind, d)) for d in details
                    ),
                    imdb_ids=sum(bool(tmdb_source.parse_title(kind, d).imdb_id) for d in details),
                    links=sum(
                        bool(tmdb_source.parse_availability(kind, d, region)) for d in details
                    ),
                )
            )
    return rows, unmatched


def report(rows: list[CoverageRow], unmatched: list[str], region: str) -> str:
    lines = [
        f"# Data coverage, region {region}",
        "",
        f"| Service | Type | Sampled | {region} rating | Any reference rating "
        "| IMDb id | Watch link |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        lines.append(
            f"| {r.service} | {r.media_type} | {r.sampled} | {r.pct(r.rated_local)} "
            f"| {r.pct(r.rated_any)} "
            f"| {r.pct(r.imdb_ids)} | {r.pct(r.links)} |"
        )
    if unmatched:
        lines += ["", "No TMDB provider matched: " + ", ".join(unmatched)]
    return "\n".join(lines) + "\n"
