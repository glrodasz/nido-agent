import { plural, t } from "../i18n";
import { describe, expect, it } from "vitest";
import {
  accessLabel,
  banLabel,
  defaultBanUntil,
  categoryLabel,
  familyLine,
  formatVotes,
  isNight,
  genresFor,
  ageLabel,
  childLabel,
  watchingAges,
  parseRegions,
  posterHue,
  largePoster,
  trailerFor,
  newestFirst,
  releasedSince,
  seenLast,
  yearSpan,
  serviceBrand,
  sortOffers,
  verdictFor,
  verifiedAgo,
  searchKind,
  lengthLabel,
  withKind,
  withLength,
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

  it("narrows to the child who is watching, by nickname when there is one", () => {
    const kids = profile({ children_ages: [9, 4], children_names: ["Leo", ""] });
    expect(familyLine(kids, names, 0)).toBe("For Leo, 9 · on Netflix");
    expect(familyLine(kids, names, 1)).toBe("For your 4-year-old · on Netflix");
    expect(familyLine(kids, names, null)).toBe("For your kids aged 4 and 9 · on Netflix");
    expect(familyLine(profile({ children_ages: [18, 4] }), names)).toBe(
      "For your kids aged 4 and 18+ · on Netflix",
    );
  });
});

describe("children", () => {
  const kids: Profile = {
    children_ages: [18, 4, 0],
    children_names: ["Ana", ""],
    regions: ["SE"],
    services: [],
    preferred_genres: [],
    avoid_categories: [],
    max_runtime_min: null,
    min_imdb_rating: null,
  };

  it("labels ages for the stepper, 18 as adult", () => {
    expect(ageLabel(0)).toBe("Under 1");
    expect(ageLabel(1)).toBe("1 year");
    expect(ageLabel(4)).toBe("4 years");
    expect(ageLabel(18)).toBe("Adult · 18+");
  });

  it("labels each child by nickname or age", () => {
    expect(childLabel(kids, 0)).toBe("Ana · 18+");
    expect(childLabel(kids, 1)).toBe("4-year-old");
    expect(childLabel(kids, 2)).toBe("Baby");
  });

  it("picks the ages of whoever watches", () => {
    expect(watchingAges(kids, null)).toEqual([18, 4, 0]);
    expect(watchingAges(kids, 1)).toEqual([4]);
    expect(watchingAges(kids, 7)).toEqual([18, 4, 0]);
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
    expect(plural(1, t.quota.search)).toBe("1 search");
    expect(plural(3, t.quota.search)).toBe("3 searches");
    expect(plural(0, t.quota.chat)).toBe("0 Ask Nido questions");
  });
});

describe("searchKind", () => {
  it("turns Shorts into a movie search of 40 minutes or less", () => {
    expect(searchKind("short", null)).toEqual({ media_type: "movie", max_runtime_min: 40 });
    expect(searchKind("short", 25)).toEqual({ media_type: "movie", max_runtime_min: 25 });
    expect(searchKind("short", 90)).toEqual({ media_type: "movie", max_runtime_min: 40 });
  });

  it("leaves movies and series to the family's max length", () => {
    expect(searchKind("movie", null)).toEqual({ media_type: "movie", max_runtime_min: undefined });
    expect(searchKind("tv", 30)).toEqual({ media_type: "tv", max_runtime_min: 30 });
  });
});

describe("lengthLabel", () => {
  it("names the slider stops", () => {
    expect([10, 40, 60, 120, null].map(lengthLabel)).toEqual(["10 min", "40 min", "1h", "2h", "Any"]);
  });
});

describe("type and length move together", () => {
  const movie = { kind: "movie" as const, runtime: null };

  it("sets the slider when the type changes", () => {
    expect(withKind(movie, "short")).toEqual({ kind: "short", runtime: 40 });
    expect(withKind({ kind: "short" as const, runtime: 10 }, "movie")).toEqual(movie);
    expect(withKind({ kind: "short" as const, runtime: 30 }, "tv")).toEqual({ kind: "tv", runtime: 30 });
  });

  it("switches between Movies and Shorts at 40 minutes", () => {
    expect(withLength(movie, 40)).toEqual({ kind: "short", runtime: 40 });
    expect(withLength({ kind: "short" as const, runtime: 40 }, 60)).toEqual({ kind: "movie", runtime: 60 });
    expect(withLength({ kind: "short" as const, runtime: 40 }, null)).toEqual(movie);
    expect(withLength({ kind: "tv" as const, runtime: null }, 10)).toEqual({ kind: "tv", runtime: 10 });
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

describe("largePoster", () => {
  it("asks TMDB for the bigger size", () => {
    expect(largePoster("https://image.tmdb.org/t/p/w342/abc.jpg")).toBe("https://image.tmdb.org/t/p/w780/abc.jpg");
  });
  it("leaves other URLs alone", () => {
    expect(largePoster("https://example.com/w342/abc.jpg")).toBe("https://example.com/w342/abc.jpg");
  });
});

describe("trailerFor", () => {
  it("prefers the page's language, then English", () => {
    expect(trailerFor({ en: "enTrailer01", es: "esTrailer01" }, "es")).toBe("esTrailer01");
    expect(trailerFor({ en: "enTrailer01" }, "pt")).toBe("enTrailer01");
  });
  it("has nothing when there is no trailer in either", () => {
    expect(trailerFor({ es: "esTrailer01" }, "pt")).toBeNull();
    expect(trailerFor(undefined, "es")).toBeNull();
  });
  it("ignores anything that is not a YouTube id", () => {
    expect(trailerFor({ es: "bad id/../x" }, "es")).toBeNull();
  });
});

describe("isNight", () => {
  const at = (hour: number, minute = 0) => new Date(2026, 10, 2, hour, minute);
  it("is night from 19:00 to 05:59 local time", () => {
    expect(isNight(at(19))).toBe(true);
    expect(isNight(at(23, 30))).toBe(true);
    expect(isNight(at(0))).toBe(true);
    expect(isNight(at(5, 59))).toBe(true);
  });
  it("is day from 06:00 to 18:59", () => {
    expect(isNight(at(6))).toBe(false);
    expect(isNight(at(12))).toBe(false);
    expect(isNight(at(18, 59))).toBe(false);
  });
});
