import { useState } from "preact/hooks";

/** A small spinning ring that inherits the text colour; screen readers get the label instead. */
export default function Spinner({ label }: { label?: string }) {
  return (
    <>
      <span class="spinner" aria-hidden="true" />
      {label && <span class="sr-only">{label}</span>}
    </>
  );
}

/**
 * Which action is waiting on the server, by key, so only the control that started it spins.
 * `track` ignores a second press while anything is pending.
 */
export function usePending() {
  const [pending, setPending] = useState<string | null>(null);
  async function track(key: string, work: () => Promise<unknown>) {
    if (pending !== null) return;
    setPending(key);
    try {
      await work();
    } finally {
      setPending(null);
    }
  }
  return [pending, track] as const;
}
