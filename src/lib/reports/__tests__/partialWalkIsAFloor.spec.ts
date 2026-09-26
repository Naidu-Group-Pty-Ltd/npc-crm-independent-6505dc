/**
 * A total summed from part of a register is a floor, and says so.
 *
 * ## The two readings §3 asked to be reconciled
 *
 * | | dwellings | over | cost | over | rows read |
 * |---|---|---|---|---|---|
 * | As the report printed it | 680 | 171 | $808,649,729 | 278 | **300 of 650** |
 * | On the complete walk | 1,410 | 301 | $1,175,556,030 | 452 | **655 of 655** |
 *
 * The difference decomposes exactly, and into two independent parts:
 *
 * - **Retrieval completeness.** On the OLD counting rule, the complete walk
 *   gives 3,442 dwellings and $2,364,004,211 — so reading the other 355 rows
 *   is +2,762 dwellings and +$1,555,354,482.
 * - **Counting rule.** The published totals are now new applications only,
 *   which subtracts the amendments bucket: −2,032 dwellings and
 *   −$1,188,448,181, to the dwelling and to the dollar
 *   (1,410 + 2,032 = 3,442; $1,175,556,030 + $1,188,448,181 = $2,364,004,211).
 *
 * Geography, date window and publisher are identical across both readings.
 *
 * `daActivityLine` already discloses a partial walk on the planning-controls
 * line. The **pipeline paragraph** did not — and that is where the money is:
 * the report printed two totals from a little over a third of the register,
 * with nothing on the page to say so.
 *
 * Nothing here hard-codes either figure. The assertions are of the FORM of the
 * disclosure and of the arithmetic identity between the buckets, both of which
 * stay true when the register changes.
 */
import { describe, expect, it } from 'vitest';
import { summariseDaRows } from '../../../../supabase/functions/_shared/planning/developmentActivity.pure';
import {
  buildInfrastructureEvidence,
  renderInfrastructureOutlook,
  infrastructureRules,
} from '../../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';

/** Two applications, one of them an amendment restating its parent. */
const ROWS = [
  { CouncilApplicationNumber: '1/2026/JP', ApplicationType: 'Development Application',
    CostOfDevelopment: 1_000_000, NumberOfNewDwellings: 10, ApplicationStatus: 'Determined',
    DeterminationDate: '2026-05-01', Location: [{ Suburb: 'KELLYVILLE', FullAddress: '1 A St' }],
    DevelopmentType: [{ DevelopmentType: 'Dwelling house' }] },
  { CouncilApplicationNumber: '1/2026/JP/A', ApplicationType: 'Modification Application',
    CostOfDevelopment: 1_000_000, NumberOfNewDwellings: 10, ApplicationStatus: 'Determined',
    DeterminationDate: '2026-06-01', Location: [{ Suburb: 'KELLYVILLE', FullAddress: '1 A St' }],
    DevelopmentType: [{ DevelopmentType: 'Dwelling house' }] },
] as never[];

const evidenceFor = (stated: number) => buildInfrastructureEvidence({
  planningData: {
    jurisdiction: 'NSW',
    developmentActivity: {
      status: 'ok',
      source: 'NSW Planning Portal — Online DA API',
      summary: summariseDaRows(ROWS, 'The Hills Shire Council', '2026-03-18', '2026-09-17', stated),
    },
  },
});

const pipelineLine = (stated: number) => renderInfrastructureOutlook(evidenceFor(stated))
  .split('\n').find((l) => l.startsWith('**Dwellings in the development pipeline'))!;

describe('the walk travels with the totals', () => {
  it('records what was read and what the register stated', () => {
    expect(evidenceFor(650).registerWalk).toEqual({ rowsRead: 2, totalStated: 650 });
  });

  it('is null where the reading carried no walk figures — not "complete"', () => {
    const ev = buildInfrastructureEvidence({
      planningData: {
        jurisdiction: 'NSW',
        developmentActivity: {
          status: 'ok',
          summary: { councilName: 'X', periodFrom: '2026-01-01', periodTo: '2026-06-01',
            newApplications: { newDwellingsTotal: 5, rowsWithDwellings: 1 } },
        },
      },
    });
    expect(ev.registerWalk).toBeNull();
  });
});

describe('a partial walk is drawn as a floor', () => {
  it('names both counts and calls each a floor', () => {
    const line = pipelineLine(650);
    // Adviser wording since 25 Sep 2026; the two counts and the word "floor"
    // are what this pins.
    expect(line).toContain('summed from 2 of the 650 applications the register lists for this period');
    expect(line).toMatch(/each is a floor rather than a total/i);
    expect(line).toMatch(/the remainder can only add to it/);
  });

  it('says nothing extra on a complete walk', () => {
    // A sentence reading "all of it" on every complete reading is noise, and
    // the figures then mean what they say.
    expect(pipelineLine(2)).not.toMatch(/floor|summed from/i);
  });

  it('treats a register that states fewer than were read as complete', () => {
    // The count the register states can lag its own paging. Reading more than
    // it claims is not a partial walk, and must not print a floor caveat
    // saying 2 of 1.
    expect(pipelineLine(1)).not.toMatch(/floor|summed from/i);
  });

  it('tells the model to carry the qualification wherever it uses the figure', () => {
    const rules = infrastructureRules(evidenceFor(650));
    expect(rules).toMatch(/call it a floor rather than a total/);
    expect(rules).toMatch(/Do NOT present a partial sum as the area’s development activity/);
    expect(rules).toMatch(/do not compare it with a figure read over a different share/);
  });
});

describe('the counting rule and the walk are independent', () => {
  it('publishes new applications only, and the amendment restates its parent', () => {
    // One development, two rows, both stating 10 dwellings and $1m. Summing
    // them would report 20 dwellings and $2m of a 10-dwelling development —
    // which is the whole reason the published totals are new-only, and the
    // −2,032 / −$1,188,448,181 step of the reconciliation above.
    const s = summariseDaRows(ROWS, 'The Hills Shire Council', '2026-03-18', '2026-09-17', 2);
    expect(s.newApplications.newDwellingsTotal).toBe(10);
    expect(s.newApplications.statedCostTotal).toBe(1_000_000);
    expect(s.amendments.newDwellingsTotal).toBe(10);
    expect(s.amendments.statedCostTotal).toBe(1_000_000);
    expect(s.unclassified.rows).toBe(0);
  });

  it('keeps the amendment out of the published pipeline figure', () => {
    const ev = evidenceFor(2);
    expect(ev.pipelineDwellings?.total).toBe(10);
    expect(ev.pipelineInvestment?.total).toBe(1_000_000);
  });
});
