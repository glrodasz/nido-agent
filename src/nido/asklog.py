"""Ask Nido's quality log: one record per question, so the owner can review how answers went.

A record holds what was asked and for whom (ages watching, content to avoid, services, regions:
never emails, names or the children's nicknames), what the model did (each tool call with its
arguments and how many titles it found), what the family saw (the reply and its cards), how the
turn went (time, models, tokens, outcome) and what the family did next: a 👍/👎 with an optional
comment, and saves or marks on the answer's cards within FOLLOW_UP_WINDOW. A family is a short
one-way tag, enough to group questions without naming anyone.

Records live 30 days (a TTL policy on expire_at deletes them, see infra/bootstrap.sh). Writing one
never fails the question: a store error is logged and the answer goes out.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import time
from datetime import UTC, datetime, timedelta
from statistics import median
from typing import Any

ASK_LOG_TTL = timedelta(days=30)
# How long after an answer a save, a mark or another question still counts as a reaction to it.
FOLLOW_UP_WINDOW = timedelta(minutes=30)
MAX_TITLES_PER_TOOL = 20
MAX_CARDS_LOGGED = 20
MAX_REPLY_CHARS = 6000
MAX_COMMENT_CHARS = 500

Outcome = str  # ok | partial | too_slow | busy | budget | no_answer


def family_tag(family_id: str) -> str:
    """A family's stable, anonymous label in the log."""
    return hashlib.sha256(f"nido-ask-log:{family_id}".encode()).hexdigest()[:10]


def new_log_id() -> str:
    return secrets.token_urlsafe(12)


def _key(item: dict[str, Any]) -> str:
    return f"{item.get('media_type')}:{item.get('tmdb_id')}"


def _title(item: dict[str, Any]) -> dict[str, Any]:
    return {"key": _key(item), "title": item.get("title"), "year": item.get("year")}


def _plain(value: Any) -> Any:
    """JSON-safe copy (tool arguments may hold anything the model wrote)."""
    return json.loads(json.dumps(value, default=str))


class TurnRecorder:
    """Collects one chat turn as the agent's events stream by."""

    def __init__(self) -> None:
        self._started = time.perf_counter()
        self.tools: list[dict[str, Any]] = []
        self.models: list[str] = []
        self.model_calls = 0
        self.tokens = {"prompt": 0, "output": 0}

    def event(self, event: Any) -> None:
        get_calls = getattr(event, "get_function_calls", None)
        for call in (get_calls() if callable(get_calls) else None) or []:
            self.tools.append({"name": call.name, "args": _plain(dict(call.args or {}))})
        for response in event.get_function_responses() or []:
            self._tool_output(response.name, response.response)
        model = getattr(event, "model_version", None)
        usage = getattr(event, "usage_metadata", None)
        if isinstance(model, str) and model:
            self.model_calls += 1
            if model not in self.models:
                self.models.append(model)
        if usage is not None:
            self.tokens["prompt"] += int(getattr(usage, "prompt_token_count", 0) or 0)
            self.tokens["output"] += int(getattr(usage, "candidates_token_count", 0) or 0)

    def _tool_output(self, name: str, output: Any) -> None:
        # The response belongs to the latest call of that tool still waiting for one.
        call = next(
            (t for t in reversed(self.tools) if t["name"] == name and "found" not in t), None
        )
        if call is None:
            call = {"name": name, "args": {}}
            self.tools.append(call)
        if not isinstance(output, dict):
            call["found"] = {}
            return
        results = output.get("results") or []
        misses = output.get("near_misses") or []
        found: dict[str, Any] = {"results": len(results), "near_misses": len(misses)}
        titles = [_title(r) for r in results] + [{**_title(r), "near_miss": True} for r in misses]
        if titles:
            found["titles"] = titles[:MAX_TITLES_PER_TOOL]
        for extra in ("ignored_genres", "not_found", "not_available", "error"):
            if output.get(extra):
                found[extra] = _plain(output[extra])
        call["found"] = found

    def record(
        self,
        *,
        log_id: str,
        family_id: str,
        session_id: str,
        previous: str | None,
        question: str,
        locale: str,
        viewers: dict[str, Any],
        reply: str,
        cards: dict[str, Any] | None,
        note: str | None,
        outcome: Outcome,
        error: str | None = None,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        now = now or datetime.now(UTC)
        shown = [_title(r) for r in (cards or {}).get("results") or []] + [
            {**_title(r), "near_miss": True} for r in (cards or {}).get("near_misses") or []
        ]
        return {
            "id": log_id,
            "family": family_tag(family_id),
            "session": session_id,
            "previous": previous,
            "at": now,
            "expire_at": now + ASK_LOG_TTL,
            "locale": locale,
            "question": question,
            "viewers": viewers,
            "tools": self.tools,
            "reply": reply[:MAX_REPLY_CHARS],
            "cards": shown[:MAX_CARDS_LOGGED],
            "note": note,
            "outcome": outcome,
            "error": error,
            "latency_ms": round((time.perf_counter() - self._started) * 1000),
            "model_calls": self.model_calls,
            "models": self.models,
            "tokens": self.tokens,
            "rating": None,
            "comment": None,
            "events": [],
        }


def card_keys(record: dict[str, Any]) -> set[str]:
    return {c["key"] for c in record.get("cards") or []}


def present(record: dict[str, Any], own_family: str | None = None) -> dict[str, Any]:
    """A record as the Quality page shows it."""
    out = {k: v for k, v in record.items() if k != "expire_at"}
    if isinstance(out.get("at"), datetime):
        out["at"] = out["at"].isoformat()
    out["events"] = [
        {**e, "at": e["at"].isoformat() if isinstance(e.get("at"), datetime) else e.get("at")}
        for e in record.get("events") or []
    ]
    out["yours"] = own_family is not None and record.get("family") == family_tag(own_family)
    return out


FAILED = frozenset({"too_slow", "busy", "no_answer"})


def summarize(records: list[dict[str, Any]], fallback_model: str | None) -> dict[str, Any]:
    latencies = [r.get("latency_ms") or 0 for r in records]
    return {
        "questions": len(records),
        "families": len({r.get("family") for r in records}),
        "failed": sum(r.get("outcome") in FAILED for r in records),
        "partial": sum(r.get("outcome") in {"partial", "budget"} for r in records),
        "up": sum(r.get("rating") == "up" for r in records),
        "down": sum(r.get("rating") == "down" for r in records),
        "no_cards": sum(not r.get("cards") and r.get("outcome") not in FAILED for r in records),
        "acted": sum(
            any(e.get("kind") != "asked_again" for e in r.get("events") or []) for r in records
        ),
        "fallback": sum(
            bool(fallback_model and fallback_model in (r.get("models") or [])) for r in records
        ),
        "median_ms": round(median(latencies)) if latencies else None,
        "slowest_ms": max(latencies) if latencies else None,
    }
