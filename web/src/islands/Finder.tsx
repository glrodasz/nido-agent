import { useRef, useState } from "preact/hooks";
import { api } from "../logic/api";
import { GENRES } from "../logic/format";
import type { AppConfig, MediaType, Profile, SearchResult, TitleResult } from "../logic/types";
import TitleCard from "./TitleCard";

interface Props {
  config: AppConfig;
  profile: Profile;
  savedKeys: Set<string>;
  onToggleSave: (result: TitleResult) => void;
}

interface Turn {
  role: "you" | "nido";
  text: string;
}

const EXAMPLES = [
  "Something funny for tonight, under 100 minutes",
  "An adventure series we can watch over a few weekends",
  "A feel-good animated movie the adults will enjoy too",
];

export default function Finder({ config, profile, savedKeys, onToggleSave }: Props) {
  const [mediaType, setMediaType] = useState<MediaType>("movie");
  const [genres, setGenres] = useState<string[]>([]);
  const [runtime, setRuntime] = useState("");
  const [minImdb, setMinImdb] = useState("");
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

  async function search(e?: Event) {
    e?.preventDefault();
    const found = await run("search", () =>
      api.search({
        media_type: mediaType,
        genres: genres.length ? genres : undefined,
        max_runtime_min: runtime ? Number(runtime) : undefined,
        min_imdb_rating: minImdb ? Number(minImdb) : undefined,
      }),
    );
    if (found) setResults(found);
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
    setGenres(genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g]);
  const multiRegion = (results?.regions.length ?? 0) > 1;
  const nearMisses = results?.near_misses ?? [];

  return (
    <div class="finder">
      {config.chat_enabled && (
        <section class="panel chat" aria-label="Ask Nido">
          {turns.length === 0 ? (
            <div class="examples">
              <p class="muted">Ask in your own words. Nido already knows your family profile.</p>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" class="chip-btn" onClick={(e) => chat(e, ex)}>
                  {ex}
                </button>
              ))}
            </div>
          ) : (
            <ol class="turns" aria-live="polite">
              {turns.map((t, i) => (
                <li key={i} class={`turn turn-${t.role}`}>
                  <span class="who">{t.role === "you" ? "You" : "Nido"}</span>
                  <p>{t.text}</p>
                </li>
              ))}
              {busy === "chat" && (
                <li class="turn turn-nido">
                  <span class="who">Nido</span>
                  <p class="muted">Looking through your services…</p>
                </li>
              )}
            </ol>
          )}
          <form class="ask" onSubmit={(e) => chat(e)}>
            <input
              value={message}
              onInput={(e) => setMessage(e.currentTarget.value)}
              placeholder="What do you feel like watching?"
              maxLength={2000}
              aria-label="Message"
            />
            <button class="btn btn-primary" type="submit" disabled={busy !== null || !message.trim()}>
              Ask
            </button>
          </form>
        </section>
      )}

      <form class="panel filters" onSubmit={search} aria-label="Filters">
        <div class="segmented" role="group" aria-label="Type">
          {(["movie", "tv"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={mediaType === t}
              class={mediaType === t ? "active" : ""}
              onClick={() => setMediaType(t)}
            >
              {t === "movie" ? "Movies" : "Series"}
            </button>
          ))}
        </div>
        <div class="chips">
          {GENRES.map((g) => (
            <label key={g} class="chip">
              <input type="checkbox" checked={genres.includes(g)} onChange={() => toggleGenre(g)} />
              {g}
            </label>
          ))}
        </div>
        <div class="row">
          <label class="field">
            <span>Max minutes</span>
            <input
              type="number"
              min={1}
              value={runtime}
              placeholder={profile.max_runtime_min?.toString() ?? "Any"}
              onInput={(e) => setRuntime(e.currentTarget.value)}
            />
          </label>
          <label class="field">
            <span>Min IMDb</span>
            <input
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={minImdb}
              placeholder={profile.min_imdb_rating?.toString() ?? "Any"}
              onInput={(e) => setMinImdb(e.currentTarget.value)}
            />
          </label>
          <button class="btn" type="submit" disabled={busy !== null}>
            {busy === "search" ? "Searching…" : "Show picks"}
          </button>
        </div>
      </form>

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}

      {results && (
        <section class="results" aria-label="Shortlist">
          {results.results.length === 0 && (
            <p class="panel muted">
              {nearMisses.length > 0
                ? "Nothing fits your family profile. These are the closest, with what each one misses."
                : "Nothing passed the filters. Try fewer genres, a longer runtime or another type."}
            </p>
          )}
          {(results.results.length > 0 ? results.results : nearMisses).map((r) => (
            <TitleCard
              key={`${r.media_type}:${r.tmdb_id}`}
              result={r}
              services={profile.services}
              showRegion={multiRegion}
              saved={savedKeys.has(`${r.media_type}:${r.tmdb_id}`)}
              onToggleSave={onToggleSave}
            />
          ))}
          <p class="attribution muted">{config.attribution}</p>
        </section>
      )}
    </div>
  );
}
