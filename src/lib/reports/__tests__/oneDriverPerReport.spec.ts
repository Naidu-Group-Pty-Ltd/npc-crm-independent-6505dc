import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  GENERATION_DRIVER_LEASE_MS,
  claimGenerationDriver,
  generationDriverHolder,
  heartbeatGenerationDriver,
  newDriverIdentity,
  releaseGenerationDriver,
} from '@/lib/reports/generationDriver';
import { shouldMarkRunFailed } from '@/lib/reports/generationSignals.pure';
import { STALLED_AFTER_MS } from '@/components/reports/progress/selectors.pure';

/**
 * One driver per report.
 *
 * Measured on 97 Poole Road, 20 Sep 2026: two browser pumps drove one report,
 * `last_completed_section` went 14 → 8, the finished document shrank from
 * 134,392 to 120,145 characters, and the loser stamped `failed` over a
 * complete record. These pin the rules that stop it.
 */

const REPORT = 'report-under-test';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* the module falls back to its own map */
  }
});

describe('the claim is exclusive', () => {
  it('refuses a second driver and names where the work already is', () => {
    const first = newDriverIdentity('regenerate');
    const second = newDriverIdentity('auto-continue');

    expect(claimGenerationDriver(REPORT, first)).toEqual({ ok: true });

    const refused = claimGenerationDriver(REPORT, second);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.heldBy).toBe('regenerate');
  });

  it('separates two drivers of the SAME kind — two tabs both regenerating', () => {
    // The first cut of this module keyed exclusivity on the driver KIND, so
    // two tabs both claiming as 'regenerate' would both have succeeded — the
    // exact case the module exists for, admitted by its own key.
    const tabA = newDriverIdentity('regenerate');
    const tabB = newDriverIdentity('regenerate');
    expect(tabA.token).not.toBe(tabB.token);

    expect(claimGenerationDriver(REPORT, tabA)).toEqual({ ok: true });
    expect(claimGenerationDriver(REPORT, tabB).ok).toBe(false);
  });

  it('lets the SAME driver re-claim, because a driver does not compete with itself', () => {
    const driver = newDriverIdentity('regenerate');
    expect(claimGenerationDriver(REPORT, driver)).toEqual({ ok: true });
    expect(claimGenerationDriver(REPORT, driver)).toEqual({ ok: true });
  });
});

describe('it is a lease, never a lock', () => {
  it('lets a claim whose heartbeat went quiet be taken over', () => {
    const abandoned = newDriverIdentity('regenerate');
    const takingOver = newDriverIdentity('auto-continue');
    const t0 = 1_000_000;

    claimGenerationDriver(REPORT, abandoned, t0);
    expect(claimGenerationDriver(REPORT, takingOver, t0 + GENERATION_DRIVER_LEASE_MS - 1).ok).toBe(false);
    expect(claimGenerationDriver(REPORT, takingOver, t0 + GENERATION_DRIVER_LEASE_MS).ok).toBe(true);
  });

  it('keeps a live driver\'s claim alive across a long section', () => {
    const driver = newDriverIdentity('regenerate');
    const other = newDriverIdentity('auto-continue');
    const t0 = 1_000_000;

    claimGenerationDriver(REPORT, driver, t0);
    // The closing section has been measured at 40–110s; a heartbeat at the top
    // of each section keeps the claim standing across one.
    heartbeatGenerationDriver(REPORT, driver, t0 + 110_000);
    expect(claimGenerationDriver(REPORT, other, t0 + 200_000).ok).toBe(false);
  });

  it('does not let a displaced driver beat its way back in', () => {
    const displaced = newDriverIdentity('regenerate');
    const holder = newDriverIdentity('auto-continue');
    const t0 = 1_000_000;

    claimGenerationDriver(REPORT, displaced, t0);
    const later = t0 + GENERATION_DRIVER_LEASE_MS + 1;
    expect(claimGenerationDriver(REPORT, holder, later).ok).toBe(true);

    heartbeatGenerationDriver(REPORT, displaced, later + 1);
    expect(generationDriverHolder(REPORT, later + 2)).toBe('auto-continue');
  });

  it('outlasts the stall threshold, so the two readings cannot disagree', () => {
    // If the lease were shorter, the widget would call a report stalled while
    // its driver still held a live claim.
    expect(GENERATION_DRIVER_LEASE_MS).toBeGreaterThan(STALLED_AFTER_MS);
  });
});

describe('releasing', () => {
  it('hands the report straight back', () => {
    const driver = newDriverIdentity('regenerate');
    claimGenerationDriver(REPORT, driver);
    releaseGenerationDriver(REPORT, driver);
    expect(generationDriverHolder(REPORT)).toBeNull();
    expect(claimGenerationDriver(REPORT, newDriverIdentity('auto-continue')).ok).toBe(true);
  });

  it('only the holder may release', () => {
    const holder = newDriverIdentity('regenerate');
    const stranger = newDriverIdentity('auto-continue');
    claimGenerationDriver(REPORT, holder);
    releaseGenerationDriver(REPORT, stranger);
    expect(generationDriverHolder(REPORT)).toBe('regenerate');
  });
});

describe('a failure is a statement about the row', () => {
  it('refuses to mark a completed report failed', () => {
    expect(shouldMarkRunFailed({ status: 'completed', last_completed_section: 14, total_sections: 14 })).toBe(false);
  });

  it('refuses to mark a report failed when its banked sections meet the server total', () => {
    // 97 Poole Road as reported: `Failed` beside `14/14 sections · 100%`.
    expect(shouldMarkRunFailed({ status: 'processing', last_completed_section: 14, total_sections: 14 })).toBe(false);
  });

  it('still records a genuinely short run', () => {
    expect(shouldMarkRunFailed({ status: 'processing', last_completed_section: 8, total_sections: 14 })).toBe(true);
  });

  it('records a failure when the row could not be read — it fails visible, not closed', () => {
    expect(shouldMarkRunFailed(null)).toBe(true);
    expect(shouldMarkRunFailed(undefined)).toBe(true);
  });

  it('records a failure when the server has stated no total', () => {
    expect(shouldMarkRunFailed({ status: 'processing', last_completed_section: 0, total_sections: null })).toBe(true);
  });
});

describe('both pumps take the claim', () => {
  // A guard is worthless if a driver does not ask for it. This is the same
  // shape as `builderPortalUiMounted.spec.ts`: the rule is only real where
  // something actually applies it.
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('the regeneration hook claims, beats and releases', () => {
    const src = read('src/hooks/useChunkedRegeneration.ts');
    expect(src).toContain('claimGenerationDriver(reportId, driver)');
    expect(src).toContain('heartbeatGenerationDriver(reportId, driver)');
    expect(src).toContain('releaseGenerationDriver(reportId, driver)');
  });

  it('the progress panel claims, beats and releases', () => {
    const src = read('src/components/reports/ReportGenerationProgress.tsx');
    expect(src).toContain('claimGenerationDriver(reportId, driver)');
    expect(src).toContain('heartbeatGenerationDriver(reportId, driver)');
    expect(src).toContain('releaseGenerationDriver(reportId, driver)');
  });

  it('the panel stands down from auto-retrying a report somebody else is driving', () => {
    const src = read('src/components/reports/ReportGenerationProgress.tsx');
    expect(src).toContain('if (generationDriverHolder(id)) return;');
  });

  it('the hook asks the row before recording a failure', () => {
    const src = read('src/hooks/useChunkedRegeneration.ts');
    expect(src).toContain('shouldMarkRunFailed');
    // The unconditional write is what presented a complete document as failed.
    expect(src).not.toMatch(/settleProgressToast\(toastId, 'error'[\s\S]{0,400}?data: \{ status: 'failed' \}/);
  });
});
