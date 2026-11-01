import { useId, useState } from "preact/hooks";
import {
  accessLabel,
  formatVotes,
  isIncluded,
  posterHue,
  serviceBrand,
  sortOffers,
  verdictFor,
  verifiedAgo,
  yearSpan,
} from "../logic/format";
import type { ComponentChildren } from "preact";
import type { MarkChange, Offer, TitleMark, TitleResult } from "../logic/types";
import Icon from "./Icon";
import Spinner from "./Spinner";
import TitleMarks from "./TitleMarks";

interface Props {
  result: TitleResult;
  services: string[];
  showRegion: boolean;
  saved: boolean;
  onToggleSave: (result: TitleResult) => Promise<void>;
  mark: TitleMark | null;
  youngest: number;
  onMark: (change: MarkChange) => Promise<void>;
  // Extra controls at the bottom of the card, e.g. the watchlist's Watched and Hide details.
  footer?: ComponentChildren;
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
  footer,
}: Props) {
  const [posterFailed, setPosterFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const headingId = useId();
  const sorted = sortOffers(result.where_to_watch, services);
  const included = sorted.filter((o) => isIncluded(o, services));
  // Rent and buy rows can run to a dozen stores; the card leads with what the family already pays for.
  const [primary, ...alsoIncluded] = included;
  const others = included.length > 0 ? alsoIncluded : sorted.slice(0, 2);
  const meta = [
    yearSpan(result),
    result.media_type === "tv" ? "Series" : "Movie",
    result.runtime_min ? `${result.runtime_min} min${result.media_type === "tv" ? " / ep" : ""}` : null,
    result.genres.slice(0, 3).join(", ") || null,
  ].filter(Boolean);
  const nearMiss = result.misses.length > 0;
  const verdict = verdictFor(result.misses, result.age_baseline_min, youngest);
  const verdictWhy = [...result.misses, ...result.cautions].map((r) => r.replace(/\.$/, ""));
  const region = (o: Offer) => (showRegion ? ` ${o.region}` : "");

  return (
    <article class="card" aria-labelledby={headingId}>
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
          <div class="poster-empty" style={{ "--hue": posterHue(result.tmdb_id) }} aria-hidden="true">
            <span>{result.title}</span>
          </div>
        )}
      </div>
      <div class="card-body">
        <header class="card-head">
          <div>
            <h3 id={headingId}>{result.title}</h3>
            <p class="muted">{meta.join(" · ")}</p>
          </div>
          <button
            type="button"
            class={saved ? "key key-small key-on" : "key key-small"}
            aria-pressed={saved}
            aria-busy={saving}
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onToggleSave(result);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Spinner /> : <Icon name="bookmark" filled={saved} />}
            {saved ? "Saved" : "Save"}
          </button>
        </header>

        <div class="watch">
          {primary && <ServiceButton offer={primary} title={result.title} region={region(primary)} />}
          {others.map((o) => {
            const label = (
              <>
                {included.length > 0 && "+ "}
                {o.provider}
                {!isIncluded(o, services) && ` · ${accessLabel(o.access)}`}
                {region(o)}
              </>
            );
            const key = `${o.region}-${o.provider}-${o.access}`;
            return o.link ? (
              <a key={key} class="watch-alt" href={o.link} target="_blank" rel="noopener">
                {label}
              </a>
            ) : (
              <span key={key} class="watch-alt">
                {label}
              </span>
            );
          })}
          {sorted.length === 0 && <span class="watch-alt">No streaming offers found</span>}
          {result.imdb ? (
            <a class="imdb" href={result.imdb.url ?? undefined} target="_blank" rel="noopener">
              <Icon name="star" filled />
              IMDb <strong>{result.imdb.score.toFixed(1)}</strong>
              {result.imdb.votes !== null && <span> · {formatVotes(result.imdb.votes)}</span>}
            </a>
          ) : (
            <span class="imdb">No IMDb rating</span>
          )}
        </div>

        <p class={`verdict verdict-${verdict.level}`}>
          <span class="verdict-dot" aria-hidden="true" />
          <strong>{verdict.label}</strong>
          {verdictWhy.length > 0 && <span class="verdict-why"> · {verdictWhy.join(" · ")}</span>}
        </p>

        <TitleMarks
          mark={mark}
          youngest={youngest}
          baselineAge={result.age_baseline_min ?? null}
          onMark={onMark}
        />

        {result.synopsis && <p class="synopsis">{result.synopsis}</p>}

        <details class="more">
          <summary>
            <Icon name="chevron-down" />
            Age ratings, all offers and guidance
          </summary>
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
        {footer && <div class="card-foot">{footer}</div>}
      </div>
    </article>
  );
}

/** The family's own service as the card's main action: brand colour, name and play. */
function ServiceButton({ offer, title, region }: { offer: Offer; title: string; region: string }) {
  const brand = serviceBrand(offer.service);
  const style = brand ? { "--brand": brand.bg, "--brand-text": brand.fg } : undefined;
  const body = (
    <>
      {offer.provider}
      {region}
      <Icon name="play" filled />
      <span class="sr-only"> — watch {title}</span>
    </>
  );
  return offer.link ? (
    <a class="svc-btn" style={style} href={offer.link} target="_blank" rel="noopener">
      {body}
    </a>
  ) : (
    <span class="svc-btn" style={style}>
      {body}
    </span>
  );
}
