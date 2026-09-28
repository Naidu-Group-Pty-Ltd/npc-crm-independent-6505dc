import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * The Edge Function specs written for vitest.
 *
 * `vitest.config.ts` includes `src/**` and nothing else, so until 28 Sep 2026
 * none of the forty-odd `supabase/functions/**\/*.test.ts` files that import
 * vitest ran in any workflow. Eight of them were red when they were first run,
 * and one of those was a live defect: `solicitor-portal-logout` had lost its
 * POST-only and CSRF guards in a merge two months earlier, while its spec kept
 * asserting both. The other seven were contracts whose guard had moved or got
 * stricter while the spec still named the old spelling. A spec that runs
 * nowhere cannot fail, which is the same defect as the guard it describes.
 *
 * Three things differ from the app's suite, each for a measured reason:
 *
 * - **The files are chosen by what they import.** The same tree holds Deno
 *   tests (`Deno.test`, `https://deno.land/std` asserts), which vitest cannot
 *   collect, and CI runs those under `deno test` instead. A spec is in this
 *   list when it imports `vitest`, so a new one joins without an edit here.
 * - **The environment is `node`.** Under `jsdom`, `new URL('./index.ts',
 *   import.meta.url)` resolves against the page's `http://` origin, and
 *   `readFileSync` refuses anything that is not a `file:` URL. Most of these
 *   specs read the function they guard exactly that way.
 * - **No setup file.** `src/test/setup.ts` prepares a browser (`window`,
 *   matchers for the DOM), and it throws under `node`.
 *
 * The aliases are the app's, inherited, so a spec that imports a `_shared`
 * module reaching an `npm:` or `esm.sh` specifier resolves it the same way.
 */
const FUNCTIONS_ROOT = "supabase/functions";

function vitestSpecs(): string[] {
  const entries = readdirSync(FUNCTIONS_ROOT, { recursive: true }) as string[];
  return entries
    .map((entry) => path.posix.join(FUNCTIONS_ROOT, entry.split(path.sep).join("/")))
    .filter((file) => file.endsWith(".test.ts"))
    .filter((file) => /from\s+["']vitest["']/.test(readFileSync(file, "utf8")))
    .sort();
}

// `mergeConfig` concatenates arrays, so the three fields that must REPLACE the
// app's are assigned after the merge rather than merged into it.
const merged = mergeConfig(base, {});
merged.test = {
  ...merged.test,
  include: vitestSpecs(),
  environment: "node",
  setupFiles: [],
};

export default defineConfig(merged);
