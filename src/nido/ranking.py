"""Deterministic filtering and ranking: the model proposes search criteria and explains the
result, but which titles make the shortlist is decided here, in testable code.

Weights are a first guess, to be tuned against the eval scenarios.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from datetime import date

from nido.models import (
    AccessType,
    Availability,
    Classification,
    EvidenceType,
    FamilyProfile,
    GuidanceObservation,
    MediaType,
    Rating,
    Title,
)

INCLUDED = {AccessType.SUBSCRIPTION, AccessType.ADS}
# Bayesian average: a 9.0 from 300 votes should not outrank an 8.1 from 400,000. Kept small,
# because shows for young children get few IMDb votes: at 5,000 Gabby's Dollhouse (7.1 from about
# 1,200 votes) scored like a 6.6 and lost to older titles with louder audiences.
PRIOR_VOTES = 1_000
PRIOR_SCORE = 6.5
# Families want what is new first: a title loses recency credit linearly until it is this old.
RECENCY_SPAN_YEARS = 20
# A real choice on one evening; the chat shows them all as cards while the model comments on 5 at
# most. Stays below tools.ENOUGH_ELIGIBLE, so the pool can fill it.
SHORTLIST_SIZE = 20
NEAR_MISS_SIZE = 3


@dataclass
class Candidate:
    title: Title
    classifications: list[Classification] = field(default_factory=list)
    availability: list[Availability] = field(default_factory=list)
    rating: Rating | None = None
    guidance: list[GuidanceObservation] = field(default_factory=list)


@dataclass
class Ranked:
    candidate: Candidate
    score: float
    included: bool
    baseline: AgeBaseline | None
    reasons: list[str]
    cautions: list[str]
    # Family profile rules the title breaks; only near misses (see near_misses) have any.
    misses: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class AgeBaseline:
    """Official ratings homologated onto one age scale (catalog.SYSTEMS)."""

    age: int
    # Country -> its strictest homologated age, the inputs of the median.
    by_country: dict[str, int]

    def describe(self) -> str:
        countries = ", ".join(f"{c} {a}+" for c, a in sorted(self.by_country.items()))
        return f"age {self.age}+ (median of {len(self.by_country)} countries: {countries})"


def age_baseline(classifications: list[Classification]) -> AgeBaseline | None:
    """Median of the homologated ages across countries, rounded up. Within a country the strictest
    version counts. A single country's rating is used as is."""
    by_country: dict[str, int] = {}
    for c in classifications:
        if c.min_age is not None:
            by_country[c.region] = max(by_country.get(c.region, 0), c.min_age)
    if not by_country:
        return None
    return AgeBaseline(age=math.ceil(statistics.median(by_country.values())), by_country=by_country)


def weighted_quality(rating: Rating | None) -> float | None:
    if rating is None:
        return None
    votes = rating.votes or 0
    score = rating.score * 10 / rating.scale
    return (votes * score + PRIOR_VOTES * PRIOR_SCORE) / (votes + PRIOR_VOTES)


def recency(title: Title, today: date | None = None) -> float:
    """1 for a title out this year (a series: aired this year), down to 0 at RECENCY_SPAN_YEARS;
    0 when the date is unknown."""
    latest = title.latest_date
    if latest is None:
        return 0.0
    years = ((today or date.today()) - latest).days / 365.25
    return min(1.0, max(0.0, 1 - years / RECENCY_SPAN_YEARS))


def evaluate(candidate: Candidate, profile: FamilyProfile) -> Ranked | None:
    """None when the title is excluded; otherwise its score and the reasons behind it."""
    ranked = assess(candidate, profile)
    return None if ranked is None or ranked.misses else ranked


def assess(candidate: Candidate, profile: FamilyProfile) -> Ranked | None:
    """Score every title that can be watched in the family's regions, listing the profile rules
    it breaks in `misses`. None when there is nowhere to watch it at all."""
    reasons: list[str] = []
    cautions: list[str] = []
    misses: list[str] = []

    baseline = age_baseline(candidate.classifications)
    if baseline is None:
        cautions.append("No official age rating found in any reference country.")
    elif baseline.age > profile.youngest:
        misses.append(f"Rated {baseline.age}+, and your youngest is {profile.youngest}.")
    else:
        reasons.append(f"Official ratings put it at {baseline.describe()}.")
        if len(baseline.by_country) == 1:
            cautions.append("Only one country's rating was found.")

    regions = {r.upper() for r in profile.regions}
    offers = [a for a in candidate.availability if a.region in regions]
    included = any(a.access in INCLUDED and a.service_key in profile.services for a in offers)
    if not offers:
        return None
    if included:
        reasons.append("Included in your subscriptions.")
    else:
        cautions.append("Not included in your subscriptions: rent, buy or add-on only.")

    runtime = candidate.title.runtime_min
    if profile.max_runtime_min and runtime and runtime > profile.max_runtime_min:
        misses.append(f"Runs {runtime} min, longer than your {profile.max_runtime_min} min limit.")
    elif profile.max_runtime_min and not runtime and candidate.title.media_type is MediaType.MOVIE:
        # An unknown length cannot meet an explicit limit: "Shorts" must not show a feature
        # TMDB has no runtime for. Series often lack episode lengths, so they keep passing.
        misses.append(
            f"No runtime listed to check against your {profile.max_runtime_min} min limit."
        )

    quality = weighted_quality(candidate.rating)
    if profile.min_imdb_rating is not None:
        # An unknown score cannot meet an explicit minimum.
        if candidate.rating is None:
            misses.append(
                f"No IMDb score to check against your minimum of {profile.min_imdb_rating}."
            )
        elif candidate.rating.score < profile.min_imdb_rating:
            misses.append(
                f"IMDb {candidate.rating.score}, below your minimum of {profile.min_imdb_rating}."
            )
    if quality is None:
        cautions.append("No IMDb rating available.")

    flagged = sorted(
        {
            o.category
            for o in candidate.guidance
            if o.category in profile.avoid_categories
            and o.evidence is not EvidenceType.AI_INFERENCE
        }
    )
    for category in flagged:
        cautions.append(f"Sources report content you asked to avoid: {category}.")

    genre_match = bool(set(profile.preferred_genres) & set(candidate.title.genres))
    if genre_match:
        reasons.append("Matches your preferred genres.")

    score = (
        0.6 * ((quality if quality is not None else PRIOR_SCORE) / 10)
        + 0.25 * included
        + 0.15 * genre_match
        + 0.2 * recency(candidate.title)
        - 0.2 * len(flagged)
    )
    return Ranked(candidate, round(score, 4), included, baseline, reasons, cautions, misses)


def shortlist(
    candidates: list[Candidate], profile: FamilyProfile, size: int = SHORTLIST_SIZE
) -> list[Ranked]:
    ranked = [r for c in candidates if (r := evaluate(c, profile)) is not None]
    ranked.sort(key=lambda r: r.score, reverse=True)
    return ranked[:size]


def near_misses(
    candidates: list[Candidate], profile: FamilyProfile, size: int = NEAR_MISS_SIZE
) -> list[Ranked]:
    """The closest titles that break the family profile, for when the shortlist is empty: fewest
    broken rules first, then the smallest age gap, then the score."""

    def gap(r: Ranked) -> int:
        return max(0, r.baseline.age - profile.youngest) if r.baseline else 0

    missed = [r for c in candidates if (r := assess(c, profile)) is not None and r.misses]
    missed.sort(key=lambda r: (len(r.misses), gap(r), -r.score))
    return missed[:size]
