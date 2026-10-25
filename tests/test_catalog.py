from nido.agent.tools import prefilter_certification
from nido.catalog import min_age_for, service_for_provider
from nido.models import MediaType


def test_swedish_ratings_map_to_minimum_ages():
    assert min_age_for("SE", "Btl") == 0
    assert min_age_for("se", "11") == 11
    assert min_age_for("SE", "PG-13") is None
    assert min_age_for("JP", "G") is None


def test_homologation_covers_reference_countries():
    assert min_age_for("US", "PG-13") == 13
    assert min_age_for("US", "TV-Y7") == 7
    assert min_age_for("GB", "12A") == 12
    assert min_age_for("DE", "6") == 6
    assert min_age_for("NL", "AL") == 0
    assert min_age_for("FI", "K-16") == 16


def test_us_prefilter_is_one_step_looser_than_the_child():
    assert prefilter_certification(4) == "PG"
    assert prefilter_certification(8) == "PG-13"
    assert prefilter_certification(13) == "R"
    assert prefilter_certification(18) == "NC-17"
    assert prefilter_certification(4, strict=True) == "G"
    assert prefilter_certification(8, strict=True) == "PG"
    assert prefilter_certification(6, MediaType.TV, strict=True) == "TV-G"


def test_provider_names_match_services_but_not_channels():
    assert service_for_provider("Netflix").key == "netflix"
    assert service_for_provider("Disney Plus").key == "disney_plus"
    assert service_for_provider("HBO Max").key == "hbo_max"
    assert service_for_provider("Amazon Prime Video").key == "prime_video"
    assert service_for_provider("Apple TV Plus").key == "apple_tv_plus"
    assert service_for_provider("HBO Max Amazon Channel") is None


def test_series_prefilter_is_one_step_looser_in_tmdb_order():
    from nido.models import MediaType

    assert prefilter_certification(6, MediaType.TV) == "TV-PG"  # TV-G is the last one allowed
    assert prefilter_certification(7, MediaType.TV) == "TV-PG"
    assert prefilter_certification(10, MediaType.TV) == "TV-14"
    assert prefilter_certification(17, MediaType.TV) == "TV-MA"


async def test_discover_puts_the_age_appropriate_pool_first():
    from types import SimpleNamespace

    from nido.agent.tools import Toolbox
    from nido.config import Settings
    from nido.models import FamilyProfile

    pools = {"G": [1, 2], "PG": [9, 8, 1]}
    calls = []

    class Tmdb:
        async def discover(self, kind, *, max_certification, **_):
            calls.append(max_certification)
            return [SimpleNamespace(tmdb_id=i) for i in pools[max_certification]]

    toolbox = Toolbox(Settings(tmdb_token="t"))

    async def no_providers(kind, region):
        return {}

    toolbox._provider_ids = no_providers
    profile = FamilyProfile(children_ages=[4], services=[])
    ids = await toolbox._discover(Tmdb(), MediaType.MOVIE, "SE", profile, [])
    assert sorted(calls) == ["G", "PG"]
    assert ids == [1, 9, 2, 8]
