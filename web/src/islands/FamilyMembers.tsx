import { useEffect, useState } from "preact/hooks";
import { api } from "../logic/api";
import type { Family, FamilyMember } from "../logic/types";

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
        url: `${location.origin}/?invite=${encodeURIComponent(invite.token)}`,
        expires: new Date(invite.expires_at).toLocaleDateString(undefined, {
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
      setError("Could not copy. Select the link and copy it by hand.");
    }
  }

  async function remove(m: FamilyMember) {
    const leaving = m.you;
    try {
      await api.removeMember(m.uid);
      if (leaving) onLeft();
      else setFamily((f) => f && { ...f, members: f.members.filter((x) => x.uid !== m.uid) });
    } catch (err) {
      setError(message(err));
    }
  }

  const owner = family?.role === "owner";
  return (
    <section class="panel family-members">
      <h2 class="section-title">Who shares this family</h2>
      <p class="muted">Everyone here sees and edits the same profile, watchlist and marks.</p>
      {family && (
        <ul class="members">
          {family.members.map((m) => (
            <li key={m.uid} class="member">
              <span class="member-avatar" aria-hidden="true">
                {(m.email ?? "?").charAt(0).toUpperCase()}
              </span>
              <span class="member-text">
                <strong>{m.email ?? "Unknown account"}</strong>
                <span class="muted">
                  {[m.role === "owner" ? "Owner" : "Member", m.you ? "you" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {m.role !== "owner" && (owner || m.you) && (
                <button type="button" class="btn btn-small" onClick={() => remove(m)}>
                  {m.you ? "Leave" : "Remove"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {link ? (
        <div class="invite">
          <label class="invite-label" for="invite-link">
            Send this link to someone you want to add. It works once, until {link.expires}.
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
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" class="btn" disabled={busy} onClick={createLink}>
          Invite someone
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

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
