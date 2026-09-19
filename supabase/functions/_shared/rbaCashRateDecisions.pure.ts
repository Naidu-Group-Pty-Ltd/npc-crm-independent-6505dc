/**
 * The Reserve Bank's own Cash Rate Target decision history.
 *
 * ## Why this exists, when F1 is already loaded
 *
 * F1 (daily) carries `FIRMMCRTD`, the target on a date, and `FIRMMCCRT`, the
 * change in it. `FIRMMCCRT` records **only non-zero changes** — measured over
 * the whole published series on 11 Sep 2026, its distinct values are
 * `-0.50, -0.25, -0.15, 0.25, 0.50` and it carries no `0` anywhere.
 *
 * That makes F1 unable to answer the question the report actually asks. The
 * RBA publishes:
 *
 *     Cash Rate Target: 4.35%
 *     Effective date:   12 August 2026
 *
 * but the last time the target CHANGED was 6 May 2026. The Board met on
 * 17 June and again on 12 August and left it where it was, and each of those
 * decisions has its own effective date. Deriving the effective date from F1
 * would have reported **6 May 2026** — the date of the last change, which is a
 * different fact and three months stale.
 *
 * So the effective date comes from the decision history, which records
 * unchanged decisions explicitly (`0.00`), and the four facts are kept
 * separate rather than collapsed:
 *
 *   - **current target** — the rate in force;
 *   - **current effective date** — when the most recent decision took effect;
 *   - **last changed date** — when the target last moved;
 *   - **last change** — by how much it moved.
 *
 * ## What this parses
 *
 * `https://www.rba.gov.au/statistics/cash-rate/` — the RBA's own page, whose
 * table is `Effective Date | Change % points | Cash rate target % | Related
 * Documents`. 401 decision rows measured 11 Sep 2026, back to January 1990,
 * of which 300 are unchanged decisions.
 *
 * The download happens where egress works and the text is POSTed verbatim, the
 * same arrangement `rbaTables.pure.ts` uses and for the same reason: rba.gov.au
 * refuses the Supabase project's egress. ALL parsing and refusal is here, so a
 * loader that parsed differently from the reader cannot exist.
 *
 * Pure: no Deno, no network, no clock.
 */

export const CASH_RATE_DECISIONS_SOURCE =
  'RBA Cash Rate Target decision history (rba.gov.au/statistics/cash-rate)';

/**
 * Truncation floor. The published history runs from 1990 and carries 401 rows
 * (measured 11 Sep 2026); an error page or a cut download parses to far fewer.
 * A floor is what stops a short parse being mistaken for a short history.
 */
export const CASH_RATE_DECISIONS_MIN_ROWS = 350;

export interface CashRateDecision {
  /** ISO date the decision took effect. */
  readonly effectiveDate: string;
  /**
   * Percentage points; 0 for an unchanged decision, which is the whole point.
   *
   * Null where the page publishes a RANGE. In 1990 the RBA announced the target
   * as a band — seven rows, the newest 4 Jul 1990, reading e.g.
   * `15.00 to 15.50`, with changes like `-1.00 to -1.50`. Those rows are real
   * published history, so they are KEPT with their text and a null number
   * rather than dropped: dropping them would quietly shorten the history and
   * make a truncated download indistinguishable from an old one.
   */
  readonly changePoints: number | null;
  /** The target in force from this date; null for a 1990 range. */
  readonly targetPercent: number | null;
  /** Exactly what the page printed, so a range is never lost. */
  readonly targetText: string;
}

const MONTHS: Readonly<Record<string, string>> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** `12 Aug 2026` → `2026-08-12`. Null on anything else — never a guess. */
export function decisionDate(cell: string): string | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(cell.trim());
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  return `${m[3]}-${mm}-${String(day).padStart(2, '0')}`;
}

/** `+0.25` / `-0.25` / `0.00` → a number. Null on anything unparseable. */
function changeValue(cell: string): number | null {
  const t = cell.trim().replace(/[−–—]/g, '-').replace(/^\+/, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, ' ');

const decodeEntities = (s: string) =>
  s.replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

const cellText = (html: string) =>
  decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim();

export interface ParsedCashRateDecisions {
  readonly decisions: readonly CashRateDecision[];
  /** Newest first, as the page publishes them. */
  readonly source: string;
}

/**
 * Parse the RBA cash-rate page.
 *
 * Throws — refusing the load rather than writing a partial history — on a
 * missing or re-shaped table, a header that is not the one we transcribed, too
 * few rows, or an implausible target. Every refusal names what it expected,
 * because a loader that half-succeeds writes figures nobody can trust.
 */
export function parseCashRateDecisions(html: unknown): ParsedCashRateDecisions {
  if (typeof html !== 'string' || html.trim() === '') {
    throw new Error('empty document');
  }

  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const table = tables.find((t) => /Effective\s*Date/i.test(t));
  if (!table) {
    throw new Error(
      'no table with an "Effective Date" column — the cash-rate page layout has moved',
    );
  }

  const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  if (rows.length === 0) throw new Error('the cash-rate table carries no rows');

  const cellsOf = (row: string) =>
    (row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(cellText);

  const header = cellsOf(rows[0] ?? '');
  if (!/effective\s*date/i.test(header[0] ?? '')
    || !/change/i.test(header[1] ?? '')
    || !/cash\s*rate\s*target/i.test(header[2] ?? '')) {
    throw new Error(
      `unexpected header [${header.slice(0, 3).join(' | ')}] — expected `
      + 'Effective Date | Change % points | Cash rate target %',
    );
  }

  const decisions: CashRateDecision[] = [];
  for (const row of rows.slice(1)) {
    const cells = cellsOf(row);
    if (cells.length < 3) continue; // the page's trailing legend rows
    const effectiveDate = decisionDate(cells[0]);
    if (effectiveDate === null) continue;

    const targetText = cells[2].trim();
    const ranged = /\bto\b/i.test(targetText) || /\bto\b/i.test(cells[1]);
    const changePoints = ranged ? null : changeValue(cells[1]);
    const targetPercent = ranged ? null : changeValue(cells[2]);

    if (!ranged && (changePoints === null || targetPercent === null)) {
      throw new Error(
        `unparseable decision at ${effectiveDate}: change "${cells[1]}", target "${targetText}"`,
      );
    }
    // The target peaked at 17.5 in 1990 and floored at 0.10 in 2020.
    if (targetPercent !== null && !(targetPercent >= 0 && targetPercent <= 25)) {
      throw new Error(`implausible cash rate target ${targetPercent} at ${effectiveDate}`);
    }
    if (changePoints !== null && Math.abs(changePoints) > 5) {
      throw new Error(`implausible change ${changePoints} at ${effectiveDate}`);
    }
    decisions.push({ effectiveDate, changePoints, targetPercent, targetText });
  }

  if (decisions.length < CASH_RATE_DECISIONS_MIN_ROWS) {
    throw new Error(
      `truncated: ${decisions.length} decisions parsed, floor is ${CASH_RATE_DECISIONS_MIN_ROWS}`,
    );
  }

  // An unchanged decision is the reason this source exists at all. If the page
  // ever stops publishing them, this degrades to exactly what F1 already gives
  // and must say so rather than silently reporting a change date as an
  // effective date.
  if (!decisions.some((d) => d.changePoints === 0)) {
    throw new Error(
      'no unchanged (0.00) decision anywhere in the history — this source is only '
      + 'needed because it records them, so a history without any is the wrong table',
    );
  }

  return { decisions, source: CASH_RATE_DECISIONS_SOURCE };
}
