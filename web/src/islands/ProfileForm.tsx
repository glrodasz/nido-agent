import { useState } from "preact/hooks";
import { fmt, genreLabel, t } from "../i18n";
import {
  ADULT_AGE,
  ageLabel,
  categoryLabel,
  GENRES,
  LENGTH_STOPS,
  lengthLabel,
  parseRegions,
  SCORE_STOPS,
  lengthTick,
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
  const who = child.name.trim() || fmt(t.profile.childN, { n: index + 1 });
  const step = (by: number) =>
    onChange({ ...child, age: Math.min(ADULT_AGE, Math.max(0, child.age + by)) });
  return (
    <li class={child.age >= ADULT_AGE ? "child-row child-adult" : "child-row"}>
      <input
        class="child-name"
        value={child.name}
        maxLength={MAX_NICKNAME}
        placeholder={t.profile.nickname}
        aria-label={fmt(t.profile.nicknameLabel, { n: index + 1 })}
        onInput={(e) => onChange({ ...child, name: e.currentTarget.value })}
      />
      <div class="stepper" role="group" aria-label={fmt(t.profile.ageOf, { who })}>
        <button
          type="button"
          class="stepper-btn"
          aria-label={fmt(t.profile.younger, { who })}
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
          aria-label={fmt(t.profile.older, { who })}
          disabled={child.age >= ADULT_AGE}
          onClick={() => step(1)}
        >
          <Icon name="plus" />
        </button>
      </div>
      {onRemove && (
        <button type="button" class="child-remove" aria-label={fmt(t.profile.removeChild, { who })} onClick={onRemove}>
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
    if (!parsedRegions) return setError(t.profile.regionsInvalid);
    if (services.length === 0) return setError(t.profile.servicesMissing);
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
      setError(err instanceof Error ? err.message : t.profile.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="panel profile" onSubmit={submit}>
      <h2>{firstRun ? t.profile.firstTitle : t.profile.title}</h2>
      <p class="muted">{t.profile.intro}</p>

      <fieldset class="field children">
        <legend>{t.profile.children}</legend>
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
            {t.profile.addChild}
          </button>
        )}
        <small class="muted">{fmt(t.profile.childrenHint, { adult: ADULT_AGE })}</small>
      </fieldset>

      <fieldset class="field">
        <legend>{t.profile.services}</legend>
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
        <span>{t.profile.regions}</span>
        <input value={regions} onInput={(e) => setRegions(e.currentTarget.value)} placeholder="SE" />
        <small class="muted">{t.profile.regionsHint}</small>
      </label>

      <fieldset class="field">
        <legend>{t.profile.avoid}</legend>
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
        <small class="muted">{t.profile.avoidHint}</small>
      </fieldset>

      <fieldset class="field">
        <legend>{t.profile.genres}</legend>
        <div class="chips">
          {GENRES.map((g) => (
            <label key={g} class="chip">
              <input
                type="checkbox"
                checked={genres.includes(g)}
                onChange={() => setGenres(toggle(genres, g))}
              />
              {genreLabel(g)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset class="field profile-defaults">
        <legend>{t.profile.defaults}</legend>
        <small class="muted">{t.profile.defaultsHint}</small>
        <div class="filters-grid">
          <StopSlider
            id="profile-length"
            label={t.finder.maxLength}
            stops={LENGTH_STOPS}
            value={runtime}
            valueText={
              runtime !== null && runtime <= SHORT_MAX_MIN
                ? fmt(t.profile.lengthShorts, { length: lengthLabel(runtime) })
                : lengthLabel(runtime)
            }
            tick={lengthTick}
            onChange={setRuntime}
          />
          <StopSlider
            id="profile-score"
            label={t.finder.minScore}
            stops={SCORE_STOPS}
            value={minImdb}
            valueText={minImdb > SCORE_STOPS[0] ? `${minImdb}+` : t.finder.any}
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
              {t.profile.saving}
            </>
          ) : firstRun ? (
            t.profile.start
          ) : (
            t.profile.save
          )}
        </button>
        {saved && !firstRun && <span class="muted">{t.profile.saved}</span>}
      </div>
    </form>
  );
}
