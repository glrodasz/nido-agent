import type { Access, Ban, Offer, Profile } from "./types";

const DAY_MS = 86_400_000;

/** "today", "1 day ago", "12 days ago": how fresh a sourced value is. */
export function verifiedAgo(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
  if (!Number.isFinite(days) || days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

const ACCESS_LABEL: Record<Access, string> = {
  subscription: "Included",
  ads: "Included with ads",
  addon: "Add-on channel",
  rent: "Rent",
  buy: "Buy",
};

export function accessLabel(access: Access): string {
  return ACCESS_LABEL[access] ?? access;
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

const CATEGORY_LABEL: Record<string, string> = {
  violence: "Violence",
  frightening: "Scary scenes",
  language: "Language",
  sex_nudity: "Sex and nudity",
  romance: "Romance",
  substances: "Drinking, drugs, smoking",
  bullying_discrimination: "Bullying and discrimination",
  death_grief: "Death and grief",
  imitable_behavior: "Imitable behavior",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category.replaceAll("_", " ");
}

export function formatVotes(votes: number | null): string {
  if (votes === null) return "";
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M votes`;
  if (votes >= 1_000) return `${Math.round(votes / 1_000)}k votes`;
  return `${votes} votes`;
}

/** "6, 9" -> [6, 9]; null when any entry is not an age from 0 to 17. */
export function parseAges(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const ages = parts.map(Number);
  return ages.every((a) => Number.isInteger(a) && a >= 0 && a <= 17) ? ages : null;
}

/** "se, no" -> ["SE", "NO"]; null when any entry is not a two-letter code. */
export function parseRegions(text: string): string[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean).map((r) => r.toUpperCase());
  if (parts.length === 0) return null;
  return parts.every((r) => /^[A-Z]{2}$/.test(r)) ? [...new Set(parts)] : null;
}

export const EMPTY_PROFILE: Profile = {
  children_ages: [],
  regions: ["SE"],
  services: [],
  preferred_genres: [],
  avoid_categories: [],
  max_runtime_min: null,
  min_imdb_rating: null,
};

// TMDB genre names the filters offer (discover uses TMDB's own names).
export const GENRES = [
  "Adventure",
  "Animation",
  "Comedy",
  "Drama",
  "Family",
  "Fantasy",
  "Mystery",
  "Science Fiction",
  "Documentary",
  "Music",
];

// Where an age range starts: 0-6, 7-9, 10-12, 13-15, 16-17 (server.AGE_RANGE_STARTS). Profiles
// stop at 17, so an age ban lifts at 17 at the latest.
const AGE_RANGE_STARTS = [7, 10, 13, 16];
export const MAX_CHILD_AGE = 17;

/** Default age at which an age-range ban lifts: the title's baseline when it is above the
 * youngest child, else the start of the next age range. Mirrors server.default_ban_until. */
export function defaultBanUntil(youngest: number, baselineAge: number | null): number {
  if (baselineAge !== null && baselineAge > youngest) return Math.min(baselineAge, MAX_CHILD_AGE);
  return AGE_RANGE_STARTS.find((a) => a > youngest) ?? MAX_CHILD_AGE;
}

export function banLabel(ban: Ban, active: boolean): string {
  if (ban.scope === "always") return "Hidden at every age";
  return active ? `Hidden until your youngest is ${ban.until_age}` : `Was hidden until ${ban.until_age}: back in results`;
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
  if (misses.length === 0) return { level: "fit", label: "Good for all of you" };
  if (baselineAge !== null && baselineAge > youngest) {
    return baselineAge - youngest <= GROWN_UP_GAP
      ? { level: "grown-up", label: "Best with a grown-up" }
      : { level: "later", label: "For after bedtime" };
  }
  return { level: "settings", label: "Outside your settings" };
}

function joinAnd(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "For your 4-year-old · on Netflix and Disney+": who and where the picks are for. */
export function familyLine(profile: Profile, serviceNames: Record<string, string>): string {
  const ages = [...profile.children_ages].sort((a, b) => a - b);
  const who =
    ages.length === 0
      ? "For your family"
      : ages.length === 1
        ? `For your ${ages[0]}-year-old`
        : `For your kids aged ${joinAnd(ages.map(String))}`;
  const services = profile.services.map((s) => serviceNames[s] ?? s);
  return services.length ? `${who} · on ${joinAnd(services)}` : who;
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

export function seenLast<T>(items: T[], isSeen: (item: T) => boolean): T[] {
  return [...items.filter((i) => !isSeen(i)), ...items.filter(isSeen)];
}
