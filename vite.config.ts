import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "node:child_process";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import { inlineXlsxPlugin } from "./vite-inline-xlsx";
import { stagingTargetPlugin } from "./vite-staging-target";
import {
  parseDeploymentAllowances,
  resolveClientFacingFlag,
} from "./src/lib/clientFacing";
// The pure half of the Supabase target rule — no `import.meta` in it, which is
// what makes it loadable from a Vite config at all.
import {
  projectRefFromUrl,
  resolveSupabaseTarget,
} from "./src/integrations/supabase/supabaseTarget.pure";

// Identifies the deployed build. `version.json` carries the same value, so a
// tab can tell whether it is running the current bundle or a cached older one
// (see src/lib/buildVersion.ts). Commit sha when available, timestamp otherwise.
function resolveBuildId(): string {
  const fromEnv =
    process.env.VITE_BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_REF;
  if (fromEnv) return fromEnv.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return `t${Date.now().toString(36)}`;
  }
}

const BUILD_ID = resolveBuildId();

// Read once, here, so the two halves of the mode cannot be computed from
// different expressions: the constant below is what the running code reads,
// and the allowances are what `__EXCLUDE_*__` gates are derived from wherever
// a repository carries them.
const CLIENT_FACING = resolveClientFacingFlag(process.env.VITE_CLIENT_FACING);
const CLIENT_FACING_ALLOWANCES = parseDeploymentAllowances(
  process.env.VITE_CLIENT_FACING_ALLOW,
);

/**
 * Writes the build id next to the bundle so the running app can compare — and
 * which Supabase project this build resolved, so anything outside the browser
 * can ask without guessing.
 *
 * The backend block is not diagnostics. Reading a deployed bundle for a project
 * name cannot settle the question: the prime's ref is compiled into every build
 * as `FALLBACK_URL`, so a correctly-configured clone names BOTH its own project
 * and the prime's, and no amount of text matching says which one the client
 * uses. Measured 19 Sep 2026, three of four clones were serving a bundle
 * pointed at the prime and every signal the provisioner held was green. This is
 * the build stating, in one line, what it resolved.
 *
 * Resolved through `resolveSupabaseTarget` — the same pure function the running
 * client calls — rather than by reading `process.env` and deciding here. Two
 * implementations of "which project is this" is how a manifest and a client
 * come to disagree, and a manifest that disagrees is worse than none.
 *
 * And the environment it resolves from is VITE'S, never `process.env`. Vite
 * loads `.env`, `.env.local` and `.env.[mode]` into `import.meta.env` and does
 * NOT copy them into `process.env` — so a build configured by a dotenv file
 * rather than by real shell variables put the CLONE's project into the bundle
 * and the PRIME's into this manifest. That is the exact inversion the manifest
 * exists to catch, reported as a clean declaration. `loadEnv(mode, cwd,
 * ["VITE_"])` is the same resolution the client gets — dotenv files first,
 * real process variables overriding them — so the two cannot disagree about
 * the VALUES either, not just about the rule applied to them.
 *
 * A `--mode staging` build is the one case this still cannot describe:
 * `stagingTargetPlugin` retargets by substituting the production literals in
 * source, which no environment read can see. That is deliberate and safe
 * rather than unhandled — such a build is never deployed (the plugin says so,
 * prints a warning, and stamps a fixed banner plus `window.__SUPABASE_TARGET__`
 * into the page), and this manifest is only ever read back from a deployed
 * clone's own URL, where a staging bundle cannot be.
 */
function buildVersionManifest(env: Record<string, string>): Plugin {
  return {
    name: "npc-build-version-manifest",
    apply: "build",
    generateBundle() {
      const target = resolveSupabaseTarget({
        url: env.VITE_SUPABASE_URL?.trim() || undefined,
        anonKey:
          env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
          env.VITE_SUPABASE_ANON_KEY?.trim() ||
          undefined,
      });
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({
          buildId: BUILD_ID,
          supabase: {
            projectRef: projectRefFromUrl(target.url),
            source: target.source,
          },
        }),
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),

    // Client-facing mode, as a literal. It has to be a `define` rather than a
    // function call: `isClientFacingDeployment()` reads THIS, and reading the
    // environment at runtime instead is what broke the mode once already (see
    // src/lib/clientFacing.ts). The prime is the internal operations console,
    // so both resolve to their off values unless a build explicitly opts in.
    __CLIENT_FACING__: JSON.stringify(CLIENT_FACING),
    __CLIENT_FACING_ALLOW__: JSON.stringify(CLIENT_FACING_ALLOWANCES),
  },
  plugins: [
    // Inert unless run with `--mode staging` AND the local staging variables
    // are set; see vite-staging-target.ts. Gating on the mode is what stops a
    // default build being retargeted by a `.env.local` on disk. Runs before
    // everything else so the retarget applies to source, not to output.
    stagingTargetPlugin(mode, loadEnv(mode, process.cwd(), ["STAGING_"])),
    inlineXlsxPlugin(),
    react(),
    mcpPlugin(),
    // The client's own environment, resolved by Vite — see the function's
    // header. `process.env` alone would miss every dotenv-configured build.
    buildVersionManifest(loadEnv(mode, process.cwd(), ["VITE_"])),
  ],
  assetsInclude: ["**/*.xlsx", "**/*.docx"],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /src\/lib\/security\/vendor\/qrcode/],
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-popover', '@radix-ui/react-select', '@radix-ui/react-tabs', '@radix-ui/react-tooltip', '@radix-ui/react-dropdown-menu'],
          'vendor-charts': ['recharts'],
          'vendor-pdf': ['pdf-lib', 'jspdf'],
          'vendor-utils': ['date-fns', 'lucide-react', 'zod', 'react-hook-form'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
}));

