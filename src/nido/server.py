"""HTTP API for the web app (`nido serve`, the Cloud Run service).

    GET    /api/config                            services, categories, what is enabled
    GET    /api/profile    PUT /api/profile       the family profile
    GET    /api/daily                             today's picks: Find's opening cards, cached a day
    POST   /api/search                            filter panel: deterministic, no model call
    POST   /api/chat                              one turn with the ADK agent
    POST   /api/chat/feedback                     👍/👎 (and a comment) on one answer
    GET    /api/me                                what the caller may see (the Quality page)
    GET    /api/quality                           Nido's owners: the last days' questions
    GET    /api/watchlist                         saved titles
    PUT    /api/watchlist/{media_type}/{tmdb_id}  save or update one
    DELETE /api/watchlist/{media_type}/{tmdb_id}
    GET    /api/titles                            the family's marks: seen, liked, rewatch, banned
    GET    /api/titles/{media_type}/{tmdb_id}     a saved or marked title's full card
    PUT    /api/titles/{media_type}/{tmdb_id}     change some marks on one title
    GET    /api/family                            members of the caller's family
    POST   /api/family/invites                    a new single-use invite link token
    DELETE /api/family/members/{uid}              the owner removes someone, or a member leaves
    POST   /api/invites/{token}                   join the family that made the invite

Every account works on its family's data, never its own: the profile, watchlist and marks belong
to the family. Any verified Google account starts its own family on first sign-in (family id = its
uid, so data saved before families existed stays put), and an invite link moves it into another.

Search and chat count against daily quotas per family (NIDO_MAX_SEARCHES_PER_DAY,
NIDO_MAX_CHAT_TURNS_PER_DAY), kept in the store so restarts do not reset them; past the quota they
answer 429, and below it they report `quota` ({used, limit}). A family whose owner is on
NIDO_ALLOWED_EMAILS has no limit (limit null) and still sees what it used.

Today's picks (/api/daily) are one movie search and one series search with the profile's
defaults, built at most every 12 hours per family; every load in between reads the store's cache.
Time renews them, and so does a change in the children's ages (picks made for an older child must
not wait); other profile edits wait for the next build, so the picks change at a natural pace. As
they are built that rarely, they are free: they count against neither the search quota nor the
usage the family sees. Marks never rebuild them: banned and seen titles are dropped when the picks
are served, and each build picks a different handful of the shortlist.

Every chat turn is kept 30 days in the quality log (nido.asklog): the question, who it was for
without names, the tool calls, the reply and its cards, time and models, and what the family did
next (👍/👎, saves and marks on those cards, another question). Only Nido's owners
(NIDO_ALLOWED_EMAILS) read it, on the Quality page.

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

import asyncio
import logging
import random
import re
import secrets
import unicodedata
from collections import OrderedDict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, HttpUrl

from nido.agent.app import APP_NAME, build_app
from nido.agent.budget import LlmBudgetExceededError
from nido.agent.tools import GUARD_STATE_KEY, HIDDEN_STATE_KEY, LOCALE_STATE_KEY, Toolbox
from nido.asklog import (
    FOLLOW_UP_WINDOW,
    MAX_COMMENT_CHARS,
    TurnRecorder,
    card_keys,
    family_tag,
    new_log_id,
    summarize,
)
from nido.asklog import present as present_log
from nido.auth import Authenticator, AuthError, FirebaseVerifier, User
from nido.catalog import SERVICES, SERVICES_BY_KEY
from nido.config import Settings, llm_credentials_available
from nido.i18n import LANGUAGE_NAMES, localize_output, message, request_locale
from nido.models import (
    ADULT_AGE,
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
# Firebase Hosting gives up on a Cloud Run request after 60 s; a chat turn stops before that.
CHAT_TURN_SECONDS = 50.0


# Today's picks: how many cards, how many years back they reach, and how long a build is kept.
DAILY_SIZE = 12
DAILY_YEARS = 5
DAILY_TTL = timedelta(hours=12)
DAILY_KINDS = (MediaType.MOVIE, MediaType.TV)

INVITE_TTL = timedelta(days=7)
MAX_FAMILY_MEMBERS = 8
MAX_CHILDREN = 10
MAX_NICKNAME_CHARS = 24


class SearchRequest(BaseModel):
    media_type: MediaType = MediaType.MOVIE
    genres: list[str] = Field(default_factory=list)
    # Genres to leave out: a title with any of them is dropped, e.g. Animation but not Comedy.
    exclude_genres: list[str] = Field(default_factory=list, max_length=20)
    # True: a title needs every genre in `genres` (Comedy and Romance), not just one of them.
    match_all_genres: bool = False
    max_runtime_min: int | None = Field(default=None, ge=1, le=600)
    # Shortest runtime, the lower end of Find's length range; no profile default.
    min_runtime_min: int | None = Field(default=None, ge=1, le=600)
    min_imdb_rating: float | None = Field(default=None, ge=0, le=10)
    avoid: list[GuidanceCategory] | None = None
    regions: list[str] | None = None
    # Earliest release year (series: latest episode); the Find page sends five years back.
    released_since: int | None = Field(default=None, ge=1900, le=2100)
    # Who is watching: positions in the profile's children; left out or empty = the whole family.
    watching: list[int] | None = Field(default=None, max_length=MAX_CHILDREN)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    session_id: str | None = Field(default=None, max_length=128)
    watching: list[int] | None = Field(default=None, max_length=MAX_CHILDREN)


class ChatFeedback(BaseModel):
    log_id: str = Field(min_length=1, max_length=64)
    # None takes the rating back.
    rating: Literal["up", "down"] | None
    comment: str | None = Field(default=None, max_length=2000)


# Questions the Quality page lists at once, newest first.
MAX_QUALITY_ITEMS = 300


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


# Where an age range starts: 0-6, 7-9, 10-12, 13-15, 16-17. At 18 a child counts as an adult, so
# an age ban lifts at 17 at the latest; for a 17-year-old only a ban at every age makes sense.
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
    if len(profile.children_ages) > MAX_CHILDREN:
        raise HTTPException(422, f"a family profile has at most {MAX_CHILDREN} children")
    if any(a < 0 or a > ADULT_AGE for a in profile.children_ages):
        raise HTTPException(422, f"children's ages must be between 0 and {ADULT_AGE} (adult)")
    names = [" ".join(n.split())[:MAX_NICKNAME_CHARS] for n in profile.children_names]
    names = (names + [""] * len(profile.children_ages))[: len(profile.children_ages)]
    return profile.model_copy(
        update={
            "children_names": names if any(names) else [],
            "regions": regions,
            "services": [s for s in dict.fromkeys(profile.services) if s in SERVICES_BY_KEY],
        }
    )


def _age_text(age: int) -> str:
    return f"{ADULT_AGE}+ (adult)" if age >= ADULT_AGE else str(age)


def watching_ages(profile: FamilyProfile, watching: list[int] | None) -> list[int]:
    try:
        return profile.watching(watching)
    except IndexError as exc:
        raise HTTPException(422, "watching names a child the profile does not have") from exc


def describe_family(profile: FamilyProfile | None, watching: list[int] | None = None) -> str:
    """What the agent may know about the family: ages and preferences, nothing identifying (the
    children's nicknames stay out)."""
    if profile is None:
        return ""
    services = ", ".join(SERVICES_BY_KEY[s].name for s in profile.services if s in SERVICES_BY_KEY)
    ages = sorted(profile.children_ages)
    lines = [f"- Children's ages: {', '.join(_age_text(a) for a in ages)}"]
    viewers = sorted(profile.watching(watching))
    if viewers != ages:
        lines.append(
            f"- Watching this time: only the {'children' if len(viewers) > 1 else 'child'} aged "
            f"{', '.join(_age_text(a) for a in viewers)}; search for these ages"
        )
    lines += [
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


def daily_key(family: str, profile: FamilyProfile, locale: str = "en") -> str:
    """Cache key of a family's picks. Other profile edits wait for the next build, but the
    children's ages are in it: picks made for an older child must not wait 12 hours. So is the
    page's language, since the picks carry titles and synopses in it."""
    ages = "-".join(str(a) for a in sorted(profile.children_ages))
    return f"daily:{family}:{ages}:{locale}"


def daily_picks(
    built: dict[str, list[dict[str, Any]]],
    *,
    family: str,
    built_at: datetime,
    skip: set[str],
    size: int = DAILY_SIZE,
) -> list[dict[str, Any]]:
    """Today's handful from each type's shortlist, movies and series taking turns.

    `built` holds each type's ranked shortlist. Titles in `skip` (banned or already seen) are
    left out, so a mark shows on the next load without a rebuild. The same family and build always
    pick the same titles; another build picks another handful, kept in ranking order and leaning
    to the top of the shortlist."""
    rng = random.Random(f"{family}:{built_at.isoformat()}")
    lists = []
    for kind in DAILY_KINDS:
        pool = [r for r in built.get(kind.value) or [] if _key(r) not in skip]
        chosen = sorted(rng.sample(range(len(pool)), min(len(pool), size)))
        lists.append([pool[i] for i in chosen])
    # Half of each, the rest filled from whichever type has more.
    share = [min(len(lst), size // len(lists)) for lst in lists]
    spare = size - sum(share)
    for i, lst in enumerate(lists):
        extra = min(spare, len(lst) - share[i])
        share[i] += extra
        spare -= extra
    taken = [lst[:n] for lst, n in zip(lists, share, strict=True)]
    longest = max((len(t) for t in taken), default=0)
    return [t[i] for i in range(longest) for t in taken if i < len(t)]


def _final_text(event: Any) -> str:
    if not event.is_final_response() or not event.content or not event.content.parts:
        return ""
    return "".join(p.text or "" for p in event.content.parts if not getattr(p, "thought", False))


def family_guard(
    profile: FamilyProfile | None, watching: list[int] | None = None
) -> dict[str, Any]:
    """The saved profile's limits the tools enforce whatever the chat says (agent.tools). With
    some children picked as watching, only their ages count: the chat can narrow, not widen."""
    if profile is None:
        return {}
    return {
        "children_ages": profile.watching(watching),
        "avoid": [c.value for c in profile.avoid_categories],
    }


def log_viewers(profile: FamilyProfile | None, watching: list[int] | None) -> dict[str, Any]:
    """Who a question was for, as the quality log keeps it: nothing that names anyone."""
    if profile is None:
        return {}
    return {
        "ages": sorted(profile.watching(watching)),
        "family_ages": sorted(profile.children_ages),
        "avoid": [c.value for c in profile.avoid_categories],
        "services": list(profile.services),
        "regions": list(profile.regions),
        "genres": list(profile.preferred_genres),
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
    # Per chat session: every title the tools returned, by key, so later answers get cards.
    session_titles: OrderedDict[tuple[str, str], dict[str, dict[str, Any]]] = OrderedDict()
    # Per family tag: its last answer (log id, time, card keys), so saves and marks on those cards
    # and the next question are noted as reactions to it. In memory: a cold start only loses that.
    recent_asks: OrderedDict[str, dict[str, Any]] = OrderedDict()

    app = FastAPI(title="Nido", docs_url=None, redoc_url=None)

    @app.exception_handler(AuthError)
    async def _auth_error(_: Request, exc: AuthError) -> JSONResponse:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status)

    async def current_user(authorization: Annotated[str | None, Header()] = None) -> User:
        return await authenticator(authorization)

    CurrentUser = Annotated[User, Depends(current_user)]

    async def page_locale(x_nido_locale: Annotated[str | None, Header()] = None) -> str:
        """The web app's page language (es, en or pt); English for any other client."""
        return request_locale(x_nido_locale)

    PageLocale = Annotated[str, Depends(page_locale)]

    async def current_member(user: CurrentUser) -> Member:
        member = await store.get_member(user.uid)
        if member is None:
            # Anyone signed in starts a family of their own; the daily quotas bound what it costs.
            member = Member(
                uid=user.uid,
                family_id=user.uid,
                email=user.email,
                role=FamilyRole.OWNER,
                joined_at=datetime.now(UTC),
            )
            await store.put_member(member)
        return member

    CurrentMember = Annotated[Member, Depends(current_member)]

    async def current_family(member: CurrentMember) -> str:
        return member.family_id

    Family = Annotated[str, Depends(current_family)]

    async def find(
        profile: FamilyProfile, request: SearchRequest, marks: list[TitleMark], locale: str
    ) -> dict[str, Any]:
        try:
            return await toolbox.search(
                media_type=request.media_type.value,
                children_ages=watching_ages(profile, request.watching),
                services=profile.services,
                genres=request.genres,
                exclude_genres=request.exclude_genres,
                match_all_genres=request.match_all_genres,
                prefer_genres=profile.preferred_genres,
                # The profile's limits are defaults: a field the request sends, even null for
                # "any", wins; one it leaves out falls back to the profile.
                max_runtime_min=(
                    request.max_runtime_min
                    if "max_runtime_min" in request.model_fields_set
                    else profile.max_runtime_min
                ),
                min_runtime_min=request.min_runtime_min,
                min_imdb_rating=(
                    request.min_imdb_rating
                    if "min_imdb_rating" in request.model_fields_set
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
                locale=locale,
            )
        except RuntimeError as exc:  # missing TMDB token
            raise HTTPException(503, str(exc)) from exc
        except httpx.HTTPError as exc:
            log.warning("search failed: %s", exc)
            raise HTTPException(502, message("source_down", locale)) from exc

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {"ok": True}

    @app.get("/api/config")
    async def config(locale: PageLocale) -> dict[str, Any]:
        return {
            "services": [{"key": s.key, "name": s.name} for s in SERVICES],
            "categories": [c.value for c in GuidanceCategory if c is not GuidanceCategory.OTHER],
            "default_regions": list(settings.regions),
            "chat_enabled": runner is not None,
            "auth": authenticator.mode,
            "attribution": message("attribution", locale),
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

    async def take_quota(family: str, kind: str, locale: str) -> dict[str, int | None]:
        """Counts one request against the family's daily quota: {used today, limit or None}."""
        # The family id is its owner's uid; owners on NIDO_ALLOWED_EMAILS have no limit.
        owner = await store.get_member(family)
        unlimited = bool(owner and owner.email and owner.email.lower() in settings.allowed_emails)
        limit = None if unlimited else limits[kind]
        used = await store.take_quota(family, kind, datetime.now(UTC).date(), limit)
        if used is None:
            raise HTTPException(429, message(f"over_limit_{kind}", locale, limit=limit))
        return {"used": used, "limit": limit}

    async def require_profile(family: str) -> FamilyProfile:
        profile = await store.get_profile(family)
        if profile is None:
            raise HTTPException(409, "set up the family profile first")
        return profile

    @app.get("/api/daily")
    async def daily(family: Family, locale: PageLocale) -> dict[str, Any]:
        """Today's picks for the whole family, built at most every 12 hours and free."""
        profile = await require_profile(family)
        today = datetime.now(UTC).date()
        key = daily_key(family, profile, locale)
        marks = await store.list_marks(family)
        hidden = hidden_keys(marks, profile)
        hit = await store.cache_get(key, DAILY_TTL)
        if hit is not None:
            built, built_at = hit.data, hit.retrieved_at
        else:
            found = await asyncio.gather(
                *(
                    find(
                        profile,
                        SearchRequest(media_type=kind, released_since=today.year - DAILY_YEARS),
                        marks,
                        locale,
                    )
                    for kind in DAILY_KINDS
                )
            )
            built = {
                "regions": found[0].get("regions") or profile.regions,
                "attribution": found[0].get("attribution"),
                **{
                    kind.value: output.get("results") or []
                    for kind, output in zip(DAILY_KINDS, found, strict=True)
                },
            }
            built_at = await store.cache_put(key, built, DAILY_TTL)
        seen = {m.title.key for m in marks if m.seen}
        picks = daily_picks(built, family=family, built_at=built_at, skip={*hidden, *seen})
        output = with_marks(
            {
                "regions": built.get("regions") or profile.regions,
                "results": picks,
                "near_misses": [],
                "attribution": built.get("attribution") or "",
            },
            marks,
            profile,
        )
        return {
            **(localize_output(output, locale) or {}),
            "day": today.isoformat(),
        }

    @app.post("/api/search")
    async def search(request: SearchRequest, family: Family, locale: PageLocale) -> dict[str, Any]:
        profile = await require_profile(family)
        watching_ages(profile, request.watching)  # 422 before it counts against the quota
        quota = await take_quota(family, "search", locale)
        marks = await store.list_marks(family)
        found = with_marks(await find(profile, request, marks, locale), marks, profile) or {}
        return {**(localize_output(found, locale) or {}), "quota": quota}

    @app.post("/api/chat")
    async def chat(
        request: ChatRequest, user: CurrentUser, family: Family, locale: PageLocale
    ) -> dict[str, Any]:
        if runner is None:
            raise HTTPException(503, "chat is off: no model credentials on the server")
        profile = await store.get_profile(family)
        if profile is not None:
            watching_ages(profile, request.watching)  # 422 before it counts against the quota
        quota = await take_quota(family, "chat", locale)
        from google.genai import types

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
        recorder = TurnRecorder()
        log_id = new_log_id()
        previous = recent_asks.get(family_tag(family))
        if previous and datetime.now(UTC) - previous["at"] > FOLLOW_UP_WINDOW:
            previous = None
        outcome, failure, text, cards = "ok", None, "", None
        try:
            async with asyncio.timeout(CHAT_TURN_SECONDS):
                async for event in runner.run_async(
                    user_id=user.uid,
                    session_id=session.id,
                    new_message=types.Content(
                        role="user", parts=[types.Part(text=request.message)]
                    ),
                    state_delta={
                        "family": describe_family(profile, request.watching),
                        "today": date.today().isoformat(),
                        # The page's language, so the answer follows the language the family picked.
                        "language": LANGUAGE_NAMES[locale],
                        LOCALE_STATE_KEY: locale,
                        HIDDEN_STATE_KEY: hidden,
                        GUARD_STATE_KEY: family_guard(profile, request.watching),
                    },
                ):
                    recorder.event(event)
                    for output in _find_titles_outputs(event):
                        results = output
                        for field in ("results", "near_misses"):
                            known.update({_key(item): item for item in output.get(field) or []})
                    if text := _final_text(event):
                        reply.append(text)
        except LlmBudgetExceededError:
            outcome = "budget"
            note = message("stopped_budget", locale)
        except TimeoutError:
            # Hosting drops the request at 60 s with a bare error page; answer before that, with
            # whatever the turn found so far.
            log.warning("chat turn ran past %s s", CHAT_TURN_SECONDS)
            outcome = "partial"
            failure = f"ran past {CHAT_TURN_SECONDS:g} s"
            if results is None and not reply:
                outcome = "too_slow"
            else:
                note = message("stopped", locale)
        except Exception as exc:  # model quota, network: report, keep the session
            log.warning("chat turn failed: %s", exc)
            outcome, failure = "partial", f"{type(exc).__name__}: {exc}"[:500]
            if results is None and not reply:
                outcome = "busy"
            else:
                note = message("stopped", locale)
        if outcome not in {"too_slow", "busy"}:
            text = safe_links("\n\n".join(reply).strip(), known)
            cards = with_marks(chat_cards(text, results, known), marks, profile)
            if outcome == "ok" and not text and not cards:
                outcome = "no_answer"
        await log_turn(
            recorder.record(
                log_id=log_id,
                family_id=family,
                session_id=session.id,
                previous=previous["id"] if previous else None,
                question=request.message,
                locale=locale,
                viewers=log_viewers(profile, request.watching),
                reply=text,
                cards=cards,
                note=note,
                outcome=outcome,
                error=failure,
            ),
            previous,
        )
        if outcome == "too_slow":
            raise HTTPException(504, message("too_slow", locale))
        if outcome == "busy":
            raise HTTPException(503, message("busy", locale))
        return {
            "session_id": session.id,
            "log_id": log_id,
            "reply": text,
            "results": localize_output(cards, locale),
            "note": note,
            "quota": quota,
        }

    async def log_turn(record: dict[str, Any], previous: dict[str, Any] | None) -> None:
        """Keeps the question for the Quality page; a store problem never fails the answer."""
        family = record["family"]
        recent_asks[family] = {"id": record["id"], "at": record["at"], "keys": card_keys(record)}
        recent_asks.move_to_end(family)
        while len(recent_asks) > MAX_REMEMBERED_SESSIONS:
            recent_asks.popitem(last=False)
        try:
            await store.put_ask_log(record)
            if previous:
                await store.update_ask_log(
                    previous["id"], {}, {"kind": "asked_again", "at": record["at"]}
                )
        except Exception as exc:
            log.warning("could not keep the ask log: %s", exc)

    async def follow_up(family: str, key: str, kinds: list[str]) -> None:
        """A save or a mark on a card of the family's last answer counts as its reaction."""
        last = recent_asks.get(family_tag(family))
        now = datetime.now(UTC)
        if not kinds or not last or key not in last["keys"] or now - last["at"] > FOLLOW_UP_WINDOW:
            return
        try:
            for kind in kinds:
                await store.update_ask_log(last["id"], {}, {"kind": kind, "key": key, "at": now})
        except Exception as exc:
            log.warning("could not note the follow-up: %s", exc)

    def can_review(user: User) -> bool:
        # Nido's owners (NIDO_ALLOWED_EMAILS); anyone on a local run without sign-in.
        if authenticator.mode == "none":
            return True
        return bool(user.email and user.email.lower() in settings.allowed_emails)

    @app.post("/api/chat/feedback")
    async def chat_feedback(feedback: ChatFeedback, family: Family) -> dict[str, Any]:
        record = await store.get_ask_log(feedback.log_id)
        if record is None or record.get("family") != family_tag(family):
            raise HTTPException(404, "no such answer")
        comment = " ".join((feedback.comment or "").split())[:MAX_COMMENT_CHARS] or None
        await store.update_ask_log(
            feedback.log_id,
            {"rating": feedback.rating, "comment": comment if feedback.rating else None},
        )
        return {"rating": feedback.rating, "comment": comment if feedback.rating else None}

    @app.get("/api/me")
    async def me(user: CurrentUser) -> dict[str, Any]:
        return {"can_review": can_review(user)}

    @app.get("/api/quality")
    async def quality(
        user: CurrentUser,
        family: Family,
        days: Annotated[int, Query(ge=1, le=30)] = 7,
    ) -> dict[str, Any]:
        if not can_review(user):
            raise HTTPException(403, "only Nido's owners see the quality log")
        since = datetime.now(UTC) - timedelta(days=days)
        records = await store.list_ask_logs(since, MAX_QUALITY_ITEMS)
        return {
            "days": days,
            "summary": summarize(records, settings.fallback_model),
            "items": [present_log(r, family) for r in records],
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
        await follow_up(
            family,
            ref.key,
            [k for k, now in (("saved", existing is None), ("watched", update.watched)) if now],
        )
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

    @app.get("/api/titles/{media_type}/{tmdb_id}")
    async def title_details(
        media_type: MediaType, tmdb_id: int, family: Family, locale: PageLocale
    ) -> dict[str, Any]:
        # Opening a title the family saved is not a search: TMDB and OMDb answers are cached,
        # so it does not count against the daily quota. Only saved or marked titles open, so
        # the route cannot be used to look up any title without spending searches.
        profile = await require_profile(family)
        marks = await store.list_marks(family)
        key = TitleRef(media_type=media_type, tmdb_id=tmdb_id).key
        known = {m.title.key for m in marks} | {
            i.title.key for i in await store.list_watchlist(family)
        }
        if key not in known:
            raise HTTPException(404, "only saved or marked titles open here")
        try:
            result = await toolbox.details(media_type.value, tmdb_id, profile, locale)
        except RuntimeError as exc:  # missing TMDB token
            raise HTTPException(503, str(exc)) from exc
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise HTTPException(404, "title not found") from exc
            log.warning("title details failed: %s", exc)
            raise HTTPException(502, message("source_down", locale)) from exc
        except httpx.HTTPError as exc:
            log.warning("title details failed: %s", exc)
            raise HTTPException(502, message("source_down", locale)) from exc
        output = localize_output(with_marks({"results": [result]}, marks, profile), locale) or {}
        return {"result": output["results"][0]}

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
        await follow_up(
            family,
            ref.key,
            [f for f in ("seen", "liked_adults", "liked_child", "rewatch") if changes.get(f)]
            + (["dont_suggest"] if changes.get("ban") else []),
        )
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
    async def accept_invite(token: str, user: CurrentUser, locale: PageLocale) -> dict[str, Any]:
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
            raise HTTPException(409, message("leave_first", locale))
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
