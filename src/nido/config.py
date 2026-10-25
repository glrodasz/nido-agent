"""Runtime settings, read from environment variables (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    return int(value) if value else default


def _env_regions(name: str, default: tuple[str, ...] = ("SE",)) -> tuple[str, ...]:
    """ "SE,NO" -> ("SE", "NO"); unset, empty or only separators keeps the default."""
    regions = tuple(r.strip().upper() for r in os.getenv(name, "").split(",") if r.strip())
    return regions or default


@dataclass(frozen=True)
class Settings:
    # Data sources. TMDB takes the v4 "API Read Access Token" (a bearer token), not the v3 key.
    tmdb_token: str | None = field(default_factory=lambda: os.getenv("TMDB_API_TOKEN"))
    omdb_key: str | None = field(default_factory=lambda: os.getenv("OMDB_API_KEY"))

    # Family defaults until profiles live in Firestore.
    # Default catalog regions (comma-separated ISO codes) when a request names none.
    regions: tuple[str, ...] = field(default_factory=lambda: _env_regions("NIDO_REGIONS"))
    language: str = field(default_factory=lambda: os.getenv("NIDO_LANGUAGE", "en-US"))

    # LLM. GOOGLE_API_KEY (AI Studio, free tier) or GOOGLE_GENAI_USE_VERTEXAI=1 is read by ADK.
    model: str = field(default_factory=lambda: os.getenv("NIDO_MODEL", "gemini-3.1-flash-lite"))
    # Model requests allowed per conversation turn, enforced in before_model_callback so the cap
    # also holds under `adk web`. <= 0 disables the model.
    max_llm_calls: int = field(default_factory=lambda: _env_int("NIDO_MAX_LLM_CALLS", 8))

    http_timeout_s: float = 20.0


def llm_credentials_available() -> bool:
    return bool(os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_GENAI_USE_VERTEXAI"))
