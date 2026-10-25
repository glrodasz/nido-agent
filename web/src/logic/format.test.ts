import { describe, expect, it } from "vitest";
import {
  accessLabel,
  categoryLabel,
  formatVotes,
  parseAges,
  parseRegions,
  serviceBrand,
  sortOffers,
  verifiedAgo,
} from "./format";
import type { Offer } from "./types";

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

describe("serviceBrand", () => {
  it("knows the supported services and nothing else", () => {
    expect(serviceBrand("netflix")).toEqual({ bg: "#e50914", fg: "#ffffff" });
    expect(serviceBrand("mubi")).toBeNull();
    expect(serviceBrand(null)).toBeNull();
  });
});
