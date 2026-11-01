"""Card text and server messages in the web app's page language (nido.i18n)."""

import pytest

from nido.i18n import localize_output, message, request_locale, translate


@pytest.mark.parametrize(
    ("header", "locale"),
    [("es", "es"), ("pt-BR", "pt"), ("EN", "en"), ("fr", "en"), (None, "en"), ("", "en")],
)
def test_request_locale(header: str | None, locale: str) -> None:
    assert request_locale(header) == locale


# Every sentence ranking.assess writes must have a translation, or it would show in English.
RANKING_SENTENCES = [
    "No official age rating found in any reference country.",
    "Rated 7+, and your youngest is 4.",
    "Official ratings put it at age 7+ (median of 9 countries: DE 6+, SE 7+).",
    "Only one country's rating was found.",
    "Included in your subscriptions.",
    "Not included in your subscriptions: rent, buy or add-on only.",
    "Runs 140 min, longer than your 120 min limit.",
    "No runtime listed to check against your 40 min limit.",
    "No IMDb score to check against your minimum of 7.0.",
    "IMDb 6.5, below your minimum of 7.0.",
    "No IMDb rating available.",
    "Sources report content you asked to avoid: frightening.",
    "Matches your preferred genres.",
]


@pytest.mark.parametrize("locale", ["es", "pt"])
@pytest.mark.parametrize("sentence", RANKING_SENTENCES)
def test_every_ranking_sentence_is_translated(sentence: str, locale: str) -> None:
    assert translate(sentence, locale) != sentence


def test_translations_keep_the_numbers() -> None:
    rated = "Rated 7+, and your youngest is 4."
    assert translate(rated, "es") == "Clasificada 7+, y el menor tiene 4."
    assert translate("IMDb 6.5, below your minimum of 7.0.", "pt") == (
        "IMDb 6,5, abaixo do seu mínimo de 7,0."
    )
    assert translate("Sources report content you asked to avoid: frightening.", "es") == (
        "Las fuentes reportan contenido que pediste evitar: escenas de miedo."
    )


def test_english_and_unknown_text_stay_as_they_are() -> None:
    rated = "Rated 7+, and your youngest is 4."
    assert translate(rated, "en") == rated
    assert translate("Something new.", "es") == "Something new."


def test_localize_output_translates_every_card() -> None:
    card = {
        "title": "Bluey",
        "why": ["Included in your subscriptions."],
        "cautions": ["No IMDb rating available."],
        "misses": [],
        "age_baseline": "age 0+ (median of 1 countries: SE 0+)",
    }
    out = localize_output({"results": [card], "near_misses": [], "attribution": "x"}, "pt")
    assert out is not None
    assert out["results"][0]["why"] == ["Incluído nas suas assinaturas."]
    assert out["results"][0]["cautions"] == ["Sem nota no IMDb."]
    assert out["results"][0]["age_baseline"] == "idade 0+ (mediana de 1 país: SE 0+)"
    assert out["results"][0]["title"] == "Bluey"
    assert out["attribution"].startswith("Metadados")
    assert localize_output({"results": [card]}, "en") == {"results": [card]}


def test_messages_fall_back_to_english() -> None:
    assert message("over_limit_search", "es", limit=150).startswith("Tu familia ya usó las 150")
    assert message("busy", "fr").startswith("The assistant is busy")
