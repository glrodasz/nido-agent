// Keeps the app on one address. Firebase Hosting always serves the site on <project>.web.app and
// <project>.firebaseapp.com too, and neither can be turned off, so a page opened on a default
// domain that is not the canonical one is sent to the same path on the canonical origin.
// Firebase's reserved /__/ paths (the sign-in handler, among others) are left alone.
// Self-contained (no imports or outer names): Base.astro inlines its source in <head>.
export function canonicalRedirect(href: string, canonicalOrigin: string): string | null {
  const here = new URL(href);
  const canonical = new URL(canonicalOrigin);
  if (here.host === canonical.host) return null;
  if (!/(^|\.)(web\.app|firebaseapp\.com)$/.test(here.hostname)) return null;
  if (here.pathname.startsWith("/__/")) return null;
  return canonical.origin + here.pathname + here.search + here.hash;
}
