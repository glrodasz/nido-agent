import pytest

from nido.config import Settings


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, ("SE",)), ("", ("SE",)), (" , ", ("SE",)), ("se, no", ("SE", "NO"))],
)
def test_regions_fall_back_to_sweden(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv("NIDO_REGIONS", raising=False)
    else:
        monkeypatch.setenv("NIDO_REGIONS", value)
    assert Settings().regions == expected


def test_fallback_model_can_be_disabled(monkeypatch):
    from nido.config import Settings

    monkeypatch.setenv("NIDO_FALLBACK_MODEL", "none")
    assert Settings().fallback_model == ""
    monkeypatch.setenv("NIDO_FALLBACK_MODEL", "gemini-x")
    assert Settings().fallback_model == "gemini-x"
