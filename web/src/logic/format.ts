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

// Where an age range ends: 0-6, 7-9, 10-12, 13-15, 16-17 (server.AGE_RANGE_STARTS).
const AGE_RANGE_STARTS = [7, 10, 13, 16, 18];

/** Default age at which an age-range ban lifts: the title's baseline when it is above the
 * youngest child, else the start of the next age range. Mirrors server.default_ban_until. */
export function defaultBanUntil(youngest: number, baselineAge: number | null): number {
  if (baselineAge !== null && baselineAge > youngest) return baselineAge;
  return AGE_RANGE_STARTS.find((a) => a > youngest) ?? 18;
}

export function banLabel(ban: Ban, active: boolean): string {
  if (ban.scope === "always") return "Hidden at every age";
  return active ? `Hidden until your youngest is ${ban.until_age}` : `Was hidden until ${ban.until_age}: back in results`;
}
