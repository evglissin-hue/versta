import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";

// Route packs (public/packs/**) are large and change rarely: they are cached at runtime, not precached.
export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", "icons/*.svg"],
      manifest: {
        name: "Versta", short_name: "Versta", description: "Rides and walks that tell you their stories as you pass.",
        theme_color: "#0E2233", background_color: "#F5F8F5", display: "standalone", orientation: "portrait", start_url: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: ["packs/**"],
        navigateFallback: "index.html",
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.includes("/packs/"), handler: "CacheFirst",
            options: { cacheName: "versta-packs", rangeRequests: true, cacheableResponse: { statuses: [200] }, expiration: { maxEntries: 2000 } } },
          { urlPattern: ({ url }) => url.hostname === "tiles.openfreemap.org", handler: "CacheFirst",
            options: { cacheName: "versta-tiles", cacheableResponse: { statuses: [0, 200] }, expiration: { maxEntries: 6000, maxAgeSeconds: 60 * 60 * 24 * 60 } } }
        ]
      }
    })
  ],
  build: { target: "es2022", sourcemap: true },
  test: { environment: "node", include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"] }
});
