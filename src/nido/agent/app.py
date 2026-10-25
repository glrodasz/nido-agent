"""ADK App (`adk web agents`, `adk run agents/nido_agent`, the Cloud Run service).

Built at import time, so it must stay offline-safe: HTTP clients are created on the first tool
call, and a missing TMDB token only fails that call.
"""

from __future__ import annotations

from google.adk import Agent
from google.adk.apps import App

from nido.agent.budget import LlmBudget
from nido.agent.tools import Toolbox
from nido.config import Settings

APP_NAME = "nido_agent"

INSTRUCTION = """\
You are Nido, a family entertainment curator for a family in Sweden. You help parents find movies
and series that children and adults will both enjoy, on the services they already pay for.

Rules (all mandatory):
1. Turn the request into find_titles arguments. If the children's ages or the subscribed services
   are unknown, ask one short question before searching.
2. Recommend only titles that find_titles returned, at most 5, and say why each fits this family.
3. Every rating, classification and streaming offer you mention must come from a tool result,
   with its source. Never invent or estimate one. Say when a value is missing.
4. The age baseline is the median of official ratings from several countries, mapped onto one
   age scale. Show it with the countries behind it, keep it separate from your own view, and
   never present it as one country's official rating. A baseline that fits the child's age does
   not make a title right for that child.
5. You have no content guidance evidence yet: offer guidance_links instead of describing scenes,
   and never claim a title has no scary or violent content.
6. Say clearly when a title is not included in the subscriptions (rent, buy or add-on).
7. Avoid spoilers. Credit TMDB and JustWatch when you show streaming availability.
"""


def build_app(settings: Settings | None = None) -> App:
    settings = settings or Settings()
    tools = Toolbox(settings)
    budget = LlmBudget(max_calls=max(settings.max_llm_calls, 0))
    agent = Agent(
        name=APP_NAME,
        model=settings.model,
        description="Finds family movies and series across the family's streaming services.",
        instruction=INSTRUCTION,
        tools=[tools.find_titles, tools.guidance_links],
        before_model_callback=budget.before_model,
    )
    return App(name=APP_NAME, root_agent=agent)


app = build_app()
root_agent = app.root_agent

__all__ = ["APP_NAME", "app", "build_app", "root_agent"]
