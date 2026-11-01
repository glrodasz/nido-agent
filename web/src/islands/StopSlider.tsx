interface Props<T> {
  id: string;
  label: string;
  stops: T[];
  value: T;
  // Shown next to the label and read out by screen readers.
  valueText: string;
  tick: (stop: T) => string;
  onChange: (stop: T) => void;
}

/** A slider that only lands on fixed stops, with each stop labelled (and tappable) underneath. */
export default function StopSlider<T>({ id, label, stops, value, valueText, tick, onChange }: Props<T>) {
  const index = Math.max(0, stops.indexOf(value));
  return (
    <div class="filter-field">
      <label class="filter-label filter-slider-label" for={id}>
        {label}
        <output for={id} class="filter-value">
          {valueText}
        </output>
      </label>
      <input
        id={id}
        class="stop-slider"
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={index}
        aria-valuetext={valueText}
        onInput={(e) => onChange(stops[Number(e.currentTarget.value)])}
      />
      <div class="stop-ticks" aria-hidden="true">
        {stops.map((s, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            class={i === index ? "stop-tick active" : "stop-tick"}
            onClick={() => onChange(s)}
          >
            {tick(s)}
          </button>
        ))}
      </div>
    </div>
  );
}
