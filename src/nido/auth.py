"""Who is calling: Firebase Auth ID tokens, checked against an email allowlist.

Firebase Hosting forwards /api/** to a public Cloud Run service, so the service itself must decide
who may use it. The web app signs in with Google through Firebase Auth and sends the ID token as
`Authorization: Bearer <token>`; the token is verified here against Google's public certificates
(no service account needed). Any verified Google account gets through; what it may do is decided
by its family membership (server.py): emails in NIDO_ALLOWED_EMAILS may start a family, everyone
else needs an invite link from a family member.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
from google.auth import exceptions as google_exceptions
from google.auth import jwt

CERTS_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
)
CERTS_MAX_AGE_S = 3600
LOCAL_UID = "local"


class AuthError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass(frozen=True)
class User:
    uid: str
    email: str | None = None
    # On NIDO_ALLOWED_EMAILS: may start a family without an invite.
    allowed: bool = False


class FirebaseVerifier:
    def __init__(
        self,
        project: str,
        allowed_emails: tuple[str, ...],
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self._project = project
        self._allowed = {e.lower() for e in allowed_emails}
        self._http = http or httpx.AsyncClient(timeout=10)
        self._certs: dict[str, str] = {}
        self._certs_at = 0.0

    async def _public_certs(self) -> dict[str, str]:
        if not self._certs or time.monotonic() - self._certs_at > CERTS_MAX_AGE_S:
            response = await self._http.get(CERTS_URL)
            response.raise_for_status()
            self._certs = response.json()
            self._certs_at = time.monotonic()
        return self._certs

    async def verify(self, token: str) -> User:
        try:
            claims: dict[str, Any] = jwt.decode(
                token, certs=await self._public_certs(), audience=self._project
            )
        except (ValueError, google_exceptions.GoogleAuthError) as exc:
            raise AuthError(401, "invalid or expired sign-in token") from exc
        if claims.get("iss") != f"https://securetoken.google.com/{self._project}":
            raise AuthError(401, "token was not issued for this project")
        uid = claims.get("sub") or claims.get("user_id")
        if not uid:
            raise AuthError(401, "token has no user")
        email = str(claims.get("email") or "").lower()
        if not email or not claims.get("email_verified"):
            raise AuthError(403, "sign in with an account that has a verified email")
        return User(uid=str(uid), email=email, allowed=email in self._allowed)


class Authenticator:
    """`await authenticator(header)` -> User, or AuthError."""

    def __init__(self, mode: str, verifier: FirebaseVerifier | None = None) -> None:
        if mode not in {"firebase", "none"}:
            raise ValueError(f"NIDO_AUTH must be 'firebase' or 'none', got {mode!r}")
        if mode == "firebase" and verifier is None:
            raise ValueError(
                "NIDO_AUTH=firebase needs NIDO_FIREBASE_PROJECT or GOOGLE_CLOUD_PROJECT"
            )
        self.mode = mode
        self._verifier = verifier

    async def __call__(self, authorization: str | None) -> User:
        if self.mode == "none":
            return User(uid=LOCAL_UID, allowed=True)
        scheme, _, token = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise AuthError(401, "sign in first")
        assert self._verifier is not None
        return await self._verifier.verify(token.strip())
