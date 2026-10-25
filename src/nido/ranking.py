"""Deterministic filtering and ranking: the model proposes search criteria and explains the
result, but which titles make the shortlist is decided here, in testable code.

Weights are a first guess, to be tuned against the eval scenarios.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from nido.models import (
    AccessType,
    Availability,
    Classification,
    EvidenceType,
    FamilyProfile,
    GuidanceObservation,
    Rating,
    Title,
)

INCLUDED = {AccessType.SUBSCRIPTION, AccessType.ADS}
# Bayesian average: a 9.0 from 300 votes should not outrank an 8.1 from 400,000.
PRIOR_VOTES = 5_000
PRIOR_SCORE = 6.5
SHORTLIST_SIZE = 5


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
    reasons: list[str]
    cautions: list[str]


def official_min_age(candidate: Candidate, region: str) -> int | None:
    """The strictest official classification for `region` (versions can differ)."""
    ages = [
        c.min_age
        for c in candidate.classifications
        if c.region == region.upper() and c.min_age is not None
    ]
    return max(ages) if ages else None


def weighted_quality(rating: Rating | None) -> float | None:
    if rating is None:
        return None
    votes = rating.votes or 0
    score = rating.score * 10 / rating.scale
    return (votes * score + PRIOR_VOTES * PRIOR_SCORE) / (votes + PRIOR_VOTES)


def evaluate(candidate: Candidate, profile: FamilyProfile) -> Ranked | None:
    """None when the title is excluded; otherwise its score and the reasons behind it."""
    reasons: list[str] = []
    cautions: list[str] = []

    min_age = official_min_age(candidate, profile.region)
    if min_age is None:
        cautions.append(f"No official {profile.region} classification found.")
    elif min_age > profile.youngest:
        return None
    else:
        reasons.append(f"Official {profile.region} classification fits age {profile.youngest}.")

    offers = [a for a in candidate.availability if a.region == profile.region.upper()]
    included = any(a.access in INCLUDED and a.service_key in profile.services for a in offers)
    if not offers:
        return None
    if included:
        reasons.append("Included in your subscriptions.")
    else:
        cautions.append("Not included in your subscriptions: rent, buy or add-on only.")

    runtime = candidate.title.runtime_min
    if profile.max_runtime_min and runtime and runtime > profile.max_runtime_min:
        return None

    quality = weighted_quality(candidate.rating)
    if quality is None:
        cautions.append("No IMDb rating available.")
    elif (
        profile.min_imdb_rating
        and candidate.rating
        and (candidate.rating.score < profile.min_imdb_rating)
    ):
        return None

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
        - 0.2 * len(flagged)
    )
    return Ranked(candidate, round(score, 4), included, reasons, cautions)


def shortlist(
    candidates: list[Candidate], profile: FamilyProfile, size: int = SHORTLIST_SIZE
) -> list[Ranked]:
    ranked = [r for c in candidates if (r := evaluate(c, profile)) is not None]
    ranked.sort(key=lambda r: r.score, reverse=True)
    return ranked[:size]
