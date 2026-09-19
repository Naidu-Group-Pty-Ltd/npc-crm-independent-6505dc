/**
 * PostgREST JSON-path column reads, for the test doubles.
 *
 * THE PREDICATE IS EMULATED, NEVER FAKED. The screening claim's history is the
 * warning: its test double matched `.or()` strings with a regex, so code and
 * test agreed while only the server disagreed, and the claim had never once
 * succeeded in production. A filter like
 * `source_detail->sanitization_attempt->>at` must therefore be RESOLVED
 * against the row the way PostgREST resolves it against the column — walk the
 * JSON, `->` steps into a key, `->>` extracts the leaf as text, and anything
 * missing along the way is SQL NULL — so a test that passes here is evidence
 * about the filter, not about the double.
 *
 * Shared by every fake PostgREST in this directory for the same reason the
 * production rule is written once: three imitations would drift, and they
 * would drift on exactly the filter that matters.
 */
export function readPostgrestColumn(
  row: Record<string, unknown>, column: string,
): unknown {
  if (!column.includes('->')) return row[column];

  // 'a->b->>c' — every step is a key; the '->>' step marks text extraction.
  const textLeaf = column.includes('->>');
  const steps = column.split(/->>?/);
  let current: unknown = row;
  for (const step of steps.slice(0, -1)) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[step];
  }
  const leaf = steps[steps.length - 1];
  if (!current || typeof current !== 'object') return null;
  const value = (current as Record<string, unknown>)[leaf];
  if (value === undefined || value === null) return null;
  if (!textLeaf) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
