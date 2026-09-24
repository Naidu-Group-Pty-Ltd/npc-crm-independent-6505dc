/**
 * Where a listing scrape's figures actually came from.
 *
 * ## The defect this exists for
 *
 * `scrape-property-listing` reads the listing page through Firecrawl, and
 * where that returns nothing it falls back to asking the model to FIND the
 * listing by web search. The two produce the same shape of answer, and the
 * server records which one ran — `metadata.scrapedFromPage`, beside
 * `metadata.confidence` — and **nothing read either**. The operator got
 * "Scraping Successful · Found: $725,000, 4 beds" whichever it was.
 *
 * The search fallback's own prompt says "If the exact listing is not found,
 * return nulls rather than using generic commercial real estate pages", and a
 * prohibition with no demonstration of the permitted form is one a model
 * routes around — so what comes back for an unreachable listing is a
 * plausible property, not an absence. That is the 19 Sep 2026 clone audit's
 * "wrong data returned for a second URL", and it is the whole explanation for
 * the defect being clone-only: `FIRECRAWL_API_KEY` is an Integrations-page
 * credential that no clone is provisioned with, so on a clone the page is
 * never read and EVERY scrape is the search fallback.
 *
 * ## The rules
 *
 * **A retrieval is not information.** The reading names which of the two
 * happened, in the operator's words, and the page says so beside the figures
 * rather than in a log line.
 *
 * **It describes the scrape, never the property.** Nothing here judges whether
 * a figure is right — it says what the figure rests on, which is the question
 * the operator can actually act on.
 *
 * **An unknown provenance is its own reading.** A response from an older
 * deployment carries no flag, and reporting that as "read from the page" is
 * the false confidence this exists to remove.
 *
 * Pure + deterministic: no DOM, no network, no clocks.
 */

export type ScrapeSource = 'page' | 'search' | 'unknown';

export interface ScrapeMetadataLike {
  scrapedFromPage?: unknown;
  confidence?: unknown;
  provider?: unknown;
}

export interface ScrapeProvenance {
  source: ScrapeSource;
  /** The model's own 0–1 confidence, where it gave one. */
  confidence: number | null;
  /** True where the figures rest on the listing page itself. */
  readThePage: boolean;
}

export function readScrapeProvenance(metadata: unknown): ScrapeProvenance {
  const meta = (metadata ?? {}) as ScrapeMetadataLike;
  const flag = meta.scrapedFromPage;
  const source: ScrapeSource =
    flag === true ? 'page' : flag === false ? 'search' : 'unknown';
  const raw = meta.confidence;
  const confidence =
    typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : null;
  return { source, confidence, readThePage: source === 'page' };
}

export interface ProvenanceNotice {
  tone: 'ok' | 'caution';
  title: string;
  body: string;
}

/**
 * What to tell the operator, or null where the page was read and the figures
 * need no caveat.
 *
 * The caution wording names the ACT it is asking for — check the figures
 * against the listing — because a warning with no permitted next step is one
 * people learn to dismiss.
 */
export function provenanceNotice(p: ScrapeProvenance): ProvenanceNotice | null {
  if (p.source === 'page') return null;
  if (p.source === 'search') {
    return {
      tone: 'caution',
      title: 'The listing page could not be read',
      body:
        'These figures come from a web search for this listing rather than from the page '
        + 'itself, so they may describe a different property. Check the address and the '
        + 'price against the listing before generating a report. Adding a Firecrawl API '
        + 'key on the Integrations page lets this read the page directly.',
    };
  }
  return {
    tone: 'caution',
    title: 'This extraction did not say where its figures came from',
    body:
      'Check the address and the price against the listing before generating a report.',
  };
}

/**
 * The summary line under the Extract button.
 *
 * `parts` is what was extracted, already formatted. The heading changes with
 * the provenance because "Extraction Successful" over a search-derived answer is
 * the sentence that made this defect invisible.
 */
export function scrapeSummaryTitle(p: ScrapeProvenance): string {
  return p.readThePage ? 'Extracted from the listing page' : 'Extracted — check the figures';
}
