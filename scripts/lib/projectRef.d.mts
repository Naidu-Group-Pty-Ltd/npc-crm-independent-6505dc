/**
 * Types for the project-ref reader, so a spec importing it is checked rather
 * than silently `any`. See `migrationDependencyOrder.d.mts` for why a `.mjs`
 * build script carries its types beside it.
 */

/** This checkout's `supabase/config.toml`, from the working directory. */
export declare const CONFIG_TOML_PATH: string;

/** The preamble's `project_id`, or null when the preamble names no project. */
export declare function preambleProjectId(text: string): string | null;

/**
 * The environment's ref, else this checkout's `supabase/config.toml`, else
 * null. Never a literal.
 */
export declare function projectRef(
  env: Record<string, string | undefined>,
  readConfig?: () => string,
): string | null;
