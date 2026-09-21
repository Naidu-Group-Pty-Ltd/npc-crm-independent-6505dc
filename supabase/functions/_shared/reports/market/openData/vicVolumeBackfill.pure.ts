/**
 * Victoria's transaction volumes — one quarter at a time, from both sources.
 *
 * ## The gap this closes
 *
 * `scoreTransactionVolume` is the only PRIMARY demand measure this deployment
 * is entitled to: the other three (rental tightness, sale urgency, absorption)
 * come from vendor feeds nobody here holds, which is what a Domain 403 leaves
 * behind. It needs `VOLUME_BASELINE_PERIODS + 1` — **four** periods carrying a
 * count — to have a baseline it will believe.
 *
 * NSW, Queensland and South Australia pair a count with every period they
 * publish, so Demand scores there. **Victoria prints ONE `No. of Sales` column
 * per workbook**, describing that workbook's own latest quarter, so
 * `parseVicQuarterly` correctly assigns a count to `latestPeriod` and `null`
 * to every other column, and the annual time series carries no count at all.
 * One workbook can therefore yield at most ONE counted period, four are
 * needed, and Demand has been structurally unscoreable in Victoria since the
 * register was built. Measured 21 Sep 2026 on 9 Hollow Street, Golden Square:
 * three of five dimensions scored, 80% of the matrix by nominal weight, with
 * Demand's 15 points among the missing 20.
 *
 * ## Where the quarters are found
 *
 * Two sources, asked together rather than one behind the other, because
 * neither contains the other (see {@link mergeVicQuarterSources}): the
 * publisher's own CKAN catalogue names every release in words, and the
 * Internet Archive holds the bytes the publisher will not serve a script.
 *
 * ## Why the archive answers it
 *
 * The publisher names a SEPARATE workbook per quarter —
 * `median-house-q4-2025.xlsx` — and the Wayback Machine holds them. So the
 * counts are not lost and never were: each quarter's file states its own
 * quarter's count, and loading four files recovers four counted periods. This
 * invents nothing, reads no new publisher, needs no key, and goes through the
 * SAME parser and the same plausibility refusals as the live load. What it
 * changes is only WHICH captures are asked for.
 *
 * ## Two rules
 *
 * **One workbook per invocation.** `market-sales-ingest`'s own history is the
 * reason: five DCJ workbooks in one call hit the edge worker's compute limit.
 * So this module chooses exactly one file — the newest quarter still missing a
 * count — and the caller repeats until `remaining` is empty.
 *
 * **A quarter already counted is never re-read.** The selector is driven by
 * what the register HOLDS rather than by a cursor the caller keeps, so an
 * interrupted backfill resumes correctly and a completed one is a no-op.
 */

import type { VicCatalogueResource } from './vicVpsrCatalogue.pure.ts';

/** Quarter label to the month its period ends in, as `parseVicQuarterly` writes it. */
const QUARTER_END_MONTH: Readonly<Record<string, string>> = {
  '1': '03', '2': '06', '3': '09', '4': '12',
};

/**
 * The period a quarterly workbook's name describes — `YYYY-MM` at the quarter
 * end, the spelling `parseVicQuarterly` gives `latestPeriod`.
 *
 * Read from the NAME rather than from the file, because choosing which file to
 * fetch has to happen before fetching it. The parser remains the authority on
 * what the file actually contains: a name that disagrees with its contents
 * means this file is skipped as already-loaded or loaded twice, and neither
 * writes a wrong number — the row written is always the parser's.
 */
export function periodOfVicQuarterlyName(name: string): string | null {
  const m = /^(?:vpsr-)?median-(?:house|unit)-q([1-4])-(\d{4})\.xlsx?$/i.exec(String(name ?? '').trim());
  if (!m) return null;
  const month = QUARTER_END_MONTH[m[1]];
  return month ? `${m[2]}-${month}` : null;
}

/**
 * Where a quarter was found. Both sources are asked, every time.
 *
 * Neither is a superset of the other, measured 21 Sep 2026:
 *
 * - The ARCHIVE holds `median-house-q3-2025.xls`, which the loader reads
 *   today, and the catalogue's own listing for that dataset is incomplete.
 * - The CATALOGUE lists `Median-House-VGS-1st-Qtr-2024.xls`, a spelling no
 *   filename pattern here matches, so the archive walk was blind to it even
 *   though the bytes are in the archive.
 *
 * So they run together and the results are unioned. A quarter found by either
 * is a quarter we can try; a quarter found by BOTH carries two ways to fetch
 * it, and the canonical URL is tried before the pattern-matched capture
 * because it is the publisher's own answer to "which file is this quarter".
 */
export type VicQuarterSource = 'catalogue' | 'archive' | 'both';

export interface VicQuarterCandidate {
  readonly period: string;
  /** The publisher's canonical URL, where the catalogue named one. */
  readonly canonicalUrl: string | null;
  /** The archived original, where the pattern walk found one. */
  readonly archivedUrl: string | null;
  readonly discoveredBy: VicQuarterSource;
}

/**
 * Every quarter either source knows about, newest first.
 *
 * `floor` keeps a backfill to a recent baseline rather than a history — see
 * {@link chooseNextVicVolumeFile}.
 */
export function mergeVicQuarterSources(
  catalogue: ReadonlyArray<VicCatalogueResource>,
  archived: ReadonlyArray<{ original: string }>,
  floor = '0000-00',
): VicQuarterCandidate[] {
  const byPeriod = new Map<string, { canonical: string | null; archived: string | null }>();
  const put = (period: string | null, key: 'canonical' | 'archived', url: string) => {
    if (!period || period < floor) return;
    const held = byPeriod.get(period) ?? { canonical: null, archived: null };
    // First wins within a source: the callers hand these in newest-capture
    // order, and a second URL for the same quarter is the same quarter.
    if (!held[key]) held[key] = url;
    byPeriod.set(period, held);
  };

  for (const r of catalogue ?? []) put(r.period, 'canonical', r.url);
  for (const f of archived ?? []) {
    const name = String(f?.original ?? '');
    put(periodOfVicQuarterlyName(name.slice(name.lastIndexOf('/') + 1)), 'archived', name);
  }

  return [...byPeriod.entries()]
    .map(([period, held]) => ({
      period,
      canonicalUrl: held.canonical,
      archivedUrl: held.archived,
      discoveredBy: (held.canonical && held.archived
        ? 'both'
        : held.canonical ? 'catalogue' : 'archive') as VicQuarterSource,
    }))
    .sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));
}

/**
 * The next quarter to read, from the merged set.
 *
 * Same rule as {@link chooseNextVicVolumeFile} and for the same reasons — the
 * register's own contents decide, so an interrupted backfill resumes and a
 * finished one is a no-op — but over both sources rather than one.
 */
export function chooseNextVicQuarter(
  candidates: ReadonlyArray<VicQuarterCandidate>,
  countedPeriods: ReadonlyArray<string>,
): { next: VicQuarterCandidate | null; remaining: ReadonlyArray<VicQuarterCandidate> } {
  const counted = new Set(countedPeriods ?? []);
  const remaining = (candidates ?? []).filter((c) => !counted.has(c.period));
  return { next: remaining[0] ?? null, remaining };
}

export interface VicVolumeCandidate {
  /** The archived original URL. */
  readonly original: string;
  /** `YYYY-MM` the file's name says it reports. */
  readonly period: string;
}

export interface VicVolumeChoice {
  readonly next: VicVolumeCandidate | null;
  /** Quarters this dwelling type still has no count for, newest first. */
  readonly remaining: ReadonlyArray<VicVolumeCandidate>;
  /** Quarters the register already carries a count for, newest first. */
  readonly alreadyCounted: ReadonlyArray<string>;
}

/**
 * Which quarterly workbook to read next.
 *
 * @param archived Every quarterly file the archive lists for this dwelling
 *   type, in any order; `original` is the publisher's URL.
 * @param countedPeriods Periods the register already holds a Victorian count
 *   for, at this dwelling type.
 * @param floor The oldest period worth reaching for. A backfill is for a
 *   BASELINE, not a history: `scoreTransactionVolume` compares the latest
 *   count against the mean of the priors, and a count from a market five years
 *   ago is a worse baseline than one from last year, not a better one.
 */
export function chooseNextVicVolumeFile(
  archived: ReadonlyArray<{ original: string }>,
  countedPeriods: ReadonlyArray<string>,
  floor = '0000-00',
): VicVolumeChoice {
  const counted = new Set(countedPeriods);
  const seen = new Set<string>();
  const candidates: VicVolumeCandidate[] = [];

  for (const f of archived ?? []) {
    const name = String(f?.original ?? '').slice(String(f?.original ?? '').lastIndexOf('/') + 1);
    const period = periodOfVicQuarterlyName(name);
    if (!period || period < floor) continue;
    // One candidate per quarter. The archive can list the same quarter's file
    // at more than one URL (a path change, a re-publication), and reading both
    // would spend an invocation to write the row the first one already wrote.
    if (seen.has(period)) continue;
    seen.add(period);
    if (counted.has(period)) continue;
    candidates.push({ original: f.original, period });
  }

  candidates.sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));
  return {
    next: candidates[0] ?? null,
    remaining: candidates,
    alreadyCounted: [...counted].sort().reverse(),
  };
}

/**
 * How many more counted quarters Demand needs before it can be scored.
 *
 * Stated so the backfill can say what it is FOR on every call, rather than
 * reporting a row count that means nothing on its own. Four is
 * `VOLUME_BASELINE_PERIODS + 1` in `demandScoring.pure.ts`; it is restated
 * here as a parameter rather than imported so this module stays free of the
 * scorer, and `vicVolumeBackfill.spec.ts` pins the two together.
 */
export function quartersStillNeeded(countedPeriods: ReadonlyArray<string>, required = 4): number {
  return Math.max(0, required - new Set(countedPeriods ?? []).size);
}
