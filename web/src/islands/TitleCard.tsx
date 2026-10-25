import { useState } from "preact/hooks";
import { accessLabel, formatVotes, isIncluded, sortOffers, verifiedAgo } from "../logic/format";
import type { MarkChange, TitleMark, TitleResult } from "../logic/types";
import TitleMarks from "./TitleMarks";

interface Props {
  result: TitleResult;
  services: string[];
  showRegion: boolean;
  saved: boolean;
  onToggleSave: (result: TitleResult) => void;
  mark: TitleMark | null;
  youngest: number;
  onMark: (change: MarkChange) => Promise<void>;
}

function guidanceLinks(result: TitleResult): { name: string; url: string }[] {
  const links = [
    {
      name: "Common Sense Media",
      url: `https://www.commonsensemedia.org/search/${encodeURIComponent(result.title)}`,
    },
  ];
  if (result.imdb_id) {
    links.push({
      name: "IMDb Parents Guide",
      url: `https://www.imdb.com/title/${result.imdb_id}/parentalguide`,
    });
  }
  return links;
}

export default function TitleCard({
  result,
  services,
  showRegion,
  saved,
  onToggleSave,
  mark,
  youngest,
  onMark,
}: Props) {
  const [posterFailed, setPosterFailed] = useState(false);
  const sorted = sortOffers(result.where_to_watch, services);
  const included = sorted.filter((o) => isIncluded(o, services));
  // Rent and buy rows can run to a dozen stores; the card leads with what the family already pays for.
  const headline = included.length > 0 ? included : sorted.slice(0, 2);
  const meta = [
    result.year,
    result.media_type === "tv" ? "Series" : "Movie",
    result.runtime_min ? `${result.runtime_min} min${result.media_type === "tv" ? " / ep" : ""}` : null,
    result.genres.slice(0, 3).join(", ") || null,
  ].filter(Boolean);
  const nearMiss = result.misses.length > 0;

  return (
    <article class="card">
      <div class="card-poster">
        {result.poster_url && !posterFailed ? (
          <img
            src={result.poster_url}
            alt=""
            loading="lazy"
            width={120}
            height={180}
            onError={() => setPosterFailed(true)}
          />
        ) : (
          <div class="poster-empty" aria-hidden="true" />
        )}
      </div>
      <div class="card-body">
        <header class="card-head">
          <div>
            <h3>{result.title}</h3>
            <p class="muted">{meta.join(" · ")}</p>
          </div>
          <button
            type="button"
            class={saved ? "btn btn-small btn-saved" : "btn btn-small"}
            aria-pressed={saved}
            onClick={() => onToggleSave(result)}
          >
            {saved ? "Saved" : "Save"}
          </button>
        </header>

        {nearMiss ? (
          <div class="verdict verdict-warn">
            <strong>Outside your family profile</strong>
            {result.misses.length === 1 ? (
              <span>{result.misses[0]}</span>
            ) : (
              <ul>
                {result.misses.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div class="verdict verdict-ok">
            <strong>Fits your family profile</strong>
            {result.cautions.length > 0 && (
              <ul>
                {result.cautions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div class="watch">
          {headline.map((o) => {
            const label = (
              <>
                {o.provider}
                {!isIncluded(o, services) && <span class="pill-note"> {accessLabel(o.access)}</span>}
                {showRegion && <span class="pill-note"> {o.region}</span>}
              </>
            );
            const cls = isIncluded(o, services) ? "pill pill-ok" : "pill";
            return o.link ? (
              <a key={`${o.region}-${o.provider}-${o.access}`} class={cls} href={o.link} target="_blank" rel="noopener">
                {label}
              </a>
            ) : (
              <span key={`${o.region}-${o.provider}-${o.access}`} class={cls}>
                {label}
              </span>
            );
          })}
          {headline.length === 0 && <span class="pill pill-muted">No streaming offers found</span>}
          {result.imdb ? (
            <a class="pill pill-muted" href={result.imdb.url ?? undefined} target="_blank" rel="noopener">
              IMDb <strong>{result.imdb.score.toFixed(1)}</strong>
              <span class="pill-note"> {formatVotes(result.imdb.votes)}</span>
            </a>
          ) : (
            <span class="pill pill-muted">No IMDb rating</span>
          )}
        </div>

        <TitleMarks
          mark={mark}
          youngest={youngest}
          baselineAge={result.age_baseline_min ?? null}
          onMark={onMark}
        />

        {result.synopsis && <p class="synopsis">{result.synopsis}</p>}

        <details class="more">
          <summary>Age ratings, all offers and guidance</summary>
          <div class="more-body">
          <section class="facts">
            <h4>Age</h4>
            <p>
              {result.age_baseline ? (
                <>Official ratings: {result.age_baseline}</>
              ) : (
                <span class="muted">No official age rating found.</span>
              )}
            </p>
            {result.official_classifications.length > 0 && (
              <ul class="ratings">
                {result.official_classifications.map((c) => (
                  <li key={`${c.country}-${c.value}`}>
                    <strong>{c.country}</strong> {c.value}{" "}
                    <span class="muted">
                      ({c.issuer}, via {c.source})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p class="hint">
              The baseline is the median across countries, not advice for your child. Check the
              guidance below for what is in it.
            </p>
          </section>

          <section class="facts">
            <h4>Where to watch</h4>
            {sorted.length === 0 ? (
              <p class="muted">No offers found.</p>
            ) : (
              <ul class="offers">
                {sorted.map((o) => (
                  <li key={`${o.region}-${o.provider}-${o.access}`}>
                    <span class={isIncluded(o, services) ? "dot dot-ok" : "dot"} aria-hidden="true" />
                    {o.link ? (
                      <a href={o.link} target="_blank" rel="noopener">
                        {o.provider}
                      </a>
                    ) : (
                      o.provider
                    )}{" "}
                    <span class="muted">
                      {accessLabel(o.access)}
                      {showRegion ? ` · ${o.region}` : ""} · checked {verifiedAgo(o.verified_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(result.why.length > 0 || (nearMiss && result.cautions.length > 0)) && (
            <section class="facts">
              <h4>Why it is here</h4>
              <ul class="reasons">
                {result.why.map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {nearMiss &&
                  result.cautions.map((c) => (
                    <li key={c} class="caution">
                      {c}
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <section class="facts">
            <h4>Parental guidance</h4>
            <p>
              {guidanceLinks(result).map((l, i) => (
                <>
                  {i > 0 && " · "}
                  <a href={l.url} target="_blank" rel="noopener">
                    {l.name}
                  </a>
                </>
              ))}
            </p>
          </section>
          </div>
        </details>
      </div>
    </article>
  );
}
