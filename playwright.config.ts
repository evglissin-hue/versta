import { defineConfig } from "@playwright/test";
// End to end rides run against the production build with the built-in GPS simulator.
// CHROME_PATH runs them on another Chromium binary (a container without Google Chrome).
const exe = process.env.CHROME_PATH;
export default defineConfig({
  testDir: "tests/e2e", timeout: 180_000, retries: 0, reporter: "list",
  use: { baseURL: "http://localhost:4173", viewport: { width: 390, height: 844 }, ...(exe ? {} : { channel: "chrome" as const }), launchOptions: { ...(exe ? { executablePath: exe } : {}), args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] } },
  webServer: { command: "npm run preview", url: "http://localhost:4173", reuseExistingServer: true, timeout: 60_000 }
});
