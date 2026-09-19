// Token estimation heuristics — the FALLBACK price list.
//
// Mission Control's report cost index is authoritative: `reportMetering.ts`
// resolves the reserve amount from it by metering kind, so an operator can
// reprice a report without a deploy here. These numbers are what we charge
// when Mission Control is unreachable or a kind is unlisted, and they are the
// values the index is seeded with — keep the two in step when adding a kind.
//
// UNIT: these are billing credits (the same unit as the token balance, plan
// allowances and top-up packs), NOT raw LLM tokens. One report costs a handful
// of credits. Keep them in this scale so usage stays consistent with the
// plans/packs sold on the Aurixa Systems pricing page — do not paste raw LLM
// token counts (~thousands per report) in here.
import type { TokenKind } from "./missionControl.ts";
import { VERIFICATION_RESERVE_TOKENS } from "./aml/verificationTokenPrice.pure.ts";

const BASE: Record<TokenKind, number> = {
  "report.investment.compass": 12,
  "report.investment.executive": 8,
  "report.investment.snapshot": 4,
  "report.investment.financial": 5,
  "report.suburb.compass": 10,
  "report.postcode.compass": 10,
  "report.market-intelligence": 6,
  "report.portfolio-review": 8,
  "report.bulk-item": 8, // averaged; caller should override per-item
  "report.chart-analysis": 2,
  "report.qualitative-regen": 3,
  // Imported, never a literal: the two live verification routes reserve from
  // `verificationTokenPrice.pure.ts` and this is the fallback they fall back
  // TO, so a number typed here would be a second price list that disagrees
  // with the one being charged. It was 4 while `aml-verification` reserved
  // 400 and the standalone path reserved nothing at all.
  "aml_identity_check": VERIFICATION_RESERVE_TOKENS,
  "aml_screening_check": 4,
};

export interface EstimateOptions {
  extraSections?: number;       // +20% each
  aiNarrative?: boolean;        // +50%
  multiplier?: number;          // arbitrary multiplier (e.g. bulk count)
}

/** Apply server-resolved workload modifiers to a base report price. */
export function applyEstimateOptions(base: number, opts: EstimateOptions = {}): number {
  let n = base;
  if (opts.extraSections && opts.extraSections > 0) {
    n = n * (1 + 0.2 * opts.extraSections);
  }
  if (opts.aiNarrative) n = n * 1.5;
  if (opts.multiplier && opts.multiplier > 0) n = n * opts.multiplier;
  return Math.ceil(n);
}

export function estimateTokens(kind: TokenKind, opts: EstimateOptions = {}): number {
  return applyEstimateOptions(BASE[kind] ?? 5, opts);
}

export function estimateBulk(items: Array<{ kind: TokenKind; opts?: EstimateOptions }>): number {
  return items.reduce((sum, it) => sum + estimateTokens(it.kind, it.opts), 0);
}

/** Heuristic for actual usage when no model usage object is returned. */
export function fallbackActual(estimated: number, success: boolean): number {
  // Assume ~80% of estimate on success, 0 on failure (cancel path handles that).
  return success ? Math.ceil(estimated * 0.8) : 0;
}
