import { describe, expect, it } from "vitest";
import { nearestStop, SCORE_STOPS, scoreTick } from "./format";
import {
  cycleGenre,
  DEFAULT_FILTERS,
  favouriteTitles,
  genreState,
  isDefault,
  profileFilters,
  quickChips,
} from "./quick";
import type { Profile, TitleMark } from "./types";

const profile = (patch: Partial<Profile> = {}): Profile => ({
  children_ages: [4],
  regions: ["SE"],
  services: ["netflix"],
  preferred_genres: ["Animation", "Family", "Fantasy", "Music"],
  avoid_categories: [],
  max_runtime_min: null,
  min_imdb_rating: null,
  ...patch,
});

const mark = (name: string, patch: Partial<TitleMark> = {}): TitleMark => ({
  key: `tv:${name}`,
  title: { media_type: "tv", tmdb_id: 1 },
  name,
  year: 2020,
  poster_url: null,
  seen: true,
  liked_adults: false,
  liked_child: false,
  rewatch: false,
  ban: null,
  ban_active: false,
  updated_at: "2026-10-01T00:00:00Z",
  ...patch,
});

const labels = (...args: Parameters<typeof quickChips>) => quickChips(...args).map((c) => c.label);

describe("quickChips", () => {
  it("leads with Shorts for little ones and uses the favourite genres", () => {
    expect(labels(profile(), [], "movie", true)).toEqual([
      "Shorts",
      "Series",
      "New",
      "Well rated",
      "Animation",
      "Family",
      "Fantasy",
    ]);
  });

  it("puts Series first for older kids and falls back to common genres", () => {
    expect(labels(profile({ children_ages: [9, 12], preferred_genres: [] }), [], "movie", true)).toEqual([
      "Series",
      "Shorts",
      "New",
      "Well rated",
      "Animation",
      "Family",
      "Comedy",
    ]);
  });

  it("only offers genres the chosen type has", () => {
    const p = profile({ preferred_genres: ["Music", "Kids", "Science Fiction"] });
    expect(labels(p, [], "tv", true).slice(4)).toEqual(["Kids", "Sci-fi"]);
    expect(labels(p, [], "short", true).slice(4)).toEqual(["Music", "Sci-fi"]);
  });

  it("asks Nido for titles like the ones the family loves", () => {
    const marks = [
      mark("Bluey", { rewatch: true }),
      mark("Gabby's Dollhouse", { liked_child: true, updated_at: "2026-10-30T00:00:00Z" }),
      mark("Paddington", { liked_child: true }),
    ];
    const asks = quickChips(profile(), marks, "movie", true).filter((c) => c.kind === "ask");
    expect(asks.map((c) => c.label)).toEqual(["Like Bluey", "Like Gabby's Dollhouse"]);
    expect(asks[0]).toMatchObject({ icon: "repeat", question: expect.stringContaining("similar to Bluey") });
    expect(quickChips(profile(), marks, "movie", false).some((c) => c.kind === "ask")).toBe(false);
  });

  it("toggles its filter and back", () => {
    const chips = quickChips(profile(), [], "movie", true);
    for (const c of chips) {
      if (c.kind !== "filter") continue;
      const on = c.toggle(DEFAULT_FILTERS);
      expect(c.on(on)).toBe(true);
      expect(isDefault(c.toggle(on))).toBe(true);
    }
  });
});

describe("profile defaults", () => {
  it("start Find at the profile's length and score, snapped to the stops", () => {
    expect(profileFilters(profile())).toEqual(DEFAULT_FILTERS);
    expect(profileFilters(profile({ max_runtime_min: 90, min_imdb_rating: 6.5 }))).toMatchObject({
      kind: "movie",
      runtime: 60,
      minImdb: 7,
    });
    expect(profileFilters(profile({ max_runtime_min: 30 }))).toMatchObject({ kind: "short", runtime: 30 });
  });

  it("make chips switch off back to the profile's values", () => {
    const p = profile({ max_runtime_min: 120, min_imdb_rating: 6 });
    const base = profileFilters(p);
    for (const c of quickChips(p, [], "movie", true)) {
      if (c.kind !== "filter") continue;
      const on = c.toggle(base);
      expect(c.on(on)).toBe(true);
      expect(isDefault(c.toggle(on), base)).toBe(true);
    }
    expect(isDefault(DEFAULT_FILTERS, base)).toBe(false);
  });

  it("turn Well rated off to Any when the profile already asks for 7", () => {
    const p = profile({ min_imdb_rating: 7 });
    const rated = quickChips(p, [], "movie", true).find((c) => c.id === "rated")!;
    expect(rated.kind === "filter" && rated.toggle(profileFilters(p)).minImdb).toBe(SCORE_STOPS[0]);
  });
});

describe("nearestStop", () => {
  it("snaps to the closest stop, the stricter one on a tie", () => {
    expect(nearestStop([10, 30, 40, 60, 120, null], 90)).toBe(60);
    expect(nearestStop([10, 30, 40, 60, 120, null], 100)).toBe(120);
    expect(nearestStop([4, 6, 7, 8, 9], 6.5)).toBe(6);
    expect(nearestStop([4, 6, 7, 8, 9], 6.5, "higher")).toBe(7);
    expect(nearestStop([4, 6, 7, 8, 9], 6.4, "higher")).toBe(6);
    expect(nearestStop([4, 6, 7, 8, 9], null)).toBe(null);
  });
});

describe("favouriteTitles", () => {
  it("skips hidden titles and plain seen ones", () => {
    const marks = [
      mark("Seen only"),
      mark("Hidden", { rewatch: true, ban_active: true }),
      mark("Loved", { liked_child: true }),
    ];
    expect(favouriteTitles(marks).map((m) => m.name)).toEqual(["Loved"]);
  });
});

describe("isDefault", () => {
  it("notices any changed filter", () => {
    expect(isDefault(DEFAULT_FILTERS)).toBe(true);
    expect(isDefault({ ...DEFAULT_FILTERS, since: "" })).toBe(false);
    expect(isDefault({ ...DEFAULT_FILTERS, genres: ["Family"] })).toBe(false);
    expect(isDefault({ ...DEFAULT_FILTERS, excludeGenres: ["Comedy"] })).toBe(false);
  });
});

describe("cycleGenre", () => {
  it("steps a genre through include, exclude and off", () => {
    const included = cycleGenre(DEFAULT_FILTERS, "Comedy");
    expect([included.genres, included.excludeGenres]).toEqual([["Comedy"], []]);
    const excluded = cycleGenre(included, "Comedy");
    expect([excluded.genres, excluded.excludeGenres]).toEqual([[], ["Comedy"]]);
    expect(genreState(excluded, "Comedy")).toBe("exclude");
    const off = cycleGenre(excluded, "Comedy");
    expect(isDefault(off)).toBe(true);
  });

  it("keeps the other genres as they are", () => {
    const f = { ...DEFAULT_FILTERS, genres: ["Animation"], excludeGenres: ["Comedy"] };
    expect(genreState(f, "Animation")).toBe("include");
    expect(cycleGenre(f, "Family").genres).toEqual(["Animation", "Family"]);
    expect(cycleGenre(f, "Family").excludeGenres).toEqual(["Comedy"]);
  });

  it("lets a quick genre chip include a genre that was ruled out", () => {
    const f = { ...DEFAULT_FILTERS, excludeGenres: ["Family"] };
    const chip = quickChips(profile({ preferred_genres: ["Family"] }), [], "movie", false).find(
      (c) => c.id === "genre:Family",
    );
    if (chip?.kind !== "filter") throw new Error("no Family chip");
    const on = chip.toggle(f);
    expect([on.genres, on.excludeGenres]).toEqual([["Family"], []]);
  });
});

describe("scoreTick", () => {
  it("shows the lowest stop as Any", () => {
    expect(SCORE_STOPS.map(scoreTick)).toEqual(["Any", "6", "7", "8", "9"]);
  });
});
