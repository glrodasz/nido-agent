"""Supported streaming services and official age classifications.

Services are matched to TMDB watch providers by name, not by id: TMDB renames and re-numbers
providers (HBO Max -> Max -> HBO Max), and `nido coverage` reports any alias that stops matching.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Service:
    key: str
    name: str
    # Lower-cased TMDB provider names that count as this service. Channels sold inside another
    # service ("HBO Max Amazon Channel") are deliberately absent: they are paid add-ons.
    tmdb_names: tuple[str, ...]


SERVICES: tuple[Service, ...] = (
    Service("netflix", "Netflix", ("netflix", "netflix standard with ads")),
    Service("disney_plus", "Disney+", ("disney plus", "disney+")),
    Service("hbo_max", "HBO Max", ("hbo max", "max")),
    Service("prime_video", "Prime Video", ("amazon prime video", "prime video")),
    Service("apple_tv_plus", "Apple TV+", ("apple tv plus", "apple tv+", "apple tv")),
)
SERVICES_BY_KEY = {s.key: s for s in SERVICES}


def service_for_provider(provider_name: str) -> Service | None:
    name = provider_name.strip().lower()
    for service in SERVICES:
        if name in service.tmdb_names:
            return service
    return None


@dataclass(frozen=True)
class ClassificationSystem:
    region: str
    issuer: str
    issuer_url: str
    # Official value -> the youngest age it is rated for.
    min_age: dict[str, int]


# Statens medieråd (Swedish Media Council). Children aged 7+ may also see an older rating when
# accompanied by an adult; Nido treats the rating as the baseline and leaves that call to parents.
SWEDEN = ClassificationSystem(
    region="SE",
    issuer="Statens medieråd",
    issuer_url="https://www.statensmedierad.se/",
    min_age={"btl": 0, "7": 7, "11": 11, "15": 15},
)

SYSTEMS = {SWEDEN.region: SWEDEN}


def min_age_for(region: str, value: str) -> int | None:
    """Youngest age an official classification allows, or None when the value is unknown."""
    system = SYSTEMS.get(region.upper())
    if system is None:
        return None
    return system.min_age.get(value.strip().lower())
