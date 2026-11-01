import { describe, expect, it } from "vitest";
import {
  accessLabel,
  banLabel,
  defaultBanUntil,
  categoryLabel,
  familyLine,
  formatVotes,
  genresFor,
  parseAges,
  parseRegions,
  plural,
  posterHue,
  newestFirst,
  releasedSince,
  seenLast,
  yearSpan,
  serviceBrand,
  sortOffers,
  verdictFor,
  verifiedAgo,
} from "./format";
import type { Offer, Profile } from "./types";

const offer = (o: Partial<Offer>): Offer => ({
  region: "SE",
  provider: "Netflix",
  service: "netflix",
  access: "subscription",
  link: null,
  source: "TMDB (JustWatch)",
  verified_at: "2026-10-25T00:00:00Z",
  ...o,
});

describe("verifiedAgo", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  it("counts whole days", () => {
    expect(verifiedAgo("2026-10-25T08:00:00Z", now)).toBe("today");
    expect(verifiedAgo("2026-10-24T08:00:00Z", now)).toBe("1 day ago");
    expect(verifiedAgo("2026-10-13T12:00:00Z", now)).toBe("12 days ago");
  });
});

describe("sortOffers", () => {
  it("puts subscribed services first and drops duplicates", () => {
    const sorted = sortOffers(
      [
        offer({ provider: "Apple TV", service: null, access: "rent" }),
        offer({ provider: "HBO Max Amazon Channel", service: null, access: "addon" }),
        offer({}),
        offer({}),
        offer({ provider: "Disney Plus", service: "disney_plus" }),
      ],
      ["netflix"],
    );
    expect(sorted.map((o) => o.provider)).toEqual([
      "Netflix",
      "HBO Max Amazon Channel",
      "Apple TV",
      "Disney Plus",
    ]);
  });
});

describe("parsers", () => {
  it("parses ages and rejects adults", () => {
    expect(parseAges("6, 9")).toEqual([6, 9]);
    expect(parseAges("6 19")).toBeNull();
    expect(parseAges("")).toBeNull();
  });
  it("parses regions", () => {
    expect(parseRegions("se, no se")).toEqual(["SE", "NO"]);
    expect(parseRegions("Sweden")).toBeNull();
  });
});

describe("labels", () => {
  it("labels access, categories and votes", () => {
    expect(accessLabel("addon")).toBe("Add-on channel");
    expect(categoryLabel("sex_nudity")).toBe("Sex and nudity");
    expect(categoryLabel("frightening")).toBe("Scary scenes");
    expect(formatVotes(1_234_567)).toBe("1.2M votes");
    expect(formatVotes(45_600)).toBe("46k votes");
  });
});

describe("bans", () => {
  it("defaults to the title's baseline when it is above the youngest", () => {
    expect(defaultBanUntil(4, 11)).toBe(11);
  });

  it("otherwise lifts at the start of the next age range", () => {
    expect(defaultBanUntil(4, 0)).toBe(7);
    expect(defaultBanUntil(4, null)).toBe(7);
    expect(defaultBanUntil(7, 7)).toBe(10);
    expect(defaultBanUntil(16, null)).toBe(17);
    expect(defaultBanUntil(4, 18)).toBe(17);
  });

  it("labels active, lifted and permanent bans", () => {
    const at = "2026-10-25T00:00:00Z";
    expect(banLabel({ scope: "age", until_age: 7, at }, true)).toContain("until your youngest is 7");
    expect(banLabel({ scope: "age", until_age: 7, at }, false)).toContain("back in results");
    expect(banLabel({ scope: "always", until_age: null, at }, true)).toBe("Hidden at every age");
  });
});

describe("serviceBrand", () => {
  it("knows the supported services and nothing else", () => {
    expect(serviceBrand("netflix")).toEqual({ bg: "#e50914", fg: "#ffffff" });
    expect(serviceBrand("mubi")).toBeNull();
    expect(serviceBrand(null)).toBeNull();
  });
});

describe("verdictFor", () => {
  it("calls a title with no misses good for everyone", () => {
    expect(verdictFor([], 7, 4)).toEqual({ level: "fit", label: "Good for all of you" });
  });

  it("asks for a grown-up when the rating is a few years above the youngest", () => {
    expect(verdictFor(["Rated 7+"], 7, 4).level).toBe("grown-up");
  });

  it("saves bigger age gaps for after bedtime", () => {
    expect(verdictFor(["Rated 12+"], 12, 4).level).toBe("later");
  });

  it("names runtime and IMDb misses as settings, not age", () => {
    expect(verdictFor(["Runs 140 min"], 0, 4).level).toBe("settings");
    expect(verdictFor(["Runs 140 min"], null, 4).level).toBe("settings");
  });
});

describe("familyLine", () => {
  const profile = (o: Partial<Profile>): Profile => ({
    children_ages: [4],
    regions: ["SE"],
    services: ["netflix"],
    preferred_genres: [],
    avoid_categories: [],
    max_runtime_min: null,
    min_imdb_rating: null,
    ...o,
  });
  const names = { netflix: "Netflix", disney_plus: "Disney+", hbo_max: "HBO Max" };

  it("names one child and the services", () => {
    expect(familyLine(profile({ services: ["netflix", "disney_plus"] }), names)).toBe(
      "For your 4-year-old · on Netflix and Disney+",
    );
  });

  it("lists several ages youngest first", () => {
    expect(
      familyLine(profile({ children_ages: [9, 6], services: ["netflix", "disney_plus", "hbo_max"] }), names),
    ).toBe("For your kids aged 6 and 9 · on Netflix, Disney+ and HBO Max");
  });
});

describe("posterHue", () => {
  it("is stable and within the colour wheel", () => {
    expect(posterHue(550)).toBe(posterHue(550));
    expect(posterHue(123456)).toBeGreaterThanOrEqual(0);
    expect(posterHue(123456)).toBeLessThan(360);
  });
});

describe("newestFirst", () => {
  it("puts the latest release first and undated titles last", () => {
    const items = [
      { id: 1, released_on: "2019-05-01" },
      { id: 2, released_on: null },
      { id: 3, released_on: "2025-11-20" },
      { id: 4, released_on: "2022-03-04" },
    ];
    expect(newestFirst(items).map((i) => i.id)).toEqual([3, 4, 1, 2]);
  });

  it("keeps the ranking between titles out on the same day", () => {
    const items = [
      { id: 1, released_on: "2024-01-01" },
      { id: 2, released_on: "2024-01-01" },
    ];
    expect(newestFirst(items).map((i) => i.id)).toEqual([1, 2]);
  });
});

describe("releasedSince", () => {
  it("counts whole years back from today", () => {
    expect(releasedSince(5, new Date("2026-10-28"))).toBe(2021);
    expect(releasedSince(null)).toBeNull();
  });
});

describe("seenLast", () => {
  it("moves seen titles to the end and keeps the ranking within each group", () => {
    const seen = new Set([1, 3]);
    expect(seenLast([1, 2, 3, 4, 5], (n) => seen.has(n))).toEqual([2, 4, 5, 1, 3]);
  });

  it("leaves a list without seen titles as it was", () => {
    expect(seenLast([3, 1, 2], () => false)).toEqual([3, 1, 2]);
  });
});

describe("yearSpan", () => {
  it("spans a series up to its latest episode and leaves movies as one year", () => {
    expect(yearSpan({ year: 2018, media_type: "tv", released_on: "2026-09-14" })).toBe("2018–2026");
    expect(yearSpan({ year: 2024, media_type: "tv", released_on: "2024-05-01" })).toBe("2024");
    expect(yearSpan({ year: 2023, media_type: "movie", released_on: "2023-09-24" })).toBe("2023");
  });
});

describe("plural", () => {
  it("counts searches and questions", () => {
    expect(plural(1, "search")).toBe("1 search");
    expect(plural(3, "search")).toBe("3 searches");
    expect(plural(0, "Ask Nido question")).toBe("0 Ask Nido questions");
  });
});

describe("genresFor", () => {
  it("offers each type only the genres TMDB has for it", () => {
    expect(genresFor("movie")).toContain("Romance");
    expect(genresFor("movie")).not.toContain("Kids");
    expect(genresFor("tv")).toContain("Kids");
    expect(genresFor("tv")).not.toContain("Music");
    expect(genresFor("tv")).toContain("Western");
  });
});
