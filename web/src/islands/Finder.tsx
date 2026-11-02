import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiError, api } from "../logic/api";
import {
  childLabel,
  familyLine,
  type FindKind,
  genresFor,
  LENGTH_STOPS,
  lengthLabel,
  newestFirst,
  lengthTick,
  releasedSince,
  SCORE_STOPS,
  scoreTick,
  searchKind,
  seenLast,
  watchingAges,
  withKind,
  withLength,
  youngestOf,
} from "../logic/format";
import type {
  AppConfig,
  MarkChange,
  Profile,
  Quota,
  SearchResult,
  TitleMark,
  TitleResult,
} from "../logic/types";
import { Fragment } from "preact";
import { fmt, genreLabel, plural, t } from "../i18n";
import Icon from "./Icon";
import Markdown from "./Markdown";
import Spinner from "./Spinner";
import StopSlider from "./StopSlider";
import TitleCard from "./TitleCard";
import {
  cycleGenre,
  type Filters,
  type GenreState,
  genreState,
  isDefault,
  profileFilters,
  type QuickChip,
  quickChips,
} from "../logic/quick";

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

// Below these, the ask panel says how much of today's quota the family has left.
const LOW_QUOTA = { chat: 5, search: 10 };
const QUOTA_KINDS = ["chat", "search"] as const;
type QuotaKind = (typeof QUOTA_KINDS)[number];

const SINCE_OPTIONS = (): { value: string; label: string }[] => [
  { value: "2", label: t.finder.last2 },
  { value: "5", label: t.finder.last5 },
  { value: "10", label: t.finder.last10 },
  { value: "20", label: t.finder.last20 },
  { value: "", label: t.finder.anyTime },
];

const KINDS = (): { value: FindKind; label: string }[] => [
  { value: "movie", label: t.finder.movies },
  { value: "short", label: t.finder.shorts },
  { value: "tv", label: t.finder.series },
];

// Seen titles sink to the end unless the family turned that off; remembered in this browser only.
const SEEN_LAST_KEY = "nido-seen-last";
// "newest" (default) or "rated": Nido's best-match ranking. Remembered in this browser only.
const ORDER_KEY = "nido-order";
type Order = "newest" | "rated";

// Today's picks this visit already loaded, so going back to Find from another tab does not ask
// again. The server caches them for the day too; this only saves the round trip.
let todayMemo: { key: string; result: SearchResult } | null = null;
const utcDay = () => new Date().toISOString().slice(0, 10);
const todayKey = (profile: Profile) => `${utcDay()}:${JSON.stringify(profile)}`;

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

/** The picked genres that exist for the chosen type: a genre picked for movies stays picked
 * when switching to series, but only filters the type that has it. */
const applicable = (f: Filters, genres: string[] = f.genres) => {
  const offered = genresFor(f.kind === "tv" ? "tv" : "movie");
  return genres.filter((g) => offered.includes(g));
};

const genreStateText = (state: GenreState) =>
  ({ off: t.finder.genreAny, include: t.finder.genreIncluded, exclude: t.finder.genreExcluded })[state];

export default function Finder({
  config,
  profile,
  savedKeys,
  onToggleSave,
  marks,
  onMark,
}: Props) {
  // The profile's default length and score: where the filters start and what Clear goes back to.
  const base = useMemo(() => profileFilters(profile), [profile]);
  const [filters, setFilters] = useState<Filters>(base);
  useEffect(() => setFilters(base), [base]);
  const { kind, runtime, minImdb, since } = filters;
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [results, setResults] = useState<SearchResult | null>(null);
  // The question the cards answer when they came from Ask Nido; null for the filters.
  const [answering, setAnswering] = useState<string | null>(null);
  // True while the cards are today's picks, before the family searched or asked anything.
  const [today, setToday] = useState(false);
  const [todayLoading, setTodayLoading] = useState(false);
  // Set once the family searches or asks, so today's picks arriving late do not replace them.
  const acted = useRef(false);
  const [busy, setBusy] = useState<"search" | "chat" | null>(null);
  // The quick filter whose search is running, so that chip is the one that spins.
  const [quickBusy, setQuickBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The family's use of today's quotas, as the last answers reported it.
  const [quota, setQuota] = useState<{ chat?: Quota; search?: Quota }>({});
  const session = useRef<string | null>(null);
  const [sinkSeen, setSinkSeen] = useState(loadSeenLast);
  // Who is watching: one child by position in the profile, or the whole family (null).
  const [watching, setWatching] = useState<number | null>(null);
  // Whoever the shown cards were judged for: their misses are that viewer's, so the verdict is too.
  const [judgedFor, setJudgedFor] = useState<number | null>(null);
  useEffect(() => {
    setWatching(null);
    setJudgedFor(null);
  }, [profile]);
  const viewerAges = watchingAges(profile, watching);
  const [order, setOrder] = useState<Order>(loadOrder);

  // Find opens on today's picks instead of an empty page; a new profile gets new picks.
  useEffect(() => {
    if (acted.current) return;
    const key = todayKey(profile);
    if (todayMemo?.key === key) {
      showToday(todayMemo.result);
      return;
    }
    let live = true;
    setTodayLoading(true);
    api
      .daily()
      .then((found) => {
        if (found.quota) setQuota((q) => ({ ...q, search: found.quota }));
        todayMemo = { key, result: found };
        if (live && !acted.current) showToday(found);
      })
      .catch((err) => {
        // Out of searches: the tag says so. Anything else leaves Find as it always was.
        if (err instanceof ApiError && err.status === 429) {
          setQuota((q) => ({ ...q, search: { used: q.search?.limit ?? 0, limit: q.search?.limit ?? 0 } }));
        }
      })
      .finally(() => live && setTodayLoading(false));
    return () => {
      live = false;
    };
  }, [profile]);

  function showToday(found: SearchResult) {
    if (found.results.length === 0) return;
    setResults(found);
    setToday(true);
    setJudgedFor(null);
    setAnswering(null);
  }

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
      // Out of today's quota: the tag under the ask box says so, no need for a second message.
      if (err instanceof ApiError && err.status === 429) {
        setQuota((q) => ({ ...q, [kind]: { used: q[kind]?.limit ?? 0, limit: q[kind]?.limit ?? 0 } }));
      }
      else setError(err instanceof Error ? err.message : t.app.somethingWrong);
    } finally {
      setBusy(null);
    }
  }

  async function search(e?: Event, f: Filters = filters, who: number | null = watching) {
    e?.preventDefault();
    const { media_type, max_runtime_min } = searchKind(f.kind, f.runtime);
    const found = await run("search", () =>
      api.search({
        // Both limits are always sent, null for "any", so the sliders win over the profile's
        // defaults they started from.
        media_type,
        max_runtime_min: max_runtime_min ?? null,
        genres: applicable(f).length ? applicable(f) : undefined,
        exclude_genres: applicable(f, f.excludeGenres).length ? applicable(f, f.excludeGenres) : undefined,
        match_all_genres: f.matchAll && applicable(f).length > 1 ? true : undefined,
        min_imdb_rating: f.minImdb > SCORE_STOPS[0] ? f.minImdb : null,
        released_since: releasedSince(f.since ? Number(f.since) : null),
        watching: who === null ? undefined : [who],
      }),
    );
    if (found) {
      acted.current = true;
      setToday(false);
      setQuota((q) => ({ ...q, search: found.quota }));
      setResults(found);
      setJudgedFor(who);
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

  // Back to the defaults. Picks the filters found are redone with them; Ask Nido's cards stay.
  async function clear(control: string) {
    setFilters(base);
    if (!results || answering !== null || today) return;
    setQuickBusy(control);
    try {
      await search(undefined, base);
    } finally {
      setQuickBusy(null);
    }
  }

  // Picks the filters found are redone for whoever watches now; Ask Nido's cards stay, and the
  // next question is for them.
  async function chooseWatching(who: number | null) {
    if (who === watching) return;
    setWatching(who);
    // Today's picks are for the whole family and stay; Ask Nido's cards stay too.
    if (!results || answering !== null || today) return;
    setQuickBusy(`who:${who ?? "all"}`);
    try {
      await search(undefined, filters, who);
    } finally {
      setQuickBusy(null);
    }
  }

  function pressChip(chip: QuickChip) {
    if (chip.kind === "ask") void chat(undefined, chip.question);
    else void quick(chip.id, chip.toggle);
  }

  async function chat(e?: Event, text = message) {
    e?.preventDefault();
    const ask = text.trim();
    if (!ask) return;
    setTurns((t) => [...t, { role: "you", text: ask }]);
    setMessage("");
    const asked = watching;
    const reply = await run("chat", () => api.chat(ask, session.current, asked === null ? undefined : [asked]));
    if (!reply) return;
    session.current = reply.session_id;
    setQuota((q) => ({ ...q, chat: reply.quota }));
    const text2 = [reply.reply, reply.note].filter(Boolean).join("\n\n");
    if (text2) setTurns((t) => [...t, { role: "nido", text: text2 }]);
    if (reply.results) {
      acted.current = true;
      setToday(false);
      setResults(reply.results);
      setJudgedFor(asked);
      setAnswering(ask);
    }
  }

  const chips = useMemo(
    () => quickChips(profile, marks.values(), kind, config.chat_enabled, viewerAges),
    [profile, marks, kind, config.chat_enabled, watching],
  );
  // The lowest stop sends no minimum (unrated shorts stay in), so it reads as "Any".
  const scoreText = minImdb !== SCORE_STOPS[0] ? `${minImdb}+` : t.finder.any;
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
  const left = (k: QuotaKind) => {
    const q = quota[k];
    return q && q.limit !== null ? Math.max(0, q.limit - q.used) : null;
  };
  // Owner families have no limit and always see what they used; the rest only when few are left.
  const shownQuotas = QUOTA_KINDS.filter((k) => {
    const q = quota[k];
    if (!q) return false;
    return q.limit === null ? q.used > 0 : left(k)! <= LOW_QUOTA[k];
  });

  return (
    <div class="finder">
      <section class="ask-panel" aria-label={config.chat_enabled ? t.finder.askLabel : t.finder.findLabel}>
        <div>
          <h1 class="ask-title">{t.finder.title}</h1>
          <p class="ask-for muted">{familyLine(profile, serviceNames, watching)}</p>
        </div>
        {profile.children_ages.length > 1 && (
          <div class="watching">
            <span class="filter-label" id="watching-label">
              {t.finder.watching}
            </span>
            <div class="segmented segmented-small" role="group" aria-labelledby="watching-label">
              {[null, ...profile.children_ages.map((_, i) => i)].map((who) => {
                const id = `who:${who ?? "all"}`;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={watching === who}
                    class={watching === who ? "active" : ""}
                    disabled={busy !== null}
                    aria-busy={quickBusy === id}
                    onClick={() => chooseWatching(who)}
                  >
                    {quickBusy === id && <Spinner />}
                    {who === null ? t.finder.wholeFamily : childLabel(profile, who)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {config.chat_enabled && (
          <form class="ask" onSubmit={(e) => chat(e)}>
            <Icon name="search" />
            <input
              value={message}
              onInput={(e) => setMessage(e.currentTarget.value)}
              placeholder={
                turns.length ? t.finder.followUp : t.finder.placeholder
              }
              maxLength={2000}
              aria-label={t.finder.message}
            />
            <button
              class="btn btn-primary"
              type="submit"
              disabled={busy !== null || !message.trim()}
            >
              {t.finder.ask}
            </button>
          </form>
        )}
        {shownQuotas.length > 0 && (
          <div class="quota-tags" role="status">
            {shownQuotas.map((k) => (
              <span
                key={k}
                class={
                  left(k) === null
                    ? "quota-tag quota-free"
                    : left(k) === 0
                      ? "quota-tag quota-out"
                      : "quota-tag"
                }
              >
                <Icon name={k === "chat" ? "bot" : "search"} />
                {left(k) === null ? (
                  <span>
                    <strong>{fmt(t.quota.usedToday, { count: plural(quota[k]!.used, t.quota[k]) })}</strong>
                  </span>
                ) : left(k) === 0 ? (
                  <span>
                    <strong>{k === "chat" ? t.quota.noneLeftChat : t.quota.noneLeftSearch}</strong> {t.quota.comeBack}
                  </span>
                ) : (
                  <span>
                    <strong>{fmt(t.quota.left, { count: plural(left(k)!, t.quota[k]) })}</strong> {t.quota.leftAfter}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
        <div class="quick" role="group" aria-label={t.finder.quickFilters}>
          {chips.map((c) => {
            const on = c.kind === "filter" && c.on(filters);
            return (
              <button
                key={c.id}
                type="button"
                class={on ? "chip-btn chip-on" : c.kind === "ask" ? "chip-btn chip-ask" : "chip-btn"}
                aria-pressed={c.kind === "filter" ? on : undefined}
                disabled={busy !== null}
                aria-busy={quickBusy === c.id}
                title={c.kind === "ask" ? fmt(t.finder.askChipTitle, { question: c.question }) : undefined}
                onClick={() => pressChip(c)}
              >
                {quickBusy === c.id ? <Spinner /> : c.kind === "ask" && <Icon name={c.icon} />}
                {c.label}
              </button>
            );
          })}
          {/* Stays while its search runs, so the spinner has somewhere to be. */}
          {(!isDefault(filters, base) || quickBusy === "clear") && (
            <button
              type="button"
              class="chip-clear"
              disabled={busy !== null}
              aria-busy={quickBusy === "clear"}
              onClick={() => clear("clear")}
            >
              {quickBusy === "clear" ? <Spinner /> : <Icon name="x" />}
              {t.finder.clearFilters}
            </button>
          )}
        </div>
        {turns.length > 0 && (
          <ol class="turns" aria-live="polite">
            {turns.map((turn, i) => (
              <li key={i} class={`turn turn-${turn.role}`}>
                <span class="sr-only">{turn.role === "you" ? t.finder.you : t.finder.nido}</span>
                {turn.role === "you" ? (
                  <p>{turn.text}</p>
                ) : (
                  <>
                    <span class="turn-who" aria-hidden="true">
                      Nido
                    </span>
                    <Markdown text={turn.text} />
                  </>
                )}
              </li>
            ))}
            {busy === "chat" && (
              <li class="turn turn-nido">
                <p class="loading loading-inline">
                  <Spinner />
                  {t.finder.thinking}
                </p>
              </li>
            )}
          </ol>
        )}
      </section>

      <details class="more-filters" open={!config.chat_enabled}>
        <summary>
          <Icon name="chevron-down" />
          {t.finder.moreFilters}
        </summary>
        <form class="filters" onSubmit={search} aria-label={t.finder.filters}>
          <div class="filters-grid">
            <div class="filter-field">
              <span class="filter-label" id="filter-type">
                {t.finder.type}
              </span>
              <div class="segmented segmented-small" role="group" aria-labelledby="filter-type">
                {KINDS().map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    aria-pressed={kind === k.value}
                    class={kind === k.value ? "active" : ""}
                    onClick={() => setFilters(withKind(filters, k.value))}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
            <label class="filter-field">
              <span class="filter-label">{t.finder.released}</span>
              <select value={since} onChange={(e) => set({ since: e.currentTarget.value })}>
                {SINCE_OPTIONS().map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <StopSlider
              id="filter-length"
              label={t.finder.maxLength}
              stops={LENGTH_STOPS}
              value={runtime}
              valueText={lengthLabel(runtime)}
              tick={lengthTick}
              onChange={(m) => setFilters(withLength(filters, m))}
            />
            <StopSlider
              id="filter-score"
              label={t.finder.minScore}
              stops={SCORE_STOPS}
              value={minImdb}
              valueText={scoreText}
              tick={scoreTick}
              onChange={(v) => set({ minImdb: v })}
            />
          </div>
          <fieldset class="filter-field filter-genres">
            <legend class="filter-label">{t.finder.genres}</legend>
            <p class="filter-hint" id="genre-hint">
              {t.finder.genreHintBefore}{" "}
              <span class="genre-key genre-key-include" aria-hidden="true">+</span>
              {t.finder.genreHintMiddle}{" "}
              <span class="genre-key genre-key-exclude" aria-hidden="true">−</span>
              {t.finder.genreHintAfter}
            </p>
            <div class="chips chips-small">
              {genresFor(kind === "tv" ? "tv" : "movie").map((g) => {
                const state = genreState(filters, g);
                return (
                  <button
                    key={g}
                    type="button"
                    class={`chip genre-chip genre-${state}`}
                    aria-label={`${genreLabel(g)}: ${genreStateText(state)}`}
                    aria-describedby="genre-hint"
                    onClick={() => setFilters(cycleGenre(filters, g))}
                  >
                    {state !== "off" && <Icon name={state === "include" ? "plus" : "minus"} />}
                    {genreLabel(g)}
                  </button>
                );
              })}
            </div>
            {applicable(filters).length > 1 && (
              <div class="genre-match">
                <span id="genre-match-label">{t.finder.titlesNeed}</span>
                <div class="segmented segmented-small segmented-blue" role="group" aria-labelledby="genre-match-label">
                  {[
                    { all: false, label: t.finder.anyOfThem },
                    { all: true, label: t.finder.allOfThem },
                  ].map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      aria-pressed={filters.matchAll === o.all}
                      class={filters.matchAll === o.all ? "active" : ""}
                      onClick={() => set({ matchAll: o.all })}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </fieldset>
          <div class="filters-actions">
            {(!isDefault(filters, base) || quickBusy === "clear-more") && (
              <button
                class="btn"
                type="button"
                disabled={busy !== null}
                aria-busy={quickBusy === "clear-more"}
                onClick={() => clear("clear-more")}
              >
                {quickBusy === "clear-more" && <Spinner />}
                {t.finder.clearFilters}
              </button>
            )}
            <button
              class="btn btn-primary"
              type="submit"
              disabled={busy !== null}
              aria-busy={busy === "search" && quickBusy === null}
            >
              {busy === "search" && quickBusy === null ? (
                <>
                  <Spinner />
                  {t.finder.searching}
                </>
              ) : (
                t.finder.showPicks
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

      {!results && todayLoading && (
        <section class="results" aria-labelledby="picks-title" aria-busy="true">
          <header class="results-head">
            <h2 id="picks-title">{t.finder.today}</h2>
          </header>
          <p class="loading" role="status">
            <Spinner />
            {t.finder.loadingToday}
          </p>
        </section>
      )}

      {results && (
        <section class="results" aria-labelledby="picks-title" aria-busy={busy !== null}>
          <header class="results-head">
            <h2 id="picks-title">
              {today ? t.finder.today : results.results.length > 0 ? t.finder.picks : t.finder.closest}
            </h2>
            <div class="results-tools">
              {picks.length > 1 && (
                <div class="segmented segmented-small" role="group" aria-label={t.finder.order}>
                  {(["newest", "rated"] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={order === o}
                      class={order === o ? "active" : ""}
                      onClick={() => chooseOrder(o)}
                    >
                      {o === "newest" ? t.finder.newest : t.finder.bestMatch}
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
                  {t.finder.seenLast}
                </button>
              )}
              {picks.length > 0 && (
                <span class="muted">{plural(picks.length, t.finder.titles)}</span>
              )}
            </div>
          </header>
          {today && (
            <p class="results-for muted">
              <Icon name="sun" />
              {t.finder.todayHint}
            </p>
          )}
          {answering && (
            <p class="results-for muted">
              <Icon name="search" />
              {fmt(t.finder.answering, { question: answering })}
            </p>
          )}
          {results.results.length === 0 && (
            <p class="notice">
              {nearMisses.length > 0
                ? t.finder.nearMissNotice
                : t.finder.emptyNotice}
            </p>
          )}
          {picks.map((r, i) => (
            <Fragment key={`${r.media_type}:${r.tmdb_id}`}>
              {sunk > 0 && i === firstSunk && (
                <p class="eyebrow seen-divider">{fmt(t.finder.alreadySeen, { n: sunk })}</p>
              )}
              <TitleCard
                result={r}
                services={profile.services}
                showRegion={multiRegion}
                saved={savedKeys.has(`${r.media_type}:${r.tmdb_id}`)}
                onToggleSave={onToggleSave}
                mark={marks.get(`${r.media_type}:${r.tmdb_id}`) ?? null}
                youngest={Math.min(...profile.children_ages)}
                watchingYoungest={youngestOf(watchingAges(profile, judgedFor))}
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
