import { useEffect, useState } from "preact/hooks";
import { fmt, intlLocale, locale, t } from "../i18n";
import { localizePath } from "../i18n/locale";
import { api } from "../logic/api";
import type { Family, FamilyMember } from "../logic/types";
import Spinner from "./Spinner";

interface Props {
  /** Called after the signed-in account leaves the family. */
  onLeft: () => void;
}

/** Who shares this family, and an invite link to add someone. */
export default function FamilyMembers({ onLeft }: Props) {
  const [family, setFamily] = useState<Family | null>(null);
  const [link, setLink] = useState<{ url: string; expires: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.family().then(setFamily, (err) => setError(message(err)));
  }, []);

  async function createLink() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const invite = await api.createInvite();
      setLink({
        // The invitee lands in this page's language, unless they saved another one.
        url: `${location.origin}${localizePath("/", locale)}?invite=${encodeURIComponent(invite.token)}`,
        expires: new Date(invite.expires_at).toLocaleDateString(intlLocale(), {
          day: "numeric",
          month: "long",
        }),
      });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError(t.members.copyFailed);
    }
  }

  async function remove(m: FamilyMember) {
    const leaving = m.you;
    setRemoving(m.uid);
    setError(null);
    try {
      await api.removeMember(m.uid);
      if (leaving) onLeft();
      else setFamily((f) => f && { ...f, members: f.members.filter((x) => x.uid !== m.uid) });
    } catch (err) {
      setError(message(err));
    } finally {
      setRemoving(null);
    }
  }

  const owner = family?.role === "owner";
  return (
    <section class="panel family-members">
      <h2 class="section-title">{t.members.title}</h2>
      <p class="muted">{t.members.intro}</p>
      {!family && !error && (
        <p class="loading loading-inline" role="status">
          <Spinner />
          {t.members.loading}
        </p>
      )}
      {family && (
        <ul class="members">
          {family.members.map((m) => (
            <li key={m.uid} class="member">
              <span class="member-avatar" aria-hidden="true">
                {(m.email ?? "?").charAt(0).toUpperCase()}
              </span>
              <span class="member-text">
                <strong>{m.email ?? t.members.unknown}</strong>
                <span class="muted">
                  {[m.role === "owner" ? t.members.owner : t.members.member, m.you ? t.members.you : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {m.role !== "owner" && (owner || m.you) && (
                <button
                  type="button"
                  class="btn btn-small"
                  aria-busy={removing === m.uid}
                  disabled={removing !== null}
                  onClick={() => remove(m)}
                >
                  {removing === m.uid && <Spinner />}
                  {m.you ? t.members.leave : t.members.remove}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {link ? (
        <div class="invite">
          <label class="invite-label" for="invite-link">
            {fmt(t.members.inviteLabel, { date: link.expires })}
          </label>
          <div class="invite-row">
            <input
              id="invite-link"
              type="text"
              readOnly
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" class="btn btn-primary" onClick={copy}>
              {copied ? t.members.copied : t.members.copy}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" class="btn" disabled={busy} aria-busy={busy} onClick={createLink}>
          {busy ? (
            <>
              <Spinner />
              {t.members.creating}
            </>
          ) : (
            t.members.invite
          )}
        </button>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

const message = (err: unknown) => (err instanceof Error ? err.message : t.app.somethingWrong);
