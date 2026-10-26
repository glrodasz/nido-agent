"""Data model: identity, availability, classifications, ratings, evidence and AI assessments are
separate records so every claim keeps its provenance and AI summaries can be regenerated when the
evidence under them changes."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field, HttpUrl


class MediaType(StrEnum):
    MOVIE = "movie"
    TV = "tv"


class AccessType(StrEnum):
    SUBSCRIPTION = "subscription"
    ADS = "ads"
    RENT = "rent"
    BUY = "buy"
    ADDON = "addon"


class EvidenceType(StrEnum):
    OFFICIAL = "official"
    EDITORIAL = "editorial"
    USER = "user"
    AI_INFERENCE = "ai_inference"


class GuidanceCategory(StrEnum):
    VIOLENCE = "violence"
    FRIGHTENING = "frightening"
    LANGUAGE = "language"
    SEX_NUDITY = "sex_nudity"
    ROMANCE = "romance"
    SUBSTANCES = "substances"
    BULLYING_DISCRIMINATION = "bullying_discrimination"
    DEATH_GRIEF = "death_grief"
    IMITABLE_BEHAVIOR = "imitable_behavior"
    OTHER = "other"


class Frequency(StrEnum):
    BRIEF = "brief"
    RECURRING = "recurring"
    CENTRAL = "central"


class TitleRef(BaseModel):
    media_type: MediaType
    tmdb_id: int
    season: int | None = None

    @property
    def key(self) -> str:
        base = f"{self.media_type}:{self.tmdb_id}"
        return base if self.season is None else f"{base}:s{self.season}"


class Title(BaseModel):
    media_type: MediaType
    tmdb_id: int
    imdb_id: str | None = None
    name: str
    year: int | None = None
    runtime_min: int | None = None
    season_count: int | None = None
    genres: list[str] = Field(default_factory=list)
    synopsis: str = ""
    poster_url: HttpUrl | None = None


class Availability(BaseModel):
    title: TitleRef
    region: str
    service_key: str | None = Field(
        default=None, description="Supported service this offer belongs to, if any."
    )
    provider_name: str
    access: AccessType
    link: HttpUrl | None = None
    source: str
    verified_at: datetime


class Classification(BaseModel):
    title: TitleRef
    region: str
    issuer: str
    value: str
    min_age: int | None = None
    descriptors: list[str] = Field(default_factory=list)
    version: str | None = Field(default=None, description="Cut or release, e.g. 'theatrical'.")
    source: str
    source_url: HttpUrl | None = None
    retrieved_at: datetime


class Rating(BaseModel):
    title: TitleRef
    source: str
    score: float
    scale: float = 10.0
    votes: int | None = None
    source_url: HttpUrl | None = None
    retrieved_at: datetime


class GuidanceObservation(BaseModel):
    """One sourced claim about a title's content. Append-only; never edited by the AI layer."""

    title: TitleRef
    source: str
    source_url: HttpUrl
    evidence: EvidenceType
    category: GuidanceCategory
    observation: str = Field(description="Own short paraphrase, never copied review text.")
    intensity: str | None = Field(default=None, description="Only when the source states it.")
    frequency: Frequency | None = None
    spoiler: bool = False
    region: str | None = None
    published_at: datetime | None = None
    retrieved_at: datetime
    confidence: float = Field(ge=0, le=1)


class CategoryAssessment(BaseModel):
    category: GuidanceCategory
    summary: str
    observation_ids: list[str] = Field(
        min_length=1, description="Every statement must cite at least one observation."
    )
    disagreement: str | None = None
    uncertainty: str | None = None


class Assessment(BaseModel):
    """AI synthesis for one title and one family profile version. Regenerable from evidence."""

    title: TitleRef
    profile_version: str
    categories: list[CategoryAssessment]
    why_recommended: str
    model: str
    generated_at: datetime


class FamilyProfile(BaseModel):
    """Minimal personal data: ages, never names or birthdates."""

    children_ages: list[int] = Field(min_length=1)
    # Catalog regions whose streaming offers count (a VPN can add more than the home one).
    # Age ratings do not depend on them: they come from every reference country.
    regions: list[str] = Field(default_factory=lambda: ["SE"], min_length=1)
    services: list[str] = Field(default_factory=list)
    preferred_genres: list[str] = Field(default_factory=list)
    avoid_categories: list[GuidanceCategory] = Field(default_factory=list)
    max_runtime_min: int | None = None
    mood: str | None = None
    min_imdb_rating: float | None = None

    @property
    def youngest(self) -> int:
        return min(self.children_ages)


class Feedback(BaseModel):
    title: TitleRef
    saved: bool = False
    watched: bool = False
    rejected: bool = False
    stars: int | None = Field(default=None, ge=1, le=5)
    at: datetime


class BanScope(StrEnum):
    AGE = "age"  # for the youngest child's current age range; lifts at `until_age`
    ALWAYS = "always"


class Ban(BaseModel):
    scope: BanScope
    until_age: int | None = Field(
        default=None,
        ge=1,
        le=17,
        description="Only for scope 'age': lifts once the youngest is this old.",
    )
    at: datetime

    def active(self, youngest: int) -> bool:
        if self.scope is BanScope.ALWAYS:
            return True
        return self.until_age is None or youngest < self.until_age


class TitleMark(BaseModel):
    """The family's own marks on one title. Seen, liked and rewatch never hide a title; an active
    ban keeps it out of every search and chat shortlist."""

    title: TitleRef
    name: str
    year: int | None = None
    poster_url: HttpUrl | None = None
    seen: bool = False
    liked_adults: bool = False
    liked_child: bool = False
    # The kids ask for it again and again: a good pick to put on even though it's been seen.
    rewatch: bool = False
    ban: Ban | None = None
    updated_at: datetime

    @property
    def empty(self) -> bool:
        return not (self.seen or self.liked_adults or self.liked_child or self.rewatch or self.ban)


class WatchlistItem(BaseModel):
    """A title the family saved, with enough to show it without another API call."""

    title: TitleRef
    name: str
    year: int | None = None
    poster_url: HttpUrl | None = None
    watched: bool = False
    added_at: datetime


class FamilyRole(StrEnum):
    OWNER = "owner"
    MEMBER = "member"


class Member(BaseModel):
    """One account's place in a family. Every member sees and edits the same profile, watchlist
    and marks. A family's id is its owner's uid, so a family started before sharing existed keeps
    its data."""

    uid: str
    family_id: str
    email: str | None = None
    role: FamilyRole = FamilyRole.MEMBER
    joined_at: datetime


class Invite(BaseModel):
    """A single-use link that lets any Google account join a family."""

    token: str
    family_id: str
    created_by: str
    created_at: datetime
    expires_at: datetime
    used_by: str | None = None
