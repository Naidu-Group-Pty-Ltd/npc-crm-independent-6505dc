/**
 * What happened when this report asked for each piece of evidence.
 *
 * ── Why this module exists ───────────────────────────────────────────────
 *
 * `data_sources` on the stored Cowra report reads:
 *
 *     seifa: null, climate: null, employment: null,
 *     marketData: null, demographics: null, locationIntelligence: null
 *
 * beside `_generationQuality.errorsEncountered: 0` and an average section
 * score of 97. Six producers are absent and the record's own quality block
 * says nothing went wrong.
 *
 * The composition that produces those nulls is, verbatim:
 *
 *     demographics: enhancedData.demographics ? { … } : null,
 *
 * under a comment reading *"A null is a fact ('we asked and got nothing'),
 * never an error."* The code cannot support that comment. `enhancedData.X` is
 * the RESULT, and reading a result tells you nothing about the attempt: the
 * `{ success: false, error }` that `fetchServiceWithFallback` computes for a
 * timeout, a thrown error, an open circuit breaker and a null return is
 * `console.log`ged and then discarded. A guard that skipped the call entirely
 * — planning is fetched only `if (planningCoords?.lat && planningCoords?.lng)`
 * — leaves no trace at all.
 *
 * So five materially different situations arrive at the same `null`:
 *
 *   1. the call was never made;
 *   2. the call was made and failed;
 *   3. the producer answered and the answer was lost or excluded downstream;
 *   4. the producer answered and said it holds nothing here;
 *   5. the producer answered and the value was used.
 *
 * Only (4) is "we asked and got nothing". (1) and (2) are faults of ours and
 * are repairable. (3) is a bug. Telling a reader that a suburb's demographics
 * are unavailable, when the truth is that this deployment never asked, is the
 * same class of error as printing a figure nobody measured — it states
 * something about the world that is actually a statement about our plumbing.
 *
 * ── What this module is ──────────────────────────────────────────────────
 *
 * A recorder. Each producer gets exactly one entry, written at the point the
 * attempt is made or deliberately skipped, and `data_sources` is DERIVED from
 * the ledger rather than from the result object. That inverts the dependency:
 * a producer that is absent from the ledger is a producer nobody accounted
 * for, and `unaccounted()` names it rather than letting it pass as a null.
 *
 * It decides nothing about the document. It scores nothing, gates nothing and
 * withholds nothing. What it makes possible is a report that can say which of
 * the five happened, and an operator who can tell a repair from a limitation.
 *
 * Deno-compatible: siblings and `_shared` only, explicit `.ts` extensions.
 */

/**
 * The five outcomes, and nothing else.
 *
 * The vocabulary is deliberately closed. "Unknown" is not among them: a
 * producer whose outcome nobody recorded is reported by `unaccounted()` as a
 * gap in the ledger, which is a defect to fix, not a sixth state to render.
 */
export type AcquisitionOutcome =
  /** The request was made and the answer is in the report. */
  | 'answered'
  /** No request was made — a precondition was absent, or a guard was false. */
  | 'never_requested'
  /** A request was made and did not succeed. Ours to repair. */
  | 'requested_failed'
  /** The producer answered; the answer did not reach the report. A bug. */
  | 'retrieved_not_bound'
  /** The producer answered and holds nothing for this subject. */
  | 'unavailable_in_coverage';

/** The outcomes that mean the reader is owed an explanation about US. */
export const OUR_FAULT: readonly AcquisitionOutcome[] = [
  'never_requested',
  'requested_failed',
  'retrieved_not_bound',
];

/**
 * Why a request was never made.
 *
 * A guard that skipped a call is the hardest of the five to notice, because
 * it leaves no log line and no error — so the reason is required rather than
 * optional, and it names the precondition rather than the symptom.
 */
export interface AcquisitionEntry {
  /** The producer, in the vocabulary `data_sources` already uses. */
  producer: string;
  outcome: AcquisitionOutcome;
  /**
   * One sentence an operator can act on. For `never_requested` it names the
   * precondition that was absent; for `requested_failed` it is the provider's
   * or the transport's own words, never a paraphrase.
   */
  detail: string;
  /** The service invoked, where one was. */
  service?: string;
  /** When the attempt was made. */
  at: string;
  /** Milliseconds the attempt took, where it was measured. */
  ms?: number;
}

export interface AcquisitionLedger {
  entries: AcquisitionEntry[];
  /** Producers the run was expected to account for and did not. */
  unaccounted: string[];
  /** Counts by outcome, for a coverage line that is arithmetic rather than prose. */
  tally: Record<AcquisitionOutcome, number>;
}

/**
 * The producers a full Investment run is expected to account for.
 *
 * Kept in this module rather than beside the fetches, because the point of the
 * list is to catch a producer whose accounting was FORGOTTEN — and a list
 * derived from the call sites cannot do that.
 */
export const EXPECTED_PRODUCERS: readonly string[] = [
  'demographics',
  'marketData',
  'locationIntelligence',
  'economics',
  'seifa',
  'crimeStatistics',
  'employment',
  'climate',
  'riskAssessment',
  'investmentScore',
  'planning',
  'financials',
];

/**
 * Record one attempt per producer, last write winning.
 *
 * Last-write-wins is deliberate and is the resume path's requirement: a
 * producer skipped in phase 1 for want of a coordinate and then genuinely
 * fetched in phase 2 must end as `answered`, not as the `never_requested`
 * that was true earlier in the same run.
 */
export class AcquisitionRecorder {
  private readonly seen = new Map<string, AcquisitionEntry>();

  record(entry: Omit<AcquisitionEntry, 'at'> & { at?: string }): void {
    const at = entry.at ?? new Date().toISOString();
    this.seen.set(entry.producer, { ...entry, at });
  }

  /** The request was never made. `precondition` names what was absent. */
  skipped(producer: string, precondition: string, service?: string): void {
    this.record({
      producer,
      outcome: 'never_requested',
      detail: precondition,
      service,
    });
  }

  /**
   * Classify a `fetchServiceWithFallback`-shaped result.
   *
   * `bound` is asked for separately rather than inferred, because "the
   * producer answered" and "the answer reached the report" are the two
   * questions `retrieved_not_bound` exists to keep apart.
   */
  fromServiceResult(
    producer: string,
    result: { success?: boolean; error?: string; data?: unknown } | null | undefined,
    opts: { service?: string; bound?: boolean; ms?: number } = {},
  ): void {
    const { service, ms } = opts;
    if (!result) {
      this.record({ producer, outcome: 'requested_failed', detail: 'No result was returned by the fetch wrapper', service, ms });
      return;
    }
    if (result.success && result.data) {
      const bound = opts.bound ?? true;
      this.record({
        producer,
        outcome: bound ? 'answered' : 'retrieved_not_bound',
        detail: bound ? 'Retrieved and used' : 'The producer answered and the value did not reach the report',
        service,
        ms,
      });
      return;
    }
    const err = (result.error ?? '').trim();
    // The wrapper says "No data returned" when the fetch resolved to null,
    // which is the provider answering that it holds nothing here. Every other
    // error — a timeout, a throw, an open circuit — is a failure of ours.
    if (/^no data returned$/i.test(err)) {
      this.record({ producer, outcome: 'unavailable_in_coverage', detail: 'The provider answered and holds nothing for this subject', service, ms });
      return;
    }
    this.record({
      producer,
      outcome: 'requested_failed',
      detail: err || 'The request did not succeed and reported no reason',
      service,
      ms,
    });
  }

  /** The producer answered that it holds nothing for this subject. */
  empty(producer: string, detail: string, service?: string): void {
    this.record({ producer, outcome: 'unavailable_in_coverage', detail, service });
  }

  /** Retrieved and used. */
  answered(producer: string, detail = 'Retrieved and used', service?: string): void {
    this.record({ producer, outcome: 'answered', detail, service });
  }

  /** The request failed. `reason` is the provider's or transport's own words. */
  failed(producer: string, reason: string, service?: string): void {
    this.record({ producer, outcome: 'requested_failed', detail: reason, service });
  }

  build(expected: readonly string[] = EXPECTED_PRODUCERS): AcquisitionLedger {
    const entries = [...this.seen.values()].sort((a, b) => a.producer.localeCompare(b.producer));
    const tally: Record<AcquisitionOutcome, number> = {
      answered: 0,
      never_requested: 0,
      requested_failed: 0,
      retrieved_not_bound: 0,
      unavailable_in_coverage: 0,
    };
    for (const e of entries) tally[e.outcome] += 1;
    return {
      entries,
      unaccounted: expected.filter((p) => !this.seen.has(p)).sort(),
      tally,
    };
  }
}

/**
 * Read a ledger back off a stored row.
 *
 * Every report generated before this module existed has none, and that is a
 * real and different state from a run whose ledger is empty — so this returns
 * null rather than an empty ledger, and the readers below say "not recorded"
 * rather than "nothing was asked".
 */
export function readAcquisitionLedger(row: unknown): AcquisitionLedger | null {
  const ds = (row as { data_sources?: Record<string, unknown> } | null)?.data_sources;
  const raw = ds && typeof ds === 'object' ? (ds as Record<string, unknown>)._acquisition : undefined;
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Partial<AcquisitionLedger>;
  if (!Array.isArray(l.entries)) return null;
  return {
    entries: l.entries as AcquisitionEntry[],
    unaccounted: Array.isArray(l.unaccounted) ? (l.unaccounted as string[]) : [],
    tally: (l.tally as AcquisitionLedger['tally']) ?? {
      answered: 0, never_requested: 0, requested_failed: 0,
      retrieved_not_bound: 0, unavailable_in_coverage: 0,
    },
  };
}

/**
 * How an absent producer may be described to a reader.
 *
 * This is the whole point of the ledger reaching the document. "Not available"
 * is the only sentence the product could write before, and it was wrong for
 * three of the five cases. Each sentence here is about the RECORD, never about
 * the area — an unasked register says nothing about the suburb.
 */
export function absenceSentence(outcome: AcquisitionOutcome, producerLabel: string): string {
  switch (outcome) {
    case 'answered':
      return `${producerLabel} was retrieved for this property.`;
    case 'unavailable_in_coverage':
      return `${producerLabel} was requested and the provider holds nothing for this location.`;
    case 'never_requested':
      return `${producerLabel} was not requested for this report.`;
    case 'requested_failed':
      return `${producerLabel} was requested for this report and the request did not succeed.`;
    case 'retrieved_not_bound':
      return `${producerLabel} was retrieved and did not reach this document.`;
  }
}

/**
 * Whether an absence is a statement about the area or a statement about us.
 *
 * A reader is entitled to know the difference, and a report that cannot tell
 * them apart will eventually present our outage as the locality's character —
 * which is the failure `placesAvailability` already paid for once, one level
 * up.
 */
export function isOurFault(outcome: AcquisitionOutcome): boolean {
  return (OUR_FAULT as readonly string[]).includes(outcome);
}
