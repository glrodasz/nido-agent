import { idToken } from "./auth";
import type {
  AppConfig,
  ChatReply,
  MediaType,
  Profile,
  SearchResult,
  TitleResult,
  WatchlistItem,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await idToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : response.statusText;
    throw new ApiError(response.status, detail || "request failed");
  }
  return data as T;
}

export interface SearchFilters {
  media_type: MediaType;
  genres?: string[];
  max_runtime_min?: number | null;
  min_imdb_rating?: number | null;
  avoid?: string[];
}

export const api = {
  config: () => call<AppConfig>("GET", "/config"),
  profile: () => call<{ profile: Profile | null }>("GET", "/profile").then((r) => r.profile),
  saveProfile: (profile: Profile) =>
    call<{ profile: Profile }>("PUT", "/profile", profile).then((r) => r.profile),
  search: (filters: SearchFilters) => call<SearchResult>("POST", "/search", filters),
  chat: (message: string, sessionId: string | null) =>
    call<ChatReply>("POST", "/chat", { message, session_id: sessionId }),
  watchlist: () => call<{ items: WatchlistItem[] }>("GET", "/watchlist").then((r) => r.items),
  save: (t: Pick<TitleResult, "media_type" | "tmdb_id" | "title" | "year" | "poster_url">, watched = false) =>
    call<{ item: WatchlistItem }>("PUT", `/watchlist/${t.media_type}/${t.tmdb_id}`, {
      name: t.title,
      year: t.year,
      poster_url: t.poster_url,
      watched,
    }).then((r) => r.item),
  unsave: (mediaType: MediaType, tmdbId: number) =>
    call<{ ok: boolean }>("DELETE", `/watchlist/${mediaType}/${tmdbId}`),
};
