import { useEffect, useState } from "preact/hooks";
import { ApiError, api } from "../logic/api";
import { authEnabled, signIn, signOut, watchUser } from "../logic/auth";
import { EMPTY_PROFILE } from "../logic/format";
import type {
  AppConfig,
  MarkChange,
  Profile,
  TitleMark,
  TitleResult,
  WatchlistItem,
} from "../logic/types";
import { currentTheme, setTheme, type Theme } from "../logic/theme";
import FamilyMembers from "./FamilyMembers";
import Finder from "./Finder";
import HiddenTitles from "./HiddenTitles";
import Icon from "./Icon";
import Landing from "./Landing";
import Logo from "./Logo";
import ProfileForm from "./ProfileForm";
import Spinner from "./Spinner";
import Watchlist from "./Watchlist";

type Tab = "find" | "watchlist" | "family";
type Session =
  | { state: "loading" }
  | { state: "signed-out" }
  | { state: "in"; uid: string; email: string | null };

const itemKey = (i: WatchlistItem) => `${i.title.media_type}:${i.title.tmdb_id}`;

/** The token of an invite link (/?invite=…) this page was opened with. */
function inviteFromUrl(): string | null {
  return new URLSearchParams(location.search).get("invite");
}

function forgetInviteInUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("invite");
  history.replaceState(null, "", url);
}

export default function App() {
  const [session, setSession] = useState<Session>(
    authEnabled ? { state: "loading" } : { state: "in", uid: "local", email: null },
  );
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [marks, setMarks] = useState<TitleMark[]>([]);
  const [tab, setTab] = useState<Tab>("find");
  const [error, setError] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  const [invite, setInvite] = useState<string | null>(inviteFromUrl);
  // Bumped to load the family again, e.g. after leaving it.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api.config().then(setConfig, () => setError("Nido's server is not reachable."));
    if (!authEnabled) return;
    let stop: (() => void) | undefined;
    watchUser((user) =>
      setSession(
        user ? { state: "in", uid: user.uid, email: user.email } : { state: "signed-out" },
      ),
    ).then((unsubscribe) => (stop = unsubscribe));
    return () => stop?.();
  }, []);

  // Keyed on the user, not just "signed in": another account must never see this one's family.
  const uid = session.state === "in" ? session.uid : null;
  useEffect(() => {
    setProfile(undefined);
    setWatchlist([]);
    setMarks([]);
    setTab("find");
    if (uid === null) return;
    setError(null);
    let stale = false;
    (async () => {
      let inviteProblem: string | null = null;
      if (invite) {
        // A link that cannot be used still lets an account that has a family in.
        inviteProblem = await api.acceptInvite(invite).then(
          () => null,
          (err) =>
            err instanceof ApiError && err.status === 410
              ? "This invite link has expired or was already used. Ask for a new one."
              : err instanceof Error
                ? err.message
                : "Could not use the invite link.",
        );
        forgetInviteInUrl();
        setInvite(null);
      }
      try {
        const [p, w, m] = await Promise.all([api.profile(), api.watchlist(), api.marks()]);
        if (stale) return;
        setProfile(p);
        setWatchlist(w);
        setMarks(m);
        setError(inviteProblem);
      } catch (err) {
        if (stale) return;
        setProfile(undefined);
        setError(
          inviteProblem ?? (err instanceof Error ? err.message : "Could not load your family."),
        );
      }
    })();
    return () => {
      stale = true;
    };
    // The invite is read when the user changes, not as a dependency: accepting it clears it.
  }, [uid, reload]);

  async function saveProfile(next: Profile) {
    setProfile(await api.saveProfile(next));
    // An age ban lifts once the youngest reaches its age, so the list depends on the profile.
    setMarks(await api.marks());
    setTab("find");
  }

  async function markTitle(
    info: Pick<TitleResult, "media_type" | "tmdb_id" | "title" | "year" | "poster_url">,
    change: MarkChange,
  ) {
    try {
      const updated = await api.mark(info, change);
      const empty =
        !updated.seen &&
        !updated.liked_adults &&
        !updated.liked_child &&
        !updated.rewatch &&
        !updated.ban;
      setMarks((all) => [...(empty ? [] : [updated]), ...all.filter((m) => m.key !== updated.key)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that mark.");
    }
  }

  function markListed(m: TitleMark, change: MarkChange) {
    return markTitle(
      {
        media_type: m.title.media_type,
        tmdb_id: m.title.tmdb_id,
        title: m.name,
        year: m.year,
        poster_url: m.poster_url,
      },
      change,
    );
  }

  async function toggleSave(result: TitleResult) {
    const key = `${result.media_type}:${result.tmdb_id}`;
    try {
      if (watchlist.some((i) => itemKey(i) === key)) {
        await api.unsave(result.media_type, result.tmdb_id);
        setWatchlist((w) => w.filter((i) => itemKey(i) !== key));
      } else {
        const item = await api.save(result);
        setWatchlist((w) => [item, ...w]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the watchlist.");
    }
  }

  async function setWatched(item: WatchlistItem, watched: boolean) {
    try {
      const updated = await api.save(
        {
          media_type: item.title.media_type,
          tmdb_id: item.title.tmdb_id,
          title: item.name,
          year: item.year,
          poster_url: item.poster_url,
        },
        watched,
      );
      setWatchlist((w) => w.map((i) => (itemKey(i) === itemKey(item) ? updated : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the watchlist.");
    }
  }

  async function remove(item: WatchlistItem) {
    try {
      await api.unsave(item.title.media_type, item.title.tmdb_id);
      setWatchlist((w) => w.filter((i) => itemKey(i) !== itemKey(item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the watchlist.");
    }
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  }

  // Visitors without an invite get the Spanish landing page instead of the app.
  const landing = session.state === "signed-out" && !invite;

  const header = (
    <header class={landing ? "top top-wide" : "top"}>
      <div class="brand">
        <Logo />
      </div>
      {landing && (
        <nav class="lp-nav" aria-label="Secciones" lang="es">
          <a href="#que-hace">Qué hace</a>
          <a href="#como-funciona">Cómo funciona</a>
        </nav>
      )}
      {session.state === "in" && profile && (
        <nav class="tabs" aria-label="Sections">
          {(
            [
              ["find", "Find"],
              ["watchlist", `Watchlist${watchlist.length ? ` (${watchlist.length})` : ""}`],
              ["family", "Family"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              class={tab === id ? "active" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      <div class="top-end">
        <button
          type="button"
          class="icon-btn"
          aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
          onClick={toggleTheme}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        {authEnabled && session.state === "in" && (
          <button type="button" class="link" onClick={() => signOut()}>
            Sign out
          </button>
        )}
      </div>
    </header>
  );

  let body;
  if (session.state === "loading" || (session.state === "in" && profile === undefined && !error)) {
    body = (
      <p class="loading" role="status">
        <Spinner />
        Loading…
      </p>
    );
  } else if (session.state === "signed-out") {
    // Only an invite link gets here; other visitors see the landing page.
    body = (
      <section class="hero">
        <div class="hero-text">
          <h1>You're invited to a family on Nido</h1>
          <p>Sign in with Google to join. You'll share the family's profile, watchlist and marks.</p>
          <button type="button" class="btn btn-primary" onClick={() => signIn().catch(() => {})}>
            Sign in with Google to join
          </button>
        </div>
        <HeroSample />
      </section>
    );
  } else if (!config || profile === undefined) {
    body = null;
  } else if (profile === null || tab === "family") {
    body = (
      <>
        <ProfileForm
          config={config}
          initial={profile ?? { ...EMPTY_PROFILE, regions: config.default_regions }}
          firstRun={profile === null}
          onSave={saveProfile}
        />
        {profile && <HiddenTitles marks={marks} onMark={markListed} />}
        {profile && <FamilyMembers onLeft={() => setReload((n) => n + 1)} />}
      </>
    );
  } else if (tab === "watchlist") {
    body = (
      <Watchlist
        items={watchlist}
        onWatched={setWatched}
        onRemove={remove}
        marks={marks}
        onMark={markTitle}
        profile={profile}
        savedKeys={new Set(watchlist.map(itemKey))}
        onToggleSave={toggleSave}
      />
    );
  } else {
    body = (
      <Finder
        config={config}
        profile={profile}
        savedKeys={new Set(watchlist.map(itemKey))}
        onToggleSave={toggleSave}
        marks={new Map(marks.map((m) => [m.key, m]))}
        onMark={markTitle}
      />
    );
  }

  if (landing) {
    return (
      <>
        {header}
        <Landing onSignIn={signIn} error={error} />
      </>
    );
  }

  return (
    <>
      {header}
      <main class="main">
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        {body}
      </main>
    </>
  );
}

/** A made-up pick that shows what a result looks like before signing in. */
function HeroSample() {
  return (
    <div class="card hero-sample" aria-hidden="true">
      <div class="poster-empty" style={{ "--hue": 150 }}>
        <span>My Neighbor Totoro</span>
      </div>
      <div class="card-body">
        <div class="card-head">
          <div>
            <h3>My Neighbor Totoro</h3>
            <p class="muted">1988 · Movie · 86 min</p>
          </div>
        </div>
        <div class="watch">
          <span class="svc-btn" style={{ "--brand": "#5b2bd6", "--brand-text": "#ffffff" }}>
            HBO Max
            <Icon name="play" filled />
          </span>
          <span class="imdb">
            <Icon name="star" filled />
            IMDb <strong>8.1</strong>
          </span>
        </div>
        <p class="verdict verdict-fit">
          <span class="verdict-dot" />
          <strong>Good for all of you</strong>
          <span class="verdict-why"> · Fits your ages and services</span>
        </p>
      </div>
    </div>
  );
}
