# syntax=docker/dockerfile:1
# Image for the Cloud Run service (`nido serve`): the API behind Firebase Hosting's /api/**
# rewrite. The web app is built and deployed to Firebase Hosting separately (deploy.yml).

FROM python:3.13-slim

# uv from its official image (pinned): the same resolver that produced uv.lock.
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /uvx /bin/

# Bytecode at build time (the non-root user cannot write __pycache__, and Cloud Run cold-starts
# at zero instances); copy from the cache mount; never download a Python.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Dependencies first, in their own layer: rebuilt only when the lockfile changes.
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY README.md LICENSE ./
COPY src/ src/
COPY agents/ agents/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Unprivileged runtime user with a writable home (google-auth/ADK may cache small files there).
RUN groupadd --gid 10001 nido \
    && useradd --uid 10001 --gid nido --create-home --home-dir /home/nido \
       --shell /usr/sbin/nologin nido

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:${PATH}"

USER nido

# Cloud Run sets PORT; `nido serve` reads it.
CMD ["nido", "serve", "--host", "0.0.0.0"]
