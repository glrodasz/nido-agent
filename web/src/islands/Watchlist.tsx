import type { WatchlistItem } from "../logic/types";

interface Props {
  items: WatchlistItem[];
  onWatched: (item: WatchlistItem, watched: boolean) => void;
  onRemove: (item: WatchlistItem) => void;
}

export default function Watchlist({ items, onWatched, onRemove }: Props) {
  if (items.length === 0) {
    return (
      <p class="panel muted">
        Nothing saved yet. Press Save on any pick to keep it here for movie night.
      </p>
    );
  }
  const toWatch = items.filter((i) => !i.watched);
  const watched = items.filter((i) => i.watched);
  const list = (group: WatchlistItem[]) => (
    <ul class="watchlist">
      {group.map((item) => (
        <li key={`${item.title.media_type}:${item.title.tmdb_id}`} class="panel wl-item">
          {item.poster_url ? (
            <img src={item.poster_url} alt="" width={46} height={69} loading="lazy" />
          ) : (
            <div class="poster-empty small" aria-hidden="true" />
          )}
          <div class="wl-text">
            <strong>{item.name}</strong>
            <span class="muted">
              {[item.year, item.title.media_type === "tv" ? "Series" : "Movie"]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <label class="chip">
            <input
              type="checkbox"
              checked={item.watched}
              onChange={(e) => onWatched(item, e.currentTarget.checked)}
            />
            Watched
          </label>
          <button type="button" class="btn btn-small" onClick={() => onRemove(item)}>
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <div>
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
