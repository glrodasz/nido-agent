import { useState } from "preact/hooks";
import { accessLabel, formatVotes, isIncluded, sortOffers, verifiedAgo } from "../logic/format";
import type { TitleResult } from "../logic/types";

interface Props {
  result: TitleResult;
  services: string[];
  showRegion: boolean;
  saved: boolean;
  onToggleSave: (result: TitleResult) => void;
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

export default function TitleCard({ result, services, showRegion, saved, onToggleSave }: Props) {
  const [showRatings, setShowRatings] = useState(false);
  const [allOffers, setAllOffers] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const sorted = sortOffers(result.where_to_watch, services);
  const included = sorted.filter((o) => isIncluded(o, services));
  // Rent and buy rows can run to a dozen stores; show them on request once something is included.
  const offers = allOffers || included.length === 0 ? sorted : included;
  const hidden = sorted.length - offers.length;
  const meta = [
    result.year,
    result.media_type === "tv" ? "Series" : "Movie",
    result.runtime_min ? `${result.runtime_min} min${result.media_type === "tv" ? " / ep" : ""}` : null,
    result.genres.slice(0, 3).join(", ") || null,
  ].filter(Boolean);

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

        <div class="badges">
          <span class={result.included_in_subscriptions ? "badge badge-ok" : "badge badge-warn"}>
            {result.included_in_subscriptions ? "In your subscriptions" : "Rent, buy or add-on"}
          </span>
          {result.imdb ? (
            <a class="badge" href={result.imdb.url ?? undefined} target="_blank" rel="noopener">
              IMDb {result.imdb.score.toFixed(1)}
              <span class="muted"> {formatVotes(result.imdb.votes)}</span>
            </a>
          ) : (
            <span class="badge badge-muted">No IMDb rating</span>
          )}
        </div>

        {result.synopsis && <p class="synopsis">{result.synopsis}</p>}

        <section class="facts">
          <h4>Age</h4>
          <p>
            {result.age_baseline ? (
              <>Official ratings: {result.age_baseline}</>
            ) : (
              <span class="muted">No official age rating found.</span>
            )}{" "}
            {result.official_classifications.length > 0 && (
              <button type="button" class="link" onClick={() => setShowRatings(!showRatings)}>
                {showRatings ? "Hide originals" : "Show originals"}
              </button>
            )}
          </p>
          {showRatings && (
            <ul class="ratings">
              {result.official_classifications.map((c) => (
                <li key={`${c.country}-${c.value}`}>
                  <strong>{c.country}</strong> {c.value} <span class="muted">({c.issuer}, via {c.source})</span>
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
          {offers.length === 0 ? (
            <p class="muted">No offers found.</p>
          ) : (
            <ul class="offers">
              {offers.map((o) => (
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
          {hidden > 0 && (
            <button type="button" class="link" onClick={() => setAllOffers(true)}>
              {hidden} more to rent, buy or add on
            </button>
          )}
        </section>

        {(result.why.length > 0 || result.cautions.length > 0) && (
          <section class="facts">
            <h4>Why it is here</h4>
            <ul class="reasons">
              {result.why.map((w) => (
                <li key={w}>{w}</li>
              ))}
              {result.cautions.map((c) => (
                <li key={c} class="caution">
                  {c}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p class="guidance">
          Parental guidance:{" "}
          {guidanceLinks(result).map((l, i) => (
            <>
              {i > 0 && " · "}
              <a href={l.url} target="_blank" rel="noopener">
                {l.name}
              </a>
            </>
          ))}
        </p>
      </div>
    </article>
  );
}
