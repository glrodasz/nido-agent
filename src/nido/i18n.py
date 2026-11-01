"""The web app's language on the server: what Ask Nido answers in, and the card text the server
writes (the reasons, cautions and misses from ranking, the age baseline, quota and busy messages).

The web app sends its page language in the X-Nido-Locale header (es, en or pt); anything else is
English, so API clients and tests keep today's text. Ranking and the agent's tools keep working in
English: the model reads English tool output, and only what a person reads is translated, at the
edge of the API (localize_output). A sentence this module does not know stays in English.
"""

import re
from collections.abc import Callable
from typing import Any

LOCALES = ("es", "en", "pt")
DEFAULT_LOCALE = "en"

# How the agent is told which language to answer in.
LANGUAGE_NAMES = {
    "es": "Spanish (neutral Latin American Spanish)",
    "en": "English",
    "pt": "Brazilian Portuguese",
}


def request_locale(header: str | None) -> str:
    value = (header or "").strip().lower().split("-")[0]
    return value if value in LOCALES else DEFAULT_LOCALE


def _number(value: str, locale: str) -> str:
    return value.replace(".", ",") if locale in ("es", "pt") else value


CATEGORIES = {
    "es": {
        "violence": "violencia",
        "frightening": "escenas de miedo",
        "language": "lenguaje",
        "sex_nudity": "sexo y desnudos",
        "romance": "romance",
        "substances": "alcohol, drogas, tabaco",
        "bullying_discrimination": "acoso y discriminación",
        "death_grief": "muerte y duelo",
        "imitable_behavior": "conductas imitables",
    },
    "pt": {
        "violence": "violência",
        "frightening": "cenas assustadoras",
        "language": "linguagem",
        "sex_nudity": "sexo e nudez",
        "romance": "romance",
        "substances": "álcool, drogas, cigarro",
        "bullying_discrimination": "bullying e discriminação",
        "death_grief": "morte e luto",
        "imitable_behavior": "comportamentos imitáveis",
    },
}

_BASELINE = re.compile(r"age (\d+)\+ \(median of (\d+) countries: (.*)\)")
_BASELINE_TEXT = {
    "es": "edad {age}+ (mediana de {countries}: {list})",
    "pt": "idade {age}+ (mediana de {countries}: {list})",
}


def _baseline(m: re.Match[str], locale: str) -> str:
    n = int(m.group(2))
    countries = "1 país" if n == 1 else f"{n} países"
    return _BASELINE_TEXT[locale].format(age=m.group(1), countries=countries, list=m.group(3))


Rule = tuple[re.Pattern[str], Callable[[re.Match[str], str], str]]


def _fixed(es: str, pt: str) -> Callable[[re.Match[str], str], str]:
    return lambda m, locale: {"es": es, "pt": pt}[locale].format(*m.groups())


# The sentences ranking.assess and Toolbox.details write, and their translations.
RULES: list[Rule] = [
    (
        re.compile(r"No official age rating found in any reference country\."),
        _fixed(
            "No se encontró una clasificación oficial de edad en ningún país de referencia.",
            "Nenhuma classificação indicativa oficial encontrada nos países de referência.",
        ),
    ),
    (
        re.compile(r"Rated (\d+)\+, and your youngest is (\d+)\."),
        _fixed(
            "Clasificada {0}+, y el menor tiene {1}.", "Classificação {0}+, e o mais novo tem {1}."
        ),
    ),
    (
        re.compile(r"Official ratings put it at (age .*)\."),
        lambda m, locale: {
            "es": "Las clasificaciones oficiales la ubican en {0}.",
            "pt": "As classificações oficiais indicam {0}.",
        }[locale].format(localize_baseline(m.group(1), locale)),
    ),
    (
        re.compile(r"Only one country's rating was found\."),
        _fixed(
            "Solo se encontró la clasificación de un país.",
            "Só foi encontrada a classificação de um país.",
        ),
    ),
    (
        re.compile(r"Included in your subscriptions\."),
        _fixed("Incluida en tus suscripciones.", "Incluído nas suas assinaturas."),
    ),
    (
        re.compile(r"Not included in your subscriptions: rent, buy or add-on only\."),
        _fixed(
            "No está incluida en tus suscripciones: solo alquiler, compra o canal adicional.",
            "Não está incluído nas suas assinaturas: só aluguel, compra ou canal adicional.",
        ),
    ),
    (
        re.compile(r"Runs (\d+) min, longer than your (\d+) min limit\."),
        _fixed(
            "Dura {0} min, más que tu límite de {1} min.",
            "Dura {0} min, mais do que o seu limite de {1} min.",
        ),
    ),
    (
        re.compile(r"No runtime listed to check against your (\d+) min limit\."),
        _fixed(
            "No figura su duración para compararla con tu límite de {0} min.",
            "Não há duração informada para comparar com o seu limite de {0} min.",
        ),
    ),
    (
        re.compile(r"No IMDb score to check against your minimum of ([\d.]+)\."),
        lambda m, locale: {
            "es": "No tiene nota en IMDb para compararla con tu mínimo de {0}.",
            "pt": "Não tem nota no IMDb para comparar com o seu mínimo de {0}.",
        }[locale].format(_number(m.group(1), locale)),
    ),
    (
        re.compile(r"IMDb ([\d.]+), below your minimum of ([\d.]+)\."),
        lambda m, locale: {
            "es": "IMDb {0}, por debajo de tu mínimo de {1}.",
            "pt": "IMDb {0}, abaixo do seu mínimo de {1}.",
        }[locale].format(_number(m.group(1), locale), _number(m.group(2), locale)),
    ),
    (
        re.compile(r"No IMDb rating available\."),
        _fixed("Sin nota en IMDb.", "Sem nota no IMDb."),
    ),
    (
        re.compile(r"Sources report content you asked to avoid: (\w+)\."),
        lambda m, locale: {
            "es": "Las fuentes reportan contenido que pediste evitar: {0}.",
            "pt": "As fontes apontam conteúdo que você pediu para evitar: {0}.",
        }[locale].format(CATEGORIES[locale].get(m.group(1), m.group(1).replace("_", " "))),
    ),
    # Written by Toolbox.details for a saved title nobody streams in the family's regions.
    (
        re.compile(r"Not streaming in your regions right now\."),
        _fixed(
            "Por ahora no está en streaming en tus regiones.",
            "No momento não está em streaming nas suas regiões.",
        ),
    ),
    (
        re.compile(r"Matches your preferred genres\."),
        _fixed("Coincide con sus géneros favoritos.", "Combina com os seus gêneros favoritos."),
    ),
]


def translate(text: str, locale: str) -> str:
    """One sentence from ranking in the page's language; unknown text stays as it is."""
    if locale == "en":
        return text
    for pattern, render in RULES:
        if m := pattern.fullmatch(text):
            return render(m, locale)
    return text


def localize_baseline(text: str | None, locale: str) -> str | None:
    """ "age 7+ (median of 9 countries: DE 6+, ...)" in the page's language."""
    if text is None or locale == "en":
        return text
    m = _BASELINE.fullmatch(text)
    return _baseline(m, locale) if m else text


def _localize_item(item: dict[str, Any], locale: str) -> dict[str, Any]:
    return {
        **item,
        **{
            field: [translate(t, locale) for t in item.get(field) or []]
            for field in ("why", "cautions", "misses")
            if field in item
        },
        **(
            {"age_baseline": localize_baseline(item["age_baseline"], locale)}
            if "age_baseline" in item
            else {}
        ),
    }


def localize_output(output: dict[str, Any] | None, locale: str) -> dict[str, Any] | None:
    """Search or chat output with every card's text in the page's language."""
    if not output or locale == "en":
        return output
    return {
        **output,
        **{
            field: [_localize_item(item, locale) for item in output.get(field) or []]
            for field in ("results", "near_misses")
            if field in output
        },
        **({"attribution": MESSAGES["attribution"][locale]} if "attribution" in output else {}),
    }


# Server messages a person reads, by key, then locale.
MESSAGES: dict[str, dict[str, str]] = {
    "attribution": {
        "en": "Metadata: TMDB (this product uses the TMDB API but is not endorsed or certified by "
        "TMDB). Streaming availability: JustWatch via TMDB. IMDb ratings via OMDb.",
        "es": "Metadatos: TMDB (este producto usa la API de TMDB, pero TMDB no lo respalda ni lo "
        "certifica). Disponibilidad en streaming: JustWatch vía TMDB. Notas de IMDb vía OMDb.",
        "pt": "Metadados: TMDB (este produto usa a API do TMDB, mas não é endossado nem "
        "certificado pelo TMDB). Disponibilidade em streaming: JustWatch via TMDB. Notas do IMDb "
        "via OMDb.",
    },
    "over_limit_chat": {
        "en": "Your family has used today's {limit} Ask Nido questions. They come back tomorrow; "
        "the filters still work.",
        "es": "Tu familia ya usó las {limit} preguntas a Nido de hoy. Vuelven mañana; los filtros "
        "siguen funcionando.",
        "pt": "A sua família já usou as {limit} perguntas ao Nido de hoje. Elas voltam amanhã; os "
        "filtros continuam funcionando.",
    },
    "over_limit_search": {
        "en": "Your family has used today's {limit} searches. They come back tomorrow.",
        "es": "Tu familia ya usó las {limit} búsquedas de hoy. Vuelven mañana.",
        "pt": "A sua família já usou as {limit} buscas de hoje. Elas voltam amanhã.",
    },
    "busy": {
        "en": "The assistant is busy right now. Try again in a minute, or use the filters.",
        "es": "El asistente está ocupado en este momento. Intenta de nuevo en un minuto o usa los "
        "filtros.",
        "pt": "O assistente está ocupado agora. Tente de novo em um minuto ou use os filtros.",
    },
    "stopped_budget": {
        "en": "Stopped early: this turn reached its model call limit.",
        "es": "Se detuvo antes: esta respuesta llegó a su límite de llamadas al modelo.",
        "pt": "Parou antes: esta resposta atingiu o limite de chamadas ao modelo.",
    },
    "stopped": {
        "en": "The assistant stopped before finishing.",
        "es": "El asistente se detuvo antes de terminar.",
        "pt": "O assistente parou antes de terminar.",
    },
    "source_down": {
        "en": "a data source did not answer; try again",
        "es": "una fuente de datos no respondió; intenta de nuevo",
        "pt": "uma fonte de dados não respondeu; tente de novo",
    },
    "leave_first": {
        "en": "leave your current family first (Family tab)",
        "es": "primero sal de tu familia actual (pestaña Familia)",
        "pt": "primeiro saia da sua família atual (aba Família)",
    },
}


def message(key: str, locale: str, **values: Any) -> str:
    texts = MESSAGES[key]
    return texts.get(locale, texts[DEFAULT_LOCALE]).format(**values)
