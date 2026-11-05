import { useEffect, useId, useRef, useState } from "preact/hooks";
import { fmt, formatNumber, genreLabel, locale, t } from "../i18n";
import {
  accessLabel,
  formatVotes,
  isIncluded,
  posterHue,
  serviceBrand,
  serviceName,
  sortOffers,
  trailerFor,
  verdictFor,
  verifiedAgo,
  yearSpan,
} from "../logic/format";
import type { ComponentChildren } from "preact";
import type { MarkChange, Offer, TitleMark, TitleResult } from "../logic/types";
import Icon from "./Icon";
import MediaViewer, { type Media } from "./MediaViewer";
import Spinner from "./Spinner";
import TitleMarks from "./TitleMarks";

interface Props {
  result: TitleResult;
  services: string[];
  showRegion: boolean;
  saved: boolean;
  onToggleSave: (result: TitleResult) => Promise<void>;
  mark: TitleMark | null;
  // The family's youngest: what age bans count from.
  youngest: number;
  // The youngest of whoever watches now, for the verdict; the family's youngest when left out.
  watchingYoungest?: number;
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
      name: t.card.imdbParents,
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
  watchingYoungest = youngest,
  onMark,
  footer,
}: Props) {
  const [posterFailed, setPosterFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [media, setMedia] = useState<Media | null>(null);
  const trailer = trailerFor(result.trailers, locale);
  const headingId = useId();
  const sorted = sortOffers(result.where_to_watch, services);
  const included = sorted.filter((o) => isIncluded(o, services));
  // Rent and buy rows can run to a dozen stores; the card leads with what the family already pays for.
  const [primary, ...alsoIncluded] = included;
  // The family's other services go in the service button's menu; without any, show two other offers.
  const others = included.length > 0 ? [] : sorted.slice(0, 2);
  const meta = [
    yearSpan(result),
    result.media_type === "tv" ? t.card.series : t.card.movie,
    result.runtime_min
      ? fmt(result.media_type === "tv" ? t.card.perEpisode : t.card.minutes, { n: result.runtime_min })
      : null,
    result.genres.slice(0, 3).map(genreLabel).join(", ") || null,
  ].filter(Boolean);
  const nearMiss = result.misses.length > 0;
  const verdict = verdictFor(result.misses, result.age_baseline_min, watchingYoungest);
  // The watch row already says when there is no IMDb score; don't repeat it after the verdict.
  const cautions = result.imdb ? result.cautions : result.cautions.filter((c) => !c.includes("IMDb"));
  const verdictWhy = [...result.misses, ...cautions].map((r) => r.replace(/\.$/, ""));
  const region = (o: Offer) => (showRegion ? ` ${o.region}` : "");

  const trailerButton = () =>
    trailer && (
      <button
        type="button"
        class="trailer-btn"
        onClick={() => setMedia({ kind: "trailer", youtubeId: trailer })}
      >
        <Icon name="play" filled />
        {t.card.trailer}
        <span class="sr-only"> — {result.title}</span>
      </button>
    );
  // Rendered twice, one per layout; CSS shows the wide-screen or the phone copy.
  const saveButton = (where: string) => (
    <button
      type="button"
      class={`${saved ? "key key-small key-on" : "key key-small"} ${where}`}
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
      {saved ? t.card.saved : t.card.save}
    </button>
  );

  return (
    <article class="card" aria-labelledby={headingId}>
      <div class="card-poster">
        {result.poster_url && !posterFailed ? (
          <button
            type="button"
            class="poster-btn"
            onClick={() => result.poster_url && setMedia({ kind: "poster", url: result.poster_url })}
          >
            <img
              src={result.poster_url}
              alt=""
              loading="lazy"
              width={120}
              height={180}
              onError={() => setPosterFailed(true)}
            />
            <span class="sr-only">{fmt(t.card.enlargePoster, { title: result.title })}</span>
          </button>
        ) : (
          <div class="poster-empty" style={{ "--hue": posterHue(result.tmdb_id) }} aria-hidden="true">
            <span>{result.title}</span>
          </div>
        )}
        {trailerButton()}
      </div>
      <div class="card-body">
        <header class="card-head">
          <div>
            <h3 id={headingId}>{result.title}</h3>
            {result.original_title && (
              <p class="original-title" lang="">
                {result.original_title}
              </p>
            )}
            <p class="muted">{meta.join(" · ")}</p>
          </div>
          {saveButton("save-wide")}
        </header>
        {result.synopsis && <p class="synopsis">{result.synopsis}</p>}
      </div>
      {/* Beside the poster on wide screens; under it, full width, on phones. */}
      <div class="card-rest">

        <div class="watch">
          {primary && (
            <ServiceButton
              offer={primary}
              more={alsoIncluded}
              title={result.title}
              region={region}
            />
          )}
          {/* Phones: Save shares the row with the service button, under the poster. */}
          {saveButton("save-phone")}
          <span class="watch-break" aria-hidden="true" />
          {others.map((o) => {
            const label = (
              <>
                {o.provider}
                {` · ${accessLabel(o.access)}`}
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
          {sorted.length === 0 && <span class="watch-alt">{t.card.noOffers}</span>}
          {result.imdb ? (
            <a class="imdb" href={result.imdb.url ?? undefined} target="_blank" rel="noopener">
              <Icon name="star" filled />
              IMDb <strong>{formatNumber(result.imdb.score, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>
              {result.imdb.votes !== null && <span> · {formatVotes(result.imdb.votes)}</span>}
            </a>
          ) : (
            <span class="imdb">{t.card.noImdb}</span>
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

        <details class="more">
          <summary>
            <Icon name="chevron-down" />
            {t.card.more}
          </summary>
          <div class="more-body">
          <section class="facts">
            <h4>{t.card.age}</h4>
            <p>
              {result.age_baseline ? (
                <>{fmt(t.card.officialRatings, { baseline: result.age_baseline })}</>
              ) : (
                <span class="muted">{t.card.noAgeRating}</span>
              )}
            </p>
            {result.official_classifications.length > 0 && (
              <ul class="ratings">
                {result.official_classifications.map((c) => (
                  <li key={`${c.country}-${c.value}`}>
                    <strong>{c.country}</strong> {c.value}{" "}
                    <span class="muted">
                      {fmt(t.card.via, { issuer: c.issuer, source: c.source })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p class="hint">
              {t.card.baselineHint}
            </p>
          </section>

          <section class="facts">
            <h4>{t.card.whereToWatch}</h4>
            {sorted.length === 0 ? (
              <p class="muted">{t.card.noOffersFound}</p>
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
                      {showRegion ? ` · ${o.region}` : ""} · {fmt(t.card.checked, { when: verifiedAgo(o.verified_at) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(result.why.length > 0 || (nearMiss && result.cautions.length > 0)) && (
            <section class="facts">
              <h4>{t.card.whyHere}</h4>
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
            <h4>{t.card.guidance}</h4>
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
      {media && <MediaViewer media={media} title={result.title} onClose={() => setMedia(null)} />}
    </article>
  );
}

/** The family's own service as the card's main action: brand colour, name and play. */
function ServiceButton({
  offer,
  more,
  title,
  region,
}: {
  offer: Offer;
  more: Offer[];
  title: string;
  region: (o: Offer) => string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const style = (o: Offer) => {
    const brand = serviceBrand(o.service);
    return brand ? { "--brand": brand.bg, "--brand-text": brand.fg } : undefined;
  };
  const body = (
    <>
      {serviceName(offer)}
      {region(offer)}
      <Icon name="play" filled />
      <span class="sr-only">{fmt(t.card.watchTitle, { title })}</span>
    </>
  );
  const main = offer.link ? (
    <a class="svc-btn" style={style(offer)} href={offer.link} target="_blank" rel="noopener">
      {body}
    </a>
  ) : (
    <span class="svc-btn" style={style(offer)}>
      {body}
    </span>
  );
  if (more.length === 0) return main;
  // On several of the family's services: the arrow lists the others.
  return (
    <div class={open ? "svc-split open" : "svc-split"} ref={root}>
      {main}
      <button
        type="button"
        class="svc-btn svc-caret"
        style={style(offer)}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t.card.moreServices}
        onClick={() => setOpen(!open)}
      >
        <Icon name="chevron-down" />
      </button>
      {open && (
        <ul class="svc-menu" id={menuId}>
          {more.map((o) => {
            const label = (
              <>
                <span class="svc-dot" style={style(o)} aria-hidden="true" />
                {serviceName(o)}
                {region(o)}
              </>
            );
            return (
              <li key={`${o.region}-${o.provider}-${o.access}`}>
                {o.link ? (
                  <a href={o.link} target="_blank" rel="noopener" onClick={() => setOpen(false)}>
                    {label}
                    <Icon name="play" filled />
                  </a>
                ) : (
                  <span>{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
