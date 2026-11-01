import { fmt, formatNumber, plural, t } from "../i18n";
import type { Access, Ban, MediaType, Offer, Profile } from "./types";

const DAY_MS = 86_400_000;

/** "today", "1 day ago", "12 days ago": how fresh a sourced value is. */
export function verifiedAgo(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
  if (!Number.isFinite(days) || days <= 0) return t.ago.today;
  return plural(days, t.ago.days);
}

export function accessLabel(access: Access): string {
  return t.access[access] ?? access;
}

export function isIncluded(offer: Offer, services: string[]): boolean {
  return (
    (offer.access === "subscription" || offer.access === "ads") &&
    offer.service !== null &&
    services.includes(offer.service)
  );
}

// Brand colours for the supported services (keys from src/nido/catalog.py), picked so the
// label text stays readable on them.
const BRAND: Record<string, { bg: string; fg: string }> = {
  netflix: { bg: "#e50914", fg: "#ffffff" },
  disney_plus: { bg: "#113ccf", fg: "#ffffff" },
  hbo_max: { bg: "#5b2bd6", fg: "#ffffff" },
  prime_video: { bg: "#0f79af", fg: "#ffffff" },
  apple_tv_plus: { bg: "#000000", fg: "#ffffff" },
};

export function serviceBrand(service: string | null): { bg: string; fg: string } | null {
  return (service && BRAND[service]) || null;
}

/** Offers the family already pays for first, then the rest; one row per provider and access. */
export function sortOffers(offers: Offer[], services: string[]): Offer[] {
  const seen = new Set<string>();
  const unique = offers.filter((o) => {
    const key = `${o.region}|${o.provider}|${o.access}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rank = (o: Offer) => (isIncluded(o, services) ? 0 : o.access === "addon" ? 1 : 2);
  return unique.sort((a, b) => rank(a) - rank(b) || a.provider.localeCompare(b.provider));
}

export function categoryLabel(category: string): string {
  return t.categories[category] ?? category.replaceAll("_", " ");
}

export function formatVotes(votes: number | null): string {
  if (votes === null) return "";
  if (votes >= 1_000_000) {
    const n = formatNumber(votes / 1_000_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return fmt(t.card.votesM, { n });
  }
  if (votes >= 1_000) return fmt(t.card.votesK, { n: Math.round(votes / 1_000) });
  return fmt(t.card.votes, { n: votes });
}

// From this age on a child counts as an adult: no age rating limits them (server ADULT_AGE).
export const ADULT_AGE = 18;

/** "4 years", "Under 1", or "Adult · 18+" for the age stepper. */
export function ageLabel(age: number): string {
  if (age >= ADULT_AGE) return fmt(t.ages.adult, { n: ADULT_AGE });
  if (age === 0) return t.ages.underOne;
  return plural(age, t.ages.years);
}

const shortAge = (age: number) => (age >= ADULT_AGE ? `${ADULT_AGE}+` : String(age));

/** One child as the "Who's watching" picker shows them: "Leo · 9", or "9-year-old" unnamed. */
export function childLabel(profile: Profile, index: number): string {
  const age = profile.children_ages[index];
  const name = profile.children_names?.[index]?.trim();
  if (name) return `${name} · ${shortAge(age)}`;
  if (age >= ADULT_AGE) return t.ages.adultChild;
  return age === 0 ? t.ages.baby : fmt(t.ages.yearOld, { n: age });
}

/** The ages of whoever watches: one child by position, or everyone (null). */
export function watchingAges(profile: Profile, watching: number | null): number[] {
  const age = watching === null ? undefined : profile.children_ages[watching];
  return age === undefined ? profile.children_ages : [age];
}

/** The age that sets the limits: the youngest of whoever watches. */
export function youngestOf(ages: number[]): number {
  return ages.length ? Math.min(...ages) : 0;
}

/** "se, no" -> ["SE", "NO"]; null when any entry is not a two-letter code. */
export function parseRegions(text: string): string[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean).map((r) => r.toUpperCase());
  if (parts.length === 0) return null;
  return parts.every((r) => /^[A-Z]{2}$/.test(r)) ? [...new Set(parts)] : null;
}

export const EMPTY_PROFILE: Profile = {
  children_ages: [],
  children_names: [],
  regions: ["SE"],
  services: [],
  preferred_genres: [],
  avoid_categories: [],
  max_runtime_min: null,
  min_imdb_rating: null,
};

// TMDB genre names the profile and filters offer (discover uses TMDB's own names). Series
// genres are compound ("Action & Adventure", "Sci-Fi & Fantasy"); the server
// matches each name to either half. A few exist for one type only, so Find shows only those
// that can filter the chosen type. Left out as too violent or off-topic for a family
// app: Crime, Horror, Thriller, War, News, Soap, Talk, TV Movie.
const BOTH: MediaType[] = ["movie", "tv"];
export const GENRE_TYPES: Record<string, MediaType[]> = {
  Action: BOTH,
  Adventure: BOTH,
  Animation: BOTH,
  Comedy: BOTH,
  Documentary: BOTH,
  Drama: BOTH,
  Family: BOTH,
  Fantasy: BOTH,
  History: ["movie"],
  Kids: ["tv"],
  Music: ["movie"],
  Mystery: BOTH,
  Reality: ["tv"],
  Romance: ["movie"],
  "Science Fiction": BOTH,
  Western: BOTH,
};
export const GENRES = Object.keys(GENRE_TYPES);

/** The genres that can filter one media type. */
export function genresFor(mediaType: MediaType): string[] {
  return GENRES.filter((g) => GENRE_TYPES[g].includes(mediaType));
}

// Where an age range starts: 0-6, 7-9, 10-12, 13-15, 16-17 (server.AGE_RANGE_STARTS). At 18 a
// child counts as an adult, so an age ban lifts at 17 at the latest.
const AGE_RANGE_STARTS = [7, 10, 13, 16];
export const MAX_CHILD_AGE = 17;

/** Default age at which an age-range ban lifts: the title's baseline when it is above the
 * youngest child, else the start of the next age range. Mirrors server.default_ban_until. */
export function defaultBanUntil(youngest: number, baselineAge: number | null): number {
  if (baselineAge !== null && baselineAge > youngest) return Math.min(baselineAge, MAX_CHILD_AGE);
  return AGE_RANGE_STARTS.find((a) => a > youngest) ?? MAX_CHILD_AGE;
}

export function banLabel(ban: Ban, active: boolean): string {
  if (ban.scope === "always") return t.ban.always;
  return fmt(active ? t.ban.until : t.ban.lifted, { age: ban.until_age ?? "" });
}

export type VerdictLevel = "fit" | "grown-up" | "later" | "settings";

export interface Verdict {
  level: VerdictLevel;
  label: string;
}

// An age miss this many years or fewer above the youngest reads as "watch it together".
const GROWN_UP_GAP = 3;

/** One plain verdict per title, from the profile rules it breaks: everyone, together with a
 * grown-up, after bedtime, or outside the family's other settings (runtime, IMDb). */
export function verdictFor(
  misses: string[],
  baselineAge: number | null,
  youngest: number,
): Verdict {
  if (misses.length === 0) return { level: "fit", label: t.verdict.fit };
  if (baselineAge !== null && baselineAge > youngest) {
    return baselineAge - youngest <= GROWN_UP_GAP
      ? { level: "grown-up", label: t.verdict.grownUp }
      : { level: "later", label: t.verdict.later };
  }
  return { level: "settings", label: t.verdict.settings };
}

function joinAnd(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} ${t.family.and} ${items[items.length - 1]}`;
}

/** "For your 4-year-old · on Netflix and Disney+": who and where the picks are for. With one
 * child picked as watching, only that child: "For Leo, 9 · on Netflix". */
export function familyLine(
  profile: Profile,
  serviceNames: Record<string, string>,
  watching: number | null = null,
): string {
  const name = watching === null ? "" : (profile.children_names?.[watching]?.trim() ?? "");
  const ages = [...watchingAges(profile, watching)].sort((a, b) => a - b);
  const who =
    ages.length === 0
      ? t.family.forFamily
      : name
        ? fmt(t.family.forNamed, { name, age: shortAge(ages[0]) })
        : ages.length === 1
          ? ages[0] >= ADULT_AGE
            ? t.family.forAdult
            : fmt(t.family.forOne, { age: ages[0] })
          : fmt(t.family.forMany, { ages: joinAnd(ages.map(shortAge)) });
  const services = profile.services.map((s) => serviceNames[s] ?? s);
  return services.length ? fmt(t.family.on, { who, services: joinAnd(services) }) : who;
}

/** A stable hue per title, so a missing poster still gets its own colour. */
export function posterHue(tmdbId: number): number {
  return (tmdbId * 47) % 360;
}

/** Unseen titles first, seen ones after; the ranking order holds within each group. */
/** "2018–2026" for a series that aired after its first year, so "Newest" order reads right. */
export function yearSpan(r: {
  year: number | null;
  media_type: string;
  released_on?: string | null;
}): string | null {
  const latest = r.released_on ? Number(r.released_on.slice(0, 4)) : null;
  if (r.year == null) return latest ? String(latest) : null;
  return r.media_type === "tv" && latest && latest > r.year ? `${r.year}–${latest}` : String(r.year);
}

/** Newest first by release (series: latest episode); undated titles last, ranking kept on ties. */
export function newestFirst<T extends { released_on: string | null }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort(
      (a, b) =>
        (b.item.released_on ?? "").localeCompare(a.item.released_on ?? "") || a.i - b.i,
    )
    .map(({ item }) => item);
}

/** First release year a "last N years" filter allows; null for any time. */
export function releasedSince(years: number | null, today: Date = new Date()): number | null {
  return years ? today.getFullYear() - years : null;
}

/** Shorts are movies of SHORT_MAX_MIN minutes or less. */
export const SHORT_MAX_MIN = 40;
export type FindKind = "movie" | "short" | "tv";

/** What a filter search asks for: Shorts is a movie search with a 40-minute cap, and a shorter
 * "Max length" the family typed still wins. */
export function searchKind(
  kind: FindKind,
  maxLength: number | null,
): { media_type: "movie" | "tv"; max_runtime_min: number | undefined } {
  if (kind === "short") {
    return {
      media_type: "movie",
      max_runtime_min: Math.min(maxLength ?? SHORT_MAX_MIN, SHORT_MAX_MIN),
    };
  }
  return { media_type: kind, max_runtime_min: maxLength ?? undefined };
}

/** Picking a type sets the slider: Shorts to 40 min, Movies to Any. Series keep their length,
 * since for them it is the episode length. */
export function withKind<F extends { kind: FindKind; runtime: number | null }>(
  f: F,
  kind: FindKind,
): F {
  if (kind === "tv") return { ...f, kind };
  return { ...f, kind, runtime: kind === "short" ? SHORT_MAX_MIN : null };
}

/** Moving the slider sets the type: 40 min or less is a short, anything longer a movie. */
export function withLength<F extends { kind: FindKind; runtime: number | null }>(
  f: F,
  runtime: number | null,
): F {
  if (f.kind === "tv") return { ...f, runtime };
  const short = runtime !== null && runtime <= SHORT_MAX_MIN;
  return { ...f, runtime, kind: short ? "short" : "movie" };
}

/** Max length slider stops in minutes; null is "Any" (the default, last stop). */
export const LENGTH_STOPS: (number | null)[] = [10, 30, 40, 60, 120, null];
/** Min IMDb score slider stops. The first is the default and adds no minimum, so titles without
 * an IMDb score (common for shorts and specials) still show. */
export const SCORE_STOPS = [4, 6, 7, 8, 9];

/** The stop closest to a saved value (profiles saved before the sliders hold any number);
 * null stays null, the "Any" end. On a tie the stricter stop wins: the lower one for a length
 * limit, the higher one for a minimum score. */
export function nearestStop(
  stops: (number | null)[],
  value: number | null,
  stricter: "lower" | "higher" = "lower",
): number | null {
  if (value === null) return null;
  let best: number | null = null;
  for (const s of stops) {
    if (s === null) continue;
    const d = Math.abs(s - value);
    const bestD = best === null ? Infinity : Math.abs(best - value);
    const tieWins = d === bestD && best !== null && (stricter === "higher" ? s > best : s < best);
    if (d < bestD || tieWins) best = s;
  }
  return best;
}

/** Score slider ticks: the first stop reads "Any" (the server still drops anything IMDb scores
 * below 4, see ranking.IMDB_FLOOR). */
export const scoreTick = (stop: number) => (stop === SCORE_STOPS[0] ? t.finder.any : String(stop));

/** "10 min", "1h", "2h", "Any". */
export function lengthLabel(min: number | null): string {
  if (min === null) return t.finder.any;
  return min >= 60 && min % 60 === 0 ? `${min / 60}h` : fmt(t.card.minutes, { n: min });
}

/** Max length slider ticks: "Any", "10", "30", "1h". */
export const lengthTick = (min: number | null) =>
  min === null ? t.finder.any : min >= 60 ? `${min / 60}h` : String(min);

export function seenLast<T>(items: T[], isSeen: (item: T) => boolean): T[] {
  return [...items.filter((i) => !isSeen(i)), ...items.filter(isSeen)];
}
