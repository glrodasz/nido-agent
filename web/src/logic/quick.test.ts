import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, favouriteTitles, isDefault, quickChips } from "./quick";
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
  });
});
