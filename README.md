# Nido

**A family entertainment curator: find movies and series that children and adults will both
enjoy, on the streaming services the family already pays for.**

Nido answers three questions in one place:

1. What is worth watching?
2. Is it appropriate for my child's age and sensitivities?
3. Where can we watch it with our existing subscriptions?

Scope today: personal, non-commercial use, region Sweden, English UI. Services: Netflix,
Disney+, HBO Max, Prime Video and Apple TV+.

## Design principles

| Principle | In practice |
|---|---|
| **The LLM proposes, code decides** | Gemini turns a request into search criteria and explains the result. Filtering and ranking are deterministic ([`ranking.py`](src/nido/ranking.py)). |
| **Official ratings first** | Ratings from nine countries (US, GB, DE, NL, FR, SE, NO, DK, FI) are homologated onto one age scale and the median is the baseline ([`catalog.py`](src/nido/catalog.py)). Originals are always shown, and the baseline is kept apart from any AI assessment. Fitting it never means "appropriate for your child". |
| **Every claim has a source** | Ratings, classifications, offers and guidance carry their source and retrieval date ([`models.py`](src/nido/models.py)). Missing data is shown as missing, never guessed. |
| **Evidence and AI stay apart** | Guidance observations (official, editorial, user, AI inference) are append-only; AI summaries cite them and can be regenerated. |
| **Free tier** | One ADK agent, Gemini Flash-Lite, per-turn model call cap, cached API responses. |

## Stack

Python 3.12+, [Google ADK](https://google.github.io/adk-docs/), Gemini (AI Studio free tier),
uv, ruff, pytest. Planned: Cloud Run behind Firebase Hosting, Firebase Auth, Firestore, Astro +
Preact web app.

Data: [TMDB](https://www.themoviedb.org/) (metadata, certifications) with streaming availability
from [JustWatch](https://www.justwatch.com/) via TMDB, and IMDb ratings via
[OMDb](https://www.omdbapi.com/). This product uses the TMDB API but is not endorsed or certified
by TMDB.

## Quickstart

```bash
uv sync
cp .env.example .env          # add TMDB_API_TOKEN, OMDB_API_KEY, GOOGLE_API_KEY
uv run nido coverage          # phase 0: data coverage per service in Sweden
uv run adk web agents         # chat with the agent at http://localhost:8000
uv run pytest -q
```

## Layout

| Path | What |
|---|---|
| `src/nido/models.py` | Data model with provenance |
| `src/nido/catalog.py` | Supported services, Swedish classifications |
| `src/nido/sources/` | TMDB and OMDb clients |
| `src/nido/ranking.py` | Deterministic filter and ranking |
| `src/nido/agent/` | ADK agent, tools, model call budget |
| `src/nido/coverage.py` | Phase 0 coverage report |
| `agents/nido_agent/` | Shim for `adk web` / `adk run` |

## Roadmap

1. **Phase 0, data check.** Run `nido coverage`: Swedish versus reference-country rating coverage.
2. **Phase 1, MVP.** Family profile, Firestore cache, direct watch links, web app, Cloud Run
   deploy with billing cap.
3. **Phase 2, guidance.** Per-category summaries from Common Sense Media, cited and labeled AI.
4. **Phase 3, choosing together.** Watchlist, compare, feedback-driven ranking.

## License

Apache-2.0
