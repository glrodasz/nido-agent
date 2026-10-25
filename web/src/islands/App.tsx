import { useEffect, useState } from "preact/hooks";
import { ApiError, api } from "../logic/api";
import { authEnabled, signIn, signOut, watchUser } from "../logic/auth";
import { EMPTY_PROFILE } from "../logic/format";
import type { AppConfig, Profile, TitleResult, WatchlistItem } from "../logic/types";
import Finder from "./Finder";
import ProfileForm from "./ProfileForm";
import Watchlist from "./Watchlist";

type Tab = "find" | "watchlist" | "family";
type Session =
  | { state: "loading" }
  | { state: "signed-out" }
  | { state: "in"; uid: string; email: string | null };

const itemKey = (i: WatchlistItem) => `${i.title.media_type}:${i.title.tmdb_id}`;

export default function App() {
  const [session, setSession] = useState<Session>(
    authEnabled ? { state: "loading" } : { state: "in", uid: "local", email: null },
  );
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [tab, setTab] = useState<Tab>("find");
  const [error, setError] = useState<string | null>(null);

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
    setTab("find");
    if (uid === null) return;
    setError(null);
    Promise.all([api.profile(), api.watchlist()]).then(
      ([p, w]) => {
        setProfile(p);
        setWatchlist(w);
      },
      (err) => {
        setProfile(undefined);
        setError(
          err instanceof ApiError && err.status === 403
            ? "This Google account is not on Nido's guest list. Ask the admin to add it."
            : err instanceof Error
              ? err.message
              : "Could not load your family.",
        );
      },
    );
  }, [uid]);

  async function saveProfile(next: Profile) {
    setProfile(await api.saveProfile(next));
    setTab("find");
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
  }

  async function remove(item: WatchlistItem) {
    await api.unsave(item.title.media_type, item.title.tmdb_id);
    setWatchlist((w) => w.filter((i) => itemKey(i) !== itemKey(item)));
  }

  const header = (
    <header class="top">
      <div class="brand">
        <img src="/favicon.svg" alt="" width={32} height={32} />
        <span>Nido</span>
      </div>
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
      {authEnabled && session.state === "in" && (
        <button type="button" class="link" onClick={() => signOut()}>
          Sign out
        </button>
      )}
    </header>
  );

  let body;
  if (session.state === "loading" || (session.state === "in" && profile === undefined && !error)) {
    body = <p class="muted center">Loading…</p>;
  } else if (session.state === "signed-out") {
    body = (
      <section class="panel hero">
        <h1>Find something the whole family will enjoy</h1>
        <p>
          Nido searches the streaming services you already pay for, checks official age ratings
          from nine countries, and shows where every fact comes from.
        </p>
        <button type="button" class="btn btn-primary" onClick={() => signIn().catch(() => {})}>
          Sign in with Google
        </button>
      </section>
    );
  } else if (!config || profile === undefined) {
    body = null;
  } else if (profile === null || tab === "family") {
    body = (
      <ProfileForm
        config={config}
        initial={profile ?? { ...EMPTY_PROFILE, regions: config.default_regions }}
        firstRun={profile === null}
        onSave={saveProfile}
      />
    );
  } else if (tab === "watchlist") {
    body = <Watchlist items={watchlist} onWatched={setWatched} onRemove={remove} />;
  } else {
    body = (
      <Finder
        config={config}
        profile={profile}
        savedKeys={new Set(watchlist.map(itemKey))}
        onToggleSave={toggleSave}
      />
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
