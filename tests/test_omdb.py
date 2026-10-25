from datetime import UTC, datetime

from nido.models import MediaType, TitleRef
from nido.sources.omdb import parse_rating

REF = TitleRef(media_type=MediaType.MOVIE, tmdb_id=1)
NOW = datetime(2026, 10, 25, tzinfo=UTC)


def test_parse_rating_with_votes():
    rating = parse_rating(
        REF, "tt1", {"Response": "True", "imdbRating": "7.8", "imdbVotes": "123,456"}, now=NOW
    )
    assert (rating.score, rating.votes, rating.source) == (7.8, 123456, "IMDb (via OMDb)")
    assert str(rating.source_url) == "https://www.imdb.com/title/tt1/"


def test_missing_rating_is_none_never_a_guess():
    assert parse_rating(REF, "tt1", {"Response": "True", "imdbRating": "N/A"}) is None
    assert parse_rating(REF, "tt1", {"Response": "False", "Error": "Not found"}) is None
