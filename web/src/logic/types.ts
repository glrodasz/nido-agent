// Shapes returned by the Python API (src/nido/server.py, agent/tools.py `_present`).

export type MediaType = "movie" | "tv";
export type Access = "subscription" | "ads" | "rent" | "buy" | "addon";

export interface Profile {
  children_ages: number[];
  regions: string[];
  services: string[];
  preferred_genres: string[];
  avoid_categories: string[];
  max_runtime_min: number | null;
  min_imdb_rating: number | null;
}

export interface Offer {
  region: string;
  provider: string;
  service: string | null;
  access: Access;
  link: string | null;
  source: string;
  verified_at: string;
}

export interface Classification {
  value: string;
  issuer: string;
  country: string;
  source: string;
}

export interface TitleResult {
  title: string;
  media_type: MediaType;
  tmdb_id: number;
  imdb_id: string | null;
  year: number | null;
  runtime_min: number | null;
  genres: string[];
  synopsis: string;
  poster_url: string | null;
  imdb: {
    score: number;
    votes: number | null;
    source: string;
    url: string | null;
    retrieved_at: string;
  } | null;
  age_baseline: string | null;
  // The baseline's age alone, to default an age-range ban.
  age_baseline_min: number | null;
  official_classifications: Classification[];
  where_to_watch: Offer[];
  included_in_subscriptions: boolean;
  why: string[];
  cautions: string[];
  // Family profile rules a near miss breaks; empty for real results.
  misses: string[];
  // The family's own marks on this title, attached by the server; null when unmarked.
  mark?: TitleMark | null;
}

export interface SearchResult {
  regions: string[];
  results: TitleResult[];
  // The closest titles that break the profile, sent only when results is empty.
  near_misses?: TitleResult[];
  attribution: string;
}

export interface ChatReply {
  session_id: string;
  reply: string;
  results: SearchResult | null;
  note: string | null;
}

export interface WatchlistItem {
  title: { media_type: MediaType; tmdb_id: number };
  name: string;
  year: number | null;
  poster_url: string | null;
  watched: boolean;
  added_at: string;
}

export interface Ban {
  // "age": hidden until the youngest child turns until_age; "always": for every age.
  scope: "age" | "always";
  until_age: number | null;
  at: string;
}

export interface TitleMark {
  key: string;
  title: { media_type: MediaType; tmdb_id: number };
  name: string;
  year: number | null;
  poster_url: string | null;
  seen: boolean;
  liked_adults: boolean;
  liked_child: boolean;
  // The kids love to watch it again and again.
  rewatch: boolean;
  ban: Ban | null;
  // False for a lifted age ban: kept so the family can still review it.
  ban_active: boolean;
  updated_at: string;
}

export interface BanRequest {
  scope: "age" | "always";
  until_age?: number;
  baseline_age?: number | null;
}

/** Only the fields sent change; `ban: null` lifts a ban. */
export interface MarkChange {
  seen?: boolean;
  liked_adults?: boolean;
  liked_child?: boolean;
  rewatch?: boolean;
  ban?: BanRequest | null;
}

export interface AppConfig {
  services: { key: string; name: string }[];
  categories: string[];
  default_regions: string[];
  chat_enabled: boolean;
  auth: "firebase" | "none";
  attribution: string;
}
