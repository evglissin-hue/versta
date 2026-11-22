import { defineConfig } from "@playwright/test";
// End to end rides run against the production build with the built-in GPS simulator.
// CHROME_PATH runs them on another Chromium binary (a container without Google Chrome).
const exe = process.env.CHROME_PATH;
// E2E_PORT serves the build on another port, so worktrees running at once never test each other's build.
const port = Number(process.env.E2E_PORT ?? 4173);
export default defineConfig({
  testDir: "tests/e2e", timeout: 180_000, retries: 0, reporter: "list",
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 390, height: 844 }, ...(exe ? {} : { channel: "chrome" as const }), launchOptions: { ...(exe ? { executablePath: exe } : {}), args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] } },
  webServer: { command: `npx vite preview --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: port === 4173, timeout: 60_000 }
});
