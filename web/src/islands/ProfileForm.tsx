import { useState } from "preact/hooks";
import {
  categoryLabel,
  GENRES,
  LENGTH_STOPS,
  lengthLabel,
  parseAges,
  parseRegions,
  SCORE_STOPS,
  scoreTick,
  SHORT_MAX_MIN,
} from "../logic/format";
import { profileLength, profileScore } from "../logic/quick";
import type { AppConfig, Profile } from "../logic/types";
import Spinner from "./Spinner";
import StopSlider from "./StopSlider";

interface Props {
  config: AppConfig;
  initial: Profile;
  firstRun: boolean;
  onSave: (profile: Profile) => Promise<void>;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function ProfileForm({ config, initial, firstRun, onSave }: Props) {
  const [ages, setAges] = useState(initial.children_ages.join(", "));
  const [regions, setRegions] = useState(initial.regions.join(", "));
  const [services, setServices] = useState(initial.services);
  const [avoid, setAvoid] = useState(initial.avoid_categories);
  const [genres, setGenres] = useState(initial.preferred_genres);
  // Saved as slider stops; an older profile's in-between value lands on the nearest one.
  const [runtime, setRuntime] = useState(profileLength(initial.max_runtime_min));
  const [minImdb, setMinImdb] = useState(profileScore(initial.min_imdb_rating));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    const parsedAges = parseAges(ages);
    const parsedRegions = parseRegions(regions);
    if (!parsedAges) return setError("Enter each child's age, from 0 to 17, separated by commas.");
    if (!parsedRegions) return setError("Enter catalog regions as two-letter codes, such as SE.");
    if (services.length === 0) return setError("Pick at least one streaming service.");
    setError(null);
    setSaving(true);
    try {
      await onSave({
        children_ages: parsedAges,
        regions: parsedRegions,
        services,
        avoid_categories: avoid,
        preferred_genres: genres,
        max_runtime_min: runtime,
        // The lowest stop is "Any": no minimum.
        min_imdb_rating: minImdb > SCORE_STOPS[0] ? minImdb : null,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="panel profile" onSubmit={submit}>
      <h2>{firstRun ? "Tell Nido about your family" : "Family profile"}</h2>
      <p class="muted">
        Nido stores ages only, never names or birthdates. These become the default for every
        search, and you can change them per search.
      </p>

      <label class="field">
        <span>Children's ages</span>
        <input
          value={ages}
          onInput={(e) => setAges(e.currentTarget.value)}
          placeholder="6, 9"
          inputMode="numeric"
          required
        />
      </label>

      <fieldset class="field">
        <legend>Streaming services you pay for</legend>
        <div class="chips">
          {config.services.map((s) => (
            <label key={s.key} class="chip">
              <input
                type="checkbox"
                checked={services.includes(s.key)}
                onChange={() => setServices(toggle(services, s.key))}
              />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>

      <label class="field">
        <span>Catalog regions</span>
        <input value={regions} onInput={(e) => setRegions(e.currentTarget.value)} placeholder="SE" />
        <small class="muted">
          Where you watch from. Add more (for example SE, NO) if you use another country's catalog.
          Age ratings always come from nine reference countries, whatever you pick here.
        </small>
      </label>

      <fieldset class="field">
        <legend>Content to avoid</legend>
        <div class="chips">
          {config.categories.map((c) => (
            <label key={c} class="chip">
              <input
                type="checkbox"
                checked={avoid.includes(c)}
                onChange={() => setAvoid(toggle(avoid, c))}
              />
              {categoryLabel(c)}
            </label>
          ))}
        </div>
        <small class="muted">
          Used once guidance sources are connected. Until then each result links to Common Sense
          Media and the IMDb Parents Guide.
        </small>
      </fieldset>

      <fieldset class="field">
        <legend>Favourite genres</legend>
        <div class="chips">
          {GENRES.map((g) => (
            <label key={g} class="chip">
              <input
                type="checkbox"
                checked={genres.includes(g)}
                onChange={() => setGenres(toggle(genres, g))}
              />
              {g}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset class="field profile-defaults">
        <legend>Default filters</legend>
        <small class="muted">
          Where Find's filters start, and what Clear filters goes back to. They are not fixed
          rules: change them for any search.
        </small>
        <div class="filters-grid">
          <StopSlider
            id="profile-length"
            label="Max length"
            stops={LENGTH_STOPS}
            value={runtime}
            valueText={runtime !== null && runtime <= SHORT_MAX_MIN ? `${lengthLabel(runtime)} · Shorts` : lengthLabel(runtime)}
            tick={(m) => (m === null ? "Any" : m >= 60 ? `${m / 60}h` : String(m))}
            onChange={setRuntime}
          />
          <StopSlider
            id="profile-score"
            label="Min IMDb score"
            stops={SCORE_STOPS}
            value={minImdb}
            valueText={minImdb > SCORE_STOPS[0] ? `${minImdb}+` : "Any"}
            tick={scoreTick}
            onChange={setMinImdb}
          />
        </div>
      </fieldset>

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      <div class="actions">
        <button class="btn btn-primary" type="submit" disabled={saving} aria-busy={saving}>
          {saving ? (
            <>
              <Spinner />
              Saving…
            </>
          ) : firstRun ? (
            "Start finding"
          ) : (
            "Save profile"
          )}
        </button>
        {saved && !firstRun && <span class="muted">Saved.</span>}
      </div>
    </form>
  );
}
