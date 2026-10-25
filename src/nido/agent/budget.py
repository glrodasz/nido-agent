"""Per-turn model call cap, enforced in before_model_callback so it also holds under `adk web`."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class LlmBudgetExceededError(RuntimeError):
    pass


# Invocations remembered at once: enough for overlapping turns under `adk web`, small enough that
# finished ones fall off without explicit cleanup.
MAX_TRACKED_INVOCATIONS = 256


@dataclass
class LlmBudget:
    max_calls: int
    _calls: dict[str, int] = field(default_factory=dict)

    def before_model(self, callback_context: Any, llm_request: Any) -> None:
        invocation = str(getattr(callback_context, "invocation_id", "") or "")
        used = self._calls.get(invocation, 0)
        if used >= self.max_calls:
            raise LlmBudgetExceededError(f"NIDO_MAX_LLM_CALLS={self.max_calls} reached this turn")
        self._calls.pop(invocation, None)
        self._calls[invocation] = used + 1
        # Dicts keep insertion order, and the line above moves this invocation to the end: drop the
        # least recently used ones.
        while len(self._calls) > MAX_TRACKED_INVOCATIONS:
            del self._calls[next(iter(self._calls))]
        return None
