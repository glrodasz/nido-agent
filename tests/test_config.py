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
