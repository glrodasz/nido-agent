from types import SimpleNamespace
from typing import Any

from fastapi.testclient import TestClient

from nido.asklog import TurnRecorder, family_tag, summarize
from nido.auth import LOCAL_UID, User
from nido.config import Settings
from nido.server import create_app
from nido.store import MemoryStore
from test_server import PROFILE, FakeRunner, FakeToolbox, client, movie

FOUND = {"regions": ["SE"], "results": [movie(1, "Paddington 2"), movie(2, "Wall-E")]}


def tool_event(output: dict, args: dict | None = None, model: str = "gemini-main") -> Any:
    return SimpleNamespace(
        get_function_calls=lambda: [SimpleNamespace(name="find_titles", args=args or {})],
        get_function_responses=lambda: [SimpleNamespace(name="find_titles", response=output)],
        is_final_response=lambda: False,
        content=None,
        model_version=model,
        usage_metadata=SimpleNamespace(prompt_token_count=100, candidates_token_count=5),
    )


def text_event(text: str, model: str = "gemini-main") -> Any:
    return SimpleNamespace(
        get_function_calls=lambda: [],
        get_function_responses=lambda: [],
        is_final_response=lambda: True,
        content=SimpleNamespace(parts=[SimpleNamespace(text=text, thought=False)]),
        model_version=model,
        usage_metadata=None,
    )


def ask(store: MemoryStore, events: list[Any], **kwargs: Any) -> tuple[TestClient, dict]:
    c, _ = client(store=store, runner=FakeRunner(events, **kwargs))
    c.put("/api/profile", json={**PROFILE, "children_names": ["Oldest", "Youngest"]})
    return c, c.post("/api/chat", json={"message": "something funny", "watching": [1]})


def test_each_question_is_logged_with_what_the_model_did_and_showed():
    store = MemoryStore()
    _, response = ask(
        store,
        [tool_event(FOUND, {"genres": ["Comedy"]}), text_event("Try **Wall-E**.")],
    )
    body = response.json()
    record = store._ask_logs[body["log_id"]]
    assert record["question"] == "something funny"
    assert record["family"] == family_tag(LOCAL_UID)
    assert record["viewers"]["ages"] == [6]
    assert record["viewers"]["avoid"] == ["frightening"]
    assert "Oldest" not in str(record)  # nicknames stay out
    assert record["tools"] == [
        {
            "name": "find_titles",
            "args": {"genres": ["Comedy"]},
            "found": {
                "results": 2,
                "near_misses": 0,
                "titles": [
                    {"key": "movie:1", "title": "Paddington 2", "year": None},
                    {"key": "movie:2", "title": "Wall-E", "year": None},
                ],
            },
        }
    ]
    assert [card["key"] for card in record["cards"]] == ["movie:2", "movie:1"]
    assert record["reply"] == "Try **Wall-E**."
    assert record["outcome"] == "ok"
    assert record["models"] == ["gemini-main"]
    assert record["model_calls"] == 2
    assert record["tokens"] == {"prompt": 100, "output": 5}
    assert record["expire_at"] > record["at"]


def test_a_failed_question_is_logged_too():
    store = MemoryStore()
    _, response = ask(store, [], fail=RuntimeError("503 overloaded"))
    assert response.status_code == 503
    (record,) = store._ask_logs.values()
    assert record["outcome"] == "busy"
    assert "503 overloaded" in record["error"]


def test_saves_marks_and_the_next_question_are_noted_on_the_answer():
    store = MemoryStore()
    c, response = ask(store, [tool_event(FOUND), text_event("Try Wall-E.")])
    log_id = response.json()["log_id"]
    title = {"name": "Wall-E"}
    c.put("/api/watchlist/movie/2", json=title)
    c.put("/api/titles/movie/2", json={**title, "seen": True, "liked_child": True})
    c.put("/api/titles/movie/99", json={"name": "Not a card", "seen": True})
    c.post("/api/chat", json={"message": "something shorter"})
    record = store._ask_logs[log_id]
    assert [(e["kind"], e.get("key")) for e in record["events"]] == [
        ("saved", "movie:2"),
        ("seen", "movie:2"),
        ("liked_child", "movie:2"),
        ("asked_again", None),
    ]
    later = next(r for r in store._ask_logs.values() if r["id"] != log_id)
    assert later["previous"] == log_id


def test_a_family_rates_its_own_answers_only():
    store = MemoryStore()
    c, response = ask(store, [tool_event(FOUND), text_event("Try Wall-E.")])
    log_id = response.json()["log_id"]
    rated = c.post(
        "/api/chat/feedback",
        json={"log_id": log_id, "rating": "down", "comment": "  too  babyish "},
    )
    assert rated.json() == {"rating": "down", "comment": "too babyish"}
    assert store._ask_logs[log_id]["rating"] == "down"
    assert store._ask_logs[log_id]["comment"] == "too babyish"
    c.post("/api/chat/feedback", json={"log_id": log_id, "rating": None, "comment": "x"})
    assert store._ask_logs[log_id]["rating"] is None
    assert store._ask_logs[log_id]["comment"] is None

    store._ask_logs[log_id]["family"] = family_tag("someone-else")
    assert c.post("/api/chat/feedback", json={"log_id": log_id, "rating": "up"}).status_code == 404


class OneUser:
    mode = "firebase"

    def __init__(self, email: str) -> None:
        self.email = email

    async def __call__(self, authorization: str | None) -> User:
        return User(uid="u1", email=self.email)


def test_only_owners_see_the_quality_page():
    store = MemoryStore()
    ask(store, [tool_event(FOUND), text_event("Try Wall-E.")])
    settings = Settings(store="memory", auth="none", allowed_emails=("owner@example.com",))
    for email, status in (("owner@example.com", 200), ("guest@example.com", 403)):
        app = create_app(settings, store=store, toolbox=FakeToolbox(), authenticator=OneUser(email))
        c = TestClient(app)
        assert c.get("/api/me").json() == {"can_review": status == 200}
        assert c.get("/api/quality").status_code == status
    owner = TestClient(
        create_app(
            settings,
            store=store,
            toolbox=FakeToolbox(),
            authenticator=OneUser("owner@example.com"),
        )
    )
    body = owner.get("/api/quality?days=7").json()
    assert body["summary"]["questions"] == 1
    (item,) = body["items"]
    assert item["question"] == "something funny"
    assert item["yours"] is False  # asked by the local family, not u1's
    assert "expire_at" not in item


def test_local_runs_can_review():
    c, _ = client()
    assert c.get("/api/me").json() == {"can_review": True}


def test_summary_counts_ratings_failures_and_fallbacks():
    def rec(**kw: Any) -> dict:
        base = {"family": "a", "latency_ms": 1000, "cards": [{"key": "movie:1"}], "events": []}
        return {**base, "outcome": "ok", "rating": None, "models": ["main"], **kw}

    summary = summarize(
        [
            rec(rating="up", events=[{"kind": "saved"}]),
            rec(rating="down", latency_ms=3000),
            rec(outcome="too_slow", cards=[], latency_ms=50000),
            rec(cards=[], models=["main", "backup"], events=[{"kind": "asked_again"}]),
        ],
        "backup",
    )
    assert summary == {
        "questions": 4,
        "families": 1,
        "failed": 1,
        "partial": 0,
        "up": 1,
        "down": 1,
        "no_cards": 1,
        "acted": 1,
        "fallback": 1,
        "median_ms": 2000,
        "slowest_ms": 50000,
    }


def test_recorder_tolerates_a_response_without_a_call():
    recorder = TurnRecorder()
    recorder.event(
        SimpleNamespace(
            get_function_responses=lambda: [
                SimpleNamespace(name="look_up_title", response={"not_found": "Zzz"})
            ]
        )
    )
    assert recorder.tools == [
        {
            "name": "look_up_title",
            "args": {},
            "found": {"results": 0, "near_misses": 0, "not_found": "Zzz"},
        }
    ]
