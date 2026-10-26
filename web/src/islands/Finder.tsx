import { useRef, useState } from "preact/hooks";
import { api } from "../logic/api";
import { familyLine, GENRES } from "../logic/format";
import type {
  AppConfig,
  MarkChange,
  MediaType,
  Profile,
  SearchResult,
  TitleMark,
  TitleResult,
} from "../logic/types";
import Icon from "./Icon";
import Markdown from "./Markdown";
import TitleCard from "./TitleCard";

interface Props {
  config: AppConfig;
  profile: Profile;
  savedKeys: Set<string>;
  onToggleSave: (result: TitleResult) => void;
  marks: Map<string, TitleMark>;
  onMark: (result: TitleResult, change: MarkChange) => Promise<void>;
}

interface Turn {
  role: "you" | "nido";
  text: string;
}

interface Filters {
  mediaType: MediaType;
  genres: string[];
  runtime: string;
  minImdb: string;
}

// One-tap shortcuts into the filters below; each runs the filter search straight away.
const QUICK: { label: string; on: (f: Filters) => boolean; toggle: (f: Filters) => Filters }[] = [
  {
    label: "Under 90 min",
    on: (f) => f.runtime === "90",
    toggle: (f) => ({ ...f, runtime: f.runtime === "90" ? "" : "90" }),
  },
  {
    label: "Well rated",
    on: (f) => f.minImdb === "7",
    toggle: (f) => ({ ...f, minImdb: f.minImdb === "7" ? "" : "7" }),
  },
  {
    label: "Animated",
    on: (f) => f.genres.includes("Animation"),
    toggle: (f) => ({
      ...f,
      genres: f.genres.includes("Animation")
        ? f.genres.filter((g) => g !== "Animation")
        : [...f.genres, "Animation"],
    }),
  },
  {
    label: "Series",
    on: (f) => f.mediaType === "tv",
    toggle: (f) => ({ ...f, mediaType: f.mediaType === "tv" ? "movie" : "tv" }),
  },
];

export default function Finder({
  config,
  profile,
  savedKeys,
  onToggleSave,
  marks,
  onMark,
}: Props) {
  const [filters, setFilters] = useState<Filters>({
    mediaType: "movie",
    genres: [],
    runtime: "",
    minImdb: "",
  });
  const { mediaType, genres, runtime, minImdb } = filters;
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState<"search" | "chat" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<string | null>(null);

  async function run<T>(kind: "search" | "chat", work: () => Promise<T>): Promise<T | undefined> {
    setBusy(kind);
    setError(null);
    try {
      return await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function search(e?: Event, f: Filters = filters) {
    e?.preventDefault();
    const found = await run("search", () =>
      api.search({
        media_type: f.mediaType,
        genres: f.genres.length ? f.genres : undefined,
        max_runtime_min: f.runtime ? Number(f.runtime) : undefined,
        min_imdb_rating: f.minImdb ? Number(f.minImdb) : undefined,
      }),
    );
    if (found) setResults(found);
  }

  function quick(toggle: (f: Filters) => Filters) {
    const next = toggle(filters);
    setFilters(next);
    search(undefined, next);
  }

  async function chat(e: Event, text = message) {
    e.preventDefault();
    const ask = text.trim();
    if (!ask) return;
    setTurns((t) => [...t, { role: "you", text: ask }]);
    setMessage("");
    const reply = await run("chat", () => api.chat(ask, session.current));
    if (!reply) return;
    session.current = reply.session_id;
    const text2 = [reply.reply, reply.note].filter(Boolean).join("\n\n");
    if (text2) setTurns((t) => [...t, { role: "nido", text: text2 }]);
    if (reply.results) setResults(reply.results);
  }

  const toggleGenre = (g: string) =>
    set({ genres: genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g] });
  const serviceNames = Object.fromEntries(config.services.map((s) => [s.key, s.name]));
  const multiRegion = (results?.regions.length ?? 0) > 1;
  const nearMisses = results?.near_misses ?? [];

  const picks = results ? (results.results.length > 0 ? results.results : nearMisses) : [];

  return (
    <div class="finder">
      <section class="ask-panel" aria-label={config.chat_enabled ? "Ask Nido" : "Find"}>
        <div>
          <h1 class="ask-title">What shall we watch tonight?</h1>
          <p class="ask-for muted">{familyLine(profile, serviceNames)}</p>
        </div>
        {config.chat_enabled && (
          <form class="ask" onSubmit={(e) => chat(e)}>
            <Icon name="search" />
            <input
              value={message}
              onInput={(e) => setMessage(e.currentTarget.value)}
              placeholder={
                turns.length ? "Ask a follow-up…" : "Something cosy we can all watch, under 2 hours"
              }
              maxLength={2000}
              aria-label="Message"
            />
            <button class="btn btn-primary" type="submit" disabled={busy !== null || !message.trim()}>
              Ask Nido
            </button>
          </form>
        )}
        <div class="quick" role="group" aria-label="Quick filters">
          {QUICK.map((q) => (
            <button
              key={q.label}
              type="button"
              class={q.on(filters) ? "chip-btn chip-on" : "chip-btn"}
              aria-pressed={q.on(filters)}
              disabled={busy !== null}
              onClick={() => quick(q.toggle)}
            >
              {q.label}
            </button>
          ))}
        </div>
        {turns.length > 0 && (
          <ol class="turns" aria-live="polite">
            {turns.map((t, i) => (
              <li key={i} class={`turn turn-${t.role}`}>
                <span class="sr-only">{t.role === "you" ? "You:" : "Nido:"}</span>
                {t.role === "you" ? (
                  <p>{t.text}</p>
                ) : (
                  <>
                    <span class="turn-who" aria-hidden="true">
                      Nido
                    </span>
                    <Markdown text={t.text} />
                  </>
                )}
              </li>
            ))}
            {busy === "chat" && (
              <li class="turn turn-nido">
                <p class="muted">Looking through your services…</p>
              </li>
            )}
          </ol>
        )}
      </section>

      <details class="more-filters" open={!config.chat_enabled}>
        <summary>
          <Icon name="chevron-down" />
          More filters
        </summary>
        <form class="filters" onSubmit={search} aria-label="Filters">
          <div class="filters-row">
            <div class="segmented segmented-small" role="group" aria-label="Type">
              {(["movie", "tv"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={mediaType === t}
                  class={mediaType === t ? "active" : ""}
                  onClick={() => set({ mediaType: t })}
                >
                  {t === "movie" ? "Movies" : "Series"}
                </button>
              ))}
            </div>
            <label class="inline-field">
              <span>Max length (min)</span>
              <input
                type="number"
                min={1}
                value={runtime}
                placeholder={profile.max_runtime_min?.toString() ?? "Any"}
                onInput={(e) => set({ runtime: e.currentTarget.value })}
              />
            </label>
            <label class="inline-field">
              <span>Min IMDb score</span>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={minImdb}
                placeholder={profile.min_imdb_rating?.toString() ?? "Any"}
                onInput={(e) => set({ minImdb: e.currentTarget.value })}
              />
            </label>
          </div>
          <div class="chips chips-small">
            {GENRES.map((g) => (
              <label key={g} class="chip">
                <input type="checkbox" checked={genres.includes(g)} onChange={() => toggleGenre(g)} />
                {g}
              </label>
            ))}
          </div>
          <div>
            <button class="btn btn-small" type="submit" disabled={busy !== null}>
              {busy === "search" ? "Searching…" : "Show picks"}
            </button>
          </div>
        </form>
      </details>

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}

      {results && (
        <section class="results" aria-labelledby="picks-title">
          <header class="results-head">
            <h2 id="picks-title">
              {results.results.length > 0 ? "Picks for your family" : "Closest picks"}
            </h2>
            {picks.length > 0 && (
              <span class="muted">
                {picks.length} {picks.length === 1 ? "title" : "titles"}
              </span>
            )}
          </header>
          {results.results.length === 0 && (
            <p class="notice">
              {nearMisses.length > 0
                ? "Nothing fits every rule in your profile, so these are the closest. Each one says what it misses."
                : "Nothing passed the filters. Try fewer genres, a longer runtime or another type."}
            </p>
          )}
          {picks.map((r) => (
            <TitleCard
              key={`${r.media_type}:${r.tmdb_id}`}
              result={r}
              services={profile.services}
              showRegion={multiRegion}
              saved={savedKeys.has(`${r.media_type}:${r.tmdb_id}`)}
              onToggleSave={onToggleSave}
              mark={marks.get(`${r.media_type}:${r.tmdb_id}`) ?? null}
              youngest={Math.min(...profile.children_ages)}
              onMark={(change) => onMark(r, change)}
            />
          ))}
          <p class="attribution muted">{config.attribution}</p>
        </section>
      )}
    </div>
  );
}
