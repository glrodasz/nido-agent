import datetime as dt
import time

import httpx
import pytest
import respx
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from google.auth import crypt, jwt

from nido.auth import CERTS_URL, LOCAL_UID, Authenticator, AuthError, FirebaseVerifier

PROJECT = "nido-test"


@pytest.fixture(scope="module")
def keypair():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    pem_key = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return crypt.RSASigner.from_string(pem_key, key_id="k1"), cert.public_bytes(
        serialization.Encoding.PEM
    ).decode()


def token(signer, **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": f"https://securetoken.google.com/{PROJECT}",
        "aud": PROJECT,
        "sub": "uid-1",
        "iat": now,
        "exp": now + 3600,
        "email": "Parent@Example.com",
        "email_verified": True,
        **overrides,
    }
    return jwt.encode(signer, claims).decode()


async def verify(keypair, tok: str, allowed=("parent@example.com",)):
    _, cert = keypair
    with respx.mock:
        respx.get(CERTS_URL).mock(return_value=httpx.Response(200, json={"k1": cert}))
        verifier = FirebaseVerifier(PROJECT, allowed)
        return await Authenticator("firebase", verifier)(f"Bearer {tok}")


async def test_valid_token_for_allowed_email(keypair):
    user = await verify(keypair, token(keypair[0]))
    assert user.uid == "uid-1" and user.email == "parent@example.com"


@pytest.mark.parametrize(
    ("overrides", "allowed", "status"),
    [
        ({"email": "other@example.com"}, ("parent@example.com",), 403),
        ({"email_verified": False}, ("parent@example.com",), 403),
        ({}, (), 403),
        ({"aud": "someone-else"}, ("parent@example.com",), 401),
        ({"iss": "https://evil.example"}, ("parent@example.com",), 401),
        ({"exp": int(time.time()) - 10}, ("parent@example.com",), 401),
    ],
)
async def test_rejected_tokens(keypair, overrides, allowed, status):
    with pytest.raises(AuthError) as err:
        await verify(keypair, token(keypair[0], **overrides), allowed)
    assert err.value.status == status


async def test_missing_header_and_local_mode():
    with pytest.raises(AuthError):
        await Authenticator("firebase", FirebaseVerifier(PROJECT, ()))(None)
    assert (await Authenticator("none")(None)).uid == LOCAL_UID


def test_firebase_mode_needs_a_project():
    with pytest.raises(ValueError):
        Authenticator("firebase", None)
