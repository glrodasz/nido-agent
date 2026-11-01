from datetime import UTC, date, datetime

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
from nido.ranking import (
    IMDB_FLOOR,
    SHORTLIST_SIZE,
    Candidate,
    age_baseline,
    evaluate,
    near_misses,
    recency,
    shortlist,
    weighted_quality,
)

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
    runtime: int | None = 95,
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


def test_unknown_movie_runtime_cannot_meet_a_limit():
    # "Shorts" asks for 40 min or less; a movie with no listed length must not slip in.
    shorts = PROFILE.model_copy(update={"max_runtime_min": 40})
    assert evaluate(make(1, runtime=30), shorts) is not None
    assert evaluate(make(2, runtime=None), shorts) is None
    assert evaluate(make(3, runtime=None), PROFILE.model_copy(update={"max_runtime_min": None}))


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


def test_low_vote_kids_show_is_not_flattened_to_the_prior():
    # Gabby's Dollhouse: 7.1 from about 1,200 votes should read closer to 7 than to 6.5.
    assert weighted_quality(make(1, rating=7.1, votes=1_171).rating) > 6.8


def test_recency_favours_new_titles_and_running_series():
    today = date(2026, 10, 28)
    new = Title(media_type=MediaType.MOVIE, tmdb_id=1, name="n", release_date=date(2026, 6, 1))
    old = Title(media_type=MediaType.MOVIE, tmdb_id=2, name="o", release_date=date(1991, 1, 1))
    running = Title(
        media_type=MediaType.TV,
        tmdb_id=3,
        name="r",
        release_date=date(2018, 10, 1),
        last_air_date=date(2026, 9, 1),
    )
    assert recency(new, today) > 0.95
    assert recency(old, today) == 0
    assert recency(running, today) > 0.9
    assert recency(Title(media_type=MediaType.MOVIE, tmdb_id=4, name="u"), today) == 0


def test_newer_title_ranks_above_an_equally_rated_older_one():
    newer, older = make(1), make(2)
    newer.title.release_date = date.today()
    older.title.release_date = date(1995, 1, 1)
    assert evaluate(newer, PROFILE).score > evaluate(older, PROFILE).score


def test_shortlist_is_capped_and_sorted():
    candidates = [make(i, rating=6 + i / 10) for i in range(SHORTLIST_SIZE + 3)]
    result = shortlist(candidates, PROFILE)
    assert len(result) == SHORTLIST_SIZE
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


def test_unknown_imdb_score_fails_an_explicit_minimum():
    strict = PROFILE.model_copy(update={"min_imdb_rating": 7.0})
    assert evaluate(make(1, rating=None), strict) is None
    assert evaluate(make(1, rating=None), PROFILE) is not None


def test_near_misses_explain_the_broken_rules_closest_first():
    young = FamilyProfile(children_ages=[4], services=["netflix"], max_runtime_min=110)
    seven = make(1, min_age=7)
    eleven = make(2, min_age=11)
    seven_and_long = make(3, min_age=7, runtime=150)
    unwatchable = make(4, min_age=7)
    unwatchable.availability = []
    candidates = [eleven, seven_and_long, seven, unwatchable]
    assert shortlist(candidates, young) == []
    missed = near_misses(candidates, young)
    assert [r.candidate.title.tmdb_id for r in missed] == [1, 2, 3]
    assert missed[0].misses == ["Rated 7+, and your youngest is 4."]
    assert len(missed[2].misses) == 2 and "150 min" in missed[2].misses[1]


def test_titles_that_pass_have_no_misses():
    assert evaluate(make(1), PROFILE).misses == []


def test_search_pool_gathers_enough_titles_to_fill_the_shortlist():
    from nido.agent.tools import ENOUGH_ELIGIBLE

    assert SHORTLIST_SIZE <= ENOUGH_ELIGIBLE


def test_titles_below_the_imdb_floor_never_show():
    # "Any" on the score slider still drops anything IMDb scores under 4, even as a near miss.
    assert IMDB_FLOOR == 4
    assert evaluate(make(1, rating=3.9), PROFILE) is None
    assert near_misses([make(1, rating=3.9)], PROFILE) == []
    assert evaluate(make(2, rating=4.0), PROFILE) is not None
    assert evaluate(make(3, rating=None), PROFILE) is not None  # no score yet: stays in
