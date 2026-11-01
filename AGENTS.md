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

## Languages

Nido speaks Spanish (default, served at `/`), English (`/en`) and Portuguese (`/pt`). The page
URL decides the language; `web/src/i18n/locale.ts` holds the rules (saved `locale` cookie, then
the browser's languages, for an unprefixed first visit).

- **No user-visible text in components.** Add every string to `web/src/i18n/messages/en.ts`
  (the type source) and to `es.ts` and `pt.ts`; the landing page's copy lives in
  `web/src/i18n/landing.ts`. `npm test` fails when a language misses a key.
- Spanish is neutral Latin American Spanish ("ustedes", "tu hijo"); Portuguese is Brazilian.
- Sentences the server writes for cards (`ranking.assess` reasons, cautions and misses) need a
  translation rule in `src/nido/i18n.py`; `tests/test_i18n.py` lists them, so add new ones there.
- The web app sends its language in `X-Nido-Locale`; Ask Nido answers in it.
