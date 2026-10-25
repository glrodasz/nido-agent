import { useId, useState } from "preact/hooks";
import { banLabel, defaultBanUntil } from "../logic/format";
import type { MarkChange, TitleMark } from "../logic/types";

interface Props {
  mark: TitleMark | null;
  youngest: number;
  baselineAge: number | null;
  onMark: (change: MarkChange) => Promise<void>;
}

const VOTES = [
  ["seen", "Seen"],
  ["liked_adults", "We liked it"],
  ["liked_child", "Our kid liked it"],
] as const;

/** Seen, the two independent likes, and "don't suggest this" for one title. */
export default function TitleMarks({ mark, youngest, baselineAge, onMark }: Props) {
  const [choosing, setChoosing] = useState(false);
  const [scope, setScope] = useState<"age" | "always">("age");
  const [untilAge, setUntilAge] = useState(() => defaultBanUntil(youngest, baselineAge));
  const [busy, setBusy] = useState(false);
  const group = useId();

  async function change(next: MarkChange) {
    setBusy(true);
    try {
      await onMark(next);
      setChoosing(false);
    } finally {
      setBusy(false);
    }
  }

  if (mark?.ban && mark.ban_active) {
    return (
      <div class="marks">
        <p class="notice notice-warn">
          {banLabel(mark.ban, true)}. Nido won't suggest it.{" "}
          <button type="button" class="link" disabled={busy} onClick={() => change({ ban: null })}>
            Undo
          </button>
        </p>
      </div>
    );
  }

  const ages = Array.from({ length: 18 - youngest }, (_, i) => youngest + 1 + i);
  return (
    <div class="marks">
      <div class="mark-row" role="group" aria-label="Your marks">
        {VOTES.map(([field, label]) => {
          const on = Boolean(mark?.[field]);
          return (
            <button
              key={field}
              type="button"
              class={on ? "chip-btn chip-on" : "chip-btn"}
              aria-pressed={on}
              disabled={busy}
              onClick={() => change({ [field]: !on })}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          class="chip-btn"
          aria-expanded={choosing}
          disabled={busy}
          onClick={() => setChoosing(!choosing)}
        >
          Don't suggest…
        </button>
      </div>
      {choosing && (
        <fieldset class="ban-choice">
          <legend class="sr-only">How long to hide it</legend>
          <label>
            <input
              type="radio"
              name={group}
              checked={scope === "age"}
              onChange={() => setScope("age")}
            />
            Until our youngest is{" "}
            <select
              value={untilAge}
              aria-label="Age"
              onChange={(e) => {
                setScope("age");
                setUntilAge(Number(e.currentTarget.value));
              }}
            >
              {ages.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="radio"
              name={group}
              checked={scope === "always"}
              onChange={() => setScope("always")}
            />
            At any age
          </label>
          <div class="actions">
            <button
              type="button"
              class="btn btn-small"
              disabled={busy}
              onClick={() =>
                change({ ban: scope === "always" ? { scope } : { scope, until_age: untilAge } })
              }
            >
              Hide it
            </button>
            <button type="button" class="link" onClick={() => setChoosing(false)}>
              Cancel
            </button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
