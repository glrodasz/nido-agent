import { useEffect, useState } from "preact/hooks";
import Icon from "./Icon";
import Spinner from "./Spinner";

// The page signed-out visitors see: what Nido does, then "Entrar con Google".
// Copy is neutral Latin American Spanish; the demo picks are examples, not live data.

type Pick = {
  title: string;
  meta: string;
  service: [name: string, brand: string];
  imdb: string;
  fit: boolean;
  call: string;
  why?: string;
  poster: string;
};

type Scene = { chip: string; question: string; reply: string; picks: Pick[] };

const SCENES: Scene[] = [
  {
    chip: "Ciencia ficción divertida",
    question: "Una película divertida de ciencia ficción",
    reply:
      "Dos que les van a gustar a todos. **WALL·E** es perfecta para tu hijo de 4; **Los Mitchell** es más alocada y conviene verla juntos.",
    picks: [
      {
        title: "WALL·E",
        meta: "2008 · Película · 98 min · Animación, Ciencia ficción",
        service: ["Disney+", "#113ccf"],
        imdb: "8,4",
        fit: true,
        call: "Buena para todos",
        poster: "#c9a46a, #6b4a2b",
      },
      {
        title: "Los Mitchell vs. las máquinas",
        meta: "2021 · Película · 114 min · Animación, Comedia",
        service: ["Netflix", "#e50914"],
        imdb: "7,6",
        fit: false,
        call: "Mejor con un adulto",
        why: "Clasificada 7+ y tu hijo tiene 4",
        poster: "#b18be0, #4b2a86",
      },
    ],
  },
  {
    chip: "Animada y bien valorada",
    question: "Algo animado y bien valorado, menos de 90 minutos",
    reply:
      "**Mi vecino Totoro** es tranquila y hermosa para los más chiquitos. **Shaun, el cordero** no tiene diálogos y hace reír a cualquier edad.",
    picks: [
      {
        title: "Mi vecino Totoro",
        meta: "1988 · Película · 86 min · Animación, Fantasía",
        service: ["HBO Max", "#5b2bd6"],
        imdb: "8,1",
        fit: true,
        call: "Buena para todos",
        poster: "#9cc79a, #3b6e47",
      },
      {
        title: "Shaun, el cordero: La película",
        meta: "2015 · Película · 85 min · Animación, Comedia",
        service: ["Netflix", "#e50914"],
        imdb: "7,3",
        fit: true,
        call: "Buena para todos",
        why: "Algún momento de tensión leve",
        poster: "#d8c79a, #7b6a3a",
      },
    ],
  },
  {
    chip: "Una serie que no dé miedo",
    question: "Una serie con capítulos cortos que no dé miedo",
    reply:
      "**Bluey** es la favorita de muchos padres: capítulos de 7 minutos y mucho humor. **Puffin Rock** es más calmada, ideal antes de dormir.",
    picks: [
      {
        title: "Bluey",
        meta: "2018– · Serie · 7 min · Animación, Familia",
        service: ["Disney+", "#113ccf"],
        imdb: "9,3",
        fit: true,
        call: "Buena para todos",
        poster: "#8fb6c9, #2f6280",
      },
      {
        title: "Puffin Rock",
        meta: "2015–2022 · Serie · 7 min · Animación, Infantil",
        service: ["Netflix", "#e50914"],
        imdb: "8,0",
        fit: true,
        call: "Buena para todos",
        poster: "#a6c9b8, #3f6f63",
      },
    ],
  },
];

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

/** Renders the demo reply's **bold** titles; the text is ours, so no markdown parser is needed. */
function bold(text: string) {
  return text.split("**").map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
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
    <div class="lp-demo" aria-label="Ejemplo de búsqueda en Nido">
      <div class="lp-demo-label">
        <span>Pregunta como hablas</span>
        <span>Ejemplo</span>
      </div>
      <div class="lp-ask">
        <Icon name="search" />
        <span class="lp-ask-text">
          {typed}
          <span class="lp-caret" aria-hidden="true" />
        </span>
        <span class="btn btn-primary btn-small" aria-hidden="true">
          Preguntar
        </span>
      </div>
      <div class="chips lp-chips" role="group" aria-label="Otros ejemplos">
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
        <span>{bold(scene.reply)}</span>
      </div>
      <div class="lp-picks">
        {scene.picks.map((p) => (
          <article class="lp-pick" key={p.title}>
            <span class="lp-poster" style={{ background: `linear-gradient(160deg, ${p.poster})` }}>
              {p.title}
            </span>
            <div class="lp-pick-body">
              <h3>{p.title}</h3>
              <p class="muted">{p.meta}</p>
              <div class="watch">
                <span class="svc-btn" style={{ "--brand": p.service[1], "--brand-text": "#ffffff" }}>
                  {p.service[0]}
                  <Icon name="play" filled />
                </span>
                <span class="imdb">
                  <Icon name="star" filled />
                  IMDb <strong>{p.imdb}</strong>
                </span>
              </div>
              <p class={`verdict ${p.fit ? "verdict-fit" : "verdict-grown-up"}`}>
                <span class="verdict-dot" />
                <strong>{p.call}</strong>
                {p.why && <span> · {p.why}</span>}
              </p>
            </div>
          </article>
        ))}
      </div>
      <p class="lp-note">Ejemplo para una familia con un niño de 4 años.</p>
    </>
  );
}

function MarksSample() {
  const [on, setOn] = useState([true, true, true, true]);
  const marks = [
    ["eye", "Vista"],
    ["heart", "Nos gustó"],
    ["smile", "Le gustó a mi hijo"],
    ["repeat", "Para repetir"],
  ] as const;
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

  return (
    <main class="landing" lang="es">
      <section class="lp-hero">
        <div class="lp-wrap">
          <div class="lp-hero-text">
            {error && (
              <p class="error" role="alert">
                {error}
              </p>
            )}
            <span class="lp-kicker">Para ver en familia</span>
            <h1>
              ¿Cansado de no saber qué ver, ni qué es <em>adecuado</em> para tus hijos?
            </h1>
            <p class="lp-lede">
              Nido busca en los servicios de streaming que ya pagas y te propone películas y series{" "}
              <strong>aptas para tus hijos y que también vas a disfrutar tú</strong>. Le dices la
              edad de tu hijo y lo que prefieres evitar, y Nido hace el resto.
            </p>
            <div class="lp-cta">
              {signInButton("hero", "Entrar con Google")}
              <a class="lp-quiet" href="#que-hace">
                Ver qué hace Nido
              </a>
            </div>
            <p class="lp-fine">Por ahora Nido funciona por invitación.</p>
          </div>
          <Demo />
        </div>
      </section>

      <section class="lp-band">
        <div class="lp-wrap">
          <h2>Que sea apta no basta. Tiene que gustarles a todos.</h2>
          <div>
            <p>
              La mayoría de buscadores para niños solo filtran. Nido parte de tu familia:{" "}
              <strong>
                la edad de tu hijo, los servicios que ya tienen y lo que prefieres evitar
              </strong>
              , como sustos, violencia o malos ejemplos.
            </p>
            <p>
              Con eso busca títulos de calidad, bien valorados y que un adulto también vea con
              gusto, y te dice en una línea si encajan con ustedes y por qué.
            </p>
            <div class="lp-triad">
              <span>Apta para su edad</span>
              <span>Bien valorada</span>
              <span>En tus servicios</span>
              <span>Divertida para todos</span>
            </div>
          </div>
        </div>
      </section>

      <section class="lp-features" id="que-hace">
        <div class="lp-wrap">
          <div class="lp-head">
            <h2>Todo lo que necesitas para decidir en un minuto</h2>
            <p>Cada dato viene de una fuente oficial y te dice de dónde sale.</p>
          </div>

          <article class="lp-feature">
            <div class="lp-feature-text">
              <span class="eyebrow">Edad</span>
              <h3>Las clasificaciones de edad del mundo, en una sola cifra</h3>
              <p>
                Nido junta las clasificaciones oficiales de nueve países, incluida la de tu país, y
                calcula una edad recomendada. Si quieres el detalle, lo tienes país por país, junto
                a enlaces a Common Sense Media y la guía para padres de IMDb.
              </p>
            </div>
            <div class="lp-vignette">
              <div class="lp-vignette-head">
                <b>Los Mitchell vs. las máquinas</b>
                <span>Ejemplo</span>
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
                <span>
                  Edad recomendada por Nido. Tu hijo tiene 4, así que te avisa:{" "}
                  <strong>mejor verla con un adulto</strong>.
                </span>
              </div>
            </div>
          </article>

          <article class="lp-feature">
            <div class="lp-feature-text">
              <span class="eyebrow">Dónde verla</span>
              <h3>Solo lo que puedes ver hoy, en lo que ya pagas</h3>
              <p>
                Marca tus servicios una vez. Nido te pone primero lo que está incluido en tu
                suscripción, con un botón para abrirlo directamente, y separa lo que solo se puede
                alquilar o comprar.
              </p>
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
                  <span class="muted">Incluida</span>
                </div>
              ))}
              <div class="lp-service lp-service-off">
                <span>Apple TV · Alquiler</span>
                <span>No está en tus servicios</span>
              </div>
            </div>
          </article>

          <article class="lp-feature">
            <div class="lp-feature-text">
              <span class="eyebrow">Recuerdos de familia</span>
              <h3>Anota lo que les gustó y lo que quieren repetir</h3>
              <p>
                Marca si ya la vieron, si les gustó a ustedes o a tu hijo, y las que pide una y otra
                vez. Las de repetir quedan a la mano para esas noches en que solo sirve su favorita.
              </p>
            </div>
            <div class="lp-vignette">
              <div class="lp-mini">
                <span class="lp-poster lp-poster-sm" style={{ background: "linear-gradient(160deg, #8fb6c9, #2f6280)" }} />
                <div>
                  <b>Bluey</b>
                  <span class="muted">2018– · Serie · Animación, Familia</span>
                </div>
              </div>
              <MarksSample />
            </div>
          </article>

          <article class="lp-feature">
            <div class="lp-feature-text">
              <span class="eyebrow">Para más adelante</span>
              <h3>Escóndela hasta que tenga edad</h3>
              <p>
                ¿Una película que todavía no es para su edad? Pídele a Nido que no la sugiera hasta
                que tu hijo cumpla la edad que elijas, o nunca. Vuelve sola cuando actualizas su
                edad, y siempre puedes deshacerlo.
              </p>
            </div>
            <div class="lp-vignette" aria-hidden="true">
              <div class="lp-mini">
                <span class="lp-poster lp-poster-sm" style={{ background: "linear-gradient(160deg, #7fa7b8, #2c5466)" }} />
                <div>
                  <b>El viaje de Chihiro</b>
                  <span class="muted">2001 · Película · 125 min</span>
                </div>
              </div>
              <div class="lp-hide">
                <span class="lp-radio lp-radio-on">
                  <i />
                  Hasta que tenga <span class="lp-select">12</span> años
                </span>
                <span class="lp-radio">
                  <i />A cualquier edad
                </span>
                <span class="lp-hide-actions">
                  <span class="btn btn-primary btn-small">Ocultar</span>
                  <span class="btn btn-small">Cancelar</span>
                </span>
              </div>
            </div>
          </article>

          <article class="lp-feature">
            <div class="lp-feature-text">
              <span class="eyebrow">Un agente de IA</span>
              <h3>La IA propone, los datos deciden</h3>
              <p>
                Nido es un agente: entiende lo que pides, busca en el catálogo, consulta edades,
                notas y disponibilidad, y te explica su elección. Las reglas de tu familia se
                aplican con datos, no con suposiciones, así que lo que ocultas nunca vuelve a
                aparecer.
              </p>
            </div>
            <ol class="lp-vignette lp-trace">
              <li>
                <i>1</i>
                <span>
                  <b>Entiende</b> "algo divertido de ciencia ficción, para esta noche"
                </span>
              </li>
              <li>
                <i>2</i>
                <span>
                  <b>Busca</b> en el catálogo de tu país y en tus servicios
                </span>
              </li>
              <li class="lp-trace-check">
                <i>✓</i>
                <span>
                  <b>Comprueba</b> edad, lo que evitas y lo que ocultaste
                </span>
              </li>
              <li>
                <i>3</i>
                <span>
                  <b>Explica</b> en una línea por qué encaja con ustedes
                </span>
              </li>
            </ol>
          </article>
        </div>
      </section>

      <section class="lp-how" id="como-funciona">
        <div class="lp-wrap">
          <div class="lp-head">
            <h2>Cómo funciona</h2>
          </div>
          <ol class="lp-steps">
            <li>
              <h3>Cuéntale de tu familia</h3>
              <p>
                La edad de tu hijo, tus servicios y lo que prefieres evitar. Puedes invitar a tu
                pareja para compartirlo todo.
              </p>
            </li>
            <li>
              <h3>Pregunta o explora</h3>
              <p>Escribe lo que se te antoje o usa atajos como "menos de 90 minutos" o "animada".</p>
            </li>
            <li>
              <h3>Elige y dale play</h3>
              <p>Cada tarjeta te dice si encaja, la nota y dónde verla. Un toque y empieza.</p>
            </li>
          </ol>
        </div>
      </section>

      <section class="lp-closing">
        <div class="lp-wrap">
          <div class="lp-closing-box">
            <div>
              <h2>Menos tiempo eligiendo, más tiempo juntos.</h2>
              <p>Entra con tu cuenta de Google. Por ahora, solo con invitación.</p>
            </div>
            {signInButton("closing", "Entrar con Google")}
          </div>
        </div>
      </section>

      <footer class="lp-footer">
        <div class="lp-wrap">
          <span>Disponibilidad de JustWatch vía TMDB. Valoraciones de OMDb.</span>
          <span>Nido · hecho en casa para ver en familia</span>
        </div>
      </footer>
    </main>
  );
}
