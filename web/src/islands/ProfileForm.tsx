import { useState } from "preact/hooks";
import {
  ADULT_AGE,
  ageLabel,
  categoryLabel,
  GENRES,
  LENGTH_STOPS,
  lengthLabel,
  parseRegions,
  SCORE_STOPS,
  scoreTick,
  SHORT_MAX_MIN,
} from "../logic/format";
import { profileLength, profileScore } from "../logic/quick";
import type { AppConfig, Profile } from "../logic/types";
import Icon from "./Icon";
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

interface Child {
  age: number;
  name: string;
}

// A new child starts here; the stepper moves it from 0 (under 1) to 18 (adult).
const NEW_CHILD_AGE = 5;
const MAX_CHILDREN = 10;
const MAX_NICKNAME = 24;

function childrenOf(profile: Profile): Child[] {
  const kids = profile.children_ages.map((age, i) => ({
    age: Math.min(Math.max(age, 0), ADULT_AGE),
    name: profile.children_names?.[i] ?? "",
  }));
  return kids.length ? kids : [{ age: NEW_CHILD_AGE, name: "" }];
}

interface StepperProps {
  child: Child;
  index: number;
  onChange: (child: Child) => void;
  onRemove: (() => void) | null;
}

/** One child: an optional nickname and an age stepper that ends at "Adult · 18+". */
function ChildRow({ child, index, onChange, onRemove }: StepperProps) {
  const who = child.name.trim() || `Child ${index + 1}`;
  const step = (by: number) =>
    onChange({ ...child, age: Math.min(ADULT_AGE, Math.max(0, child.age + by)) });
  return (
    <li class={child.age >= ADULT_AGE ? "child-row child-adult" : "child-row"}>
      <input
        class="child-name"
        value={child.name}
        maxLength={MAX_NICKNAME}
        placeholder="Nickname (optional)"
        aria-label={`Child ${index + 1} nickname`}
        onInput={(e) => onChange({ ...child, name: e.currentTarget.value })}
      />
      <div class="stepper" role="group" aria-label={`${who}'s age`}>
        <button
          type="button"
          class="stepper-btn"
          aria-label={`${who}: one year younger`}
          disabled={child.age <= 0}
          onClick={() => step(-1)}
        >
          <Icon name="minus" />
        </button>
        <output class="stepper-value" aria-live="polite">
          {ageLabel(child.age)}
        </output>
        <button
          type="button"
          class="stepper-btn"
          aria-label={`${who}: one year older`}
          disabled={child.age >= ADULT_AGE}
          onClick={() => step(1)}
        >
          <Icon name="plus" />
        </button>
      </div>
      {onRemove && (
        <button type="button" class="child-remove" aria-label={`Remove ${who}`} onClick={onRemove}>
          <Icon name="x" />
        </button>
      )}
    </li>
  );
}

export default function ProfileForm({ config, initial, firstRun, onSave }: Props) {
  const [children, setChildren] = useState<Child[]>(() => childrenOf(initial));
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
    const parsedRegions = parseRegions(regions);
    if (!parsedRegions) return setError("Enter catalog regions as two-letter codes, such as SE.");
    if (services.length === 0) return setError("Pick at least one streaming service.");
    setError(null);
    setSaving(true);
    try {
      await onSave({
        children_ages: children.map((c) => c.age),
        children_names: children.map((c) => c.name.trim()),
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
        Nido stores ages, never birthdates. These become the default for every search, and you
        can change them per search.
      </p>

      <fieldset class="field children">
        <legend>Children</legend>
        <ol class="child-list">
          {children.map((c, i) => (
            <ChildRow
              key={i}
              child={c}
              index={i}
              onChange={(next) => setChildren(children.map((old, j) => (j === i ? next : old)))}
              onRemove={
                children.length > 1 ? () => setChildren(children.filter((_, j) => j !== i)) : null
              }
            />
          ))}
        </ol>
        {children.length < MAX_CHILDREN && (
          <button
            type="button"
            class="btn btn-small child-add"
            onClick={() => setChildren([...children, { age: NEW_CHILD_AGE, name: "" }])}
          >
            <Icon name="plus" />
            Add a child
          </button>
        )}
        <small class="muted">
          Nicknames are optional and only help you pick who is watching; Nido's assistant only
          sees ages. At {ADULT_AGE}+ a child counts as an adult: no age limits when only they watch.
          With everyone watching, the youngest sets the limits.
        </small>
      </fieldset>

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
