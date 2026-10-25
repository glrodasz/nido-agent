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
  official_classifications: Classification[];
  where_to_watch: Offer[];
  included_in_subscriptions: boolean;
  why: string[];
  cautions: string[];
}

export interface SearchResult {
  regions: string[];
  results: TitleResult[];
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

export interface AppConfig {
  services: { key: string; name: string }[];
  categories: string[];
  default_regions: string[];
  chat_enabled: boolean;
  auth: "firebase" | "none";
  attribution: string;
}
