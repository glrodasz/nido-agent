import { locale } from "../i18n";
import { idToken } from "./auth";
import type {
  AppConfig,
  ChatReply,
  Family,
  MarkChange,
  MediaType,
  Profile,
  SearchResult,
  TitleMark,
  TitleResult,
  WatchlistItem,
} from "./types";

/** What the server needs to name a title in the family's lists. */
export type TitleInfo = Pick<TitleResult, "media_type" | "tmdb_id" | "title" | "year" | "poster_url">;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  // The page's language: Ask Nido answers in it and the server writes card reasons in it.
  const headers: Record<string, string> = { Accept: "application/json", "X-Nido-Locale": locale };
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
  exclude_genres?: string[];
  match_all_genres?: boolean;
  max_runtime_min?: number | null;
  min_imdb_rating?: number | null;
  avoid?: string[];
  released_since?: number | null;
  // Positions in the profile's children; left out = the whole family.
  watching?: number[];
}

export const api = {
  config: () => call<AppConfig>("GET", "/config"),
  profile: () => call<{ profile: Profile | null }>("GET", "/profile").then((r) => r.profile),
  saveProfile: (profile: Profile) =>
    call<{ profile: Profile }>("PUT", "/profile", profile).then((r) => r.profile),
  search: (filters: SearchFilters) => call<SearchResult>("POST", "/search", filters),
  /** Today's picks for the whole family: built once a day on the server, cached after. */
  daily: () => call<SearchResult>("GET", "/daily"),
  chat: (message: string, sessionId: string | null, watching?: number[]) =>
    call<ChatReply>("POST", "/chat", { message, session_id: sessionId, watching }),
  watchlist: () => call<{ items: WatchlistItem[] }>("GET", "/watchlist").then((r) => r.items),
  save: (t: TitleInfo, watched = false) =>
    call<{ item: WatchlistItem }>("PUT", `/watchlist/${t.media_type}/${t.tmdb_id}`, {
      name: t.title,
      year: t.year,
      poster_url: t.poster_url,
      watched,
    }).then((r) => r.item),
  unsave: (mediaType: MediaType, tmdbId: number) =>
    call<{ ok: boolean }>("DELETE", `/watchlist/${mediaType}/${tmdbId}`),
  marks: () => call<{ items: TitleMark[] }>("GET", "/titles").then((r) => r.items),
  /** One saved or marked title as a full result card, judged against the family profile. */
  details: (mediaType: MediaType, tmdbId: number) =>
    call<{ result: TitleResult }>("GET", `/titles/${mediaType}/${tmdbId}`).then((r) => r.result),
  mark: (t: TitleInfo, change: MarkChange) =>
    call<{ item: TitleMark }>("PUT", `/titles/${t.media_type}/${t.tmdb_id}`, {
      name: t.title,
      year: t.year,
      poster_url: t.poster_url,
      ...change,
    }).then((r) => r.item),
  family: () => call<Family>("GET", "/family"),
  createInvite: () => call<{ token: string; expires_at: string }>("POST", "/family/invites"),
  acceptInvite: (token: string) =>
    call<{ family_id: string; joined: boolean }>("POST", `/invites/${encodeURIComponent(token)}`),
  removeMember: (uid: string) =>
    call<{ ok: boolean }>("DELETE", `/family/members/${encodeURIComponent(uid)}`),
};
