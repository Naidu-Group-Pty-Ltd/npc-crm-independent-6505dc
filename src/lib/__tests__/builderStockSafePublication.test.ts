/**
 * BUILDER STOCK — WHAT MAY BE SERVED.
 *
 * This file used to pin the whole safe-publication machine: staged imports,
 * per-row readiness, the atomic cutover, the publish sweep's SQL. That
 * machine left with the Builder Portal (network extraction Phase 7) — stock
 * arrives on this deployment as `builder_network_stock_*` mirror rows,
 * already processed by the Builders Network — and its migrations and workers
 * are deleted, not dormant.
 *
 * What did NOT leave is the rule the machine existed to uphold, because the
 * marketplace still serves clients: WHICH rows a client may be shown is
 * decided by lifecycle alone. A staged replacement was never served, a row
 * mid-pipeline was never blanked, and both halves of that promise survive
 * the pipeline that used to produce the rows.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isProcessed, isServed, PROCESSED_LIFECYCLE, SERVED_LIFECYCLE,
} from '../../../supabase/functions/_shared/builderStock/stockLifecycle.pure';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MARKETPLACE = 'supabase/functions/builder-stock-marketplace/index.ts';

describe('serving and processing are different questions', () => {
  it('a property being processed is still a property being served', () => {
    // The two vocabularies are separate on purpose: PROCESSED is the wider
    // set, and collapsing them once emptied the marketplace for as long as
    // image work ran.
    expect(isServed('active')).toBe(true);
    expect(isProcessed('active')).toBe(true);
    expect(SERVED_LIFECYCLE).toBe('active');
    expect([...PROCESSED_LIFECYCLE]).toEqual(['active', 'staged']);
  });

  it('a staged replacement is processed but not served', () => {
    // What let a re-import be worked on privately while the published list
    // stayed up — and what the network sync inherits: a mirror row it stamps
    // `staged` reaches no card until it stamps it `active`.
    expect(isProcessed('staged')).toBe(true);
    expect(isServed('staged')).toBe(false);
  });

  it('an archived row is neither', () => {
    expect(isServed('archived')).toBe(false);
    expect(isProcessed('archived')).toBe(false);
  });
});

describe('the marketplace serves `active` alone, and reads nothing else about readiness', () => {
  const source = readFileSync(join(REPO_ROOT, MARKETPLACE), 'utf8');

  it('every stock read filters lifecycle to active', () => {
    /*
     * THE WHOLE SAFETY PROPERTY. If a serving query widened, a staged row
     * would appear on a client's screen as the blank or half-processed card
     * this rule exists to prevent.
     */
    expect(source).toMatch(/\.eq\('lifecycle_status', 'active'\)/);
    expect(source, 'the marketplace must not serve staged stock')
      .not.toMatch(/lifecycle_status[^)]*staged/);
  });

  it('serving is decided by lifecycle alone, never by how far image work got', () => {
    // The 23 live properties once spent a whole incident mid-ladder; a
    // serving query reading either pipeline column would have emptied the
    // marketplace for as long as processing ran. The columns still exist on
    // the mirror (the network stamps them); the serving read stays blind to
    // them.
    expect(source).toContain("'lifecycle_status', 'active'");
    expect(source).not.toContain('image_work_stage');
    expect(source).not.toContain('enrichment_status');
  });
});
