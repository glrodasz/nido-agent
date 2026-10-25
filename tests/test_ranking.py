from datetime import UTC, datetime

from nido.models import (
    AccessType,
    Availability,
    Classification,
    EvidenceType,
    FamilyProfile,
    GuidanceCategory,
    GuidanceObservation,
    MediaType,
    Rating,
    Title,
    TitleRef,
)
from nido.ranking import Candidate, age_baseline, evaluate, shortlist, weighted_quality

NOW = datetime(2026, 10, 25, tzinfo=UTC)
PROFILE = FamilyProfile(children_ages=[6, 9], services=["netflix"], max_runtime_min=110)


def make(
    tmdb_id: int,
    *,
    rating: float | None = 7.5,
    votes: int = 100_000,
    cert: str | None = "Btl",
    min_age: int | None = 0,
    access: AccessType = AccessType.SUBSCRIPTION,
    service: str | None = "netflix",
    runtime: int = 95,
    guidance: list[GuidanceCategory] = (),
) -> Candidate:
    ref = TitleRef(media_type=MediaType.MOVIE, tmdb_id=tmdb_id)
    return Candidate(
        title=Title(
            media_type=MediaType.MOVIE, tmdb_id=tmdb_id, name=f"T{tmdb_id}", runtime_min=runtime
        ),
        classifications=[
            Classification(
                title=ref,
                region="SE",
                issuer="Statens medieråd",
                value=cert,
                min_age=min_age,
                source="TMDB",
                retrieved_at=NOW,
            )
        ]
        if cert
        else [],
        availability=[
            Availability(
                title=ref,
                region="SE",
                service_key=service,
                provider_name="x",
                access=access,
                source="TMDB (JustWatch)",
                verified_at=NOW,
            )
        ],
        rating=Rating(title=ref, source="IMDb", score=rating, votes=votes, retrieved_at=NOW)
        if rating is not None
        else None,
        guidance=[
            GuidanceObservation(
                title=ref,
                source="CSM",
                source_url="https://example.org",
                evidence=EvidenceType.EDITORIAL,
                category=g,
                observation="o",
                retrieved_at=NOW,
                confidence=0.8,
            )
            for g in guidance
        ],
    )


def test_excludes_titles_rated_above_youngest_child():
    assert evaluate(make(1, cert="11", min_age=11), PROFILE) is None


def test_missing_classification_is_kept_with_a_caution():
    ranked = evaluate(make(1, cert=None), PROFILE)
    assert ranked is not None
    assert any("No official age rating" in c for c in ranked.cautions)


def test_rent_only_is_kept_but_ranked_below_included():
    included = evaluate(make(1), PROFILE)
    rent = evaluate(make(2, access=AccessType.RENT, service=None), PROFILE)
    assert rent is not None and not rent.included
    assert included.score > rent.score


def test_runtime_and_rating_thresholds_exclude():
    assert evaluate(make(1, runtime=130), PROFILE) is None
    strict = PROFILE.model_copy(update={"min_imdb_rating": 8.0})
    assert evaluate(make(1, rating=7.5), strict) is None


def test_avoided_category_lowers_score_and_is_explained():
    profile = PROFILE.model_copy(update={"avoid_categories": [GuidanceCategory.DEATH_GRIEF]})
    clean = evaluate(make(1), profile)
    flagged = evaluate(make(2, guidance=[GuidanceCategory.DEATH_GRIEF]), profile)
    assert flagged.score < clean.score
    assert any("death_grief" in c for c in flagged.cautions)


def test_few_votes_do_not_outrank_many():
    assert weighted_quality(make(1, rating=9.0, votes=300).rating) < weighted_quality(
        make(2, rating=8.1, votes=400_000).rating
    )


def test_shortlist_is_capped_and_sorted():
    candidates = [make(i, rating=6 + i / 10) for i in range(10)]
    result = shortlist(candidates, PROFILE)
    assert len(result) == 5
    assert [r.score for r in result] == sorted((r.score for r in result), reverse=True)


def rated(**ages: int) -> list[Classification]:
    ref = TitleRef(media_type=MediaType.MOVIE, tmdb_id=1)
    return [
        Classification(
            title=ref,
            region=country,
            issuer="x",
            value=str(age),
            min_age=age,
            source="TMDB",
            retrieved_at=NOW,
        )
        for country, age in ages.items()
    ]


def test_baseline_is_the_median_across_countries_rounded_up():
    assert age_baseline(rated(US=8, GB=8, SE=7, DE=6)).age == 8
    assert age_baseline(rated(US=13, SE=11)).age == 12
    assert age_baseline(rated(SE=7)).age == 7
    assert age_baseline([]) is None


def test_strictest_version_counts_within_a_country():
    classifications = rated(SE=7) + rated(SE=11)
    assert age_baseline(classifications).by_country == {"SE": 11}


def test_median_lets_a_lone_strict_country_through_with_reasons():
    candidate = make(1)
    candidate.classifications = rated(US=8, GB=8, SE=7, DE=12)
    ranked = evaluate(candidate, FamilyProfile(children_ages=[8], services=["netflix"]))
    assert ranked is not None
    assert any("median of 4 countries" in r for r in ranked.reasons)


def test_single_country_rating_is_flagged():
    ranked = evaluate(make(1), PROFILE)
    assert any("Only one country" in c for c in ranked.cautions)


def test_offers_count_in_any_profile_region():
    candidate = make(1)
    candidate.availability[0].region = "NO"
    assert evaluate(candidate, PROFILE) is None
    vpn = PROFILE.model_copy(update={"regions": ["SE", "NO"]})
    assert evaluate(candidate, vpn).included
