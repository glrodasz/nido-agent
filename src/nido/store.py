"""Persistence: family profiles, watchlists and the external API response cache.

Two implementations behind one interface: `MemoryStore` for tests and local runs, and
`FirestoreStore` for Cloud Run. Firestore layout:

    families/{uid}                    the family profile (FamilyProfile fields + updated_at)
    families/{uid}/watchlist/{key}    one WatchlistItem per saved title (key: "movie:123")
    families/{uid}/titles/{key}       one TitleMark per marked title: seen, liked, rewatch, banned
    members/{uid}                     one Member per account: which family it belongs to
    invites/{token}                   one Invite per invite link (single use, expires)

A family's id is its owner's uid; the parameters below named `uid` are family ids.
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

from nido.models import FamilyProfile, Invite, Member, TitleMark, WatchlistItem


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
    async def list_marks(self, uid: str) -> list[TitleMark]: ...
    async def get_mark(self, uid: str, key: str) -> TitleMark | None: ...
    async def put_mark(self, uid: str, mark: TitleMark) -> None: ...
    async def delete_mark(self, uid: str, key: str) -> None: ...
    async def get_member(self, uid: str) -> Member | None: ...
    async def put_member(self, member: Member) -> None: ...
    async def delete_member(self, uid: str) -> None: ...
    async def list_members(self, family_id: str) -> list[Member]: ...
    async def put_invite(self, invite: Invite) -> None: ...
    async def get_invite(self, token: str) -> Invite | None: ...
    async def claim_invite(self, token: str, uid: str, now: datetime) -> Invite | None:
        """Marks an unused, unexpired invite as used by `uid` and returns it, atomically; None if
        it does not exist, expired or was already used."""
        ...

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
        self._marks: dict[str, dict[str, TitleMark]] = {}
        self._cache: dict[str, Cached] = {}
        self._members: dict[str, Member] = {}
        self._invites: dict[str, Invite] = {}

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

    async def list_marks(self, uid: str) -> list[TitleMark]:
        items = self._marks.get(uid, {}).values()
        return sorted(items, key=lambda m: m.updated_at, reverse=True)

    async def get_mark(self, uid: str, key: str) -> TitleMark | None:
        return self._marks.get(uid, {}).get(key)

    async def put_mark(self, uid: str, mark: TitleMark) -> None:
        self._marks.setdefault(uid, {})[mark.title.key] = mark

    async def delete_mark(self, uid: str, key: str) -> None:
        self._marks.get(uid, {}).pop(key, None)

    async def get_member(self, uid: str) -> Member | None:
        return self._members.get(uid)

    async def put_member(self, member: Member) -> None:
        self._members[member.uid] = member

    async def delete_member(self, uid: str) -> None:
        self._members.pop(uid, None)

    async def list_members(self, family_id: str) -> list[Member]:
        members = [m for m in self._members.values() if m.family_id == family_id]
        return sorted(members, key=lambda m: m.joined_at)

    async def put_invite(self, invite: Invite) -> None:
        self._invites[invite.token] = invite

    async def get_invite(self, token: str) -> Invite | None:
        return self._invites.get(token)

    async def claim_invite(self, token: str, uid: str, now: datetime) -> Invite | None:
        invite = self._invites.get(token)
        if invite is None or invite.expires_at <= now or invite.used_by is not None:
            return None
        self._invites[token] = invite = invite.model_copy(update={"used_by": uid})
        return invite

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

    async def list_marks(self, uid: str) -> list[TitleMark]:
        query = (
            self._family(uid).collection("titles").order_by("updated_at", direction="DESCENDING")
        )
        return [TitleMark.model_validate(snap.to_dict()) async for snap in query.stream()]

    async def get_mark(self, uid: str, key: str) -> TitleMark | None:
        snap = await self._family(uid).collection("titles").document(_doc_id(key)).get()
        return TitleMark.model_validate(snap.to_dict()) if snap.exists else None

    async def put_mark(self, uid: str, mark: TitleMark) -> None:
        doc = self._family(uid).collection("titles").document(_doc_id(mark.title.key))
        data = mark.model_dump(mode="json")
        data["updated_at"] = mark.updated_at  # a real timestamp, so order_by sorts by time
        await doc.set(data)

    async def delete_mark(self, uid: str, key: str) -> None:
        await self._family(uid).collection("titles").document(_doc_id(key)).delete()

    async def get_member(self, uid: str) -> Member | None:
        snap = await self._db.collection("members").document(uid).get()
        return Member.model_validate(snap.to_dict()) if snap.exists else None

    async def put_member(self, member: Member) -> None:
        data = member.model_dump(mode="json")
        data["joined_at"] = member.joined_at
        await self._db.collection("members").document(member.uid).set(data)

    async def delete_member(self, uid: str) -> None:
        await self._db.collection("members").document(uid).delete()

    async def list_members(self, family_id: str) -> list[Member]:
        query = self._db.collection("members").where("family_id", "==", family_id)
        members = [Member.model_validate(snap.to_dict()) async for snap in query.stream()]
        return sorted(members, key=lambda m: m.joined_at)

    async def put_invite(self, invite: Invite) -> None:
        data = invite.model_dump(mode="json")
        data.update(created_at=invite.created_at, expires_at=invite.expires_at)
        await self._db.collection("invites").document(invite.token).set(data)

    async def get_invite(self, token: str) -> Invite | None:
        snap = await self._db.collection("invites").document(token).get()
        return Invite.model_validate(snap.to_dict()) if snap.exists else None

    async def claim_invite(self, token: str, uid: str, now: datetime) -> Invite | None:
        from google.cloud import firestore

        doc = self._db.collection("invites").document(token)

        @firestore.async_transactional
        async def claim(transaction: Any) -> Invite | None:
            snap = await doc.get(transaction=transaction)
            if not snap.exists:
                return None
            invite = Invite.model_validate(snap.to_dict())
            if invite.expires_at <= now or invite.used_by is not None:
                return None
            transaction.update(doc, {"used_by": uid, "used_at": now})
            return invite.model_copy(update={"used_by": uid})

        return await claim(self._db.transaction())

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
