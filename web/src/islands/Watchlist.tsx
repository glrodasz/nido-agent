import { posterHue } from "../logic/format";
import type { MarkChange, TitleMark, WatchlistItem } from "../logic/types";
import { Poster } from "./HiddenTitles";
import Icon from "./Icon";

interface Props {
  items: WatchlistItem[];
  onWatched: (item: WatchlistItem, watched: boolean) => void;
  onRemove: (item: WatchlistItem) => void;
  marks: TitleMark[];
  onMark: (mark: TitleMark, change: MarkChange) => void;
}

export default function Watchlist({ items, onWatched, onRemove, marks, onMark }: Props) {
  // A hidden title stays out of every list that suggests what to put on.
  const onRepeat = marks
    .filter((m) => m.rewatch && !m.ban_active)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (items.length === 0 && onRepeat.length === 0) {
    return (
      <div class="empty">
        <h2 class="section-title">Your watchlist is empty</h2>
        <p class="muted">Press Save on any pick to keep it here for movie night.</p>
      </div>
    );
  }
  const toWatch = items.filter((i) => !i.watched);
  const watched = items.filter((i) => i.watched);
  const list = (group: WatchlistItem[]) => (
    <ul class="watchlist">
      {group.map((item) => (
        <li key={`${item.title.media_type}:${item.title.tmdb_id}`} class="wl-item">
          {item.poster_url ? (
            <img src={item.poster_url} alt="" width={46} height={69} loading="lazy" />
          ) : (
            <div
              class="poster-empty small"
              style={{ "--hue": posterHue(item.title.tmdb_id) }}
              aria-hidden="true"
            />
          )}
          <div class="wl-text">
            <strong>{item.name}</strong>
            <span class="muted">
              {[item.year, item.title.media_type === "tv" ? "Series" : "Movie"]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <button
            type="button"
            class={item.watched ? "key key-small key-on" : "key key-small"}
            aria-pressed={item.watched}
            onClick={() => onWatched(item, !item.watched)}
          >
            <Icon name="eye" />
            Watched
          </button>
          <button type="button" class="link link-quiet" onClick={() => onRemove(item)}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <div class="lists">
      {onRepeat.length > 0 && (
        <section class="on-repeat">
          <h2 class="section-title">
            <Icon name="repeat" /> On repeat
          </h2>
          <p class="muted">Already seen, but the kids love to watch these again.</p>
          <ul class="watchlist">
            {onRepeat.map((m) => (
              <li key={m.key} class="wl-item">
                <Poster url={m.poster_url} hue={posterHue(m.title.tmdb_id)} />
                <div class="wl-text">
                  <strong>{m.name}</strong>
                  <span class="muted">
                    {[m.year, m.title.media_type === "tv" ? "Series" : "Movie"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <button
                  type="button"
                  class="link link-quiet"
                  onClick={() => onMark(m, { rewatch: false })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {toWatch.length > 0 && (
        <>
          <h2 class="section-title">To watch</h2>
          {list(toWatch)}
        </>
      )}
      {watched.length > 0 && (
        <>
          <h2 class="section-title">Watched</h2>
          {list(watched)}
        </>
      )}
    </div>
  );
}
