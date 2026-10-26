import pytest

from nido.agent.budget import LlmBudget, LlmBudgetExceededError


class Ctx:
    def __init__(self, invocation_id: str) -> None:
        self.invocation_id = invocation_id


def test_agent_app_imports_offline():
    from nido.agent.app import root_agent

    assert root_agent.name == "nido_agent"
    assert len(root_agent.tools) == 3


def test_budget_caps_calls_per_turn_and_resets_on_next_turn():
    budget = LlmBudget(max_calls=2)
    budget.before_model(Ctx("a"), None)
    budget.before_model(Ctx("a"), None)
    with pytest.raises(LlmBudgetExceededError):
        budget.before_model(Ctx("a"), None)
    budget.before_model(Ctx("b"), None)


def test_interleave_merges_regions_without_duplicates():
    from nido.agent.tools import _interleave

    assert _interleave([[1, 2, 3], [2, 4], []]) == [1, 2, 4, 3]


def test_budget_keeps_counts_of_overlapping_turns():
    budget = LlmBudget(max_calls=2)
    for invocation in ("a", "b", "a", "b"):
        budget.before_model(Ctx(invocation), None)
    with pytest.raises(LlmBudgetExceededError):
        budget.before_model(Ctx("a"), None)
    with pytest.raises(LlmBudgetExceededError):
        budget.before_model(Ctx("b"), None)


def _fake_gemini(monkeypatch, failing: dict[str, int]):
    import asyncio

    from google.adk.models import Gemini
    from google.genai import errors

    seen: list[str] = []

    async def fake(self, llm_request, stream=False):
        seen.append(llm_request.model)
        if llm_request.model in failing:
            raise errors.ServerError(failing[llm_request.model], {"error": {"message": "busy"}})
        yield f"ok from {llm_request.model}"

    monkeypatch.setattr(Gemini, "generate_content_async", fake)

    def run(model):
        from google.adk.models import LlmRequest

        async def collect():
            req = LlmRequest(model=model.model)
            return [r async for r in model.generate_content_async(req)]

        return asyncio.run(collect())

    return seen, run


def test_overloaded_model_falls_back(monkeypatch):
    from nido.agent.model import build_model

    seen, run = _fake_gemini(monkeypatch, {"main": 503})
    assert run(build_model("main", "spare")) == ["ok from spare"]
    assert seen == ["main", "spare"]


def test_no_fallback_configured_raises(monkeypatch):
    from google.genai import errors

    from nido.agent.model import build_model

    _, run = _fake_gemini(monkeypatch, {"main": 503})
    with pytest.raises(errors.ServerError):
        run(build_model("main", ""))


def test_model_retries_transient_errors():
    from nido.agent.model import build_model

    assert build_model("main", None).retry_options.attempts == 3
