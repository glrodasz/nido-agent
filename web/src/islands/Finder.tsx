import { useMemo, useRef, useState } from "preact/hooks";
import { api } from "../logic/api";
import { familyLine, GENRES, newestFirst, plural, releasedSince, seenLast } from "../logic/format";
import type {
  AppConfig,
  MarkChange,
  MediaType,
  Profile,
  SearchResult,
  TitleMark,
  TitleResult,
} from "../logic/types";
import { Fragment } from "preact";
import Icon from "./Icon";
import Markdown from "./Markdown";
import Spinner from "./Spinner";
import TitleCard from "./TitleCard";

interface Props {
  config: AppConfig;
  profile: Profile;
  savedKeys: Set<string>;
  onToggleSave: (result: TitleResult) => Promise<void>;
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
  // "Last N years" as a string for the select; "" is any time.
  since: string;
}

// Below these, the ask panel says how much of today's quota the family has left.
const LOW_QUOTA = { chat: 5, search: 10 };

// Families want what is new: the filters start at five years back. A series counts while it
// still airs, so Bluey stays in even though it started in 2018.
const DEFAULT_SINCE = "5";
const SINCE_OPTIONS: { value: string; label: string }[] = [
  { value: "2", label: "Last 2 years" },
  { value: "5", label: "Last 5 years" },
  { value: "10", label: "Last 10 years" },
  { value: "20", label: "Last 20 years" },
  { value: "", label: "Any time" },
];

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

// Seen titles sink to the end unless the family turned that off; remembered in this browser only.
const SEEN_LAST_KEY = "nido-seen-last";
// "newest" (default) or "rated": Nido's best-match ranking. Remembered in this browser only.
const ORDER_KEY = "nido-order";
type Order = "newest" | "rated";

function loadOrder(): Order {
  try {
    return localStorage.getItem(ORDER_KEY) === "rated" ? "rated" : "newest";
  } catch {
    return "newest";
  }
}

function loadSeenLast(): boolean {
  try {
    return localStorage.getItem(SEEN_LAST_KEY) !== "off";
  } catch {
    return true;
  }
}

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
    since: DEFAULT_SINCE,
  });
  const { mediaType, genres, runtime, minImdb, since } = filters;
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [results, setResults] = useState<SearchResult | null>(null);
  // The question the cards answer when they came from Ask Nido; null for the filters.
  const [answering, setAnswering] = useState<string | null>(null);
  const [busy, setBusy] = useState<"search" | "chat" | null>(null);
  // The quick filter whose search is running, so that chip is the one that spins.
  const [quickBusy, setQuickBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What the family has left of today's quotas, as the last answers reported it.
  const [left, setLeft] = useState<{ chat?: number; search?: number }>({});
  const session = useRef<string | null>(null);
  const [sinkSeen, setSinkSeen] = useState(loadSeenLast);
  const [order, setOrder] = useState<Order>(loadOrder);

  function chooseOrder(next: Order) {
    setOrder(next);
    try {
      localStorage.setItem(ORDER_KEY, next);
    } catch {
      // Private windows can refuse storage; the order still changes for this visit.
    }
  }

  function toggleSinkSeen() {
    const next = !sinkSeen;
    setSinkSeen(next);
    try {
      localStorage.setItem(SEEN_LAST_KEY, next ? "on" : "off");
    } catch {
      // Private windows can refuse storage; the order still changes for this visit.
    }
  }

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
        released_since: releasedSince(f.since ? Number(f.since) : null),
      }),
    );
    if (found) {
      setLeft((l) => ({ ...l, search: found.quota_left }));
      setResults(found);
      setAnswering(null);
    }
  }

  async function quick(label: string, toggle: (f: Filters) => Filters) {
    const next = toggle(filters);
    setFilters(next);
    setQuickBusy(label);
    try {
      await search(undefined, next);
    } finally {
      setQuickBusy(null);
    }
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
    setLeft((l) => ({ ...l, chat: reply.quota_left }));
    const text2 = [reply.reply, reply.note].filter(Boolean).join("\n\n");
    if (text2) setTurns((t) => [...t, { role: "nido", text: text2 }]);
    if (reply.results) {
      setResults(reply.results);
      setAnswering(ask);
    }
  }

  const toggleGenre = (g: string) =>
    set({ genres: genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g] });
  const serviceNames = Object.fromEntries(config.services.map((s) => [s.key, s.name]));
  const multiRegion = (results?.regions.length ?? 0) > 1;
  const nearMisses = results?.near_misses ?? [];

  const ranked = results ? (results.results.length > 0 ? results.results : nearMisses) : [];
  const isSeen = (r: TitleResult) => marks.get(`${r.media_type}:${r.tmdb_id}`)?.seen ?? false;
  // Ordered when results arrive or the toggle flips, not on every mark: a card the family just
  // marked as seen stays put instead of jumping away under their finger.
  const { picks, sunk } = useMemo(() => {
    const sorted = order === "newest" ? newestFirst(ranked) : ranked;
    const ordered = sinkSeen ? seenLast(sorted, isSeen) : sorted;
    return { picks: ordered, sunk: sinkSeen ? ranked.filter(isSeen).length : 0 };
  }, [results, sinkSeen, order]);
  const anySeen = picks.some(isSeen);
  const firstSunk = picks.length - sunk;
  const quotaNote = [
    left.chat !== undefined && left.chat <= LOW_QUOTA.chat && plural(left.chat, "Ask Nido question"),
    left.search !== undefined && left.search <= LOW_QUOTA.search && plural(left.search, "search"),
  ].filter(Boolean);

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
            <button
              class="btn btn-primary"
              type="submit"
              disabled={busy !== null || !message.trim()}
            >
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
              aria-busy={quickBusy === q.label}
              onClick={() => quick(q.label, q.toggle)}
            >
              {quickBusy === q.label && <Spinner />}
              {q.label}
            </button>
          ))}
        </div>
        {quotaNote.length > 0 && (
          <p class="quota-note muted">{quotaNote.join(" and ")} left today for your family.</p>
        )}
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
                <p class="loading loading-inline">
                  <Spinner />
                  Looking through your services…
                </p>
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
          <div class="filters-grid">
            <div class="filter-field">
              <span class="filter-label" id="filter-type">
                Type
              </span>
              <div class="segmented segmented-small" role="group" aria-labelledby="filter-type">
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
            </div>
            <label class="filter-field">
              <span class="filter-label">Released</span>
              <select value={since} onChange={(e) => set({ since: e.currentTarget.value })}>
                {SINCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label class="filter-field">
              <span class="filter-label">Max length</span>
              <span class="filter-unit">
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={runtime}
                  placeholder={profile.max_runtime_min?.toString() ?? "Any"}
                  onInput={(e) => set({ runtime: e.currentTarget.value })}
                />
                <span aria-hidden="true">min</span>
              </span>
            </label>
            <label class="filter-field">
              <span class="filter-label">Min IMDb score</span>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                inputMode="decimal"
                value={minImdb}
                placeholder={profile.min_imdb_rating?.toString() ?? "Any"}
                onInput={(e) => set({ minImdb: e.currentTarget.value })}
              />
            </label>
          </div>
          <fieldset class="filter-field filter-genres">
            <legend class="filter-label">Genres</legend>
            <div class="chips chips-small">
              {GENRES.map((g) => (
                <label key={g} class="chip">
                  <input type="checkbox" checked={genres.includes(g)} onChange={() => toggleGenre(g)} />
                  {g}
                </label>
              ))}
            </div>
          </fieldset>
          <div class="filters-actions">
            <button
              class="btn btn-primary"
              type="submit"
              disabled={busy !== null}
              aria-busy={busy === "search" && quickBusy === null}
            >
              {busy === "search" && quickBusy === null ? (
                <>
                  <Spinner />
                  Searching…
                </>
              ) : (
                "Show picks"
              )}
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
        <section class="results" aria-labelledby="picks-title" aria-busy={busy !== null}>
          <header class="results-head">
            <h2 id="picks-title">
              {results.results.length > 0 ? "Picks for your family" : "Closest picks"}
            </h2>
            <div class="results-tools">
              {picks.length > 1 && (
                <div class="segmented segmented-small" role="group" aria-label="Order">
                  {(["newest", "rated"] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={order === o}
                      class={order === o ? "active" : ""}
                      onClick={() => chooseOrder(o)}
                    >
                      {o === "newest" ? "Newest" : "Best match"}
                    </button>
                  ))}
                </div>
              )}
              {(anySeen || sunk > 0) && (
                <button
                  type="button"
                  class={sinkSeen ? "chip-btn chip-on" : "chip-btn"}
                  aria-pressed={sinkSeen}
                  onClick={toggleSinkSeen}
                >
                  <Icon name="eye" />
                  Seen last
                </button>
              )}
              {picks.length > 0 && (
                <span class="muted">
                  {picks.length} {picks.length === 1 ? "title" : "titles"}
                </span>
              )}
            </div>
          </header>
          {answering && (
            <p class="results-for muted">
              <Icon name="search" />
              Answering “{answering}”
            </p>
          )}
          {results.results.length === 0 && (
            <p class="notice">
              {nearMisses.length > 0
                ? "Nothing fits every rule in your profile, so these are the closest. Each one says what it misses."
                : "Nothing passed the filters. Try fewer genres, a longer runtime or another type."}
            </p>
          )}
          {picks.map((r, i) => (
            <Fragment key={`${r.media_type}:${r.tmdb_id}`}>
              {sunk > 0 && i === firstSunk && (
                <p class="eyebrow seen-divider">Already seen · {sunk}</p>
              )}
              <TitleCard
                result={r}
                services={profile.services}
                showRegion={multiRegion}
                saved={savedKeys.has(`${r.media_type}:${r.tmdb_id}`)}
                onToggleSave={onToggleSave}
                mark={marks.get(`${r.media_type}:${r.tmdb_id}`) ?? null}
                youngest={Math.min(...profile.children_ages)}
                onMark={(change) => onMark(r, change)}
              />
            </Fragment>
          ))}
          <p class="attribution muted">{config.attribution}</p>
        </section>
      )}
    </div>
  );
}
