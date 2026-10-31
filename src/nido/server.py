"""HTTP API for the web app (`nido serve`, the Cloud Run service).

    GET    /api/config                            services, categories, what is enabled
    GET    /api/profile    PUT /api/profile       the family profile
    POST   /api/search                            filter panel: deterministic, no model call
    POST   /api/chat                              one turn with the ADK agent
    GET    /api/watchlist                         saved titles
    PUT    /api/watchlist/{media_type}/{tmdb_id}  save or update one
    DELETE /api/watchlist/{media_type}/{tmdb_id}
    GET    /api/titles                            the family's marks: seen, liked, rewatch, banned
    PUT    /api/titles/{media_type}/{tmdb_id}     change some marks on one title
    GET    /api/family                            members of the caller's family
    POST   /api/family/invites                    a new single-use invite link token
    DELETE /api/family/members/{uid}              the owner removes someone, or a member leaves
    POST   /api/invites/{token}                   join the family that made the invite

Every account works on its family's data, never its own: the profile, watchlist and marks belong
to the family. A verified email on NIDO_ALLOWED_EMAILS starts its own family on first sign-in
(family id = its uid, so data saved before families existed stays put); any other Google account
gets in only through an invite link.

Search and chat count against daily quotas per family (NIDO_MAX_SEARCHES_PER_DAY,
NIDO_MAX_CHAT_TURNS_PER_DAY), kept in the store so restarts do not reset them; past the quota they
answer 429, and below it they report `quota` ({used, limit}). A family whose owner is on
NIDO_ALLOWED_EMAILS has no limit (limit null) and still sees what it used.

Banned titles are left out of search and chat by code: the server hands their keys to the
toolbox (and to chat through session state), so the model can neither see nor undo a ban.

Search and chat return the same result shape (agent.tools._present), so the web app renders the
shortlist from tool output, never from the model's text. Chat orders those cards by the answer:
the titles the reply names come first (see chat_cards). Chat sessions live in memory: a cold
start forgets the conversation, not the profile or the watchlist.

The model writes the tool arguments, and a chat message can steer it, so the limits that matter
are code too: the saved profile's children's ages and content to avoid reach the tools through
session state (family_guard), and the chat can narrow a search, never loosen it. Replies lose
every link outside the guidance sources and the tools' own links (safe_links), so neither a
message nor a title's synopsis can make Nido carry a phishing link. Live attacks on the model:
evals/prompt_injection.py.
"""

import logging
import re
import secrets
import unicodedata
from collections import OrderedDict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, HttpUrl

from nido.agent.app import APP_NAME, build_app
from nido.agent.budget import LlmBudgetExceededError
from nido.agent.tools import GUARD_STATE_KEY, HIDDEN_STATE_KEY, Toolbox
from nido.auth import Authenticator, AuthError, FirebaseVerifier, User
from nido.catalog import SERVICES, SERVICES_BY_KEY
from nido.config import Settings, llm_credentials_available
from nido.models import (
    Ban,
    BanScope,
    FamilyProfile,
    FamilyRole,
    GuidanceCategory,
    Invite,
    MediaType,
    Member,
    TitleMark,
    TitleRef,
    WatchlistItem,
)
from nido.ranking import SHORTLIST_SIZE
from nido.store import Store, build_store

log = logging.getLogger(__name__)

MAX_MESSAGE_CHARS = 2000
ATTRIBUTION = (
    "Metadata: TMDB (this product uses the TMDB API but is not endorsed or certified by TMDB). "
    "Streaming availability: JustWatch via TMDB. IMDb ratings via OMDb."
)


INVITE_TTL = timedelta(days=7)
MAX_FAMILY_MEMBERS = 8


class SearchRequest(BaseModel):
    media_type: MediaType = MediaType.MOVIE
    genres: list[str] = Field(default_factory=list)
    max_runtime_min: int | None = Field(default=None, ge=1, le=600)
    min_imdb_rating: float | None = Field(default=None, ge=0, le=10)
    avoid: list[GuidanceCategory] | None = None
    regions: list[str] | None = None
    # Earliest release year (series: latest episode); the Find page sends five years back.
    released_since: int | None = Field(default=None, ge=1900, le=2100)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    session_id: str | None = Field(default=None, max_length=128)


class WatchlistUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    year: int | None = None
    poster_url: HttpUrl | None = None
    watched: bool = False


class BanRequest(BaseModel):
    scope: BanScope
    # For scope "age": the youngest child's age at which the ban lifts. Left out, it is the
    # title's age baseline when that is above the youngest, else the start of the next age range.
    until_age: int | None = Field(default=None, ge=1, le=17)
    baseline_age: int | None = Field(default=None, ge=0, le=18)


class MarkUpdate(BaseModel):
    """Only the fields sent change; `"ban": null` lifts a ban."""

    name: str = Field(min_length=1, max_length=300)
    year: int | None = None
    poster_url: HttpUrl | None = None
    seen: bool | None = None
    liked_adults: bool | None = None
    liked_child: bool | None = None
    rewatch: bool | None = None
    ban: BanRequest | None = None


# Where an age range starts: 0-6, 7-9, 10-12, 13-15, 16-17. Profiles stop at 17, so an age ban
# lifts at 17 at the latest; for a 17-year-old only a ban at every age makes sense.
AGE_RANGE_STARTS = (7, 10, 13, 16)
MAX_CHILD_AGE = 17


def default_ban_until(youngest: int, baseline_age: int | None) -> int:
    if baseline_age is not None and baseline_age > youngest:
        return min(baseline_age, MAX_CHILD_AGE)
    return next((a for a in AGE_RANGE_STARTS if a > youngest), MAX_CHILD_AGE)


def present_mark(mark: TitleMark, profile: FamilyProfile | None) -> dict[str, Any]:
    youngest = profile.youngest if profile else 0
    return {
        **mark.model_dump(mode="json"),
        "key": mark.title.key,
        "ban_active": bool(mark.ban and mark.ban.active(youngest)),
    }


def hidden_keys(marks: list[TitleMark], profile: FamilyProfile) -> list[str]:
    return [m.title.key for m in marks if m.ban and m.ban.active(profile.youngest)]


def with_marks(
    output: dict[str, Any] | None, marks: list[TitleMark], profile: FamilyProfile | None
) -> dict[str, Any] | None:
    """Search output with each title's marks attached, so cards show them without a lookup."""
    if not output:
        return output
    by_key = {m.title.key: m for m in marks}

    def mark_of(item: dict[str, Any]) -> dict[str, Any] | None:
        key = f"{item.get('media_type')}:{item.get('tmdb_id')}"
        return present_mark(by_key[key], profile) if key in by_key else None

    return {
        **output,
        **{
            field: [{**item, "mark": mark_of(item)} for item in output.get(field) or []]
            for field in ("results", "near_misses")
            if field in output
        },
    }


def normalize_profile(profile: FamilyProfile) -> FamilyProfile:
    regions = list(dict.fromkeys(r.strip().upper() for r in profile.regions if r.strip()))
    if not regions or any(len(r) != 2 or not r.isalpha() for r in regions):
        raise HTTPException(422, "regions must be two-letter country codes, e.g. SE")
    if any(a < 0 or a > MAX_CHILD_AGE for a in profile.children_ages):
        raise HTTPException(422, "children's ages must be between 0 and 17")
    return profile.model_copy(
        update={
            "regions": regions,
            "services": [s for s in dict.fromkeys(profile.services) if s in SERVICES_BY_KEY],
        }
    )


def describe_family(profile: FamilyProfile | None) -> str:
    """What the agent may know about the family: ages and preferences, nothing identifying."""
    if profile is None:
        return ""
    services = ", ".join(SERVICES_BY_KEY[s].name for s in profile.services if s in SERVICES_BY_KEY)
    lines = [
        f"- Children's ages: {', '.join(str(a) for a in sorted(profile.children_ages))}",
        f"- Subscribed services (keys for find_titles): {', '.join(profile.services) or 'none'}"
        + (f" ({services})" if services else ""),
        f"- Catalog regions: {', '.join(profile.regions)}",
    ]
    if profile.preferred_genres:
        lines.append(f"- Preferred genres: {', '.join(profile.preferred_genres)}")
    if profile.avoid_categories:
        lines.append(f"- Content to avoid: {', '.join(profile.avoid_categories)}")
    if profile.max_runtime_min:
        lines.append(f"- Longest runtime: {profile.max_runtime_min} min")
    if profile.min_imdb_rating is not None:
        lines.append(f"- Lowest IMDb score: {profile.min_imdb_rating}")
    return "\n".join(lines)


# Tools whose output the web app shows as title cards.
TITLE_TOOLS = ("find_titles", "look_up_title")


def _find_titles_outputs(event: Any) -> list[dict[str, Any]]:
    out = []
    for response in event.get_function_responses() or []:
        if response.name in TITLE_TOOLS and isinstance(response.response, dict):
            out.append(response.response)
    return out


# As many cards as the filters show, so Ask Nido never hides picks the search returned.
MAX_CARDS = SHORTLIST_SIZE
# Chat sessions whose titles are remembered for the cards; the sessions themselves live in memory
# too, so this only has to outlast a conversation.
MAX_REMEMBERED_SESSIONS = 500


def _key(item: dict[str, Any]) -> str:
    return f"{item.get('media_type')}:{item.get('tmdb_id')}"


def _normalized(text: str) -> str:
    """Lowercase words separated by single spaces: "WALL·E" and "Wall-E" both become "wall e"."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(re.findall(r"[^\W_]+", text.lower()))


def titles_named(reply: str, known: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The known titles the reply names, in the order it names them. A name inside a longer one
    it also matched ("Toy Story" in "Toy Story 4") does not count on its own."""
    text = f" {_normalized(reply)} "
    spans: list[tuple[int, int, dict[str, Any]]] = []
    for item in known:
        name = _normalized(str(item.get("title") or ""))
        if not name:
            continue
        at = text.find(f" {name} ")
        if at >= 0:
            spans.append((at, at + len(name) + 2, item))
    spans.sort(key=lambda s: (s[0], s[0] - s[1]))
    named: list[dict[str, Any]] = []
    for start, end, item in spans:
        inside = any(s <= start and end <= e and (s, e) != (start, end) for s, e, _ in spans)
        if not inside and all(_key(n) != _key(item) for n in named):
            named.append(item)
    return named


def chat_cards(
    reply: str, output: dict[str, Any] | None, known: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    """The shortlist the web app shows after a chat turn, so the cards follow the answer: the
    titles the reply recommends come first, in its order, then the rest of this turn's search.
    `known` holds every title the tools returned in this conversation, so an answer drawn from an
    earlier search still gets its cards. Only tool output becomes a card, never the model's text.
    """
    named = titles_named(reply, list(known.values()))
    if not named:
        return output
    picked = {_key(n) for n in named}
    rest = [r for r in (output or {}).get("results") or [] if _key(r) not in picked]
    base = output or {"regions": [], "attribution": ""}
    # Near misses only show when nothing fits, and a named title that fits replaces them.
    fits = [n for n in named if not n.get("misses")]
    if fits:
        return {**base, "results": (fits + rest)[:MAX_CARDS], "near_misses": []}
    return {**base, "results": rest[:MAX_CARDS], "near_misses": named[:MAX_CARDS]}


def _final_text(event: Any) -> str:
    if not event.is_final_response() or not event.content or not event.content.parts:
        return ""
    return "".join(p.text or "" for p in event.content.parts if not getattr(p, "thought", False))


def family_guard(profile: FamilyProfile | None) -> dict[str, Any]:
    """The saved profile's limits the tools enforce whatever the chat says (agent.tools)."""
    if profile is None:
        return {}
    return {
        "children_ages": list(profile.children_ages),
        "avoid": [c.value for c in profile.avoid_categories],
    }


# Hosts the reply may link to: guidance and metadata sources. Links the tools returned (streaming
# offers, IMDb pages) are allowed too. Anything else is dropped: the chat text and the titles'
# synopses are not ours, so a reply could otherwise carry a phishing link ("verify your Netflix
# account at ...") under Nido's name.
LINK_HOSTS = (
    "commonsensemedia.org",
    "imdb.com",
    "themoviedb.org",
    "justwatch.com",
)
_MD_LINK = re.compile(r"\[([^\]]*)\]\(([^)\s]*)\)")
_URL = re.compile(r"\b(?:https?://|www\.)[^\s<>()\[\]]+", re.IGNORECASE)


def _host(url: str) -> str | None:
    """The host a browser would open, or None for a URL that hides it behind userinfo
    ("https://imdb.com:80@evil.example/") or has none."""
    if not re.match(r"^https?://", url, flags=re.IGNORECASE):
        url = "https://" + url
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if "@" in parts.netloc or not parts.hostname:
        return None
    return parts.hostname.rstrip(".")


def _tool_links(known: dict[str, dict[str, Any]]) -> set[str]:
    links: set[str] = set()
    for item in known.values():
        for offer in item.get("where_to_watch") or []:
            if offer.get("link"):
                links.add(str(offer["link"]))
        if (item.get("imdb") or {}).get("url"):
            links.add(str(item["imdb"]["url"]))
    return links


def safe_links(reply: str, known: dict[str, dict[str, Any]]) -> str:
    """The reply with every link the app cannot vouch for removed (see LINK_HOSTS)."""
    allowed = _tool_links(known)

    def ok(url: str) -> bool:
        url = url.rstrip(".,;:!?")
        host = _host(url)
        if host is None:
            return False
        return url in allowed or any(host == h or host.endswith("." + h) for h in LINK_HOSTS)

    def markdown(m: re.Match[str]) -> str:
        return m.group(0) if ok(m.group(2)) else m.group(1)

    def bare(m: re.Match[str]) -> str:
        return m.group(0) if ok(m.group(0)) else "[link removed]"

    # Markdown links first; bare URLs are then checked outside the links that were kept.
    parts = re.split(r"(\[[^\]]*\]\([^)\s]*\))", _MD_LINK.sub(markdown, reply))
    return "".join(p if _MD_LINK.fullmatch(p) else _URL.sub(bare, p) for p in parts)


def create_app(
    settings: Settings | None = None,
    *,
    store: Store | None = None,
    toolbox: Any | None = None,
    runner: Any | None = None,
    authenticator: Authenticator | None = None,
) -> FastAPI:
    settings = settings or Settings()
    store = store or build_store(
        settings.store, project=settings.gcp_project, database=settings.firestore_database
    )
    toolbox = toolbox or Toolbox(settings, cache=store)
    if authenticator is None:
        verifier = (
            FirebaseVerifier(settings.firebase_project, settings.allowed_emails)
            if settings.auth == "firebase" and settings.firebase_project
            else None
        )
        authenticator = Authenticator(settings.auth, verifier)
    if runner is None and llm_credentials_available() and settings.max_llm_calls > 0:
        from google.adk.runners import Runner
        from google.adk.sessions import InMemorySessionService

        runner = Runner(app=build_app(settings, toolbox), session_service=InMemorySessionService())
    limits = {"chat": settings.max_chat_turns_per_day, "search": settings.max_searches_per_day}
    over_limit = {
        "chat": "Your family has used today's {limit} Ask Nido questions. They come back "
        "tomorrow; the filters still work.",
        "search": "Your family has used today's {limit} searches. They come back tomorrow.",
    }
    # Per chat session: every title the tools returned, by key, so later answers get cards.
    session_titles: OrderedDict[tuple[str, str], dict[str, dict[str, Any]]] = OrderedDict()

    app = FastAPI(title="Nido", docs_url=None, redoc_url=None)

    @app.exception_handler(AuthError)
    async def _auth_error(_: Request, exc: AuthError) -> JSONResponse:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status)

    async def current_user(authorization: Annotated[str | None, Header()] = None) -> User:
        return await authenticator(authorization)

    CurrentUser = Annotated[User, Depends(current_user)]

    async def current_member(user: CurrentUser) -> Member:
        member = await store.get_member(user.uid)
        if member is None and user.allowed:
            member = Member(
                uid=user.uid,
                family_id=user.uid,
                email=user.email,
                role=FamilyRole.OWNER,
                joined_at=datetime.now(UTC),
            )
            await store.put_member(member)
        if member is None:
            raise HTTPException(
                403, "this account is not in a family yet: open an invite link from a member"
            )
        return member

    CurrentMember = Annotated[Member, Depends(current_member)]

    async def current_family(member: CurrentMember) -> str:
        return member.family_id

    Family = Annotated[str, Depends(current_family)]

    async def find(
        profile: FamilyProfile, request: SearchRequest, marks: list[TitleMark]
    ) -> dict[str, Any]:
        try:
            return await toolbox.search(
                media_type=request.media_type.value,
                children_ages=profile.children_ages,
                services=profile.services,
                genres=request.genres,
                prefer_genres=profile.preferred_genres,
                max_runtime_min=request.max_runtime_min or profile.max_runtime_min,
                min_imdb_rating=(
                    request.min_imdb_rating
                    if request.min_imdb_rating is not None
                    else profile.min_imdb_rating
                ),
                avoid=[
                    c.value
                    for c in (
                        request.avoid if request.avoid is not None else profile.avoid_categories
                    )
                ],
                regions=request.regions or profile.regions,
                released_since=request.released_since,
                hidden=hidden_keys(marks, profile),
            )
        except RuntimeError as exc:  # missing TMDB token
            raise HTTPException(503, str(exc)) from exc
        except httpx.HTTPError as exc:
            log.warning("search failed: %s", exc)
            raise HTTPException(502, "a data source did not answer; try again") from exc

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {"ok": True}

    @app.get("/api/config")
    async def config() -> dict[str, Any]:
        return {
            "services": [{"key": s.key, "name": s.name} for s in SERVICES],
            "categories": [c.value for c in GuidanceCategory if c is not GuidanceCategory.OTHER],
            "default_regions": list(settings.regions),
            "chat_enabled": runner is not None,
            "auth": authenticator.mode,
            "attribution": ATTRIBUTION,
        }

    @app.get("/api/profile")
    async def get_profile(family: Family) -> dict[str, Any]:
        profile = await store.get_profile(family)
        return {"profile": profile.model_dump(mode="json") if profile else None}

    @app.put("/api/profile")
    async def put_profile(profile: FamilyProfile, family: Family) -> dict[str, Any]:
        profile = normalize_profile(profile)
        await store.put_profile(family, profile)
        return {"profile": profile.model_dump(mode="json")}

    async def take_quota(family: str, kind: str) -> dict[str, int | None]:
        """Counts one request against the family's daily quota: {used today, limit or None}."""
        # The family id is its owner's uid; owners on NIDO_ALLOWED_EMAILS have no limit.
        owner = await store.get_member(family)
        unlimited = bool(owner and owner.email and owner.email.lower() in settings.allowed_emails)
        limit = None if unlimited else limits[kind]
        used = await store.take_quota(family, kind, datetime.now(UTC).date(), limit)
        if used is None:
            raise HTTPException(429, over_limit[kind].format(limit=limit))
        return {"used": used, "limit": limit}

    async def require_profile(family: str) -> FamilyProfile:
        profile = await store.get_profile(family)
        if profile is None:
            raise HTTPException(409, "set up the family profile first")
        return profile

    @app.post("/api/search")
    async def search(request: SearchRequest, family: Family) -> dict[str, Any]:
        profile = await require_profile(family)
        quota = await take_quota(family, "search")
        marks = await store.list_marks(family)
        found = with_marks(await find(profile, request, marks), marks, profile) or {}
        return {**found, "quota": quota}

    @app.post("/api/chat")
    async def chat(request: ChatRequest, user: CurrentUser, family: Family) -> dict[str, Any]:
        if runner is None:
            raise HTTPException(503, "chat is off: no model credentials on the server")
        quota = await take_quota(family, "chat")
        from google.genai import types

        profile = await store.get_profile(family)
        marks = await store.list_marks(family)
        sessions = runner.session_service
        session = None
        if request.session_id:
            session = await sessions.get_session(
                app_name=APP_NAME, user_id=user.uid, session_id=request.session_id
            )
        if session is None:
            session = await sessions.create_session(app_name=APP_NAME, user_id=user.uid)

        reply: list[str] = []
        results: dict[str, Any] | None = None
        hidden = hidden_keys(marks, profile) if profile else []
        known = session_titles.setdefault((user.uid, session.id), {})
        # A title banned after an earlier search in this chat must not come back as a card.
        for key in hidden:
            known.pop(key, None)
        session_titles.move_to_end((user.uid, session.id))
        while len(session_titles) > MAX_REMEMBERED_SESSIONS:
            session_titles.popitem(last=False)
        note = None
        try:
            async for event in runner.run_async(
                user_id=user.uid,
                session_id=session.id,
                new_message=types.Content(role="user", parts=[types.Part(text=request.message)]),
                state_delta={
                    "family": describe_family(profile),
                    "today": date.today().isoformat(),
                    HIDDEN_STATE_KEY: hidden,
                    GUARD_STATE_KEY: family_guard(profile),
                },
            ):
                for output in _find_titles_outputs(event):
                    results = output
                    for field in ("results", "near_misses"):
                        known.update({_key(item): item for item in output.get(field) or []})
                if text := _final_text(event):
                    reply.append(text)
        except LlmBudgetExceededError:
            note = "Stopped early: this turn reached its model call limit."
        except Exception as exc:  # model quota, network: report, keep the session
            log.warning("chat turn failed: %s", exc)
            if results is None and not reply:
                busy = "The assistant is busy right now. Try again in a minute, or use the filters."
                raise HTTPException(503, busy) from exc
            note = "The assistant stopped before finishing."
        text = safe_links("\n\n".join(reply).strip(), known)
        return {
            "session_id": session.id,
            "reply": text,
            "results": with_marks(chat_cards(text, results, known), marks, profile),
            "note": note,
            "quota": quota,
        }

    @app.get("/api/watchlist")
    async def list_watchlist(family: Family) -> dict[str, Any]:
        items = await store.list_watchlist(family)
        return {"items": [i.model_dump(mode="json") for i in items]}

    @app.put("/api/watchlist/{media_type}/{tmdb_id}")
    async def put_watchlist(
        media_type: MediaType, tmdb_id: int, update: WatchlistUpdate, family: Family
    ) -> dict[str, Any]:
        ref = TitleRef(media_type=media_type, tmdb_id=tmdb_id)
        existing = {i.title.key: i for i in await store.list_watchlist(family)}.get(ref.key)
        item = WatchlistItem(
            title=ref,
            name=update.name,
            year=update.year,
            poster_url=update.poster_url,
            watched=update.watched,
            added_at=existing.added_at if existing else datetime.now(UTC),
        )
        await store.put_watchlist_item(family, item)
        return {"item": item.model_dump(mode="json")}

    @app.delete("/api/watchlist/{media_type}/{tmdb_id}")
    async def delete_watchlist(media_type: MediaType, tmdb_id: int, family: Family) -> dict:
        await store.delete_watchlist_item(
            family, TitleRef(media_type=media_type, tmdb_id=tmdb_id).key
        )
        return {"ok": True}

    @app.get("/api/titles")
    async def list_marks(family: Family) -> dict[str, Any]:
        profile = await store.get_profile(family)
        marks = await store.list_marks(family)
        return {"items": [present_mark(m, profile) for m in marks]}

    @app.put("/api/titles/{media_type}/{tmdb_id}")
    async def put_mark(
        media_type: MediaType, tmdb_id: int, update: MarkUpdate, family: Family
    ) -> dict[str, Any]:
        profile = await store.get_profile(family)
        ref = TitleRef(media_type=media_type, tmdb_id=tmdb_id)
        now = datetime.now(UTC)
        mark = await store.get_mark(family, ref.key) or TitleMark(
            title=ref, name=update.name, updated_at=now
        )
        changes: dict[str, Any] = {
            "name": update.name,
            "year": update.year if update.year is not None else mark.year,
            "poster_url": update.poster_url or mark.poster_url,
            "updated_at": now,
        }
        for flag in ("seen", "liked_adults", "liked_child", "rewatch"):
            if getattr(update, flag) is not None:
                changes[flag] = getattr(update, flag)
        if "ban" in update.model_fields_set:
            request = update.ban
            if request is None:
                changes["ban"] = None
            elif request.scope is BanScope.ALWAYS:
                changes["ban"] = Ban(scope=BanScope.ALWAYS, at=now)
            else:
                if profile is None:
                    raise HTTPException(409, "set up the family profile first")
                until = request.until_age or default_ban_until(
                    profile.youngest, request.baseline_age
                )
                if until <= profile.youngest:
                    raise HTTPException(
                        422,
                        "until_age must be above the youngest child's age (at most 17); "
                        "use scope 'always' instead",
                    )
                changes["ban"] = Ban(scope=BanScope.AGE, until_age=until, at=now)
        mark = mark.model_copy(update=changes)
        if mark.empty:
            await store.delete_mark(family, ref.key)
        else:
            await store.put_mark(family, mark)
        return {"item": present_mark(mark, profile)}

    def present_member(m: Member, me: Member) -> dict[str, Any]:
        return {**m.model_dump(mode="json"), "you": m.uid == me.uid}

    @app.get("/api/family")
    async def get_family(member: CurrentMember) -> dict[str, Any]:
        members = await store.list_members(member.family_id)
        return {
            "role": member.role.value,
            "members": [present_member(m, member) for m in members],
        }

    @app.post("/api/family/invites")
    async def create_invite(member: CurrentMember) -> dict[str, Any]:
        if len(await store.list_members(member.family_id)) >= MAX_FAMILY_MEMBERS:
            raise HTTPException(409, f"a family has at most {MAX_FAMILY_MEMBERS} members")
        now = datetime.now(UTC)
        invite = Invite(
            token=secrets.token_urlsafe(18),
            family_id=member.family_id,
            created_by=member.uid,
            created_at=now,
            expires_at=now + INVITE_TTL,
        )
        await store.put_invite(invite)
        return {"token": invite.token, "expires_at": invite.expires_at.isoformat()}

    @app.post("/api/invites/{token}")
    async def accept_invite(token: str, user: CurrentUser) -> dict[str, Any]:
        gone = HTTPException(410, "this invite link has expired or was already used")
        now = datetime.now(UTC)
        invite = await store.get_invite(token)
        if invite is None:
            raise gone
        current = await store.get_member(user.uid)
        if current and current.family_id == invite.family_id:
            return {"family_id": invite.family_id, "joined": False}
        # A used link never works again, not even for whoever used it and was removed since.
        if invite.expires_at <= now or invite.used_by is not None:
            raise gone
        if current and len(await store.list_members(current.family_id)) > 1:
            # Leaving would strand the others' shared data behind someone who no longer sees it.
            raise HTTPException(409, "leave your current family first (Family tab)")
        if len(await store.list_members(invite.family_id)) >= MAX_FAMILY_MEMBERS:
            raise HTTPException(409, f"that family already has {MAX_FAMILY_MEMBERS} members")
        if await store.claim_invite(token, user.uid, now) is None:
            raise gone
        await store.put_member(
            Member(uid=user.uid, family_id=invite.family_id, email=user.email, joined_at=now)
        )
        return {"family_id": invite.family_id, "joined": True}

    @app.delete("/api/family/members/{uid}")
    async def remove_member(uid: str, member: CurrentMember) -> dict[str, Any]:
        target = await store.get_member(uid)
        if target is None or target.family_id != member.family_id:
            raise HTTPException(404, "no such member in your family")
        if uid == member.uid:
            if member.role is FamilyRole.OWNER:
                raise HTTPException(409, "the owner cannot leave their own family")
        elif member.role is not FamilyRole.OWNER:
            raise HTTPException(403, "only the family's owner can remove members")
        await store.delete_member(uid)
        return {"ok": True}

    if settings.web_dir and Path(settings.web_dir).is_dir():
        app.mount("/", StaticFiles(directory=settings.web_dir, html=True), name="web")

    return app
