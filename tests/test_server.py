import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from nido.agent.budget import LlmBudgetExceededError
from nido.auth import LOCAL_UID, Authenticator, User
from nido.config import Settings
from nido.models import FamilyProfile, GuidanceCategory, MediaType
from nido.server import chat_cards, create_app, describe_family, titles_named
from nido.store import MemoryStore

PROFILE = {
    "children_ages": [9, 6],
    "regions": ["se", "no"],
    "services": ["netflix", "disney_plus", "not_a_service"],
    "avoid_categories": ["frightening"],
    "max_runtime_min": 110,
    "preferred_genres": ["Comedy"],
}
RESULT = {
    "regions": ["SE"],
    "results": [{"title": "Paddington 2", "media_type": "movie", "tmdb_id": 1}],
}


class FakeToolbox:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def search(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        return RESULT

    async def find_titles(self, **kwargs: Any) -> dict[str, Any]:
        return await self.search(**kwargs)

    async def look_up_title(self, **kwargs: Any) -> dict[str, Any]:
        return RESULT

    def guidance_links(self, title: str) -> dict[str, Any]:
        return {}

    async def details(self, media_type: str, tmdb_id: int, profile: Any) -> dict[str, Any]:
        self.calls.append({"details": (media_type, tmdb_id), "regions": profile.regions})
        return {"title": "Paddington 2", "media_type": media_type, "tmdb_id": tmdb_id}


def client(**kwargs: Any) -> tuple[TestClient, FakeToolbox]:
    toolbox = kwargs.pop("toolbox", FakeToolbox())
    app = create_app(
        kwargs.pop("settings", None) or Settings(store="memory", auth="none"),
        store=kwargs.pop("store", None) or MemoryStore(),
        toolbox=toolbox,
        authenticator=Authenticator("none"),
        **kwargs,
    )
    return TestClient(app), toolbox


def test_profile_round_trip_normalizes_regions_and_services():
    c, _ = client()
    assert c.get("/api/profile").json() == {"profile": None}
    saved = c.put("/api/profile", json=PROFILE).json()["profile"]
    assert saved["regions"] == ["SE", "NO"]
    assert saved["services"] == ["netflix", "disney_plus"]
    assert c.get("/api/profile").json()["profile"] == saved


@pytest.mark.parametrize(
    "patch",
    [{"regions": ["Sweden"]}, {"children_ages": [21]}, {"children_ages": []}],
)
def test_profile_rejects_bad_values(patch):
    c, _ = client()
    assert c.put("/api/profile", json={**PROFILE, **patch}).status_code == 422


def test_search_needs_a_profile_then_uses_it():
    c, toolbox = client()
    assert c.post("/api/search", json={"media_type": "movie"}).status_code == 409
    c.put("/api/profile", json=PROFILE)
    response = c.post("/api/search", json={"media_type": "tv", "max_runtime_min": 30})
    assert response.json()["results"] == [{**RESULT["results"][0], "mark": None}]
    call = toolbox.calls[-1]
    assert call["media_type"] == "tv"
    assert call["children_ages"] == [9, 6]
    assert call["regions"] == ["SE", "NO"]
    assert call["max_runtime_min"] == 30  # request overrides the profile
    assert call["avoid"] == ["frightening"]  # profile fills what the request leaves out
    assert call["genres"] == [] and call["prefer_genres"] == ["Comedy"]  # favourites only boost
    assert call["exclude_genres"] == []
    c.post("/api/search", json={"genres": ["Animation"], "exclude_genres": ["Comedy"]})
    assert toolbox.calls[-1]["exclude_genres"] == ["Comedy"]
    assert toolbox.calls[-1]["match_all_genres"] is False
    c.post("/api/search", json={"genres": ["Comedy", "Romance"], "match_all_genres": True})
    assert toolbox.calls[-1]["match_all_genres"] is True


def test_search_can_clear_profile_avoidances():
    c, toolbox = client()
    c.put("/api/profile", json=PROFILE)
    c.post("/api/search", json={"avoid": []})
    assert toolbox.calls[-1]["avoid"] == []


def test_search_can_lift_the_profile_limits():
    # The profile's length and score are Find's defaults: an explicit null means "any".
    c, toolbox = client()
    c.put("/api/profile", json={**PROFILE, "max_runtime_min": 60, "min_imdb_rating": 7})
    c.post("/api/search", json={})
    assert toolbox.calls[-1]["max_runtime_min"] == 60
    assert toolbox.calls[-1]["min_imdb_rating"] == 7
    c.post("/api/search", json={"max_runtime_min": None, "min_imdb_rating": None})
    assert toolbox.calls[-1]["max_runtime_min"] is None
    assert toolbox.calls[-1]["min_imdb_rating"] is None


def test_search_passes_the_release_filter():
    c, toolbox = client()
    c.put("/api/profile", json=PROFILE)
    c.post("/api/search", json={"released_since": 2021})
    assert toolbox.calls[-1]["released_since"] == 2021
    c.post("/api/search", json={})
    assert toolbox.calls[-1]["released_since"] is None


def test_watchlist_upsert_keeps_added_at_and_deletes():
    c, _ = client()
    first = c.put("/api/watchlist/movie/1", json={"name": "Paddington 2", "year": 2017}).json()
    again = c.put("/api/watchlist/movie/1", json={"name": "Paddington 2", "watched": True}).json()
    assert again["item"]["added_at"] == first["item"]["added_at"]
    items = c.get("/api/watchlist").json()["items"]
    assert [(i["name"], i["watched"]) for i in items] == [("Paddington 2", True)]
    c.delete("/api/watchlist/movie/1")
    assert c.get("/api/watchlist").json()["items"] == []


def test_chat_is_off_without_a_runner():
    c, _ = client(runner=None)
    assert c.get("/api/config").json()["chat_enabled"] is False
    assert c.post("/api/chat", json={"message": "hi"}).status_code == 503


class FakeSessions:
    def __init__(self) -> None:
        self.sessions: dict[tuple[str, str], Any] = {}

    async def get_session(self, *, app_name: str, user_id: str, session_id: str) -> Any:
        return self.sessions.get((user_id, session_id))

    async def create_session(self, *, app_name: str, user_id: str) -> Any:
        session = SimpleNamespace(id=f"s{len(self.sessions) + 1}")
        self.sessions[(user_id, session.id)] = session
        return session


def event(*, tool_output: dict | None = None, text: str | None = None) -> Any:
    responses = [SimpleNamespace(name="find_titles", response=tool_output)] if tool_output else []
    content = SimpleNamespace(parts=[SimpleNamespace(text=text, thought=False)]) if text else None
    return SimpleNamespace(
        get_function_responses=lambda: responses,
        is_final_response=lambda: text is not None,
        content=content,
    )


class FakeRunner:
    def __init__(self, events: list[Any], fail: Exception | None = None) -> None:
        self.session_service = FakeSessions()
        self.events = events
        self.fail = fail
        self.state_deltas: list[dict] = []

    async def run_async(self, *, user_id, session_id, new_message, state_delta):
        self.state_deltas.append(state_delta)
        for e in self.events:
            yield e
        if self.fail:
            raise self.fail


def test_chat_returns_tool_results_and_reply_and_keeps_the_session():
    runner = FakeRunner([event(tool_output=RESULT), event(text="Try Paddington 2.")])
    c, _ = client(runner=runner)
    c.put("/api/profile", json=PROFILE)
    body = c.post("/api/chat", json={"message": "something funny"}).json()
    assert body["reply"] == "Try Paddington 2."
    assert body["results"]["results"][0]["title"] == "Paddington 2"
    assert "Children's ages: 6, 9" in runner.state_deltas[0]["family"]
    again = c.post("/api/chat", json={"message": "more", "session_id": body["session_id"]})
    assert again.json()["session_id"] == body["session_id"]


def movie(tmdb_id: int, title: str, **extra: Any) -> dict[str, Any]:
    return {"title": title, "media_type": "movie", "tmdb_id": tmdb_id, **extra}


ANIMATED = {
    "regions": ["SE"],
    "results": [
        movie(10, "Beauty and the Beast"),
        movie(11, "WALL·E"),
        movie(12, "Ratatouille"),
        movie(13, "Toy Story"),
        movie(14, "Toy Story 4"),
    ],
    "attribution": "TMDB",
}


def test_titles_named_follow_the_reply_and_prefer_the_longest_name():
    reply = "**Toy Story 4 (2019)** is newest. Also **Wall-E** and Ratatouille; WALL·E again."
    named = titles_named(reply, ANIMATED["results"])
    assert [n["tmdb_id"] for n in named] == [14, 11, 12]


def test_chat_cards_put_the_named_titles_first_then_the_rest():
    known = {f"movie:{r['tmdb_id']}": r for r in ANIMATED["results"]}
    cards = chat_cards("Try Ratatouille or WALL·E.", ANIMATED, known)
    assert [r["tmdb_id"] for r in cards["results"]] == [12, 11, 10, 13, 14]
    assert chat_cards("Nothing named here.", ANIMATED, known) is ANIMATED
    assert chat_cards("Hello", None, {}) is None


def test_chat_answer_from_an_earlier_search_still_gets_its_cards():
    runner = FakeRunner([event(tool_output=ANIMATED), event(text="Try WALL·E.")])
    c, _ = client(runner=runner)
    c.put("/api/profile", json=PROFILE)
    first = c.post("/api/chat", json={"message": "animated movies"}).json()
    assert first["results"]["results"][0]["title"] == "WALL·E"
    # The follow-up is answered from memory, without a tool call: the cards still follow it.
    runner.events = [event(text="The most recent is **Toy Story 4 (2019)**.")]
    again = c.post(
        "/api/chat", json={"message": "recent ones", "session_id": first["session_id"]}
    ).json()
    assert [r["title"] for r in again["results"]["results"]] == ["Toy Story 4"]
    assert again["results"]["results"][0]["mark"] is None
    # Another session does not see these titles.
    other = c.post("/api/chat", json={"message": "recent ones"}).json()
    assert other["results"] is None


def test_chat_never_brings_back_a_title_banned_since_the_earlier_search():
    runner = FakeRunner([event(tool_output=ANIMATED), event(text="Try WALL·E.")])
    c, _ = client(runner=runner)
    c.put("/api/profile", json=PROFILE)
    first = c.post("/api/chat", json={"message": "animated movies"}).json()
    put_mark(c, 11, ban={"scope": "always"})
    runner.events = [event(text="**WALL·E** is still a great pick.")]
    again = c.post(
        "/api/chat", json={"message": "and now?", "session_id": first["session_id"]}
    ).json()
    assert again["results"] is None


def test_chat_named_near_miss_stays_a_near_miss():
    out = {"regions": ["SE"], "results": [], "near_misses": [movie(20, "Shrek", misses=["age"])]}
    cards = chat_cards("Shrek misses your age rule.", out, {"movie:20": out["near_misses"][0]})
    assert cards["results"] == [] and cards["near_misses"][0]["title"] == "Shrek"


def test_chat_budget_stop_keeps_partial_results():
    runner = FakeRunner([event(tool_output=RESULT)], fail=LlmBudgetExceededError("cap"))
    c, _ = client(runner=runner)
    body = c.post("/api/chat", json={"message": "x"}).json()
    assert body["results"]["results"][0]["title"] == "Paddington 2"
    assert "limit" in body["note"]


def test_chat_model_failure_without_output_is_503():
    c, _ = client(runner=FakeRunner([], fail=RuntimeError("429")))
    assert c.post("/api/chat", json={"message": "x"}).status_code == 503


def test_search_quota_is_per_family_per_day():
    settings = replace(Settings(store="memory", auth="none"), max_searches_per_day=2)
    c, toolbox = client(settings=settings)
    c.put("/api/profile", json=PROFILE)
    first = c.post("/api/search", json={"media_type": "movie"}).json()["quota"]
    assert first == {"used": 1, "limit": 2}
    assert c.post("/api/search", json={"media_type": "movie"}).json()["quota"]["used"] == 2
    over = c.post("/api/search", json={"media_type": "movie"})
    assert over.status_code == 429 and "2 searches" in over.json()["detail"]
    assert len(toolbox.calls) == 2


def test_chat_quota_is_separate_from_search():
    settings = replace(Settings(store="memory", auth="none"), max_chat_turns_per_day=1)
    c, _ = client(settings=settings, runner=FakeRunner([event(text="Hi")]))
    c.put("/api/profile", json=PROFILE)
    assert c.post("/api/chat", json={"message": "x"}).json()["quota"] == {"used": 1, "limit": 1}
    assert c.post("/api/chat", json={"message": "x"}).status_code == 429
    assert c.post("/api/search", json={"media_type": "movie"}).status_code == 200


def test_quota_counts_by_family_and_day():
    store = MemoryStore()
    today, tomorrow = datetime(2026, 1, 1).date(), datetime(2026, 1, 2).date()

    async def take(family: str, day: Any) -> int | None:
        return await store.take_quota(family, "chat", day, 1)

    assert asyncio.run(take("f1", today)) == 1
    assert asyncio.run(take("f1", today)) is None
    assert asyncio.run(take("f2", today)) == 1
    assert asyncio.run(take("f1", tomorrow)) == 1


def test_owner_on_allowlist_has_no_limit_but_sees_usage():
    store = MemoryStore()
    settings = replace(
        Settings(store="memory", auth="none"), max_searches_per_day=1, allowed_emails=("me@x.se",)
    )
    c, _ = client(settings=settings, store=store)
    c.put("/api/profile", json=PROFILE)  # creates the local owner
    owner = asyncio.run(store.get_member(LOCAL_UID))
    asyncio.run(store.put_member(owner.model_copy(update={"email": "me@x.se"})))
    for used in (1, 2, 3):
        quota = c.post("/api/search", json={"media_type": "movie"}).json()["quota"]
        assert quota == {"used": used, "limit": None}


def test_family_description_has_no_identifying_fields():
    text = describe_family(
        FamilyProfile(
            children_ages=[6],
            services=["netflix"],
            avoid_categories=[GuidanceCategory.FRIGHTENING],
        )
    )
    assert "Netflix" in text and "frightening" in text and "SE" in text
    assert describe_family(None) == ""


def test_firebase_mode_without_token_is_401():
    from nido.auth import FirebaseVerifier

    app = create_app(
        Settings(store="memory", auth="firebase"),
        store=MemoryStore(),
        toolbox=FakeToolbox(),
        authenticator=Authenticator("firebase", FirebaseVerifier("p", ("a@b.c",))),
    )
    c = TestClient(app)
    assert c.get("/api/config").status_code == 200  # public: the sign-in page needs it
    assert c.get("/api/profile").status_code == 401


async def test_toolbox_serves_details_from_cache_with_original_retrieval_time():
    from nido.agent.tools import Toolbox

    store = MemoryStore()
    toolbox = Toolbox(Settings(tmdb_token="t", omdb_key=None), cache=store)
    fetched = []

    class Tmdb:
        async def details(self, media_type, tmdb_id):
            fetched.append(tmdb_id)
            return {"id": tmdb_id, "title": "X"}

    toolbox._tmdb = Tmdb()
    data, first = await toolbox._details(MediaType.MOVIE, 7)
    data2, second = await toolbox._details(MediaType.MOVIE, 7)
    assert fetched == [7] and data == data2 and first == second
    hit = await store.cache_get("tmdb:details:movie:7:en-US", timedelta(days=1))
    assert hit is not None
    assert await store.cache_get("tmdb:details:movie:7:en-US", timedelta(0)) is None


def put_mark(c: TestClient, tmdb_id: int = 1, **fields: Any) -> dict[str, Any]:
    response = c.put(f"/api/titles/movie/{tmdb_id}", json={"name": "Paddington 2", **fields})
    assert response.status_code == 200, response.text
    return response.json()["item"]


def test_marks_are_independent_and_partial_updates_keep_the_rest():
    c, _ = client()
    put_mark(c, seen=True, year=2017)
    put_mark(c, liked_child=True)
    item = put_mark(c, liked_adults=False)
    assert (item["seen"], item["liked_adults"], item["liked_child"]) == (True, False, True)
    assert item["year"] == 2017 and item["ban"] is None and item["ban_active"] is False
    assert [i["key"] for i in c.get("/api/titles").json()["items"]] == ["movie:1"]


def test_on_repeat_is_its_own_mark_and_never_hides_a_title():
    c, _ = client()
    item = put_mark(c, rewatch=True, seen=True)
    assert (item["rewatch"], item["seen"], item["ban_active"]) == (True, True, False)
    item = put_mark(c, seen=False)
    assert item["rewatch"] is True
    put_mark(c, rewatch=False)
    assert c.get("/api/titles").json()["items"] == []


def test_clearing_every_mark_forgets_the_title():
    c, _ = client()
    put_mark(c, seen=True)
    put_mark(c, seen=False)
    assert c.get("/api/titles").json()["items"] == []


def test_age_ban_defaults_to_the_baseline_or_the_next_age_range():
    c, _ = client()
    c.put("/api/profile", json=PROFILE)  # youngest is 6
    assert put_mark(c, 1, ban={"scope": "age"})["ban"]["until_age"] == 7
    assert put_mark(c, 2, ban={"scope": "age", "baseline_age": 11})["ban"]["until_age"] == 11
    assert put_mark(c, 3, ban={"scope": "age", "until_age": 9})["ban"]["until_age"] == 9
    bad = c.put("/api/titles/movie/4", json={"name": "X", "ban": {"scope": "age", "until_age": 6}})
    assert bad.status_code == 422
    assert put_mark(c, 6, ban={"scope": "age", "baseline_age": 18})["ban"]["until_age"] == 17
    always = put_mark(c, 5, ban={"scope": "always"})["ban"]
    assert always["scope"] == "always" and always["until_age"] is None


def test_a_seventeen_year_old_can_only_be_banned_for_every_age():
    c, _ = client()
    c.put("/api/profile", json={**PROFILE, "children_ages": [17]})
    response = c.put("/api/titles/movie/1", json={"name": "X", "ban": {"scope": "age"}})
    assert response.status_code == 422
    assert put_mark(c, 1, ban={"scope": "always"})["ban_active"] is True


def test_age_ban_needs_a_profile():
    c, _ = client()
    response = c.put("/api/titles/movie/1", json={"name": "X", "ban": {"scope": "age"}})
    assert response.status_code == 409


def test_search_hides_active_bans_and_age_bans_lift_with_the_profile():
    c, toolbox = client()
    c.put("/api/profile", json=PROFILE)
    put_mark(c, 1, ban={"scope": "age", "until_age": 8})
    put_mark(c, 2, ban={"scope": "always"})
    put_mark(c, 3, seen=True, liked_adults=True)  # seen and liked never hide a title
    c.post("/api/search", json={})
    assert sorted(toolbox.calls[-1]["hidden"]) == ["movie:1", "movie:2"]

    c.put("/api/profile", json={**PROFILE, "children_ages": [9, 8]})
    c.post("/api/search", json={})
    assert toolbox.calls[-1]["hidden"] == ["movie:2"]
    lifted = {i["key"]: i["ban_active"] for i in c.get("/api/titles").json()["items"]}
    assert lifted == {"movie:1": False, "movie:2": True, "movie:3": False}  # still listed


def test_unban_with_null():
    c, toolbox = client()
    c.put("/api/profile", json=PROFILE)
    put_mark(c, 1, ban={"scope": "always"}, seen=True)
    item = put_mark(c, 1, ban=None)
    assert item["ban"] is None and item["seen"] is True
    c.post("/api/search", json={})
    assert toolbox.calls[-1]["hidden"] == []


def test_results_carry_their_marks():
    c, _ = client()
    c.put("/api/profile", json=PROFILE)
    put_mark(c, 1, liked_child=True)
    result = c.post("/api/search", json={}).json()["results"][0]
    assert result["mark"]["liked_child"] is True


def test_chat_hands_bans_to_the_tool_through_session_state():
    runner = FakeRunner([event(tool_output=RESULT), event(text="ok")])
    c, _ = client(runner=runner)
    c.put("/api/profile", json=PROFILE)
    put_mark(c, 2, ban={"scope": "always"})
    put_mark(c, 1, seen=True)
    body = c.post("/api/chat", json={"message": "x"}).json()
    assert runner.state_deltas[0]["hidden_titles"] == ["movie:2"]
    assert body["results"]["results"][0]["mark"]["seen"] is True


async def test_find_titles_reads_bans_from_state_not_from_the_model():
    from nido.agent.tools import Toolbox

    toolbox = Toolbox(Settings(tmdb_token="t"))
    seen: list[Any] = []

    async def search(**kwargs: Any) -> dict[str, Any]:
        seen.append(kwargs["hidden"])
        return {}

    toolbox.search = search  # type: ignore[method-assign]
    context = SimpleNamespace(state={"hidden_titles": ["movie:2"]})
    await toolbox.find_titles("movie", [4], ["netflix"], tool_context=context)  # type: ignore[arg-type]
    await toolbox.find_titles("movie", [4], ["netflix"])
    assert seen == [["movie:2"], []]


class HeaderAuthenticator:
    """Signs in whoever the Authorization header names; "guillermo" and "grandma" are allowed."""

    mode = "firebase"

    async def __call__(self, authorization: str | None) -> User:
        uid = authorization or "guillermo"
        return User(uid=uid, email=f"{uid}@example.com", allowed=uid in {"guillermo", "grandma"})


def family_client(store: MemoryStore | None = None) -> TestClient:
    app = create_app(
        Settings(store="memory", auth="firebase"),
        store=store or MemoryStore(),
        toolbox=FakeToolbox(),
        authenticator=HeaderAuthenticator(),  # type: ignore[arg-type]
    )
    return TestClient(app)


ME, PARTNER, STRANGER = (
    {"Authorization": "guillermo"},
    {"Authorization": "partner"},
    {"Authorization": "stranger"},
)


def invite(c: TestClient, headers: dict[str, str] = ME) -> str:
    return c.post("/api/family/invites", headers=headers).json()["token"]


def test_every_account_starts_its_own_family_and_existing_data_stays():
    store = MemoryStore()
    asyncio.run(store.put_profile("guillermo", FamilyProfile(children_ages=[4])))
    c = family_client(store)
    assert c.get("/api/profile", headers=ME).json()["profile"]["children_ages"] == [4]
    family = c.get("/api/family", headers=ME).json()
    assert family["role"] == "owner"
    assert [(m["email"], m["you"]) for m in family["members"]] == [("guillermo@example.com", True)]
    # Anyone else signing in gets an empty family of their own, never someone else's data.
    assert c.get("/api/profile", headers=PARTNER).json()["profile"] is None
    assert c.get("/api/family", headers=PARTNER).json()["role"] == "owner"


def test_an_invite_shares_profile_watchlist_and_marks_and_works_once():
    c = family_client()
    c.put("/api/profile", json=PROFILE, headers=ME)
    token = invite(c)
    assert c.post(f"/api/invites/{token}", headers=PARTNER).json()["joined"] is True
    # Opening the same link again is harmless for a member, useless for anyone else.
    assert c.post(f"/api/invites/{token}", headers=PARTNER).json()["joined"] is False
    assert c.post(f"/api/invites/{token}", headers=STRANGER).status_code == 410

    assert c.get("/api/profile", headers=PARTNER).json()["profile"]["children_ages"] == [9, 6]
    put_mark(c, 7, seen=True)  # as guillermo
    c.put("/api/watchlist/movie/8", json={"name": "Up"}, headers=PARTNER)
    assert [
        i["title"]["tmdb_id"] for i in c.get("/api/titles", headers=PARTNER).json()["items"]
    ] == [7]
    assert [i["title"]["tmdb_id"] for i in c.get("/api/watchlist", headers=ME).json()["items"]] == [
        8
    ]
    roles = {m["email"]: m["role"] for m in c.get("/api/family", headers=PARTNER).json()["members"]}
    assert roles == {"guillermo@example.com": "owner", "partner@example.com": "member"}


def test_unknown_and_expired_invites_are_gone():
    store = MemoryStore()
    c = family_client(store)
    assert c.post("/api/invites/nope", headers=PARTNER).status_code == 410
    token = invite(c)
    store._invites[token] = store._invites[token].model_copy(
        update={"expires_at": datetime.now(UTC) - timedelta(seconds=1)}
    )
    assert c.post(f"/api/invites/{token}", headers=PARTNER).status_code == 410


def test_only_the_owner_removes_members_and_the_owner_cannot_leave():
    c = family_client()
    c.post(f"/api/invites/{invite(c)}", headers=PARTNER)
    c.post(f"/api/invites/{invite(c)}", headers=STRANGER)
    assert c.delete("/api/family/members/stranger", headers=PARTNER).status_code == 403
    assert c.delete("/api/family/members/guillermo", headers=ME).status_code == 409
    assert c.delete("/api/family/members/stranger", headers=ME).json() == {"ok": True}
    # Removed, they are back in a family of their own.
    assert c.get("/api/profile", headers=STRANGER).json()["profile"] is None
    # A member may leave on their own.
    assert c.delete("/api/family/members/partner", headers=PARTNER).json() == {"ok": True}
    assert c.get("/api/family", headers=PARTNER).json()["role"] == "owner"


def test_a_removed_member_cannot_come_back_with_their_old_link():
    c = family_client()
    token = invite(c)
    c.post(f"/api/invites/{token}", headers=PARTNER)
    c.delete("/api/family/members/partner", headers=ME)
    assert c.post(f"/api/invites/{token}", headers=PARTNER).status_code == 410
    assert c.get("/api/profile", headers=PARTNER).json()["profile"] is None


def test_a_member_of_a_shared_family_must_leave_before_joining_another():
    c = family_client()
    grandma = {"Authorization": "grandma"}  # also on the allowlist, with a family of her own
    c.post(f"/api/invites/{invite(c, grandma)}", headers=PARTNER)
    response = c.post(f"/api/invites/{invite(c)}", headers=PARTNER)
    assert response.status_code == 409 and "leave" in response.json()["detail"]
    # The refused link was not spent: after leaving, it still works.
    token = invite(c)
    assert c.post(f"/api/invites/{token}", headers=PARTNER).status_code == 409
    c.delete("/api/family/members/partner", headers=PARTNER)
    assert c.post(f"/api/invites/{token}", headers=PARTNER).json()["joined"] is True


def test_title_details_open_a_saved_title_with_its_marks_and_no_quota():
    c, toolbox = client()
    assert c.get("/api/titles/movie/1").status_code == 409
    c.put("/api/profile", json=PROFILE)
    c.put("/api/titles/movie/1", json={"name": "Paddington 2", "liked_child": True})
    result = c.get("/api/titles/movie/1").json()["result"]
    assert result["tmdb_id"] == 1 and result["mark"]["liked_child"] is True
    assert toolbox.calls[-1] == {"details": ("movie", 1), "regions": ["SE", "NO"]}
    c.put("/api/watchlist/tv/2", json={"name": "Bluey"})
    assert c.get("/api/titles/tv/2").json()["result"]["mark"] is None
    assert c.get("/api/titles/book/2").status_code == 422


def test_title_details_only_open_saved_or_marked_titles():
    c, toolbox = client()
    c.put("/api/profile", json=PROFILE)
    assert c.get("/api/titles/movie/99").status_code == 404
    assert not any("details" in call for call in toolbox.calls)


def test_chat_answers_in_the_page_language_and_translates_the_cards():
    card = {**RESULT["results"][0], "why": ["Included in your subscriptions."]}
    found = {**RESULT, "results": [card]}
    runner = FakeRunner([event(tool_output=found), event(text="Paddington 2")])
    c, _ = client(runner=runner)
    c.put("/api/profile", json=PROFILE)
    body = c.post(
        "/api/chat", json={"message": "algo divertido"}, headers={"X-Nido-Locale": "es"}
    ).json()
    assert runner.state_deltas[0]["language"].startswith("Spanish")
    assert body["results"]["results"][0]["why"] == ["Incluida en tus suscripciones."]
    c.post("/api/chat", json={"message": "something fun"})
    assert runner.state_deltas[1]["language"] == "English"
