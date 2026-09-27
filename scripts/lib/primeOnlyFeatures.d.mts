/**
 * Types for the prime-only register, so a spec importing it is checked rather
 * than silently `any`. See `migrationDependencyOrder.d.mts` for why a `.mjs`
 * script carries its types beside it.
 */

export interface PrimeOnlyFeature {
  /** Stable key, shared with Mission Control's register. */
  readonly key: string;
  readonly title: string;
  readonly reason: string;
  /** Exact repository paths. */
  readonly files: readonly string[];
  /** Function names, matched by the directory `supabase/functions/<name>/`. */
  readonly functions: readonly string[];
  /** pg_cron jobname globs, `*` being any run of characters. */
  readonly cronJobs: readonly string[];
  /** Storage bucket ids. */
  readonly buckets: readonly string[];
}

export declare const PRIME_ONLY_FEATURES: readonly PrimeOnlyFeature[];

export declare function functionDirectoryOf(path: string): string | null;

export declare function primeOnlyFeatureForPath(path: string): PrimeOnlyFeature | null;

export declare function isPrimeOnlyPath(path: string): boolean;

export declare function primeOnlyFunctionNames(): Set<string>;

export declare function isPrimeOnlyFunction(name: string): boolean;

export declare function primeOnlyFileNames(): Set<string>;

export declare function isPrimeOnlyBucket(id: string): boolean;

export declare function isPrimeOnlyCronJobName(jobname: string): boolean;
