import { describe, expect, it } from "vitest";
import { canonicalRedirect } from "./canonical";

const WEB_APP = "https://nido-agent.web.app";
const CUSTOM = "https://nido.guillermorodas.com";

describe("canonicalRedirect", () => {
  it("sends firebaseapp.com to the canonical origin, keeping path, query and hash", () => {
    expect(canonicalRedirect("https://nido-agent.firebaseapp.com/?invite=abc#x", WEB_APP)).toBe(
      "https://nido-agent.web.app/?invite=abc#x",
    );
  });

  it("sends both default domains to a custom canonical domain", () => {
    expect(canonicalRedirect("https://nido-agent.web.app/", CUSTOM)).toBe(`${CUSTOM}/`);
    expect(canonicalRedirect("https://nido-agent.firebaseapp.com/watchlist", CUSTOM)).toBe(
      `${CUSTOM}/watchlist`,
    );
  });

  it("stays put on the canonical origin", () => {
    expect(canonicalRedirect(`${WEB_APP}/?q=1`, WEB_APP)).toBeNull();
    expect(canonicalRedirect(`${CUSTOM}/`, CUSTOM)).toBeNull();
  });

  it("leaves local and other hosts alone", () => {
    expect(canonicalRedirect("http://localhost:4321/", CUSTOM)).toBeNull();
    expect(canonicalRedirect("http://127.0.0.1:8080/", WEB_APP)).toBeNull();
    expect(canonicalRedirect("https://evilweb.app.example.com/", WEB_APP)).toBeNull();
  });

  it("never touches Firebase's reserved paths, such as the sign-in handler", () => {
    expect(
      canonicalRedirect("https://nido-agent.firebaseapp.com/__/auth/handler?apiKey=k", WEB_APP),
    ).toBeNull();
  });
});
