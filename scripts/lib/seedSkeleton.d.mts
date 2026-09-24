/**
 * Types for the seed skeleton reader, so a spec importing it is checked rather
 * than silently `any`. See `migrationDependencyOrder.d.mts` for why a `.mjs`
 * build script carries its types beside it.
 */

export declare class SeedShapeError extends Error {
  constructor(message: string);
}

/** Everything a seed carries but its rows. */
export interface SeedShape {
  /** Every line through the line `VALUES`, verbatim. */
  header: string;
  /** The `ON CONFLICT … ;` clause that ends the rows, verbatim. */
  onConflict: string;
  /** Statements after the clause, trimmed. Empty when there are none. */
  tail: string;
  /** Tuples read between `VALUES` and the clause. */
  tupleCount: number;
  /**
   * The first table an `INSERT INTO` in the header names — the seeded table,
   * unless an earlier statement in the header inserts elsewhere, as v15 onward
   * does. Mission Control's reading, ported as it is; for a report only, and
   * the manifest does not carry it.
   */
  target: string | null;
}

export declare function linesOf(chunks: AsyncIterable<string>): AsyncGenerator<string>;

export declare function assertDollarQuotesBalanced(tuple: string, ordinal: number): void;

export declare function readSeedShape(chunks: AsyncIterable<string>): Promise<SeedShape>;

export declare function seedSkeleton(shape: SeedShape): string;
