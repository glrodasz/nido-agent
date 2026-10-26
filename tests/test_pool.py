from types import SimpleNamespace

from nido.agent import tools as tools_module
from nido.agent.tools import Toolbox
from nido.config import Settings
from nido.models import FamilyProfile, MediaType
from test_ranking import make

PROFILE = FamilyProfile(children_ages=[4], services=["netflix"])


def toolbox(pages: dict[int, list[int]], too_old: set[int], calls: list) -> Toolbox:
    """Discover serves `pages`; titles in `too_old` are rated 15+."""
    box = Toolbox(Settings(tmdb_token="t"))

    async def discover(tmdb, kind, region, profile, genre_ids, page, released_since=None):
        calls.append(page)
        if released_since:
            calls.append(("since", released_since))
        return pages.get(page, [])

    async def candidate(kind, tmdb_id, regions):
        return make(tmdb_id, min_age=15 if tmdb_id in too_old else 0)

    async def rate(candidate):
        calls.append(("rate", candidate.title.tmdb_id))

    box._discover = discover
    box._candidate = candidate
    box._rate = rate
    box._clients = lambda: (None, None)
    return box


async def test_pool_reads_more_pages_until_enough_titles_fit(monkeypatch):
    monkeypatch.setattr(tools_module, "DISCOVER_PAGE_SIZE", 3)
    monkeypatch.setattr(tools_module, "ENOUGH_ELIGIBLE", 3)
    # The most popular titles are rated older than the child: the old 12-title pool stopped there.
    pages = {1: [1, 2, 3], 2: [4, 5, 6], 3: [7, 8, 9], 4: [10, 11, 12]}
    calls: list = []
    box = toolbox(pages, too_old={1, 2, 3, 4, 6}, calls=calls)

    result = await box.search("tv", [4], ["netflix"], regions=["SE"])

    assert [c for c in calls if isinstance(c, int)] == [1, 2, 3]
    assert {r["tmdb_id"] for r in result["results"]} == {5, 7, 8, 9}
    # IMDb is looked up only for titles that pass the age and availability rules.
    assert sorted(c[1] for c in calls if isinstance(c, tuple)) == [5, 7, 8, 9]


async def test_pool_stops_when_discover_runs_out(monkeypatch):
    monkeypatch.setattr(tools_module, "DISCOVER_PAGE_SIZE", 3)
    calls: list = []
    box = toolbox({1: [1, 2]}, too_old=set(), calls=calls)

    candidates = await box._pool(MediaType.TV, ["SE"], PROFILE, {}, set())

    assert [c.title.tmdb_id for c in candidates] == [1, 2]
    assert calls == [1]


async def test_released_since_reaches_discover():
    calls: list = []
    box = toolbox({1: [1]}, too_old=set(), calls=calls)

    await box.search("movie", [4], ["netflix"], regions=["SE"], released_since=2022)

    assert ("since", 2022) in calls


async def test_pool_skips_banned_titles():
    calls: list = []
    box = toolbox({1: [1, 2]}, too_old=set(), calls=calls)

    candidates = await box._pool(MediaType.TV, ["SE"], PROFILE, {}, {"tv:1"})

    assert [c.title.tmdb_id for c in candidates] == [2]


def lookup_box(found: list[int], too_old: set[int]) -> Toolbox:
    box = toolbox({}, too_old, [])

    class Tmdb:
        async def search(self, kind, query):
            return [SimpleNamespace(tmdb_id=i, name=f"T{i}") for i in found]

    box._clients = lambda: (Tmdb(), None)
    return box


async def test_look_up_puts_a_fitting_title_in_results():
    result = await lookup_box([7], set()).look_up("x", "tv", [4], ["netflix"], regions=["SE"])
    assert [r["tmdb_id"] for r in result["results"]] == [7]
    assert result["near_misses"] == []


async def test_look_up_explains_what_a_title_misses():
    result = await lookup_box([7], {7}).look_up("x", "tv", [4], ["netflix"], regions=["SE"])
    assert result["results"] == []
    assert result["near_misses"][0]["misses"] == ["Rated 15+, and your youngest is 4."]


async def test_look_up_reports_missing_and_hidden_titles():
    missing = await lookup_box([], set()).look_up("x", "tv", [4], ["netflix"])
    assert missing["not_found"] == "x"
    hidden = await lookup_box([7], set()).look_up("x", "tv", [4], ["netflix"], hidden=["tv:7"])
    assert hidden["hidden"] == "T7"


async def test_look_up_applies_runtime_and_imdb_limits():
    box = lookup_box([7], set())
    result = await box.look_up(
        "x", "tv", [4], ["netflix"], max_runtime_min=60, min_imdb_rating=8, regions=["SE"]
    )
    assert result["results"] == []
    assert result["near_misses"][0]["misses"] == [
        "Runs 95 min, longer than your 60 min limit.",
        "IMDb 7.5, below your minimum of 8.0.",
    ]
