import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

/**
 * A minimal build of the Stage 5 path harness. Deliberately not the app's own
 * config: this needs the `@` alias and Tailwind, and nothing else.
 */
export default defineConfig({
  root: here,
  base: "./",
  plugins: [react()],
  css: { postcss: repoRoot },
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(repoRoot, "src") }],
  },
  build: { outDir: path.resolve(here, "dist"), emptyOutDir: true },
});
