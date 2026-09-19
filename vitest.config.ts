import { inlineXlsxPlugin } from "./vite-inline-xlsx";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Lets a test import a `supabase/functions/_shared` module that uses a Deno
 * `npm:` specifier.
 *
 * Those modules are shared deliberately — the report client, the workflow
 * engine, the metering wrapper — and `src/` unit tests import them so that one
 * implementation is tested once. But Deno resolves `npm:@supabase/supabase-js@2.55.0`
 * from the registry and Vite has no idea what that is, so any test whose import
 * graph reaches one dies at collection with "Failed to resolve import" — a
 * failure about the *bundler*, in a file that has nothing wrong with it.
 *
 * That had taken out `reportDesign`'s conformance and provenance specs, which
 * reach `meteredFetch.ts` through `weasyprintClient.ts`. Nobody had seen it:
 * the `verify` job died at an earlier step, so the one that runs them had never
 * been reached.
 *
 * Stripping the prefix and the version pins resolution back at the node_modules
 * copy, which is the same package. Test-time only — nothing here reaches a
 * bundle or the Deno deploy, where the specifier is correct as written.
 */
function denoNpmSpecifiers(): Plugin {
  return {
    name: "deno-npm-specifiers",
    enforce: "pre",
    resolveId(id) {
      if (!id.startsWith("npm:")) return null;
      const bare = id.slice("npm:".length);
      // Scoped packages keep their leading @; only a trailing @version goes.
      const at = bare.lastIndexOf("@");
      const name = at > 0 ? bare.slice(0, at) : bare;
      return this.resolve(name, undefined, { skipSelf: true });
    },
  };
}

export default defineConfig({
  plugins: [denoNpmSpecifiers(), inlineXlsxPlugin(), react()],
  assetsInclude: ["**/*.xlsx", "**/*.docx"],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },

      // Edge functions are Deno modules, and several of them are imported by
      // tests under `src/` — the report design system is shared source, not a
      // copy. Deno addresses packages as `npm:pkg@version` or
      // `https://esm.sh/pkg@version`; Vite cannot resolve either, so a single
      // module reached transitively fails the whole suite with
      // "Failed to resolve import … Does the file exist?".
      //
      // That is what `src/lib/reportDesign/__tests__/{conformance,provenance}.spec.ts`
      // hit through `_shared/meteredFetch.ts`, taking the `verify` job — and with
      // it every step after it, including `npm run build` — red on main.
      //
      // Mapping the specifier onto the installed package is correct rather than
      // a shim: `@supabase/supabase-js` is a real dependency here at a compatible
      // version, and edge functions resolve the same library from the registry at
      // deploy time. Scoped names are matched first so `@scope/name` keeps its
      // slash.
      { find: /^npm:(@[^/]+\/[^@]+)@.+$/, replacement: "$1" },
      { find: /^npm:([^@][^@]*)@.+$/, replacement: "$1" },
      // `unpdf` is a Deno-only dependency of the stock-list extractor: it is
      // imported dynamically inside the PDF branch and is not a browser
      // dependency of this app, so there is no node_modules copy to map onto.
      // Vite resolves a literal dynamic specifier at transform time anyway,
      // which killed collection for every test that imports `extract.ts` for
      // its HTML or CSV branch. The stub throws if anything ever calls it.
      {
        find: /^https:\/\/esm\.sh\/unpdf@.+$/,
        replacement: path.resolve(__dirname, "./src/test/stubs/unpdf.ts"),
      },
      // `djwt` is Deno-only and addressed by a `deno.land` URL, which neither
      // the `npm:` nor the `esm.sh` rules below match. It arrives only as a
      // transitive import — `clientAccess.ts` -> `authz.ts` -> `auth_v2.ts` ->
      // `jwt.ts` — so a test of the client-access helpers (audit item 36)
      // needs the chain to load without ever signing anything. The stub
      // throws if it is actually used.
      {
        find: /^https:\/\/deno\.land\/x\/djwt@.+$/,
        replacement: path.resolve(__dirname, "./src/test/stubs/djwt.ts"),
      },
      // `cloudflare:workers` is provided by the Workers runtime and by nothing
      // else, so Vite cannot resolve it and collection dies for any test that
      // reaches the Builder Stock PDF election Durable Object. The stub is a
      // base class holding `ctx` and `env` and nothing more — the REAL object
      // is what the tests then construct and drive.
      {
        find: /^cloudflare:workers$/,
        replacement: path.resolve(__dirname, "./src/test/stubs/cloudflareWorkers.ts"),
      },
      { find: /^https:\/\/esm\.sh\/(@[^/]+\/[^@]+)@[^/]+$/, replacement: "$1" },
      { find: /^https:\/\/esm\.sh\/([^@/][^@]*)@[^/]+$/, replacement: "$1" },
    ],
  },
});
