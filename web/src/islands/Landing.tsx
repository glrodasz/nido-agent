import { useEffect, useState } from "preact/hooks";
import Icon from "./Icon";
import Spinner from "./Spinner";

// The page signed-out visitors see: what Nido does, then "Sign in with Google", in the page's
// language (copy in src/i18n/landing.ts). The demo picks are examples, not live data.
import { formatNumber, locale } from "../i18n";
import { BLUEY_POSTER, LANDING, SPIRITED_AWAY_POSTER, posterUrl, type Scene } from "../i18n/landing";
import { LanguageLinks } from "./LanguageMenu";

const copy = () => LANDING[locale];

const RATINGS: [country: string, rating: string][] = [
  ["US", "PG"],
  ["GB", "U"],
  ["DE", "6"],
  ["NL", "6"],
  ["FR", "TP"],
  ["SE", "7"],
  ["NO", "6"],
  ["DK", "7"],
  ["FI", "7"],
];

/** A demo poster: the TMDB image over a gradient placeholder that stays if the image fails. */
function Poster({ gradient, img, label, small }: { gradient: string; img: string; label?: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span class={small ? "lp-poster lp-poster-sm" : "lp-poster"} style={{ background: `linear-gradient(160deg, ${gradient})` }}>
      {label}
      {!failed && <img src={posterUrl(img)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />}
    </span>
  );
}

/** Renders our own copy's **bold** and *emphasis*; the text is ours, so no markdown parser is needed. */
function rich(text: string) {
  return text.split("**").map((part, i) =>
    i % 2 ? (
      <strong key={i}>{part}</strong>
    ) : (
      part.split("*").map((bit, j) => (j % 2 ? <em key={`${i}-${j}`}>{bit}</em> : bit))
    ),
  );
}

function GoogleMark() {
  return (
    <span class="lp-g" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="12" height="12">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8Z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
      </svg>
    </span>
  );
}

function Demo() {
  const [scene, setScene] = useState(0);
  const SCENES = copy().scenes;
  const [typed, setTyped] = useState(SCENES[0].question);
  // The previous answer stays until the new question finishes "typing".
  const [answered, setAnswered] = useState(0);

  useEffect(() => {
    const question = SCENES[scene].question;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(question);
      setAnswered(scene);
      return;
    }
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      setTyped(question.slice(0, n));
      if (n >= question.length) {
        clearInterval(timer);
        setAnswered(scene);
      }
    }, 28);
    return () => clearInterval(timer);
  }, [scene]);

  return (
    <div class="lp-demo" aria-label={copy().demoLabel}>
      <div class="lp-demo-label">
        <span>{copy().askLikeYouTalk}</span>
        <span>{copy().example}</span>
      </div>
      <div class="lp-ask">
        <Icon name="search" />
        <span class="lp-ask-text">
          {typed}
          <span class="lp-caret" aria-hidden="true" />
        </span>
        <span class="btn btn-primary btn-small" aria-hidden="true">
          {copy().askButton}
        </span>
      </div>
      <div class="chips lp-chips" role="group" aria-label={copy().otherExamples}>
        {SCENES.map((s, i) => (
          <button
            key={s.chip}
            type="button"
            class={`key key-small${i === scene ? " key-on" : ""}`}
            aria-pressed={i === scene}
            onClick={() => setScene(i)}
          >
            {s.chip}
          </button>
        ))}
      </div>
      <DemoAnswer scene={SCENES[answered]} />
    </div>
  );
}

function DemoAnswer({ scene }: { scene: Scene }) {
  return (
    <>
      <div class="lp-reply" aria-live="polite">
        <b>Nido</b>
        <span>{rich(scene.reply)}</span>
      </div>
      <div class="lp-picks">
        {scene.picks.map((p) => (
          <article class="lp-pick" key={p.title}>
            <Poster gradient={p.poster} img={p.img} label={p.title} />
            <div class="lp-pick-body">
              <h3>{p.title}</h3>
              <p class="muted">
                {[p.year, p.kind === "series" ? copy().series : copy().movie, `${p.minutes} min`, p.genres].join(" · ")}
              </p>
              <div class="watch">
                <span class="svc-btn" style={{ "--brand": p.service[1], "--brand-text": "#ffffff" }}>
                  {p.service[0]}
                  <Icon name="play" filled />
                </span>
                <span class="imdb">
                  <Icon name="star" filled />
                  IMDb <strong>{formatNumber(p.imdb, { minimumFractionDigits: 1 })}</strong>
                </span>
              </div>
              <p class={`verdict ${p.fit ? "verdict-fit" : "verdict-grown-up"}`}>
                <span class="verdict-dot" />
                <strong>{p.fit ? copy().fit : copy().grownUp}</strong>
                {p.why && <span> · {p.why}</span>}
              </p>
            </div>
          </article>
        ))}
      </div>
      <p class="lp-note">{copy().demoNote}</p>
    </>
  );
}

function MarksSample() {
  const [on, setOn] = useState([true, true, true, true]);
  const icons = ["eye", "heart", "smile", "repeat"] as const;
  const marks = icons.map((icon, i) => [icon, copy().marks[i]] as const);
  return (
    <div class="lp-marks">
      {marks.map(([icon, label], i) => (
        <button
          key={label}
          type="button"
          class={`key key-small${on[i] ? " key-on" : ""}`}
          aria-pressed={on[i]}
          onClick={() => setOn(on.map((v, j) => (j === i ? !v : v)))}
        >
          <Icon name={icon} filled={icon === "heart" && on[i]} />
          {label}
        </button>
      ))}
    </div>
  );
}

export default function Landing({
  onSignIn,
  error,
}: {
  onSignIn: () => Promise<void>;
  error: string | null;
}) {
  const [pending, setPending] = useState<string | null>(null);

  async function signIn(key: string) {
    if (pending) return;
    setPending(key);
    try {
      await onSignIn();
    } catch {
      // Closing Google's popup is not an error worth showing.
    } finally {
      setPending(null);
    }
  }

  const signInButton = (key: string, label: string) => (
    <button
      type="button"
      class="btn btn-primary lp-btn-lg"
      disabled={pending !== null}
      aria-busy={pending === key}
      onClick={() => signIn(key)}
    >
      {pending === key ? <Spinner /> : <GoogleMark />}
      {label}
    </button>
  );

  const c = copy();
  return (
    <main class="landing">
      <section class="lp-hero">
        <div class="lp-wrap">
          <div class="lp-hero-text">
            {error && (
              <p class="error" role="alert">
                {error}
              </p>
            )}
            <h1>{rich(c.heroTitle)}</h1>
            <p class="lp-lede">{rich(c.heroLede)}</p>
            <div class="lp-cta">
              {signInButton("hero", c.signIn)}
              <a class="lp-quiet" href="#que-hace">
                {c.seeWhat}
              </a>
            </div>
            <p class="lp-fine">{c.fine}</p>
          </div>
          <Demo />
        </div>
      </section>

      <section class="lp-band">
        <div class="lp-wrap">
          <h2>{c.bandTitle}</h2>
          <div>
            <p>{rich(c.band)}</p>
            <div class="lp-triad">
              {c.triad.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section class="lp-features" id="que-hace">
        <div class="lp-wrap">
          <div class="lp-head">
            <h2>{c.featuresTitle}</h2>
            <p>{c.featuresLede}</p>
          </div>

          <article class="lp-feature">
            <div class="lp-feature-text">
              <span class="eyebrow">{c.ageEyebrow}</span>
              <h3>{c.ageTitle}</h3>
              <p>{c.ageBody}</p>
            </div>
            <div class="lp-vignette">
              <div class="lp-vignette-head">
                <b>{c.ageExample}</b>
                <span>{c.example}</span>
              </div>
              <div class="lp-ratings-scroll">
                <div class="lp-ratings">
                  {RATINGS.map(([country, rating]) => (
                    <div class={`lp-rating${country === "SE" ? " lp-rating-local" : ""}`} key={country}>
                      <small>{country}</small>
                      <b>{rating}</b>
                    </div>
                  ))}
                </div>
              </div>
              <div class="lp-median">
                <span class="lp-age">7+</span>
                <span>{rich(c.ageVerdict)}</span>
              </div>
            </div>
          </article>

          <article class="lp-feature">
            <div class="lp-feature-text">
              <span class="eyebrow">{c.whereEyebrow}</span>
              <h3>{c.whereTitle}</h3>
              <p>{c.whereBody}</p>
            </div>
            <div class="lp-vignette lp-services">
              {(
                [
                  ["Netflix", "#e50914"],
                  ["Disney+", "#113ccf"],
                ] as const
              ).map(([name, brand]) => (
                <div class="lp-service" key={name}>
                  <span class="svc-btn" style={{ "--brand": brand, "--brand-text": "#ffffff" }}>
                    {name}
                    <Icon name="play" filled />
                  </span>
                  <span class="muted">{c.included}</span>
                </div>
              ))}
              <div class="lp-service lp-service-off">
                <span>{c.rental}</span>
                <span>{c.notYours}</span>
              </div>
            </div>
          </article>

          <article class="lp-feature">
            <div class="lp-feature-text">
              <span class="eyebrow">{c.memoriesEyebrow}</span>
              <h3>{c.memoriesTitle}</h3>
              <p>{c.memoriesBody}</p>
            </div>
            <div class="lp-vignette">
              <div class="lp-mini">
                <Poster small gradient="#8fb6c9, #2f6280" img={BLUEY_POSTER} />
                <div>
                  <b>Bluey</b>
                  <span class="muted">{c.bluey}</span>
                </div>
              </div>
              <MarksSample />
            </div>
          </article>

          <article class="lp-feature">
            <div class="lp-feature-text">
              <span class="eyebrow">{c.laterEyebrow}</span>
              <h3>{c.laterTitle}</h3>
              <p>{c.laterBody}</p>
            </div>
            <div class="lp-vignette" aria-hidden="true">
              <div class="lp-mini">
                <Poster small gradient="#7fa7b8, #2c5466" img={SPIRITED_AWAY_POSTER} />
                <div>
                  <b>{c.spirited}</b>
                  <span class="muted">{c.spiritedMeta}</span>
                </div>
              </div>
              <div class="lp-hide">
                <span class="lp-radio lp-radio-on">
                  <i />
                  {c.untilBefore} <span class="lp-select">12</span>
                  {c.untilAfter && ` ${c.untilAfter}`}
                </span>
                <span class="lp-radio">
                  <i />
                  {c.anyAge}
                </span>
                <span class="lp-hide-actions">
                  <span class="btn btn-primary btn-small">{c.hide}</span>
                  <span class="btn btn-small">{c.cancel}</span>
                </span>
              </div>
            </div>
          </article>

          <article class="lp-feature">
            <div class="lp-feature-text">
              <span class="eyebrow">{c.agentEyebrow}</span>
              <h3>{c.agentTitle}</h3>
              <p>{c.agentBody}</p>
            </div>
            <ol class="lp-vignette lp-trace">
              {c.trace.map(([verb, rest], i) => (
                <li key={verb} class={i === 2 ? "lp-trace-check" : undefined}>
                  <i>{i === 2 ? "✓" : i < 2 ? i + 1 : i}</i>
                  <span>
                    <b>{verb}</b> {rest}
                  </span>
                </li>
              ))}
            </ol>
          </article>
        </div>
      </section>

      <section class="lp-how" id="como-funciona">
        <div class="lp-wrap">
          <div class="lp-head">
            <h2>{c.howTitle}</h2>
          </div>
          <ol class="lp-steps">
            {c.steps.map(([title, body]) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section class="lp-closing">
        <div class="lp-wrap">
          <div class="lp-closing-box">
            <div>
              <h2>{c.closingTitle}</h2>
              <p>{c.closingBody}</p>
            </div>
            {signInButton("closing", c.signIn)}
          </div>
        </div>
      </section>

      <footer class="lp-footer">
        <div class="lp-wrap">
          <span>{c.footerSources}</span>
          <span>{c.footerPrivacy}</span>
          <LanguageLinks />
          <span>{c.footerTag}</span>
        </div>
      </footer>
    </main>
  );
}
