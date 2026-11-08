import { useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../logic/api";
import type { AppConfig, AskLog, QualityReport } from "../logic/types";
import { fmt, formatNumber, intlLocale, plural, t } from "../i18n";
import Icon from "./Icon";
import Markdown from "./Markdown";
import Spinner from "./Spinner";

const PERIODS = [1, 7, 30] as const;
type Filter = "all" | "down" | "failed" | "noCards" | "quiet";
const FILTERS: Filter[] = ["all", "down", "failed", "noCards", "quiet"];
const FAILED = new Set(["too_slow", "busy", "no_answer"]);

const failed = (item: AskLog) => FAILED.has(item.outcome);
const acted = (item: AskLog) => item.events.some((e) => e.kind !== "asked_again");

const KEEP: Record<Filter, (item: AskLog) => boolean> = {
  all: () => true,
  down: (i) => i.rating === "down",
  failed,
  noCards: (i) => !failed(i) && i.cards.length === 0,
  quiet: (i) => !failed(i) && !acted(i) && i.rating === null,
};

function seconds(ms: number | null): string {
  return ms === null ? "–" : fmt(t.quality.seconds, { n: formatNumber(ms / 1000, { maximumFractionDigits: 1 }) });
}

function when(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

const category = (c: string) => (t.categories as Record<string, string>)[c] ?? c;

/** Nido's owners only: every Ask Nido question of the last days, to judge the answers. */
export default function Quality({ config }: { config: AppConfig }) {
  const [days, setDays] = useState<number>(7);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    api.quality(days).then(
      (r) => !stale && setReport(r),
      (err) => !stale && setError(err instanceof Error ? err.message : t.quality.failed),
    ).finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [days]);

  const items = useMemo(() => (report?.items ?? []).filter(KEEP[filter]), [report, filter]);
  const services = new Map(config.services.map((s) => [s.key, s.name]));
  const s = report?.summary;

  return (
    <section class="panel quality" aria-labelledby="quality-title">
      <div class="quality-head">
        <div>
          <h2 id="quality-title" class="section-title">
            {t.quality.title}
          </h2>
          <p class="quality-intro">{t.quality.intro}</p>
        </div>
        <div class="segmented" role="group" aria-label={t.quality.period}>
          {PERIODS.map((n) => (
            <button
              key={n}
              type="button"
              class={days === n ? "active" : ""}
              aria-pressed={days === n}
              disabled={loading}
              onClick={() => setDays(n)}
            >
              {loading && days === n ? <Spinner /> : null}
              {plural(n, t.quality.days)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {!report && loading && (
        <p class="loading" role="status">
          <Spinner />
          {t.quality.loading}
        </p>
      )}

      {s && (
        <dl class={`quality-stats${loading ? " is-stale" : ""}`}>
          {(
            [
              [t.quality.stats.questions, formatNumber(s.questions)],
              [t.quality.stats.families, formatNumber(s.families)],
              [t.quality.stats.helpful, formatNumber(s.up)],
              [t.quality.stats.notHelpful, formatNumber(s.down)],
              [t.quality.stats.failed, formatNumber(s.failed)],
              [t.quality.stats.noCards, formatNumber(s.no_cards)],
              [t.quality.stats.acted, formatNumber(s.acted)],
              [t.quality.stats.fallback, formatNumber(s.fallback)],
              [t.quality.stats.median, seconds(s.median_ms)],
              [t.quality.stats.slowest, seconds(s.slowest_ms)],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {report && (
        <>
          <div class="chips quality-filters" role="group" aria-label={t.quality.filters.label}>
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                class={`chip-btn${filter === f ? " chip-on" : ""}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {t.quality.filters[f]} · {formatNumber(report.items.filter(KEEP[f]).length)}
              </button>
            ))}
          </div>
          {items.length === 0 ? (
            <p class="quality-empty">{t.quality.empty}</p>
          ) : (
            <ol class={`quality-list${loading ? " is-stale" : ""}`}>
              {items.map((item) => (
                <QualityItem key={item.id} item={item} services={services} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function QualityItem({ item, services }: { item: AskLog; services: Map<string, string> }) {
  const names = new Map([...item.cards, ...item.tools.flatMap((x) => x.found?.titles ?? [])].map((c) => [c.key, c.title ?? c.key]));
  const v = item.viewers;
  return (
    <li class={`quality-item${failed(item) ? " is-failed" : ""}`}>
      <details>
        <summary>
          <span class="quality-meta">
            <span>{when(item.at)}</span>
            <span>{item.yours ? t.quality.yours : fmt(t.quality.family, { tag: item.family.slice(0, 4) })}</span>
            <span class={`quality-outcome outcome-${item.outcome}`}>{t.quality.outcome[item.outcome]}</span>
            {item.rating && (
              <span class={`quality-rating rating-${item.rating}`} aria-label={item.rating === "up" ? t.feedback.up : t.feedback.down}>
                <Icon name={item.rating === "up" ? "thumbs-up" : "thumbs-down"} />
              </span>
            )}
            <span>
              {plural(item.cards.length, t.quality.cards)} · {seconds(item.latency_ms)}
            </span>
          </span>
          <span class="quality-question">{item.question}</span>
          {item.comment && <span class="quality-comment">“{item.comment}”</span>}
        </summary>

        <div class="quality-body">
          <section>
            <h3>{t.quality.forWho}</h3>
            <p>
              {fmt(t.quality.ages, {
                ages: (v.ages ?? []).join(", ") || "–",
                family: (v.family_ages ?? []).join(", ") || "–",
              })}
            </p>
            {v.avoid && v.avoid.length > 0 && <p>{fmt(t.quality.avoid, { list: v.avoid.map(category).join(", ") })}</p>}
            <p>
              {fmt(t.quality.services, {
                list: (v.services ?? []).map((k) => services.get(k) ?? k).join(", ") || "–",
                regions: (v.regions ?? []).join(", ") || "–",
              })}
            </p>
          </section>

          <section>
            <h3>{t.quality.tools}</h3>
            {item.tools.length === 0 ? (
              <p>{t.quality.noTools}</p>
            ) : (
              <ol class="quality-tools">
                {item.tools.map((tool, i) => (
                  <li key={i}>
                    <code class="quality-tool-name">{tool.name}</code>
                    {tool.found && (
                      <span class="quality-found">
                        {fmt(t.quality.found, { results: tool.found.results, misses: tool.found.near_misses })}
                      </span>
                    )}
                    <pre>{JSON.stringify(tool.args, null, 1)}</pre>
                    {tool.found?.titles && (
                      <p class="quality-titles">
                        {tool.found.titles
                          .map((x) => `${x.title ?? x.key}${x.year ? ` (${x.year})` : ""}${x.near_miss ? ` · ${t.quality.nearMiss}` : ""}`)
                          .join(" · ")}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <h3>{t.quality.reply}</h3>
            {item.reply ? <Markdown text={item.reply} /> : <p>–</p>}
            {item.note && (
              <p>
                <strong>{t.quality.note}:</strong> {item.note}
              </p>
            )}
            {item.error && (
              <p class="error">
                <strong>{t.quality.error}:</strong> {item.error}
              </p>
            )}
          </section>

          {item.cards.length > 0 && (
            <section>
              <h3>{t.quality.shown}</h3>
              <ol class="quality-cards">
                {item.cards.map((c) => (
                  <li key={c.key}>
                    {c.title ?? c.key}
                    {c.year ? ` (${c.year})` : ""}
                    {c.near_miss ? ` · ${t.quality.nearMiss}` : ""}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section>
            <h3>{t.quality.reactions}</h3>
            {item.events.length === 0 && !item.rating ? (
              <p>{t.quality.noReactions}</p>
            ) : (
              <ul class="quality-events">
                {item.rating && <li>{item.rating === "up" ? t.feedback.up : t.feedback.down}</li>}
                {item.comment && (
                  <li>
                    {t.quality.comment}: “{item.comment}”
                  </li>
                )}
                {item.events.map((e, i) => (
                  <li key={i}>
                    {fmt((t.quality.events as Record<string, string>)[e.kind] ?? e.kind, {
                      title: e.key ? (names.get(e.key) ?? e.key) : "",
                    })}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p class="quality-model">
            <strong>{t.quality.model}:</strong>{" "}
            {fmt(t.quality.modelLine, {
              models: item.models.join(", ") || "–",
              calls: item.model_calls,
              prompt: formatNumber(item.tokens.prompt),
              output: formatNumber(item.tokens.output),
            })}
          </p>
        </div>
      </details>
    </li>
  );
}
