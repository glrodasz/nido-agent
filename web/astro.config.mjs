// @ts-check
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";

// Static build served by Firebase Hosting, which rewrites /api/** to the Cloud Run service
// (firebase.json). In `npm run dev`, /api is proxied to `nido serve` on port 8080.
const api = process.env.NIDO_API_URL || "http://127.0.0.1:8080";

export default defineConfig({
  site: "https://nido-agent.web.app",
  output: "static",
  integrations: [preact()],
  devToolbar: { enabled: false },
  vite: {
    server: { proxy: { "/api": { target: api, changeOrigin: true } } },
  },
});
