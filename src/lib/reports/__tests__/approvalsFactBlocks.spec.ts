/**
 * What a report may state about approved dwelling supply.
 *
 * The absence branch is the half that ships before the register does, and it
 * is the half that carries the risk: a bracketed prompt slot with nothing
 * behind it is what put `450 m²` and `8.5 m` into a Queensland property's
 * document under New South Wales instrument names.
 */
import { describe, it, expect } from 'vitest';
import {
  ABSENCE_SENTENCE,
  APPROVALS_RATING_PROHIBITION,
  NO_PLUMBING_IN_THE_PROSE,
  APPROVALS_WEB_SEARCH_RULE,
  approvalsWebSearchRule,
  WINDOW_MONTHS,
  approvalsFactBlocks,
  monthLabel,
  monthsBefore,
  summariseApprovals,
  type ApprovalsMonth,
  type ApprovalsSeries,
} from '../../../../supabase/functions/_shared/reports/market/approvalsFactBlocks.pure.ts';
import { APPROVALS_ARE_NOT_COMPLETIONS }
  from '../../../../supabase/functions/_shared/reports/market/openData/absBuildingApprovals.pure.ts';

/** Twenty-four whole months of counts, ending at `to`. */
function months(to: string, count = 24, unitsAt: (i: number) => number | null = () => 10): ApprovalsMonth[] {
  const out: ApprovalsMonth[] = [];
  for (let i = 0; i < count; i++) {
    const period = monthsBefore(to, i);
    for (const t of ['total_residential', 'house', 'other_residential'] as const) {
      out.push({
        period,
        buildingType: t,
        dwellingUnits: t === 'total_residential' ? unitsAt(i) : (unitsAt(i) === null ? null : 5),
        value: 1_000_000,
      });
    }
  }
  return out;
}

const series = (over: Partial<ApprovalsSeries> = {}): ApprovalsSeries => ({
  area: 'Greater Bendigo (C)',
  areaKind: 'lga',
  months: months('2026-06'),
  source: 'Australian Bureau of Statistics, Building Approvals, Australia — dwelling units approved',
  sourceUrl: 'https://data.api.abs.gov.au/rest/data/ABS,BA_LGA,1.0.0/all',
  licence: 'Creative Commons Attribution 4.0 International',
  loadedAt: '2026-09-18T02:00:00.000Z',
  ...over,
});

describe('the two windows', () => {
  it('sums the twelve months to the latest published month', () => {
    const r = summariseApprovals(series())!;
    expect(r.latestPeriod).toBe('2026-06');
    expect(r.latest.total_residential.from).toBe('2025-07');
    expect(r.latest.total_residential.to).toBe('2026-06');
    expect(r.latest.total_residential.units).toBe(120);
    expect(r.latest.total_residential.monthsCounted).toBe(WINDOW_MONTHS);
    expect(r.latest.total_residential.floor).toBe(false);
  });

  it('sums the twelve months before those as the comparison', () => {
    const r = summariseApprovals(series())!;
    expect(r.prior.total_residential.to).toBe('2025-06');
    expect(r.prior.total_residential.from).toBe('2024-07');
    expect(r.prior.total_residential.units).toBe(120);
  });

  it('states a change only between two COMPLETE windows', () => {
    // Flat: both windows whole, so a change is computable and is zero.
    expect(summariseApprovals(series())!.changePct).toBe(0);
    // A hole anywhere in the latest window withdraws the comparison.
    const holed = series({ months: months('2026-06', 24, (i) => (i === 3 ? null : 10)) });
    expect(summariseApprovals(holed)!.changePct).toBeNull();
  });

  it('computes the change from the publisher’s own counts', () => {
    const rising = series({ months: months('2026-06', 24, (i) => (i < 12 ? 20 : 10)) });
    const r = summariseApprovals(rising)!;
    expect(r.latest.total_residential.units).toBe(240);
    expect(r.prior.total_residential.units).toBe(120);
    expect(r.changePct).toBe(100);
  });

  it('a hole makes the window a FLOOR and counts the months that carried a figure', () => {
    const holed = series({ months: months('2026-06', 24, (i) => (i < 3 ? null : 10)) });
    const w = summariseApprovals(holed)!.latest.total_residential;
    expect(w.floor).toBe(true);
    expect(w.monthsCounted).toBe(9);
    expect(w.units).toBe(90);
  });

  it('a series with no month at all is an absence, never an empty reading', () => {
    expect(summariseApprovals(series({ months: [] }))).toBeNull();
  });

  it('a series whose every figure is suppressed is an absence too', () => {
    expect(summariseApprovals(series({ months: months('2026-06', 24, () => null)
      .map((m) => ({ ...m, value: null })) }))).toBeNull();
  });
});

describe('the block on a reading', () => {
  const block = () => approvalsFactBlocks(summariseApprovals(series()));

  it('names the area and says the figures are not about this property', () => {
    const out = block();
    expect(out).toContain('**Greater Bendigo (C)**');
    expect(out).toContain('local government area');
    // "an local government area" -- the article the first draft printed.
    expect(out).not.toMatch(/\ban (?=[bcdfgjklmnpqrstvwxyz])/);
    expect(out).toContain('they describe the whole local government area');
    expect(out).toMatch(/none of them describes\s+this property, this street or this suburb/);
  });

  it('carries the approval-is-not-a-completion rule', () => {
    expect(block()).toContain(APPROVALS_ARE_NOT_COMPLETIONS);
  });

  it('forbids rating supply, in the words a model would otherwise reach for', () => {
    const out = block();
    expect(out).toContain(APPROVALS_RATING_PROHIBITION);
    for (const word of ['strong', 'weak', 'tight', 'constrained', 'oversupplied', 'undersupplied']) {
      expect(APPROVALS_RATING_PROHIBITION).toContain(word);
    }
  });

  it('forbids substituting a search result for the register', () => {
    expect(block()).toContain(APPROVALS_WEB_SEARCH_RULE);
  });

  it('states the window, the latest month and the licence', () => {
    const out = block();
    expect(out).toContain('Jul 2025 – Jun 2026');
    expect(out).toContain('**Jun 2026**');
    expect(out).toContain('last loaded 18 Sep 2026');
    expect(out).toContain('Creative Commons Attribution 4.0');
  });

  it('says all twelve months are published when they are', () => {
    expect(block()).toContain('All 12 months of that window are published');
    expect(block()).not.toContain('is a FLOOR');
  });

  it('calls an incomplete window a FLOOR and says the true figure can only be higher', () => {
    const holed = summariseApprovals(series({
      months: months('2026-06', 24, (i) => (i < 3 ? null : 10)),
    }));
    const out = approvalsFactBlocks(holed);
    expect(out).toContain('**9 of the 12 months**');
    expect(out).toContain('is a FLOOR');
    expect(out).toContain('the true figure can only be higher');
  });

  it('refuses to state a year-on-year change it could not compute, and says so', () => {
    const holed = summariseApprovals(series({
      months: months('2026-06', 24, (i) => (i === 3 ? null : 10)),
    }));
    expect(approvalsFactBlocks(holed)).toContain('Do not compute one.');
  });

  it('an absent figure prints an em dash, never a zero', () => {
    const partial = summariseApprovals(series({
      months: months('2026-06', 24, () => 10)
        .filter((m) => m.buildingType !== 'house')
        .map((m) => (m.buildingType === 'other_residential' ? { ...m, value: null } : m)),
    }))!;
    const out = approvalsFactBlocks(partial);
    expect(out).toMatch(/\| houses \| — \| — \|/);
    expect(out).not.toMatch(/\| houses \| 0 \|/);
  });
});

describe('the block on an absence', () => {
  it('carries no digit at all — four absences, four sentences', () => {
    for (const kind of ['not_loaded', 'none_for_area', 'unavailable', 'no_area_resolved'] as const) {
      const out = approvalsFactBlocks(null, kind);
      expect(out).toContain(ABSENCE_SENTENCE[kind]);
      expect(out).toContain('Do not state, imply or estimate');
      expect(out).toContain(APPROVALS_RATING_PROHIBITION);
      // The absence branch has no figures above it, so it must not say so.
      expect(out).toContain(approvalsWebSearchRule(false));
      expect(out).not.toContain('the figures above');
      expect(out).toContain('the absence stated above is the finding');
      // No table, and nothing that could be read as a count.
      expect(out).not.toContain('| ---');
      expect(out.replace(/RULES[\s\S]*$/, '')).not.toMatch(/\d/);
    }
  });

  it('a failed read is ours, and never a statement about the area', () => {
    expect(ABSENCE_SENTENCE.unavailable)
      .toContain('a fact about this retrieval, not about the area');
  });

  it('a register never loaded and an area with no row are different sentences', () => {
    expect(ABSENCE_SENTENCE.not_loaded).not.toBe(ABSENCE_SENTENCE.none_for_area);
    expect(ABSENCE_SENTENCE.not_loaded).toContain('was not searched for this report');
    expect(ABSENCE_SENTENCE.none_for_area).toContain('publishes no figure for it');
  });

  it('no absence sentence rates anything', () => {
    for (const sentence of Object.values(ABSENCE_SENTENCE)) {
      expect(sentence).not.toMatch(/\b(low|limited|minimal|negligible|strong|weak|favourable)\b/i);
    }
  });

  it('no absence sentence describes this platform to the reader', () => {
    /*
     * The first draft said "has not been loaded on this deployment" and
     * "holds no row for it". A model told to state the absence states the one
     * it was handed, so both would have reached a client's page as a note
     * about our data loads and our database.
     *
     * This is W4.7's rule in the one place W4.7's test cannot look:
     * `publisherNames.spec.ts` refuses an underscore-cased IDENTIFIER in a
     * rendered field and cannot refuse a well-formed English sentence about a
     * cache. So the sentences are checked here, by the words.
     */
    const PLUMBING = /\b(deployment|database|table|row|cache|data load|loaded|ingest|API|endpoint|integration|migration)\b/i;
    for (const [kind, sentence] of Object.entries(ABSENCE_SENTENCE)) {
      expect(sentence, `${kind} describes this platform's plumbing`).not.toMatch(PLUMBING);
    }
  });

  it('uses the planning register\u2019s own two readings, and no third', () => {
    // "Searched, nothing found." and "Not searched." are what the reader is
    // already shown for planning layers; a second vocabulary for the same
    // distinction is how two pages of one document come to disagree.
    const leads = Object.values(ABSENCE_SENTENCE).map((x) => x.split('**')[1]);
    expect([...new Set(leads)].sort()).toEqual(['Not searched.', 'Searched, nothing found.']);
    // Only the register that WAS asked and answered nothing may say "searched".
    expect(ABSENCE_SENTENCE.none_for_area).toContain('Searched, nothing found.');
    for (const kind of ['not_loaded', 'unavailable', 'no_area_resolved'] as const) {
      expect(ABSENCE_SENTENCE[kind]).toContain('Not searched.');
    }
  });

  it('carries the no-plumbing rule on the absence branch, where the risk is', () => {
    expect(approvalsFactBlocks(null)).toContain(NO_PLUMBING_IN_THE_PROSE);
    expect(NO_PLUMBING_IN_THE_PROSE).toContain('no apology is offered for');
  });

  it('defaults to the not-loaded reading, which is every deployment today', () => {
    expect(approvalsFactBlocks(null)).toContain(ABSENCE_SENTENCE.not_loaded);
  });
});

describe('the month arithmetic', () => {
  it('monthLabel reads the one month table', () => {
    expect(monthLabel('2026-06')).toBe('Jun 2026');
    expect(monthLabel('2026-13')).toBeNull();
    expect(monthLabel('2026-Q2')).toBeNull();
  });

  it('monthsBefore crosses a year boundary', () => {
    expect(monthsBefore('2026-01', 1)).toBe('2025-12');
    expect(monthsBefore('2026-06', 11)).toBe('2025-07');
    expect(monthsBefore('2026-06', 12)).toBe('2025-06');
    expect(monthsBefore('2026-06', 0)).toBe('2026-06');
  });

  it('leaves a period it cannot read alone rather than inventing one', () => {
    expect(monthsBefore('not a month', 3)).toBe('not a month');
  });
});

describe('a figure that is not a figure never reaches the page', () => {
  /*
   * Found by rendering the block against the register's real depth on
   * 22 Sep 2026 — four periods loaded of a twelve-month window — and reading
   * the output rather than the source. The money column printed **`$NaN`**.
   *
   * The immediate cause was a fixture naming the field `valueAud`, so `value`
   * was `undefined`. That is the whole point: `windowOf`'s guard was
   * `m.value !== null`, and `undefined !== null` is TRUE, so `0 + undefined`
   * became NaN and then survived every downstream null check — `NaN === null`
   * is false, so the "no figure" branch never fired and the formatter was
   * handed it.
   *
   * It is reachable from production, one narrower `select` away: PostgREST
   * returns `undefined` for a column absent from a projection exactly as it
   * returns `null` for one that is empty. That is the class
   * `check-edge-column-names.mjs` exists for, and it has already cost this
   * repository `investment_reports.client_id`, `market_updates.summary` and
   * `custom_users.role_display` — each of which reported as normal, empty
   * operation.
   *
   * The rule is `rentalEvidence`'s and `placesAvailability`' — **absent is
   * never zero** — in its sharper form: an absence travels as an absence, and
   * NaN is neither a figure nor an absence.
   */
  const seriesWith = (months: unknown[]) => ({
    area: 'Braidwood',
    areaKind: 'sa2' as const,
    months: months as never,
    source: 'Australian Bureau of Statistics',
    sourceUrl: 'https://data.api.abs.gov.au/',
    licence: 'CC BY 4.0',
    loadedAt: '2026-09-22',
  });

  /** A month row whose `value` never arrived, under a mistyped column name. */
  const rowsWithNoValue = (period: string) =>
    (['total_residential', 'house', 'other_residential'] as const).map((buildingType) => ({
      period,
      buildingType,
      dwellingUnits: 4,
      valueAud: 1_000_000, // NOT `value` — the shape a narrower select produces
    }));

  it('sums only finite numbers, so a missing column is an absence and not NaN', () => {
    const reading = summariseApprovals(
      seriesWith(['2026-04', '2026-05', '2026-06', '2026-07'].flatMap(rowsWithNoValue)),
    );
    expect(reading).toBeTruthy();
    expect(reading!.latest.total_residential.units).toBe(16);
    expect(reading!.latest.total_residential.value).toBeNull();
  });

  it('prints no money figure at all rather than `$NaN`', () => {
    const block = approvalsFactBlocks(
      summariseApprovals(
        seriesWith(['2026-04', '2026-05', '2026-06', '2026-07'].flatMap(rowsWithNoValue)),
      ),
      'not_loaded',
    );
    expect(block).not.toContain('NaN');
    // The units it DOES hold are still stated: a missing money column is not a
    // reason to withhold the count beside it.
    expect(block).toContain('16');
  });

  it('counts a month for the units window only where the count is real', () => {
    const reading = summariseApprovals(
      seriesWith([
        { period: '2026-06', buildingType: 'total_residential', dwellingUnits: 5, value: 1_000 },
        { period: '2026-07', buildingType: 'total_residential', dwellingUnits: undefined, value: 2_000 },
      ]),
    );
    expect(reading!.latest.total_residential.units).toBe(5);
    expect(reading!.latest.total_residential.monthsCounted).toBe(1);
    expect(reading!.latest.total_residential.value).toBe(3_000);
  });
});
