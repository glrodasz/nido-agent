import { useState } from "preact/hooks";
import { banLabel, posterHue } from "../logic/format";
import type { MarkChange, TitleMark } from "../logic/types";
import Spinner, { usePending } from "./Spinner";

interface Props {
  marks: TitleMark[];
  onMark: (mark: TitleMark, change: MarkChange) => Promise<void>;
}

/** Every title the family told Nido not to suggest, including age bans that have lifted. */
export default function HiddenTitles({ marks, onMark }: Props) {
  const [pending, track] = usePending();
  const banned = marks
    .filter((m) => m.ban)
    .sort((a, b) => Number(b.ban_active) - Number(a.ban_active));
  return (
    <section class="panel hidden-titles">
      <h2 class="section-title">Titles Nido won't suggest</h2>
      {banned.length === 0 ? (
        <p class="muted">
          None yet. Press "Don't suggest…" on a result to hide it for now or for good.
        </p>
      ) : (
        <ul class="watchlist">
          {banned.map((m) => (
            <li key={m.key} class="wl-item">
              <Poster url={m.poster_url} hue={posterHue(m.title.tmdb_id)} />
              <div class="wl-text">
                <strong>{m.name}</strong>
                <span class={m.ban_active ? "muted" : "muted lifted"}>
                  {[m.year, m.title.media_type === "tv" ? "Series" : "Movie"]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  · {banLabel(m.ban!, m.ban_active)}
                </span>
              </div>
              {m.ban!.scope === "age" && m.ban_active && (
                <button
                  type="button"
                  class="btn btn-small"
                  aria-busy={pending === `always:${m.key}`}
                  disabled={pending !== null}
                  onClick={() =>
                    track(`always:${m.key}`, () => onMark(m, { ban: { scope: "always" } }))
                  }
                >
                  {pending === `always:${m.key}` && <Spinner />}
                  Hide at every age
                </button>
              )}
              <button
                type="button"
                class="btn btn-small"
                aria-busy={pending === `clear:${m.key}`}
                disabled={pending !== null}
                onClick={() => track(`clear:${m.key}`, () => onMark(m, { ban: null }))}
              >
                {pending === `clear:${m.key}` && <Spinner />}
                {m.ban_active ? "Suggest again" : "Clear"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Poster({ url, hue }: { url: string | null; hue: number }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? (
    <img src={url} alt="" width={46} height={69} loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <div class="poster-empty small" style={{ "--hue": hue }} aria-hidden="true" />
  );
}
