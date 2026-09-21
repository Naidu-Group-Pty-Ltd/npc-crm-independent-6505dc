/**
 * Victoria's property-sales workbooks, read from the state's own catalogue.
 *
 * ## Why this replaces guessing at file names
 *
 * The loader discovered VPSR workbooks by matching the archive's index against
 * `median-(house|unit)-q([1-4])-(\d{4})`. That is a guess about how a publisher
 * spells things, and it was wrong in both directions — measured 21 Sep 2026
 * from `discover.data.vic.gov.au`:
 *
 * - The catalogue lists `Median-House-VGS-1st-Qtr-2024.xls`. The pattern
 *   cannot match it, so that quarter was invisible to the loader and looked
 *   like a quarter the publisher had never released. Three of the six holes in
 *   the archive listing are this.
 * - The pattern also cannot tell a quarter that does not exist from one it
 *   cannot spell, which is the reading that matters: asked whether Victoria
 *   had published 2026 figures, the only honest answer available from a
 *   filename regex is "no file I recognise", not "no file".
 *
 * `discover.data.vic.gov.au` is a CKAN instance. It answers a scripted client
 * (HTTP 200, no challenge), it is the publisher's own index, and it names every
 * resource with the quarter in words — "December 2025 Quarter" — so the period
 * comes from the publisher rather than from a convention we inferred.
 *
 * ## What it does NOT solve
 *
 * The catalogue is an index, not a mirror. Every resource URL it lists points
 * back at `www.land.vic.gov.au`, which answers `403` with
 * `<title>Just a moment...</title>` to anything that is not a browser —
 * re-measured the same day, so the archive is still how the BYTES are had.
 *
 * That split is the point. Discovery is live and authoritative; retrieval is
 * archived. Asking the catalogue is what lets this pipeline notice a 2026
 * quarter the day it appears, under whatever name Victoria chooses, instead of
 * waiting for someone to widen a regex.
 *
 * One measured curiosity, recorded because it justifies the fallback: one of
 * the catalogue's own resource URLs is a `web.archive.org` link. The state
 * uses the Internet Archive as a source for its older files too.
 */

/** The publisher's own index. CKAN's search API, JSON, no key. */
export const VIC_CKAN_SEARCH_URL =
  'https://discover.data.vic.gov.au/api/3/action/package_search'
  + '?q=%22Victorian%20Property%20Sales%20Report%22&rows=25';

export type VicCatalogueDwelling = 'house' | 'attached' | 'land' | 'unknown';

export interface VicCatalogueResource {
  /** The dataset that lists it, as the catalogue titles it. */
  readonly dataset: string;
  /** The resource's own name — "December 2025 Quarter". */
  readonly name: string;
  /** Where the publisher says the file is. Usually behind the challenge. */
  readonly url: string;
  readonly fileName: string;
  readonly dwelling: VicCatalogueDwelling;
  /** `YYYY-MM` at the quarter end, or null where the resource is not quarterly. */
  readonly period: string | null;
}

const MONTH_END: Readonly<Record<string, string>> = {
  march: '03', june: '06', september: '09', december: '12',
  mar: '03', jun: '06', sep: '09', sept: '09', dec: '12',
};

/** `1st`/`2nd`/`3rd`/`4th` quarter, as the 2024 files spell it. */
const ORDINAL_END: Readonly<Record<string, string>> = {
  '1st': '03', '2nd': '06', '3rd': '09', '4th': '12',
  q1: '03', q2: '06', q3: '09', q4: '12',
};

/**
 * The quarter a catalogue resource describes.
 *
 * The resource NAME is read first because it is the publisher's own words —
 * "December 2025 Quarter" — and survives every file-naming change. The file
 * name is the fallback, and it is read in both spellings the catalogue
 * actually contains: `median-house-q4-2025.xls` and
 * `Median-House-VGS-1st-Qtr-2024.xls`.
 */
export function periodOfVicCatalogueResource(name: string, url = ''): string | null {
  const words = String(name ?? '').toLowerCase();
  const byWords = words.match(/\b(march|june|september|december|mar|jun|sept?|dec)\w*\s+(\d{4})\b/);
  if (byWords) {
    const end = MONTH_END[byWords[1]];
    if (end) return `${byWords[2]}-${end}`;
  }

  const file = String(url ?? '').slice(String(url ?? '').lastIndexOf('/') + 1).toLowerCase();
  const byQ = file.match(/\bq([1-4])[-_]?(\d{4})\b/);
  if (byQ) return `${byQ[2]}-${ORDINAL_END[`q${byQ[1]}`]}`;
  const byOrdinal = file.match(/\b(1st|2nd|3rd|4th)[-_]?qtr[-_]?(\d{4})\b/);
  if (byOrdinal) return `${byOrdinal[2]}-${ORDINAL_END[byOrdinal[1]]}`;
  return null;
}

/**
 * What the resource is about.
 *
 * Land is named and excluded rather than ignored: the register holds dwelling
 * sales, and a land median filed as a house median would be a different
 * product wearing the same label.
 */
export function dwellingOfVicCatalogueResource(dataset: string, url = '', name = ''): VicCatalogueDwelling {
  /*
   * The FILE NAME, never the whole URL. Every Victorian resource is served
   * from `land.vic.gov.au`, so a `\bland\b` test against the URL matches the
   * hostname and classifies every house and unit workbook in the catalogue as
   * land — which is to say, excludes all of them. Caught by the spec on the
   * first run against the real catalogue answer.
   */
  const file = String(url ?? '').slice(String(url ?? '').lastIndexOf('/') + 1);
  const hay = `${dataset ?? ''} ${file} ${name ?? ''}`.toLowerCase();
  if (/\bland\b/.test(hay)) return 'land';
  if (/\bunits?\b/.test(hay)) return 'attached';
  if (/\bhouses?\b/.test(hay)) return 'house';
  return 'unknown';
}

/**
 * Every resource the catalogue lists, flattened.
 *
 * Refuses rather than returning an empty list when the body is not a CKAN
 * answer, because "the catalogue lists nothing" and "that was not the
 * catalogue" send a caller to opposite conclusions — and the second one must
 * fall back to the archive rather than reporting that Victoria publishes
 * nothing.
 */
export function parseVicCatalogue(body: unknown): VicCatalogueResource[] {
  const root = (body ?? {}) as Record<string, unknown>;
  if (root.success !== true || typeof root.result !== 'object' || root.result === null) {
    throw new Error('the Victorian data catalogue answered something that is not a CKAN result — refused');
  }
  const result = root.result as Record<string, unknown>;
  const packages = Array.isArray(result.results) ? result.results as Array<Record<string, unknown>> : [];
  const out: VicCatalogueResource[] = [];
  for (const pkg of packages) {
    const dataset = String(pkg.title ?? pkg.name ?? '');
    const resources = Array.isArray(pkg.resources) ? pkg.resources as Array<Record<string, unknown>> : [];
    for (const r of resources) {
      const url = String(r.url ?? '');
      if (!/^https?:\/\//i.test(url)) continue;
      const name = String(r.name ?? '');
      const fileName = url.slice(url.lastIndexOf('/') + 1);
      out.push({
        dataset,
        name,
        url,
        fileName,
        dwelling: dwellingOfVicCatalogueResource(dataset, url, name),
        period: periodOfVicCatalogueResource(name, url),
      });
    }
  }
  return out;
}

/**
 * The quarterly median-by-suburb workbooks for one dwelling type, newest
 * quarter first.
 *
 * The time-series and yearly-summary datasets are excluded by shape rather
 * than by title: a resource with no quarter in it is not a quarter, whatever
 * dataset lists it.
 */
export function vicQuarterlyMedianResources(
  resources: ReadonlyArray<VicCatalogueResource>,
  dwelling: 'house' | 'attached',
): VicCatalogueResource[] {
  const seen = new Set<string>();
  return (resources ?? [])
    .filter((r) => r.period !== null
      && r.dwelling === dwelling
      // "Yearly summary" resources carry a quarter too, and are a different
      // product: a rolling year filed under a quarter would be a bigger number
      // wearing a smaller label.
      && !/yearly[-\s]?summary|year[-\s]?summary/i.test(`${r.dataset} ${r.fileName}`)
      && /median/i.test(`${r.dataset} ${r.fileName}`))
    .filter((r) => {
      if (seen.has(r.period as string)) return false;
      seen.add(r.period as string);
      return true;
    })
    .sort((a, b) => ((a.period as string) < (b.period as string) ? 1 : -1));
}

/**
 * The newest quarter the publisher has actually released.
 *
 * This is the reading the filename pattern could not give. Asked whether
 * Victoria had published a 2026 quarter, a regex can only answer "no file I
 * recognise"; the catalogue answers "December 2025", which is a fact about the
 * publisher rather than about our spelling.
 */
export function newestCatalogueQuarter(
  resources: ReadonlyArray<VicCatalogueResource>,
): string | null {
  const periods = (resources ?? []).map((r) => r.period).filter((p): p is string => !!p);
  return periods.length ? periods.reduce((a, b) => (a > b ? a : b)) : null;
}
