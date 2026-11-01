import {
  type FindKind,
  genresFor,
  LENGTH_STOPS,
  nearestStop,
  SCORE_STOPS,
  withKind,
  withLength,
} from "./format";
import type { Profile, TitleMark } from "./types";

export interface Filters {
  // Shorts are movies of 40 minutes or less: a type of its own for the family, a movie search
  // with a runtime cap for the API.
  kind: FindKind;
  genres: string[];
  // Max length in minutes; null is any length.
  runtime: number | null;
  // The lowest stop is the default and asks for no minimum.
  minImdb: number;
  // "Last N years" as a string for the select; "" is any time.
  since: string;
}

// Families want what is new: the filters start at five years back. A series counts while it
// still airs, so Bluey stays in even though it started in 2018.
export const DEFAULT_SINCE = "5";
export const DEFAULT_FILTERS: Filters = {
  kind: "movie",
  genres: [],
  runtime: null,
  minImdb: SCORE_STOPS[0],
  since: DEFAULT_SINCE,
};

/** Where Find starts and what Clear filters goes back to: the profile's default length and
 * score, snapped to the slider stops (a length of 40 min or less starts on Shorts). */
export function profileFilters(profile: Profile): Filters {
  const base = { ...DEFAULT_FILTERS, minImdb: profileScore(profile.min_imdb_rating) };
  return withLength(base, profileLength(profile.max_runtime_min));
}

/** The profile's saved length as a slider stop; null is "Any". */
export const profileLength = (min: number | null) => nearestStop(LENGTH_STOPS, min);
/** The profile's saved score as a slider stop; the first stop is "Any". */
export const profileScore = (score: number | null) =>
  score === null ? SCORE_STOPS[0] : (nearestStop(SCORE_STOPS, score) ?? SCORE_STOPS[0]);

export const isDefault = (f: Filters, base: Filters = DEFAULT_FILTERS) =>
  f.kind === base.kind &&
  f.genres.length === base.genres.length &&
  f.genres.every((g) => base.genres.includes(g)) &&
  f.runtime === base.runtime &&
  f.minImdb === base.minImdb &&
  f.since === base.since;

const WELL_RATED = 7;
const NEW_SINCE = "2";
// Little ones mostly watch shorts and series, so those chips lead for them.
const SHORTS_FIRST_UP_TO_AGE = 6;
const MAX_GENRE_CHIPS = 3;
const MAX_LIKE_CHIPS = 2;
// When the profile has no favourites: what most families reach for.
const FALLBACK_GENRES = ["Animation", "Family", "Comedy"];

/** A one-tap shortcut: either a filter toggle that runs the filter search, or a question for
 * Ask Nido. */
export type QuickChip =
  | { id: string; label: string; kind: "filter"; on: (f: Filters) => boolean; toggle: (f: Filters) => Filters }
  | { id: string; label: string; kind: "ask"; question: string; icon: "repeat" | "smile" };

const genreChip = (g: string): QuickChip => ({
  id: `genre:${g}`,
  label: g === "Science Fiction" ? "Sci-fi" : g,
  kind: "filter",
  on: (f) => f.genres.includes(g),
  toggle: (f) => ({
    ...f,
    genres: f.genres.includes(g) ? f.genres.filter((x) => x !== g) : [...f.genres, g],
  }),
});

/** Back to Movies, keeping the profile's length when it is a movie length. */
const toMovies = (f: Filters, base: Filters): Filters => ({
  ...withKind(f, "movie"),
  runtime: base.kind === "movie" ? base.runtime : null,
});

const typeChips = (base: Filters): QuickChip[] => [
  {
    id: "shorts",
    label: "Shorts",
    kind: "filter",
    on: (f) => f.kind === "short",
    toggle: (f) => (f.kind === "short" ? toMovies(f, base) : withKind(f, "short")),
  },
  {
    id: "series",
    label: "Series",
    kind: "filter",
    on: (f) => f.kind === "tv",
    toggle: (f) => (f.kind === "tv" ? toMovies(f, base) : withKind(f, "tv")),
  },
];

const NEW_CHIP: QuickChip = {
  id: "new",
  label: "New",
  kind: "filter",
  on: (f) => f.since === NEW_SINCE,
  toggle: (f) => ({ ...f, since: f.since === NEW_SINCE ? DEFAULT_SINCE : NEW_SINCE }),
};

/** Off goes back to the profile's score, or to "Any" when the profile already asks for 7. */
const wellRatedChip = (base: Filters): QuickChip => {
  const off = base.minImdb === WELL_RATED ? SCORE_STOPS[0] : base.minImdb;
  return {
    id: "rated",
    label: "Well rated",
    kind: "filter",
    on: (f) => f.minImdb === WELL_RATED,
    toggle: (f) => ({ ...f, minImdb: f.minImdb === WELL_RATED ? off : WELL_RATED }),
  };
};

/** Titles the family keeps coming back to, newest mark first: On repeat, then "Our kid liked
 * it". Hidden titles never seed a suggestion. */
export function favouriteTitles(marks: Iterable<TitleMark>): TitleMark[] {
  const fit = [...marks].filter((m) => !m.ban_active && (m.rewatch || m.liked_child));
  const newest = (a: TitleMark, b: TitleMark) => b.updated_at.localeCompare(a.updated_at);
  return [...fit.filter((m) => m.rewatch).sort(newest), ...fit.filter((m) => !m.rewatch).sort(newest)];
}

/** The quick chips for this family: type chips (Shorts first for little ones), New, Well rated,
 * their favourite genres for the chosen type, and "Like …" questions from the titles they love. */
export function quickChips(
  profile: Profile,
  marks: Iterable<TitleMark>,
  kind: FindKind,
  canAsk: boolean,
): QuickChip[] {
  const youngest = profile.children_ages.length ? Math.min(...profile.children_ages) : null;
  const base = profileFilters(profile);
  const types = typeChips(base);
  if (youngest === null || youngest > SHORTS_FIRST_UP_TO_AGE) types.reverse();
  const offered = genresFor(kind === "tv" ? "tv" : "movie");
  const favourites = profile.preferred_genres.length ? profile.preferred_genres : FALLBACK_GENRES;
  const genres = favourites.filter((g) => offered.includes(g)).slice(0, MAX_GENRE_CHIPS);
  const likes: QuickChip[] = canAsk
    ? favouriteTitles(marks)
        .slice(0, MAX_LIKE_CHIPS)
        .map((m) => ({
          id: `like:${m.key}`,
          label: `Like ${m.name}`,
          kind: "ask",
          icon: m.rewatch ? "repeat" : "smile",
          question: `Suggest titles similar to ${m.name} that we haven't seen yet.`,
        }))
    : [];
  return [...types, NEW_CHIP, wellRatedChip(base), ...genres.map(genreChip), ...likes];
}
