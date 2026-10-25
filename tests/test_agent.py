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
