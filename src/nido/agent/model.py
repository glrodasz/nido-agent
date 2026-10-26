"""Gemini with retries and a fallback model: the free tier often answers 503 "high demand"."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.models import Gemini
from google.genai import errors, types

log = logging.getLogger(__name__)

# Overload and quota answers worth sending to another model instead of failing the turn.
FALLBACK_CODES = frozenset({429, 500, 502, 503, 504})

# Short backoff: each turn may make several model calls and the parent is waiting.
RETRY = types.HttpRetryOptions(attempts=3, initial_delay=1.0, max_delay=4.0)


class FallbackGemini(Gemini):
    fallback_model: str | None = None

    async def generate_content_async(
        self, llm_request: Any, stream: bool = False
    ) -> AsyncGenerator[Any, None]:
        sent_any = False
        try:
            async for response in super().generate_content_async(llm_request, stream):
                sent_any = True
                yield response
            return
        except errors.APIError as exc:
            fallback = self.fallback_model
            if sent_any or not fallback or fallback == llm_request.model:
                raise
            if exc.code not in FALLBACK_CODES:
                raise
            log.warning("%s failed (%s), retrying with %s", llm_request.model, exc.code, fallback)
        llm_request.model = fallback
        async for response in super().generate_content_async(llm_request, stream):
            yield response


def build_model(model: str, fallback_model: str | None) -> FallbackGemini:
    return FallbackGemini(model=model, fallback_model=fallback_model or None, retry_options=RETRY)
