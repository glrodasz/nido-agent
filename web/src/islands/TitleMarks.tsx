import { useId, useState } from "preact/hooks";
import { MAX_CHILD_AGE, banLabel, defaultBanUntil } from "../logic/format";
import type { MarkChange, TitleMark } from "../logic/types";
import Icon from "./Icon";
import Spinner, { usePending } from "./Spinner";

interface Props {
  mark: TitleMark | null;
  youngest: number;
  baselineAge: number | null;
  onMark: (change: MarkChange) => Promise<void>;
}

const VOTES = [
  ["seen", "Seen", "eye"],
  ["liked_adults", "We liked it", "heart"],
  ["liked_child", "Our kid liked it", "smile"],
  ["rewatch", "On repeat", "repeat"],
] as const;

const HINTS: Partial<Record<(typeof VOTES)[number][0], string>> = {
  rewatch: "On repeat: the kids love to watch it again and again",
};

/** Seen, the two independent likes, "on repeat" and "don't suggest this" for one title. */
export default function TitleMarks({ mark, youngest, baselineAge, onMark }: Props) {
  const [choosing, setChoosing] = useState(false);
  // Profiles stop at 17, so a 17-year-old's ban can only be for every age.
  const canAgeBan = youngest < MAX_CHILD_AGE;
  const [scope, setScope] = useState<"age" | "always">(canAgeBan ? "age" : "always");
  const [untilAge, setUntilAge] = useState(() => defaultBanUntil(youngest, baselineAge));
  const [pending, track] = usePending();
  const busy = pending !== null;
  const group = useId();

  function change(key: string, next: MarkChange) {
    return track(key, async () => {
      await onMark(next);
      setChoosing(false);
    });
  }

  if (mark?.ban && mark.ban_active) {
    return (
      <div class="marks">
        <p class="notice notice-warn hidden-note">
          <Icon name="eye-off" />
          {banLabel(mark.ban, true)}. Nido won't suggest it.{" "}
          <button
            type="button"
            class="link"
            disabled={busy}
            aria-busy={pending === "undo"}
            onClick={() => change("undo", { ban: null })}
          >
            {pending === "undo" && <Spinner />}
            Undo
          </button>
        </p>
      </div>
    );
  }

  const ages = Array.from({ length: MAX_CHILD_AGE - youngest }, (_, i) => youngest + 1 + i);
  return (
    <div class="marks">
      <div class="mark-row" role="group" aria-label="Your marks">
        {VOTES.map(([field, label, icon]) => {
          const on = Boolean(mark?.[field]);
          return (
            <button
              key={field}
              type="button"
              class={on ? "key mark key-on" : "key mark"}
              aria-pressed={on}
              aria-label={label}
              title={HINTS[field] ?? label}
              disabled={busy}
              aria-busy={pending === field}
              // A favourite to rewatch has been seen, so turning it on marks it seen too.
              onClick={() =>
                change(
                  field,
                  field === "rewatch" && !on ? { rewatch: true, seen: true } : { [field]: !on },
                )
              }
            >
              {pending === field ? <Spinner /> : <Icon name={icon} filled={on && icon === "heart"} />}
              <span class="mark-label">{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          class={choosing ? "key mark key-on" : "key mark"}
          aria-expanded={choosing}
          aria-label="Don't suggest…"
          title="Don't suggest…"
          disabled={busy}
          onClick={() => setChoosing(!choosing)}
        >
          <Icon name="eye-off" />
          <span class="mark-label">Don't suggest…</span>
        </button>
      </div>
      {choosing && (
        <fieldset class="ban-choice">
          <legend class="sr-only">How long to hide it</legend>
          {canAgeBan && (
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
          )}
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
              class="btn btn-small btn-primary"
              disabled={busy}
              aria-busy={pending === "ban"}
              onClick={() =>
                change("ban", {
                  ban: scope === "always" ? { scope } : { scope, until_age: untilAge },
                })
              }
            >
              {pending === "ban" && <Spinner />}
              Hide it
            </button>
            <button type="button" class="link" disabled={busy} onClick={() => setChoosing(false)}>
              Cancel
            </button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
