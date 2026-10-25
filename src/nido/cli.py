"""Command line: `nido coverage` (phase 0 data check)."""

from __future__ import annotations

import argparse
import asyncio
import sys

from dotenv import load_dotenv

from nido.config import Settings
from nido.coverage import measure, report
from nido.sources.tmdb import TmdbClient


async def _coverage(settings: Settings, per_service: int) -> str:
    if not settings.tmdb_token:
        raise SystemExit("TMDB_API_TOKEN is not set (see .env.example)")
    tmdb = TmdbClient(settings.tmdb_token, language=settings.language)
    try:
        rows, unmatched = await measure(tmdb, settings.region, per_service=per_service)
    finally:
        await tmdb.aclose()
    return report(rows, unmatched, settings.region)


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(prog="nido")
    sub = parser.add_subparsers(dest="command", required=True)
    cov = sub.add_parser("coverage", help="measure data coverage per service in NIDO_REGION")
    cov.add_argument("--per-service", type=int, default=20)
    args = parser.parse_args(argv)

    if args.command == "coverage":
        sys.stdout.write(asyncio.run(_coverage(Settings(), args.per_service)))
    return 0
