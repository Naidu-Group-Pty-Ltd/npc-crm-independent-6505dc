/**
 * Ambient shims for the Deno edge runtime, for the browser typecheck only.
 *
 * A few `supabase/functions/_shared/*` modules are pure and are imported
 * directly by unit tests under `src/`, which drags them into the app's
 * TypeScript project. That project targets the browser, so it has neither the
 * `Deno` global nor a resolver for `npm:` specifiers, and the shared modules
 * fail to typecheck for reasons that have nothing to do with their own
 * correctness — the real check for that code is the Deno deploy.
 *
 * These declarations exist to describe that runtime, not to widen the app's
 * own types: nothing under `src/` should reference `Deno` or an `npm:`
 * specifier, because neither exists in the browser bundle.
 */

declare const Deno: {
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    toObject(): Record<string, string>;
  };
  resolveDns(hostname: string, recordType: string, options?: unknown): Promise<unknown>;
};

declare module 'npm:@supabase/supabase-js@2.55.0' {
  export * from '@supabase/supabase-js';
}

declare module 'npm:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}

declare module 'npm:zod@3.25.76' {
  export * from 'zod';
}
