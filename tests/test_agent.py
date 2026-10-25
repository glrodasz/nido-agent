import pytest

from nido.agent.budget import LlmBudget, LlmBudgetExceededError


class Ctx:
    def __init__(self, invocation_id: str) -> None:
        self.invocation_id = invocation_id


def test_agent_app_imports_offline():
    from nido.agent.app import root_agent

    assert root_agent.name == "nido_agent"
    assert len(root_agent.tools) == 2


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
