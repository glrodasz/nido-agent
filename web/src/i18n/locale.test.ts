import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { localeBootScript } from "./boot";
import {
  alternateLinks,
  localizePath,
  negotiateLocale,
  pageLocale,
  parseAcceptLanguage,
  resolveLocaleRedirect,
  switchLocalePath,
} from "./locale";
import { MESSAGES } from "./index";

const redirect = (pathname: string, savedLocale: string | null, header: string) =>
  resolveLocaleRedirect({ pathname, savedLocale, languages: parseAcceptLanguage(header) });

describe("resolveLocaleRedirect (Spanish is the unprefixed default)", () => {
  it.each([
    ["/", null, "en-US", "/en"],
    ["/", null, "pt-BR, en;q=0.8", "/pt"],
    ["/", null, "sv, pt;q=0.8", "/pt"],
    ["/", null, "es-ES, en", null],
    ["/", null, "sv", null],
    ["/", "en", "es-ES", "/en"],
    ["/", "es", "en-US", null],
    ["/en", "pt", "pt", null],
    ["/pt", "es", "es", null],
    ["/api/search", "en", "en", null],
    ["/__/auth/handler", "en", "en", null],
    ["/apis", null, "en", "/en/apis"],
    ["/", "garbage", "pt", "/pt"],
  ])("%s with cookie %s and %s → %s", (path, cookie, header, expected) => {
    expect(redirect(path, cookie, header)).toBe(expected);
  });

  it("round-trips paths between languages", () => {
    expect(localizePath("/en", "es")).toBe("/");
    expect(localizePath("/", "pt")).toBe("/pt");
    expect(switchLocalePath("/pt", "en")).toBe("/en");
    expect(pageLocale("/pt")).toBe("pt");
    expect(pageLocale("/")).toBe("es");
    expect(negotiateLocale(["fr", "pt-PT"])).toBe("pt");
  });

  it("lists every language plus x-default", () => {
    expect(alternateLinks("/", "https://nido.example").map((l) => `${l.hreflang} ${l.href}`)).toEqual([
      "es https://nido.example/",
      "en https://nido.example/en",
      "pt https://nido.example/pt",
      "x-default https://nido.example/",
    ]);
  });
});

describe("boot script", () => {
  function boot(pathname: string, cookie: string, languages: string[]) {
    const replaced: string[] = [];
    const attrs = new Set<string>();
    runInNewContext(localeBootScript(), {
      location: { pathname, search: "?invite=abc", hash: "", replace: (to: string) => replaced.push(to) },
      document: {
        cookie,
        documentElement: { setAttribute: (a: string) => attrs.add(a), removeAttribute: (a: string) => attrs.delete(a) },
      },
      navigator: { languages, language: languages[0] },
      setTimeout: () => 0,
    });
    return replaced;
  }

  it("sends a first visit to the browser's language, keeping the query", () => {
    expect(boot("/", "", ["pt-BR", "en"])).toEqual(["/pt?invite=abc"]);
  });

  it("follows the saved choice and leaves prefixed pages alone", () => {
    expect(boot("/", "locale=es", ["en-US"])).toEqual([]);
    expect(boot("/", "theme=x; locale=en", ["es"])).toEqual(["/en?invite=abc"]);
    expect(boot("/en", "locale=pt", ["pt"])).toEqual([]);
  });
});

describe("dictionaries", () => {
  // Same keys at every level, so no language silently falls back to a missing string.
  const shape = (value: unknown): unknown =>
    value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, shape((value as Record<string, unknown>)[k])]))
      : typeof value;

  it.each(["es", "pt"] as const)("%s has every English key", (l) => {
    expect(shape(MESSAGES[l])).toEqual(shape(MESSAGES.en));
  });
});

describe("formatting in the page's language", () => {
  it("writes the family line, ages and counts in Spanish and Portuguese", async () => {
    const i18n = await import("./index");
    const { setLocale, plural } = i18n;
    const { familyLine, verifiedAgo, formatVotes } = await import("../logic/format");
    const profile = {
      children_ages: [9, 6],
      regions: ["SE"],
      services: ["netflix", "disney_plus"],
      preferred_genres: [],
      avoid_categories: [],
      max_runtime_min: null,
      min_imdb_rating: null,
    };
    const names = { netflix: "Netflix", disney_plus: "Disney+" };
    try {
      setLocale("es");
      expect(familyLine(profile, names)).toBe("Para tus hijos de 6 y 9 · en Netflix y Disney+");
      expect(verifiedAgo("2026-10-24T08:00:00Z", new Date("2026-10-25T10:00:00Z"))).toBe("hace 1 día");
      expect(plural(3, i18n.t.quota.search)).toBe("3 búsquedas");
      expect(formatVotes(1_234_567)).toBe("1,2 M votos");
      setLocale("pt");
      expect(familyLine({ ...profile, children_ages: [4] }, names)).toBe(
        "Para o seu filho de 4 · no Netflix e Disney+",
      );
    } finally {
      setLocale("en");
    }
  });
});
