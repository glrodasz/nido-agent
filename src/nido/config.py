"""Runtime settings, read from environment variables (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    return int(value) if value else default


def _env_list(name: str) -> tuple[str, ...]:
    return tuple(v.strip() for v in os.getenv(name, "").split(",") if v.strip())


def _env_regions(name: str, default: tuple[str, ...] = ("SE",)) -> tuple[str, ...]:
    """ "SE,NO" -> ("SE", "NO"); unset, empty or only separators keeps the default."""
    regions = tuple(r.strip().upper() for r in os.getenv(name, "").split(",") if r.strip())
    return regions or default


@dataclass(frozen=True)
class Settings:
    # Data sources. TMDB takes the v4 "API Read Access Token" (a bearer token), not the v3 key.
    tmdb_token: str | None = field(default_factory=lambda: os.getenv("TMDB_API_TOKEN"))
    omdb_key: str | None = field(default_factory=lambda: os.getenv("OMDB_API_KEY"))

    # Default catalog regions (comma-separated ISO codes) when a request names none.
    regions: tuple[str, ...] = field(default_factory=lambda: _env_regions("NIDO_REGIONS"))
    language: str = field(default_factory=lambda: os.getenv("NIDO_LANGUAGE", "en-US"))

    # LLM. GOOGLE_API_KEY (AI Studio, free tier) or GOOGLE_GENAI_USE_VERTEXAI=1 is read by ADK.
    model: str = field(default_factory=lambda: os.getenv("NIDO_MODEL", "gemini-3.1-flash-lite"))
    # Used when the main model stays overloaded (503) or over quota (429) after retries.
    # Empty or "none" disables the fallback ("none" because a repository variable cannot be empty).
    fallback_model: str = field(
        default_factory=lambda: _env_model("NIDO_FALLBACK_MODEL", "gemini-3.5-flash-lite")
    )
    # Model requests allowed per conversation turn, enforced in before_model_callback so the cap
    # also holds under `adk web`. <= 0 disables the model.
    max_llm_calls: int = field(default_factory=lambda: _env_int("NIDO_MAX_LLM_CALLS", 8))

    http_timeout_s: float = 20.0

    # Web service (`nido serve`, Cloud Run).
    # "memory" (local, lost on restart) or "firestore" (Cloud Run).
    store: str = field(default_factory=lambda: os.getenv("NIDO_STORE", "memory"))
    gcp_project: str | None = field(default_factory=lambda: os.getenv("GOOGLE_CLOUD_PROJECT"))
    firestore_database: str = field(
        default_factory=lambda: os.getenv("NIDO_FIRESTORE_DATABASE", "(default)")
    )
    # "firebase" verifies Firebase Auth ID tokens; "none" is for local runs only (one fixed user).
    auth: str = field(default_factory=lambda: os.getenv("NIDO_AUTH", "firebase"))
    firebase_project: str | None = field(
        default_factory=lambda: (
            os.getenv("NIDO_FIREBASE_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT")
        )
    )
    # Verified Google emails whose families have no daily quota (anyone else may sign in and start a
    # family, within the quotas below).
    allowed_emails: tuple[str, ...] = field(
        default_factory=lambda: tuple(e.lower() for e in _env_list("NIDO_ALLOWED_EMAILS"))
    )
    # Daily quotas per family (shared by its members, reset at 00:00 UTC), so the server's API
    # keys last when more families use Nido. Ask Nido turns spend Gemini (each turn is itself
    # capped at max_llm_calls); searches spend TMDB and OMDb.
    max_chat_turns_per_day: int = field(
        default_factory=lambda: _env_int("NIDO_MAX_CHAT_TURNS_PER_DAY", 40)
    )
    max_searches_per_day: int = field(
        default_factory=lambda: _env_int("NIDO_MAX_SEARCHES_PER_DAY", 150)
    )
    # Built web app (web/dist) to serve at "/", for single-origin local runs. Firebase Hosting
    # serves it in production.
    web_dir: str | None = field(default_factory=lambda: os.getenv("NIDO_WEB_DIR"))


def _env_model(name: str, default: str) -> str:
    value = os.getenv(name, default).strip()
    return "" if value.lower() == "none" else value


def llm_credentials_available() -> bool:
    return bool(os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_GENAI_USE_VERTEXAI"))
