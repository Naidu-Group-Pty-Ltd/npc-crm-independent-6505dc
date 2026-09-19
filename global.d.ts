// Deno `npm:` specifiers used by shared edge-function modules that `src/` also
// imports. Declared repo-wide so any typecheck config resolves them; at runtime
// Deno resolves the real package and Vitest rewrites the specifier.
declare module 'npm:zod@3.25.76' {
  export * from 'zod';
}

// Deno remote (`https:`) specifiers used by shared edge-function modules. Deno
// resolves and types these at runtime; a repo-wide typecheck cannot fetch them,
// so declare them as `any` shapes here rather than weakening the call sites.
declare module 'https://esm.sh/jszip@3.10.1' {
  const JSZip: any;
  export default JSZip;
}
declare module 'https://esm.sh/xlsx@0.18.5' {
  const XLSX: any;
  export default XLSX;
  export const read: any;
  export const utils: any;
}
declare module 'https://esm.sh/unpdf@0.12.1' {
  export const extractText: any;
  export const getDocumentProxy: any;
}

// Two `_shared` modules that `src/` imports transitively reach Supabase through
// the remote specifier. Map it onto the installed package's own types so the
// call sites keep them.
declare module 'https://esm.sh/@supabase/supabase-js@2.55.0' {
  export * from '@supabase/supabase-js';
}

/*
 * Build-time flags injected by Vite's `define`. Declared here as well as in
 * `src/client-facing.d.ts` because the platform's own typecheck runs under a
 * configuration that does not pick that file up, and an undeclared name there
 * reports as four errors on every build.
 */
declare const __CLIENT_FACING__: boolean;
declare const __CLIENT_FACING_ALLOW__: readonly string[];
