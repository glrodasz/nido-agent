from nido.agent.tools import max_certification
from nido.catalog import min_age_for, service_for_provider


def test_swedish_ratings_map_to_minimum_ages():
    assert min_age_for("SE", "Btl") == 0
    assert min_age_for("se", "11") == 11
    assert min_age_for("SE", "PG-13") is None
    assert min_age_for("US", "PG") is None


def test_max_certification_for_youngest_child():
    assert max_certification("SE", 4) == "Btl"
    assert max_certification("SE", 7) == "7"
    assert max_certification("SE", 12) == "11"
    assert max_certification("SE", 16) == "15"
    assert max_certification("US", 10) is None


def test_provider_names_match_services_but_not_channels():
    assert service_for_provider("Netflix").key == "netflix"
    assert service_for_provider("Disney Plus").key == "disney_plus"
    assert service_for_provider("HBO Max").key == "hbo_max"
    assert service_for_provider("Amazon Prime Video").key == "prime_video"
    assert service_for_provider("Apple TV Plus").key == "apple_tv_plus"
    assert service_for_provider("HBO Max Amazon Channel") is None
