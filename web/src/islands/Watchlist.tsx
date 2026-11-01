import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { t } from "../i18n";
import { api, type TitleInfo } from "../logic/api";
import { posterHue } from "../logic/format";
import type {
  MarkChange,
  MediaType,
  Profile,
  TitleMark,
  TitleResult,
  WatchlistItem,
} from "../logic/types";
import { Poster } from "./HiddenTitles";
import Icon from "./Icon";
import Spinner, { usePending } from "./Spinner";
import TitleCard from "./TitleCard";

interface Props {
  items: WatchlistItem[];
  onWatched: (item: WatchlistItem, watched: boolean) => Promise<void>;
  onRemove: (item: WatchlistItem) => Promise<void>;
  marks: TitleMark[];
  onMark: (info: TitleInfo, change: MarkChange) => Promise<void>;
  profile: Profile;
  savedKeys: Set<string>;
  onToggleSave: (result: TitleResult) => Promise<void>;
}

/** One row of a list: what a saved item and an On repeat mark have in common. */
interface Entry {
  key: string;
  media_type: MediaType;
  tmdb_id: number;
  name: string;
  year: number | null;
  poster_url: string | null;
}

const fromItem = (i: WatchlistItem): Entry => ({
  key: `${i.title.media_type}:${i.title.tmdb_id}`,
  media_type: i.title.media_type,
  tmdb_id: i.title.tmdb_id,
  name: i.name,
  year: i.year,
  poster_url: i.poster_url,
});

const fromMark = (m: TitleMark): Entry => ({
  key: m.key,
  media_type: m.title.media_type,
  tmdb_id: m.title.tmdb_id,
  name: m.name,
  year: m.year,
  poster_url: m.poster_url,
});

const info = (e: Entry): TitleInfo => ({
  media_type: e.media_type,
  tmdb_id: e.tmdb_id,
  title: e.name,
  year: e.year,
  poster_url: e.poster_url,
});

/** The marks a family already set, shown on the closed row so nobody has to open it to see them. */
function MarkBadges({ mark }: { mark: TitleMark | undefined }) {
  if (!mark) return null;
  const on = [
    mark.liked_adults && (["heart", t.marks.likedAdults] as const),
    mark.liked_child && (["smile", t.marks.likedChild] as const),
    mark.rewatch && (["repeat", t.marks.rewatch] as const),
  ].filter(Boolean) as (readonly ["heart" | "smile" | "repeat", string])[];
  if (on.length === 0) return null;
  return (
    <span class="wl-badges">
      {on.map(([icon, label]) => (
        <span key={icon} class="wl-badge" title={label}>
          <Icon name={icon} filled={icon === "heart"} />
          <span class="sr-only">{label}</span>
        </span>
      ))}
    </span>
  );
}

export default function Watchlist({
  items,
  onWatched,
  onRemove,
  marks,
  onMark,
  profile,
  savedKeys,
  onToggleSave,
}: Props) {
  const [pending, track] = usePending();
  const busy = pending !== null;
  // Opening details is a read, so it never blocks Watched or Remove on other rows.
  const [opening, setOpening] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, TitleResult>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const markByKey = new Map(marks.map((m) => [m.key, m]));
  const youngest = Math.min(...profile.children_ages);

  // A hidden title stays out of every list that suggests what to put on.
  const onRepeat = marks
    .filter((m) => m.rewatch && !m.ban_active)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (items.length === 0 && onRepeat.length === 0) {
    return (
      <div class="empty">
        <h2 class="section-title">{t.watchlist.emptyTitle}</h2>
        <p class="muted">{t.watchlist.emptyBody}</p>
      </div>
    );
  }

  function close(key: string) {
    setOpen((all) => {
      const next = new Set(all);
      next.delete(key);
      return next;
    });
  }

  async function toggle(e: Entry) {
    if (open.has(e.key)) return close(e.key);
    if (opening !== null) return;
    if (!details[e.key]) {
      setOpening(e.key);
      try {
        const result = await api.details(e.media_type, e.tmdb_id);
        setDetails((all) => ({ ...all, [e.key]: result }));
        setFailed(({ [e.key]: _, ...rest }) => rest);
      } catch (err) {
        setFailed((all) => ({
          ...all,
          [e.key]: err instanceof Error ? err.message : t.watchlist.detailsFailed,
        }));
        return;
      } finally {
        setOpening(null);
      }
    }
    setOpen((all) => new Set(all).add(e.key));
  }

  const row = (e: Entry, actions: ComponentChildren) => {
    const isOpen = open.has(e.key) && details[e.key];
    const meta = [e.year, e.media_type === "tv" ? t.card.series : t.card.movie].filter(Boolean).join(" · ");
    const hide = (
      <button type="button" class="link link-quiet" onClick={() => close(e.key)}>
        <span class="chev-up">
          <Icon name="chevron-down" />
        </span>
        {t.watchlist.hideDetails}
      </button>
    );
    return (
      <li key={e.key} class="wl-entry">
        {isOpen ? (
          <TitleCard
            result={details[e.key]}
            services={profile.services}
            showRegion={profile.regions.length > 1}
            saved={savedKeys.has(e.key)}
            onToggleSave={onToggleSave}
            mark={markByKey.get(e.key) ?? null}
            youngest={youngest}
            onMark={(change) => onMark(info(e), change)}
            footer={
              <>
                {actions}
                {hide}
              </>
            }
          />
        ) : (
          <div class="wl-item">
            <button
              type="button"
              class="wl-open"
              aria-expanded={false}
              aria-busy={opening === e.key}
              disabled={opening !== null && opening !== e.key}
              onClick={() => toggle(e)}
            >
              <Poster url={e.poster_url} hue={posterHue(e.tmdb_id)} />
              <span class="wl-text">
                <strong>{e.name}</strong>
                <span class="muted">
                  {meta}
                  <MarkBadges mark={markByKey.get(e.key)} />
                </span>
                {failed[e.key] && (
                  <span class="wl-error" role="alert">
                    {failed[e.key]}
                  </span>
                )}
              </span>
              <span class="wl-chev" aria-hidden="true">
                {opening === e.key ? <Spinner /> : <Icon name="chevron-down" />}
              </span>
              <span class="sr-only">{t.watchlist.showDetails}</span>
            </button>
            {actions}
          </div>
        )}
      </li>
    );
  };

  const itemActions = (item: WatchlistItem) => {
    const key = fromItem(item).key;
    return (
      <>
        <button
          type="button"
          class={item.watched ? "key key-small key-on" : "key key-small"}
          aria-pressed={item.watched}
          aria-busy={pending === `watched:${key}`}
          disabled={busy}
          onClick={() => track(`watched:${key}`, () => onWatched(item, !item.watched))}
        >
          {pending === `watched:${key}` ? <Spinner /> : <Icon name="eye" />}
          {t.watchlist.watched}
        </button>
        <button
          type="button"
          class="link link-quiet"
          aria-busy={pending === `remove:${key}`}
          disabled={busy}
          onClick={() => track(`remove:${key}`, () => onRemove(item))}
        >
          {pending === `remove:${key}` && <Spinner />}
          {t.watchlist.remove}
        </button>
      </>
    );
  };

  const list = (group: WatchlistItem[]) => (
    <ul class="watchlist">{group.map((item) => row(fromItem(item), itemActions(item)))}</ul>
  );
  const toWatch = items.filter((i) => !i.watched);
  const watched = items.filter((i) => i.watched);
  return (
    <div class="lists">
      {onRepeat.length > 0 && (
        <section class="on-repeat">
          <h2 class="section-title">
            <Icon name="repeat" /> {t.watchlist.onRepeat}
          </h2>
          <p class="muted">{t.watchlist.onRepeatBody}</p>
          <ul class="watchlist">
            {onRepeat.map((m) =>
              row(
                fromMark(m),
                <button
                  type="button"
                  class="link link-quiet"
                  aria-busy={pending === `repeat:${m.key}`}
                  disabled={busy}
                  onClick={() =>
                    track(`repeat:${m.key}`, () => onMark(info(fromMark(m)), { rewatch: false }))
                  }
                >
                  {pending === `repeat:${m.key}` && <Spinner />}
                  {t.watchlist.remove}
                </button>,
              ),
            )}
          </ul>
        </section>
      )}
      {toWatch.length > 0 && (
        <>
          <h2 class="section-title">{t.watchlist.toWatch}</h2>
          {list(toWatch)}
        </>
      )}
      {watched.length > 0 && (
        <>
          <h2 class="section-title">{t.watchlist.watchedList}</h2>
          {list(watched)}
        </>
      )}
    </div>
  );
}
