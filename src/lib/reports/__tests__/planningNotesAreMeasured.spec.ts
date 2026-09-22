/**
 * The per-jurisdiction planning notes say what was measured, and the
 * two-jurisdiction sentence cannot come back.
 *
 * `SA_NT_NOTE` read *"every candidate host refused this platform's scripted
 * egress during integration"* and covered two jurisdictions with one
 * sentence. Measured 22 Sep 2026 from CI, it was **false for South
 * Australia** — `dpti.geohub.sa.gov.au` answers HTTP 200 with 131 services
 * across 30 folders, two named `PlanSA` and `ePlanning` — and described the
 * wrong thing for the Northern Territory, whose service answered 403 behind
 * a `Just a moment...` interstitial.
 *
 * A claim covering two jurisdictions is a claim nobody can check against
 * either, which is why this file asserts the SPLIT and not the strings.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NT_NOTE,
  SA_NOTE,
  WA_LICENCE_NOTE,
} from '../../../../supabase/functions/_shared/planning/planningSources.pure';
import { NO_STATE_LAYER_NOTE, OVERLAY_COVERAGE } from '../../../../supabase/functions/_shared/planning/planningControlGuide.pure';

describe('the two-jurisdiction note is gone, not aliased', () => {
  /*
   * "Deleted rather than dormant." An alias onto `SA_NOTE` would have served
   * South Australia's sentence to the Northern Territory — the exact fault
   * the split ends — and a dormant export is one import away from being
   * used again.
   */
  it('is named nowhere in the repository', () => {
    for (const file of [
      'supabase/functions/_shared/planning/planningSources.pure.ts',
      'supabase/functions/planning-data-service/index.ts',
    ]) {
      const src = readFileSync(file, 'utf8');
      /*
       * `SA_NT_NOTE` may appear in a comment recording what was measured —
       * that is history and worth keeping. What may not exist is a
       * declaration or an import of it.
       */
      expect(src, file).not.toMatch(/export const SA_NT_NOTE/);
      expect(src, file).not.toMatch(/^\s*SA_NT_NOTE[,\s]/m);
      expect(src, file).not.toMatch(/\bnote:\s*SA_NT_NOTE\b/);
    }
  });

  it('gives South Australia and the Northern Territory different sentences', () => {
    expect(SA_NOTE).not.toBe(NT_NOTE);
    expect(SA_NOTE).toContain('South Australia');
    expect(NT_NOTE).toContain('Northern Territory');
  });
});

describe('each note says what was measured about that jurisdiction', () => {
  /*
   * SA is reachable. Any sentence saying the host refused this platform is a
   * statement about a past egress, and this is what stops it coming back.
   */
  it('does not say South Australia refused us', () => {
    expect(SA_NOTE).not.toMatch(/refus|declin|blocked/i);
    expect(SA_NOTE).toMatch(/can reach|answers/i);
    expect(SA_NOTE).toMatch(/outstanding integration work/i);
  });

  /*
   * A challenge is not a decision the publisher made. Calling it a refusal
   * sends an operator to write to the Territory about something nobody there
   * did.
   */
  it('does not say the Northern Territory declined to publish', () => {
    expect(NT_NOTE).not.toMatch(/\bdeclined\b|\brefused\b/i);
    expect(NT_NOTE).toMatch(/bot-protection challenge/i);
    expect(NT_NOTE).toMatch(/rather than a decision the Territory made/i);
  });

  /*
   * §9's rule over all three: an absence may not be rated, and none of these
   * is a statement about the property.
   */
  it('rates nothing and says nothing about the area', () => {
    for (const [name, note] of [
      ['SA_NOTE', SA_NOTE], ['NT_NOTE', NT_NOTE], ['WA_LICENCE_NOTE', WA_LICENCE_NOTE],
      ...Object.entries(NO_STATE_LAYER_NOTE).map(([j, n]) => [`NO_STATE_LAYER_NOTE.${j}`, n as string]),
    ] as [string, string][]) {
      expect(note, name).not.toMatch(/\|\s*(?:low|minimal|negligible|limited|favourable)\s*\|/i);
      expect(note, name).not.toMatch(/\bno (?:overlay|constraint|hazard)s? appl/i);
      expect(note, name).not.toMatch(/\brisk is (?:low|minimal|negligible)\b/i);
    }
  });

  /*
   * Every note names somewhere a reader can go. A limitation with no remedy
   * is the shape that teaches people to ignore limitations.
   */
  it('names a remedy', () => {
    expect(SA_NOTE).toMatch(/PlanSA/);
    expect(NT_NOTE).toMatch(/NT planning portal/i);
    expect(WA_LICENCE_NOTE).toMatch(/PlanWA|local government/i);
  });

  /*
   * W3.6's invariant, re-asserted here because this file changed two of the
   * notes it governs: anything not read in full owes a note, and anything
   * read in full must not carry one.
   */
  it('keeps W3.6’s coverage invariant', () => {
    for (const [j, coverage] of Object.entries(OVERLAY_COVERAGE)) {
      const note = NO_STATE_LAYER_NOTE[j as keyof typeof NO_STATE_LAYER_NOTE];
      if (coverage === 'state_layers_read') expect(note, j).toBeUndefined();
      else expect(note, j).toBeTruthy();
    }
  });
});
