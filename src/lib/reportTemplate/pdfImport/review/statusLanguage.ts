/**
 * PDF Extraction V3 · E11 — precise, human-readable status language (pure).
 *
 * Maps authoritative decision state to exact operator-facing labels and a
 * semantic status tone (never colour alone). Avoids vague words like "good",
 * "bad", "fixed", "AI score" or "confidence". Kept pure + testable so the E12
 * golden corpus can assert on the exact strings.
 */
import type { PageOutputStrategy, RegionOutputStrategy } from './contracts';

export type StatusTone = 'success' | 'review' | 'warning' | 'danger' | 'neutral';

export interface StatusLabel {
  label: string;
  tone: StatusTone;
}

/** Document-level final decision → exact label + tone. */
export function documentDecisionLabel(finalDecision: string | null, hardDefectCount: number, blockedPages: number): StatusLabel {
  if (blockedPages > 0 || finalDecision === 'blocked') return { label: 'Blocked — no safe final output', tone: 'danger' };
  switch (finalDecision) {
    case 'native': return { label: 'Automatically accepted', tone: 'success' };
    case 'native-review': return { label: 'Accepted with review required', tone: 'review' };
    case 'mixed': return { label: 'Mixed output — exact source crops used', tone: hardDefectCount > 0 ? 'review' : 'success' };
    case 'mixed-review': return { label: 'Mixed output — review required', tone: 'review' };
    case 'raster-only': return { label: 'Raster-only document', tone: 'warning' };
    default: return { label: 'Processing state unknown', tone: 'neutral' };
  }
}

export function pageStrategyLabel(strategy: PageOutputStrategy): StatusLabel {
  switch (strategy) {
    case 'native': return { label: 'Native output', tone: 'success' };
    case 'mixed': return { label: 'Mixed output — exact source crops used', tone: 'review' };
    case 'raster-only': return { label: 'Raster-only page', tone: 'warning' };
    case 'blocked': return { label: 'Blocked — no safe final output', tone: 'danger' };
    default: return { label: 'Unknown output', tone: 'neutral' };
  }
}

export function regionStrategyLabel(strategy: RegionOutputStrategy): StatusLabel {
  switch (strategy) {
    case 'native': return { label: 'Native (editable)', tone: 'success' };
    case 'source-crop': return { label: 'Exact source crop (locked)', tone: 'review' };
    case 'native-with-source-reference': return { label: 'Native with source reference', tone: 'success' };
    case 'hidden-semantic': return { label: 'Hidden semantic (not visible)', tone: 'neutral' };
    case 'page-fallback': return { label: 'Page raster fallback', tone: 'warning' };
    case 'blocked': return { label: 'Blocked', tone: 'danger' };
    default: return { label: 'Unknown', tone: 'neutral' };
  }
}

export function cacheStateLabel(hit: boolean | null, complete: boolean | null, lookupState: string | null): StatusLabel {
  if (lookupState === 'rejected' || (hit === true && complete === false)) return { label: 'Cache rejected — missing artifacts', tone: 'warning' };
  if (hit === true && complete === true) return { label: 'Cache hit — artifact complete', tone: 'success' };
  if (hit === false || lookupState === 'miss') return { label: 'Cache miss — fresh parse', tone: 'neutral' };
  return { label: 'Cache state not recorded', tone: 'neutral' };
}

export function providerAttemptLabel(remote: boolean, policyBlocked: boolean, status: string): StatusLabel {
  if (policyBlocked) return { label: 'Provider attempt policy-blocked', tone: 'warning' };
  if (status === 'failed') return { label: 'Provider attempt failed', tone: 'danger' };
  if (status === 'partial') return { label: 'Partial provider result', tone: 'review' };
  return { label: remote ? 'Remote provider attempt' : 'Local provider attempt', tone: 'neutral' };
}

/** Recovery: retry (same plan/target) vs reroute (new plan/fingerprint). Never conflate. */
export function recoveryLabel(action: string): StatusLabel {
  switch (action) {
    case 'retry_same_route': return { label: 'Same-target retry (same plan)', tone: 'neutral' };
    case 'reroute': return { label: 'Reroute — new plan and fingerprint', tone: 'review' };
    case 'fallback_raster_only': return { label: 'Recovery fallback — raster-only', tone: 'warning' };
    case 'abort_manual_review': return { label: 'Recovery exhausted — manual review', tone: 'danger' };
    default: return { label: 'Recovery pending', tone: 'neutral' };
  }
}

/** A metric value → measured / unavailable / not-applicable / failed (never null→0). */
export function metricStateLabel(value: number | null, applicable = true): { text: string; measured: boolean } {
  if (!applicable) return { text: 'Not applicable', measured: false };
  if (value === null) return { text: 'Not recorded', measured: false };
  return { text: `${Math.round(value * 100)}%`, measured: true };
}

/** A concise screen-reader summary for a page (Phase 50). */
export function pageScreenReaderSummary(pageNumber: number, strategy: PageOutputStrategy, hardDefectCount: number, reviewRequired: boolean): string {
  const parts = [`Page ${pageNumber}`, pageStrategyLabel(strategy).label.toLowerCase()];
  if (hardDefectCount > 0) parts.push(`${hardDefectCount} hard defect${hardDefectCount === 1 ? '' : 's'}`);
  if (reviewRequired) parts.push('review required');
  return `${parts.join(', ')}.`;
}
