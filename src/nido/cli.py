"""Command line: `nido coverage` (phase 0 data check), `nido serve` (web API)."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

from dotenv import load_dotenv

from nido.config import Settings
from nido.coverage import measure, report
from nido.sources.tmdb import TmdbClient


async def _coverage(settings: Settings, region: str, per_service: int) -> str:
    if not settings.tmdb_token:
        raise SystemExit("TMDB_API_TOKEN is not set (see .env.example)")
    tmdb = TmdbClient(settings.tmdb_token, language=settings.language)
    try:
        rows, unmatched = await measure(tmdb, region, per_service=per_service)
    finally:
        await tmdb.aclose()
    return report(rows, unmatched, region)


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(prog="nido")
    sub = parser.add_subparsers(dest="command", required=True)
    cov = sub.add_parser("coverage", help="measure data coverage per service in one region")
    cov.add_argument("--region", help="ISO country code; default: first of NIDO_REGIONS")
    cov.add_argument("--per-service", type=int, default=20)
    serve = sub.add_parser("serve", help="run the web API (and the built web app, if any)")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=int(os.getenv("PORT", "8080")))
    args = parser.parse_args(argv)

    if args.command == "serve":
        import uvicorn

        from nido.server import create_app

        uvicorn.run(create_app(), host=args.host, port=args.port, proxy_headers=True)
        return 0

    if args.command == "coverage":
        settings = Settings()
        region = (args.region or settings.regions[0]).upper()
        sys.stdout.write(asyncio.run(_coverage(settings, region, args.per_service)))
    return 0
