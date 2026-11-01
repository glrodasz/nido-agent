// @ts-check
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";

// Static build served by Firebase Hosting, which rewrites /api/** to the Cloud Run service
// (firebase.json). In `npm run dev`, /api is proxied to `nido serve` on port 8080.
const api = process.env.NIDO_API_URL || "http://127.0.0.1:8080";
// The app's one public address: canonical and social-preview URLs, and where the default Firebase
// domains redirect to (src/logic/canonical.ts). PUBLIC_SITE_URL is set for a custom domain;
// otherwise it is https://<project>.web.app.
const site = (
  process.env.PUBLIC_SITE_URL ||
  `https://${process.env.PUBLIC_FIREBASE_PROJECT_ID || "nido-agent"}.web.app`
).replace(/\/+$/, "");

export default defineConfig({
  site,
  output: "static",
  integrations: [preact()],
  devToolbar: { enabled: false },
  vite: {
    server: { proxy: { "/api": { target: api, changeOrigin: true } } },
  },
});
