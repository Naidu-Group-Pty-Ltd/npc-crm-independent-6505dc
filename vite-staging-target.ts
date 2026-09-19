import type { Plugin } from "vite";

/**
 * Local-only Supabase retarget, for running the SPA against a **non-production**
 * Supabase project (a preview branch) in a browser.
 *
 * Why a build-time transform rather than env-driven modules: the production
 * project ref and its publishable key are baked in as literals in 34 source
 * files (`src/integrations/supabase/client.ts` is generated and must not be
 * hand-edited; the portal/auth modules deliberately hold their own copies so a
 * missing env var can never silently produce a `undefined/functions/v1/...`
 * URL — see the header of `src/lib/internalMessageAttachments.ts`). Rewriting
 * all 34 to read `import.meta.env` would be a large change to production auth
 * paths for the sole benefit of local testing. Substituting the two literals at
 * bundle time changes no shipped code and cannot half-apply: either every
 * occurrence is the staging project or the plugin is inert.
 *
 * Activation is explicit and fails closed:
 *   - inert unless the Vite mode is exactly `staging` (`--mode staging`). This
 *     matters: `loadEnv` reads the dotenv FILE, so gating on the variables
 *     alone meant a plain `npm run build` on a machine that happened to have a
 *     `.env.local` produced a staging-pointing bundle carrying a STAGING
 *     banner. A default build must never be retargetable by a file on disk;
 *   - and inert unless BOTH `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY`
 *     are set (put them in a local, git-ignored `.env.local` — never commit
 *     them);
 *   - throws if the configured URL is the production project, so a misconfigured
 *     run cannot quietly point a "staging" browser session at production;
 *   - `apply` is unset on purpose: it must work for `vite dev` and for
 *     `vite build` + `vite preview`, which is what the browser tests serve.
 *
 * It also injects a fixed STAGING banner into `index.html` so no screenshot of
 * a retargeted session can be mistaken for production, and a
 * `window.__SUPABASE_TARGET__` marker the browser tests assert on.
 */

/** The production project. Never a legal retarget destination. */
const PRODUCTION_URL = "https://dduzbchuswwbefdunfct.supabase.co";
const PRODUCTION_REF = "dduzbchuswwbefdunfct";

const TRANSFORMABLE = /\.(ts|tsx|js|jsx)$/;

function projectRefOf(url: string): string {
  return new URL(url).hostname.split(".")[0];
}

/** The only mode that may retarget. Anything else is inert. */
export const STAGING_MODE = "staging";

export function stagingTargetPlugin(
  mode: string,
  env: Record<string, string> = {},
): Plugin {
  if (mode !== STAGING_MODE) {
    return { name: "npc-staging-target-inert" } as Plugin;
  }

  const read = (key: string) => (env[key] ?? process.env[key] ?? "").trim();
  const url = read("STAGING_SUPABASE_URL");
  const anonKey = read("STAGING_SUPABASE_ANON_KEY");

  if (!url || !anonKey) {
    throw new Error(
      "[staging-target] --mode staging was requested but STAGING_SUPABASE_URL / "
        + "STAGING_SUPABASE_ANON_KEY are unset. Refusing to start rather than "
        + "silently serving the production project under a staging label.",
    );
  }

  if (url === PRODUCTION_URL || projectRefOf(url) === PRODUCTION_REF) {
    throw new Error(
      "[staging-target] STAGING_SUPABASE_URL points at the production project. " +
        "Refusing to start: a retargeted browser session must never reach production.",
    );
  }

  const ref = projectRefOf(url);
  // Production's publishable key, as it appears in source. Read from the
  // generated client so this plugin holds no second copy to drift from.
  let productionAnonKey = "";

  console.warn(
    `[staging-target] ACTIVE — Supabase calls retargeted to ${ref}. ` +
      "This build must not be deployed.",
  );

  return {
    name: "npc-staging-target",
    enforce: "pre",

    transform(code: string, id: string) {
      if (!TRANSFORMABLE.test(id.split("?")[0])) return null;
      if (!code.includes(PRODUCTION_REF)) return null;

      if (!productionAnonKey) {
        const match = code.match(/eyJhbGciOiJIUzI1NiI[A-Za-z0-9._-]+/);
        if (match && code.includes(PRODUCTION_URL)) productionAnonKey = match[0];
      }

      let out = code.split(PRODUCTION_URL).join(url);
      out = out.split(PRODUCTION_REF).join(ref);
      if (productionAnonKey) out = out.split(productionAnonKey).join(anonKey);
      return { code: out, map: null };
    },

    transformIndexHtml(html: string) {
      return {
        html,
        tags: [
          {
            tag: "script",
            children: `window.__SUPABASE_TARGET__=${JSON.stringify({ ref, url })};`,
            injectTo: "head" as const,
          },
          {
            tag: "style",
            children:
              "#npc-staging-banner{position:fixed;inset:0 0 auto 0;z-index:2147483647;" +
              "background:#7f1d1d;color:#fff;font:600 12px/1.6 system-ui,sans-serif;" +
              "text-align:center;letter-spacing:.08em;padding:2px 8px;pointer-events:none}" +
              "body{padding-top:22px!important}",
            injectTo: "head" as const,
          },
          {
            tag: "div",
            attrs: { id: "npc-staging-banner", role: "status" },
            children: `STAGING — synthetic data only · Supabase ${ref} · not production`,
            injectTo: "body-prepend" as const,
          },
        ],
      };
    },
  } as Plugin;
}
