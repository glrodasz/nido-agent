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
    # Official value, in TMDB's spelling -> the youngest age it is rated for. Values that carry
    # no age (US "PG", UK "PG": parental guidance) are homologated to 8, Nido's own reading.
    min_age: dict[str, int]

    def age_for(self, value: str) -> int | None:
        wanted = value.strip().lower()
        for official, age in self.min_age.items():
            if official.lower() == wanted:
                return age
        return None


# The countries whose ratings are homologated onto one age scale, independent of the catalog
# region. TMDB carries US ratings for most titles; the European systems add more opinions.
SYSTEMS: dict[str, ClassificationSystem] = {
    s.region: s
    for s in (
        ClassificationSystem(
            "US",
            "MPA / TV Parental Guidelines",
            {
                "G": 0,
                "PG": 8,
                "PG-13": 13,
                "R": 17,
                "NC-17": 18,
                "TV-Y": 0,
                "TV-G": 0,
                "TV-Y7": 7,
                "TV-PG": 10,
                "TV-14": 14,
                "TV-MA": 17,
            },
        ),
        ClassificationSystem(
            "GB", "BBFC", {"U": 0, "PG": 8, "12A": 12, "12": 12, "15": 15, "18": 18, "R18": 18}
        ),
        ClassificationSystem("DE", "FSK", {"0": 0, "6": 6, "12": 12, "16": 16, "18": 18}),
        ClassificationSystem(
            "NL",
            "Kijkwijzer (NICAM)",
            {"AL": 0, "6": 6, "9": 9, "12": 12, "14": 14, "16": 16, "18": 18},
        ),
        ClassificationSystem(
            "FR", "CNC", {"U": 0, "TP": 0, "10": 10, "12": 12, "16": 16, "18": 18}
        ),
        ClassificationSystem("SE", "Statens medieråd", {"Btl": 0, "7": 7, "11": 11, "15": 15}),
        ClassificationSystem(
            "NO", "Medietilsynet", {"A": 0, "6": 6, "9": 9, "12": 12, "15": 15, "18": 18}
        ),
        ClassificationSystem(
            "DK", "Medierådet for Børn og Unge", {"A": 0, "7": 7, "11": 11, "15": 15}
        ),
        ClassificationSystem(
            "FI",
            "KAVI",
            {
                "S": 0,
                "K-7": 7,
                "7": 7,
                "K-12": 12,
                "12": 12,
                "K-16": 16,
                "16": 16,
                "K-18": 18,
                "18": 18,
            },
        ),
    )
}


def min_age_for(region: str, value: str) -> int | None:
    """Youngest age an official classification allows, or None when the value is unknown."""
    system = SYSTEMS.get(region.upper())
    return system.age_for(value) if system else None
