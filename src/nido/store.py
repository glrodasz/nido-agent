"""Persistence: family profiles, watchlists and the external API response cache.

Two implementations behind one interface: `MemoryStore` for tests and local runs, and
`FirestoreStore` for Cloud Run. Firestore layout:

    families/{uid}                    the family profile (FamilyProfile fields + updated_at)
    families/{uid}/watchlist/{key}    one WatchlistItem per saved title (key: "movie:123")
    cache/{key}                       {payload (JSON), retrieved_at, expire_at}; a TTL policy
                                      on expire_at deletes stale entries (infra/bootstrap.sh)

Cache entries keep their retrieval time so a cached rating or offer still reports when it was
actually fetched, never when it was served.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from nido.models import FamilyProfile, WatchlistItem


@dataclass(frozen=True)
class Cached:
    data: dict[str, Any]
    retrieved_at: datetime


class Store(Protocol):
    async def get_profile(self, uid: str) -> FamilyProfile | None: ...
    async def put_profile(self, uid: str, profile: FamilyProfile) -> None: ...
    async def list_watchlist(self, uid: str) -> list[WatchlistItem]: ...
    async def put_watchlist_item(self, uid: str, item: WatchlistItem) -> None: ...
    async def delete_watchlist_item(self, uid: str, key: str) -> None: ...
    async def cache_get(self, key: str, max_age: timedelta) -> Cached | None: ...
    async def cache_put(self, key: str, data: dict[str, Any], ttl: timedelta) -> datetime:
        """Stores `data` and returns its retrieval time."""
        ...


def _now() -> datetime:
    return datetime.now(UTC)


class MemoryStore:
    def __init__(self) -> None:
        self._profiles: dict[str, FamilyProfile] = {}
        self._watchlists: dict[str, dict[str, WatchlistItem]] = {}
        self._cache: dict[str, Cached] = {}

    async def get_profile(self, uid: str) -> FamilyProfile | None:
        return self._profiles.get(uid)

    async def put_profile(self, uid: str, profile: FamilyProfile) -> None:
        self._profiles[uid] = profile

    async def list_watchlist(self, uid: str) -> list[WatchlistItem]:
        items = self._watchlists.get(uid, {}).values()
        return sorted(items, key=lambda i: i.added_at, reverse=True)

    async def put_watchlist_item(self, uid: str, item: WatchlistItem) -> None:
        self._watchlists.setdefault(uid, {})[item.title.key] = item

    async def delete_watchlist_item(self, uid: str, key: str) -> None:
        self._watchlists.get(uid, {}).pop(key, None)

    async def cache_get(self, key: str, max_age: timedelta) -> Cached | None:
        hit = self._cache.get(key)
        if hit is None or _now() - hit.retrieved_at > max_age:
            return None
        return hit

    async def cache_put(self, key: str, data: dict[str, Any], ttl: timedelta) -> datetime:
        now = _now()
        self._cache[key] = Cached(data=data, retrieved_at=now)
        return now


def _doc_id(key: str) -> str:
    # Firestore document ids cannot contain "/"; cache keys are ours, so this never collides.
    return key.replace("/", "|")


class FirestoreStore:
    def __init__(self, project: str | None = None, database: str = "(default)") -> None:
        # Imported here so tests and local runs never need Google credentials.
        from google.cloud import firestore

        self._db = firestore.AsyncClient(project=project, database=database)

    def _family(self, uid: str) -> Any:
        return self._db.collection("families").document(uid)

    async def get_profile(self, uid: str) -> FamilyProfile | None:
        snap = await self._family(uid).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        data.pop("updated_at", None)
        return FamilyProfile.model_validate(data)

    async def put_profile(self, uid: str, profile: FamilyProfile) -> None:
        await self._family(uid).set({**profile.model_dump(mode="json"), "updated_at": _now()})

    async def list_watchlist(self, uid: str) -> list[WatchlistItem]:
        query = (
            self._family(uid).collection("watchlist").order_by("added_at", direction="DESCENDING")
        )
        return [WatchlistItem.model_validate(snap.to_dict()) async for snap in query.stream()]

    async def put_watchlist_item(self, uid: str, item: WatchlistItem) -> None:
        doc = self._family(uid).collection("watchlist").document(_doc_id(item.title.key))
        data = item.model_dump(mode="json")
        data["added_at"] = item.added_at  # a real timestamp, so order_by sorts by time
        await doc.set(data)

    async def delete_watchlist_item(self, uid: str, key: str) -> None:
        await self._family(uid).collection("watchlist").document(_doc_id(key)).delete()

    async def cache_get(self, key: str, max_age: timedelta) -> Cached | None:
        snap = await self._db.collection("cache").document(_doc_id(key)).get()
        if not snap.exists:
            return None
        doc = snap.to_dict() or {}
        retrieved_at = doc.get("retrieved_at")
        if not isinstance(retrieved_at, datetime) or _now() - retrieved_at > max_age:
            return None
        return Cached(data=json.loads(doc.get("payload") or "{}"), retrieved_at=retrieved_at)

    async def cache_put(self, key: str, data: dict[str, Any], ttl: timedelta) -> datetime:
        now = _now()
        await (
            self._db.collection("cache")
            .document(_doc_id(key))
            .set(
                # A JSON string, not a map: API payloads may hold field names or nesting Firestore
                # maps do not allow ("watch/providers", arrays of arrays).
                {"payload": json.dumps(data), "retrieved_at": now, "expire_at": now + ttl}
            )
        )


def build_store(kind: str, *, project: str | None = None, database: str = "(default)") -> Store:
    if kind == "memory":
        return MemoryStore()
    if kind == "firestore":
        return FirestoreStore(project=project, database=database)
    raise ValueError(f"NIDO_STORE must be 'memory' or 'firestore', got {kind!r}")
