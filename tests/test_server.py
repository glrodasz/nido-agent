from datetime import timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from nido.agent.budget import LlmBudgetExceededError
from nido.auth import Authenticator
from nido.config import Settings
from nido.models import FamilyProfile, GuidanceCategory, MediaType
from nido.server import ChatLimiter, create_app, describe_family
from nido.store import MemoryStore

PROFILE = {
    "children_ages": [9, 6],
    "regions": ["se", "no"],
    "services": ["netflix", "disney_plus", "not_a_service"],
    "avoid_categories": ["frightening"],
    "max_runtime_min": 110,
    "preferred_genres": ["Comedy"],
}
RESULT = {"regions": ["SE"], "results": [{"title": "Paddington 2", "tmdb_id": 1}]}


class FakeToolbox:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def find_titles(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        return RESULT


def client(**kwargs: Any) -> tuple[TestClient, FakeToolbox]:
    toolbox = kwargs.pop("toolbox", FakeToolbox())
    app = create_app(
        Settings(store="memory", auth="none"),
        store=MemoryStore(),
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
    assert response.json() == RESULT
    call = toolbox.calls[-1]
    assert call["media_type"] == "tv"
    assert call["children_ages"] == [9, 6]
    assert call["regions"] == ["SE", "NO"]
    assert call["max_runtime_min"] == 30  # request overrides the profile
    assert call["avoid"] == ["frightening"]  # profile fills what the request leaves out
    assert call["genres"] == [] and call["prefer_genres"] == ["Comedy"]  # favourites only boost


def test_search_can_clear_profile_avoidances():
    c, toolbox = client()
    c.put("/api/profile", json=PROFILE)
    c.post("/api/search", json={"avoid": []})
    assert toolbox.calls[-1]["avoid"] == []


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
    assert body["results"] == RESULT
    assert "Children's ages: 6, 9" in runner.state_deltas[0]["family"]
    again = c.post("/api/chat", json={"message": "more", "session_id": body["session_id"]})
    assert again.json()["session_id"] == body["session_id"]


def test_chat_budget_stop_keeps_partial_results():
    runner = FakeRunner([event(tool_output=RESULT)], fail=LlmBudgetExceededError("cap"))
    c, _ = client(runner=runner)
    body = c.post("/api/chat", json={"message": "x"}).json()
    assert body["results"] == RESULT
    assert "limit" in body["note"]


def test_chat_model_failure_without_output_is_503():
    c, _ = client(runner=FakeRunner([], fail=RuntimeError("429")))
    assert c.post("/api/chat", json={"message": "x"}).status_code == 503


def test_chat_limiter_caps_per_user():
    limiter = ChatLimiter(per_day=1)
    assert limiter.take("a") and limiter.take("b")
    assert not limiter.take("a")


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
