# AGENTS.md

Guidance for coding agents working on Nido, a family app for choosing what to watch together.

## Content guidelines

### Genres

The genres Nido offers (profile "Favourite genres" and the Find filters) live in
`GENRE_TYPES` in `web/src/logic/format.ts`.

- **Never offer violent or adult-leaning genres.** Crime, War, Horror and Thriller stay out
  of the lists, and so do any genres TMDB adds later in the same spirit.
- Leave out off-topic TV formats too: News, Soap, Talk and TV Movie.
- Every offered genre must exist in TMDB for the media types it is tagged with: movie and
  series genre lists differ (Kids and Reality are series-only; History, Music and Romance are
  movies-only). `tests/test_tmdb.py::test_every_offered_genre_resolves_for_its_media_type`
  checks this, so update it together with `GENRE_TYPES`.
