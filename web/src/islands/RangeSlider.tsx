interface Props<T> {
  id: string;
  label: string;
  // Read out for each handle by screen readers.
  lowLabel: string;
  highLabel: string;
  stops: T[];
  low: T;
  high: T;
  // Shown next to the label and read out by screen readers.
  valueText: string;
  tick: (stop: T) => string;
  onChange: (low: T, high: T) => void;
}

/** Two handles on fixed stops: the low one always stays at least one stop below the high one.
 * Each stop is labelled (and tappable) underneath; a tap moves the nearer handle. */
export default function RangeSlider<T>({
  id,
  label,
  lowLabel,
  highLabel,
  stops,
  low,
  high,
  valueText,
  tick,
  onChange,
}: Props<T>) {
  const last = stops.length - 1;
  const lo = Math.max(0, stops.indexOf(low));
  const hi = Math.max(lo + 1, stops.indexOf(high) === -1 ? last : stops.indexOf(high));
  const pct = (i: number) => (i / last) * 100;
  const setLow = (i: number) => onChange(stops[Math.min(i, hi - 1)], stops[hi]);
  const setHigh = (i: number) => onChange(stops[lo], stops[Math.max(i, lo + 1)]);
  const tap = (i: number) => (i < lo || (i < hi && i - lo < hi - i) ? setLow(i) : setHigh(i));
  return (
    <div class="filter-field" role="group" aria-labelledby={`${id}-label`}>
      <span class="filter-label filter-slider-label" id={`${id}-label`}>
        {label}
        <output class="filter-value" aria-live="polite">
          {valueText}
        </output>
      </span>
      <div class="range-slider" style={{ "--lo": `${pct(lo)}%`, "--hi": `${pct(hi)}%` }}>
        <div class="range-track" aria-hidden="true">
          <div class="range-fill" />
        </div>
        <input
          id={`${id}-min`}
          type="range"
          min={0}
          max={last}
          step={1}
          value={lo}
          aria-label={lowLabel}
          aria-valuetext={tick(stops[lo])}
          onInput={(e) => {
            const i = Number(e.currentTarget.value);
            if (i >= hi) e.currentTarget.value = String(hi - 1);
            setLow(i);
          }}
        />
        <input
          id={`${id}-max`}
          type="range"
          min={0}
          max={last}
          step={1}
          value={hi}
          aria-label={highLabel}
          aria-valuetext={tick(stops[hi])}
          onInput={(e) => {
            const i = Number(e.currentTarget.value);
            if (i <= lo) e.currentTarget.value = String(lo + 1);
            setHigh(i);
          }}
        />
      </div>
      <div class="stop-ticks" aria-hidden="true">
        {stops.map((s, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            class={i === lo || i === hi ? "stop-tick active" : "stop-tick"}
            onClick={() => tap(i)}
          >
            {tick(s)}
          </button>
        ))}
      </div>
    </div>
  );
}
