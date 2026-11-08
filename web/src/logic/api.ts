import { locale, t } from "../i18n";
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

// Firebase Hosting gives up on the server after 60 s; the server stops a chat turn at 50 s.
// Past this the page stops waiting too, so a lost answer never leaves Ask Nido stuck.
export const CHAT_TIMEOUT_MS = 65_000;

async function call<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  // The page's language: Ask Nido answers in it and the server writes card reasons in it.
  const headers: Record<string, string> = { Accept: "application/json", "X-Nido-Locale": locale };
  const token = await idToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const abort = new AbortController();
  const timer = timeoutMs ? setTimeout(() => abort.abort(), timeoutMs) : undefined;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    });
  } catch {
    // No answer at all: the page gave up waiting, or the phone lost its connection.
    throw new ApiError(0, abort.signal.aborted ? t.app.tooSlow : t.app.offline);
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // The server explains its own errors; a bare page from the hosting in front of it does not.
    if (typeof data.detail === "string") throw new ApiError(response.status, data.detail);
    throw new ApiError(response.status, response.status === 504 ? t.app.tooSlow : t.app.somethingWrong);
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
    call<ChatReply>("POST", "/chat", { message, session_id: sessionId, watching }, CHAT_TIMEOUT_MS),
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
