/**
 * RF-7.2B.1 §7 — does the prose describe the fact it was handed?
 *
 * The gate decides what a model may SEE. This decides whether what it then
 * WROTE still describes that thing. They are different questions, and the
 * second one is the one RF-7.2A named as structural: reconciling prose against
 * the injected facts proves faithfulness, not truth — so this checks the
 * remaining half, which is whether a faithful number has been given an
 * unfaithful label.
 *
 * Three faults, each measured in production and each named by the mandate:
 *
 *  - **Grain.** `abs_census_poa` is postal-area data. A postcode covers
 *    several suburbs and rarely matches one, so "Cobblebank's population is
 *    18,234" is a different claim from the one the figure supports.
 *  - **Period.** The 2021 Census is five years old. Printing its figure beside
 *    "current", "today" or "latest" restates a historical measurement as a
 *    present-tense fact.
 *  - **Source.** `FIRMMCRT` is a monthly AVERAGE of the cash rate target.
 *    Calling it "the current cash rate" names a number the Board never set.
 *
 * ## What a fault does (RF-7.2B.1 §4)
 *
 * Generation still completes — a report is not failed mid-run over a word, and
 * the model is not asked to re-write itself. What changes is CLIENT READINESS.
 *
 * Each fault becomes a `validation_flags` entry, which is the report QA
 * mechanism that already exists: `QualityAssurance.tsx` splits reports into
 * `cleanReports` and `reportsWithValidationIssues` purely on
 * `validation_flags.length > 0`, so a report carrying one of these is no longer
 * clean and cannot be presented as such until it is corrected.
 *
 * They are raised at `high` — the existing severity vocabulary is
 * `critical | high | medium`, and the page counts and surfaces those bands.
 * That is deliberately a step above the `warning` the prose-vs-record
 * reconciliation uses beside it: a yield that disagrees by a rounding step is a
 * possible discrepancy, whereas these three are VALIDATED semantic errors about
 * what a figure is — a postal area called a suburb, a five-year-old census
 * figure called current, a monthly average called the rate in force. A warning
 * that no band counts is exactly the "silently client-ready" state this closes.
 *
 * What this does NOT do: gate delivery. Nothing in the product consults
 * `validation_flags` before a report is shared or downloaded — `status` is set
 * to `completed` unconditionally — and adding such a gate would be a new
 * workflow rather than a use of the existing one.
 *
 * Deliberately narrow. It matches a fact's own value in the prose and reads
 * the words immediately around it, rather than trying to parse claims in
 * general — a broad claim parser that is 80% right generates more noise than
 * signal, and a reviewer who learns to ignore these flags is worse off than
 * one who never had them.
 *
 * Pure: no Deno, no network, no clock.
 */

import type { SnapshotFact } from './safeGenerationInputs.pure.ts';

export const MARKET_CLAIM_AUDIT_VERSION = '1.0.0';

export type ClaimFaultKind = 'grain' | 'period' | 'source';

export interface ClaimFault {
  readonly fact: string;
  readonly kind: ClaimFaultKind;
  /** The prose that triggered it, trimmed — so a reviewer can see the sentence. */
  readonly excerpt: string;
  /** What the fact actually supports. */
  readonly supported: string;
  readonly message: string;
}

/** Characters either side of a matched value that count as "around" it. */
const WINDOW = 140;

/** Words that assert a narrower geography than a postal area. */
const SUBURB_WORDS = /\b(suburb|suburb's|locality|neighbourhood|neighborhood)\b/i;

/** Words that assert the present tense about a historical measurement. */
const PRESENT_WORDS = /\b(current|currently|today|today's|latest|now|present-day|as at today)\b/i;

/** Words that claim the cash rate in force. */
const IN_FORCE_WORDS = /\b(current cash rate|today's cash rate|cash rate today|rate in force|prevailing cash rate|latest cash rate)\b/i;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Every way this product prints a number, so a match is not missed because the
 * prose wrote `18,234` where the fact carried `18234`.
 */
function spellings(value: number): string[] {
  const out = new Set<string>();
  out.add(String(value));
  out.add(value.toLocaleString('en-AU'));
  if (!Number.isInteger(value)) {
    out.add(value.toFixed(1));
    out.add(value.toFixed(2));
  }
  return [...out].filter((s) => s.length >= 2);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Windows of prose around each occurrence of any spelling of the value. */
function windowsAround(text: string, value: number): string[] {
  const found: string[] = [];
  for (const spelling of spellings(value)) {
    const re = new RegExp(escape(spelling), 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      // A digit either side means we matched the middle of a longer number.
      const before = text[m.index - 1];
      const after = text[m.index + spelling.length];
      if ((before && /[\d.]/.test(before)) || (after && /[\d]/.test(after))) continue;
      found.push(text.slice(Math.max(0, m.index - WINDOW), m.index + spelling.length + WINDOW));
      if (found.length >= 20) return found;
    }
  }
  return found;
}

const trim = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * Audit one report's prose against the facts it was generated from.
 *
 * Only `present` facts are audited: an absent fact has no value to find in the
 * text. That is a real limit of a value-anchored audit, not a gap — but the
 * sentence that used to sit here said the withheld case was "a different
 * defect that the fact reconciliation already looks for", and it does not:
 * `factReconciliation.pure.ts` contains no occurrence of `withheld`, `absent`,
 * `demographic` or `population`. Two modules each assumed the other covered
 * it, and neither did, so two reports generated on 2026-09-11 stated a
 * population while `market.demographics` was `absent` in their snapshot.
 *
 * The withheld case belongs to `governedNarrativeAuthority.pure.ts`, which is
 * CATEGORY-anchored for exactly this reason, and which BLOCKS where this
 * module discloses. Both run; neither is a fallback for the other.
 */
export function auditMarketClaims(
  reportText: unknown,
  facts: readonly SnapshotFact[],
): ClaimFault[] {
  if (typeof reportText !== 'string' || reportText.trim() === '') return [];
  const faults: ClaimFault[] = [];

  for (const fact of facts) {
    if (fact.status !== 'present') continue;
    if (!isNum(fact.value)) continue;

    const windows = windowsAround(reportText, fact.value);
    if (windows.length === 0) continue;

    const isPostcodeGrain = fact.grain === 'postcode';
    const isHistorical = /census|20\d\d/i.test(fact.referencePeriod ?? '');
    const isMonthlyAverage = /monthly average/i.test(fact.referencePeriod ?? '')
      || /monthly average/i.test(fact.dataset ?? '');

    for (const window of windows) {
      if (isPostcodeGrain && SUBURB_WORDS.test(window)) {
        faults.push({
          fact: fact.name,
          kind: 'grain',
          excerpt: trim(window),
          supported: `postal area ${fact.geographyId ?? ''}`.trim(),
          message:
            'A postal-area figure is described as a suburb figure. A postcode covers '
            + 'several suburbs, so the narrower claim is not what the source supports.',
        });
      }
      if (isHistorical && !isMonthlyAverage && PRESENT_WORDS.test(window)) {
        faults.push({
          fact: fact.name,
          kind: 'period',
          excerpt: trim(window),
          supported: fact.referencePeriod ?? 'a stated reference period',
          message:
            'A figure from a past reference period is described in the present tense. '
            + 'State the period the source measured.',
        });
      }
      if (isMonthlyAverage && IN_FORCE_WORDS.test(window)) {
        faults.push({
          fact: fact.name,
          kind: 'source',
          excerpt: trim(window),
          supported: 'a monthly average of the cash rate target',
          message:
            'A monthly average of the cash rate target is described as the rate in force. '
            + 'In a month containing a Board change the average equals neither target.',
        });
      }
    }
  }

  // One fault of each kind per fact is enough to send a reviewer to the text;
  // twenty copies of the same finding is how a flag list stops being read.
  const seen = new Set<string>();
  return faults.filter((f) => {
    const key = `${f.fact}|${f.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The shape `validation_flags` already carries, so these sit beside the rest. */
export function claimFaultToFlag(fault: ClaimFault): {
  type: string;
  severity: string;
  field: string;
  message: string;
  value: Record<string, unknown>;
} {
  return {
    type: 'market_claim',
    // `high`, not `warning` — see the header. The QA page counts
    // critical/high/medium; a band it does not count reads as no finding.
    severity: 'high',
    field: fault.fact,
    message: fault.message,
    value: { kind: fault.kind, supported: fault.supported, excerpt: fault.excerpt },
  };
}
