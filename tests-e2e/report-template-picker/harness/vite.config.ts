import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

/**
 * A minimal build of the harness page. Deliberately NOT the app's own config:
 * this needs the `@` alias, Tailwind (via the repo's postcss config) and
 * nothing else, and it must not drag in the app's chunking, sentry or
 * staging-target plumbing.
 */
export default defineConfig({
  root: here,
  base: "./",
  plugins: [react()],
  css: { postcss: repoRoot },
  resolve: {
    alias: [
      // Keep the harness off the network: the picker's only outward
      // dependency resolves to a fixture-backed stub.
      { find: /^@\/lib\/secureInvoke$/, replacement: path.resolve(here, "stubs.ts") },
      { find: "@", replacement: path.resolve(repoRoot, "src") },
    ],
  },
  build: { outDir: path.resolve(here, "dist"), emptyOutDir: true },
});
