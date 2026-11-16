/* Dev harness only. node_modules is a symlink in worktrees, so Vite must be allowed to serve fonts from outside the root.
   Run: npx vite --config src/map/dev/vite.config.ts --port 5181 */
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  root: new URL("../../..", import.meta.url).pathname,
  plugins: [preact()],
  server: { fs: { strict: false } },
});
