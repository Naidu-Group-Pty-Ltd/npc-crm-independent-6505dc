/**
 * An amendment is not another project, and a determination date is not a
 * delivery horizon.
 *
 * ## The claims this exists for
 *
 * From the Compass generated for 18 Annabelle Crescent, Kellyville on
 * 17 Sep 2026:
 *
 * > Three separate **data centre and high‑technology industry projects in
 * > Norwest**, each with stated costs of **$93.18 million**, point to
 * > continuing investment in employment‑rich, technology and services
 * > infrastructure within The Hills…
 * >
 * > `{{timeline: 0-2y "Major mixed-use redevelopment Castle Hill ($181.9m)",
 * > 0-2y "High‑tech data centres Norwest (three approvals at $93.18m)",
 * > 0-2y "Terrace housing project Gables ($29.75m)"}}`
 * >
 * > | Infrastructure timing and competition from major projects | Moderate |
 * > … three determined Norwest applications each at $93,180,778 … |
 *
 * There is **one** data centre. PAN-619414, PAN-643600 and PAN-638082 carry
 * the same coordinate (150.968022088, -33.73252699), the same lot
 * (2021/DP831173), the same address (3 Brookhollow Avenue, Norwest) and the
 * same $93,180,778; their council numbers are 1382/2025/JP/A, /B and /C. The
 * document overstated that one development by about $186 million, three times,
 * in three different sections.
 *
 * `summariseDaRows` already resolves an amendment to its parent, so the table
 * is right — and the correction is what now invites the error: a cell reading
 * *"amended 3 times in this window"* is a reasonable thing to read as three
 * approvals. So the count is stated on the page, where a reader can check it,
 * and the rule is stated to the model.
 *
 * And "0-2y" is a delivery horizon. Every date in that table is a
 * determination or a lodgement — a date something was DECIDED — and the
 * registers publish no delivery date for any application, which the table's
 * own "Delivery timing" column says on every row. A horizon bucket states a
 * completion nobody published.
 */
import { describe, expect, it } from 'vitest';
import {
  buildInfrastructureEvidence,
  infrastructureRules,
  renderInfrastructureOutlook,
} from '../../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';

/** One development, three amendment rows — the Norwest shape, minimally. */
const THREE_ROWS_ONE_DEVELOPMENT = {
  jurisdiction: 'NSW',
  developmentActivity: {
    status: 'ok',
    source: 'NSW Planning Portal — Online DA API',
    licence: 'CC BY 4.0',
    summary: {
      councilName: 'The Hills Shire Council',
      periodFrom: '2026-03-18',
      periodTo: '2026-09-17',
      newApplications: { newDwellingsTotal: 1410, rowsWithDwellings: 301, statedCostTotal: 1175556030, rowsWithCost: 452 },
      largestDevelopments: [{
        reference: '1382/2025/JP',
        types: ['High technology industry', 'Data centre'],
        status: 'Determined',
        statedCost: 93180778,
        latestDate: '2026-07-30',
        latestDateKind: 'determined',
        suburb: 'NORWEST',
        address: '3 BROOKHOLLOW AVENUE NORWEST 2153',
        rowsInWindow: 3,
        amendmentsInWindow: 3,
        parentOutsideWindow: true,
      }],
    },
  },
};

/** The same register with nothing amended, so the clause stays off. */
const ONE_ROW_ONE_DEVELOPMENT = {
  ...THREE_ROWS_ONE_DEVELOPMENT,
  developmentActivity: {
    ...THREE_ROWS_ONE_DEVELOPMENT.developmentActivity,
    summary: {
      ...THREE_ROWS_ONE_DEVELOPMENT.developmentActivity.summary,
      largestDevelopments: [{
        ...THREE_ROWS_ONE_DEVELOPMENT.developmentActivity.summary.largestDevelopments[0],
        rowsInWindow: 1,
        amendmentsInWindow: 0,
        parentOutsideWindow: false,
      }],
    },
  },
};

describe('the page says how to count the table', () => {
  const drawn = renderInfrastructureOutlook(buildInfrastructureEvidence({ planningData: THREE_ROWS_ONE_DEVELOPMENT }));

  it('states the developments and the rows behind them as different numbers', () => {
    expect(drawn).toContain('1 development from the application register is listed above, '
      + 'resolved from 3 register rows');
  });

  it('says a stated cost is counted once', () => {
    expect(drawn).toMatch(/its stated cost is counted once/);
    expect(drawn).toMatch(/the amendment count is not a number of projects/);
  });

  it('draws the cost exactly once whatever the amendment count', () => {
    // The whole failure was $93,180,778 read three times. The table prints one
    // row and the money appears once on it.
    const occurrences = drawn.split('$93,180,778').length - 1;
    expect(occurrences).toBe(1);
  });

  it('keeps the explanation off a table with nothing amended', () => {
    // A sentence about amendments beside a table with none is noise, and the
    // count itself is still worth stating.
    const plain = renderInfrastructureOutlook(buildInfrastructureEvidence({ planningData: ONE_ROW_ONE_DEVELOPMENT }));
    expect(plain).toContain('resolved from 1 register row');
    expect(plain).not.toMatch(/An amendment restates/);
  });
});

describe('the rules forbid the two readings that produced the claims', () => {
  const rules = infrastructureRules(buildInfrastructureEvidence({ planningData: THREE_ROWS_ONE_DEVELOPMENT }));

  it('says an amendment is not another project', () => {
    expect(rules).toMatch(/An amendment is NOT another project/);
    expect(rules).toMatch(/never multiply a stated cost by it/);
    expect(rules).toMatch(/number of developments is the number of ROWS/);
  });

  it('refuses a future horizon bucket on a table of decision dates', () => {
    expect(rules).toMatch(/A timeline BUCKET is a delivery horizon/);
    for (const bucket of ['0-2y', '3-5y', '5y\\+']) {
      expect(rules, bucket).toMatch(new RegExp(bucket));
    }
    expect(rules).toMatch(/draw no horizon timeline at all/);
  });

  it('still tells it what a stop may be labelled with', () => {
    // A prohibition with no demonstration of the permitted form is one a model
    // routes around — the Compass document contract's own lesson.
    expect(rules).toMatch(/Determined Jul 2026/);
    expect(rules).toMatch(/Lodged Sep 2026/);
  });

  it('keeps one timeline rule rather than two that can drift', () => {
    const mentions = rules.split('\n').filter((l) => /\{\{timeline/.test(l));
    expect(mentions).toHaveLength(1);
  });
});
