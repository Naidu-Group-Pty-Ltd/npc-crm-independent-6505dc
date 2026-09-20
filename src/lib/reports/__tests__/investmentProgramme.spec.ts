/**
 * The forward investment programme — S5/S6 §4.
 *
 * §4 asks for a ten-year infrastructure outlook built from *"official
 * programmes, budgets and planning publications"*, for the 2024 QTRIP reading
 * to be **reconciled against the current programme before its funding or
 * status is relied on**, and for *"'No equivalent structured dataset found'"*
 * never to become *"'NSW has no relevant programme.'"* These pin all three.
 *
 * The fixture is the publisher's own answer, taken from
 * `datastore_search_sql` on 18 Sep 2026 for a 25 km box around 262 Pallas
 * Street, Maryborough: 14 rows, HTTP 200, CC BY 4.0, open data with no
 * personal information in it. It is committed so the reading is reproducible
 * in CI without a network call.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  distanceKm,
  horizonCaveat,
  parseQtripAnswer,
  programmeCoverageNote,
  programmeStanding,
  PROGRAMME_PUBLISHERS,
  PROGRAMME_RADIUS_KM,
  qtripQuery,
  QTRIP_EDITIONS,
  QTRIP_LICENCE,
  QTRIP_SOURCE,
  stageSentence,
  type ProgrammeParse,
} from '@/lib/reports/../../../supabase/functions/_shared/planning/investmentProgramme.pure';
import {
  buildInfrastructureEvidence,
  coverageLimitsFor,
  renderInfrastructureOutlook,
} from '@/lib/reports/../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';

const SUBJECT = { lat: -25.5407, lon: 152.7030 }; // 262 Pallas Street, Maryborough QLD
const CURRENT = QTRIP_EDITIONS[1]; // 2025-26 to 2028-29 — the edition that answers
const answer = () => JSON.parse(
  readFileSync('src/lib/reports/__tests__/fixtures/qtrip-maryborough-25km.json', 'utf8'),
);
const parsed = () => {
  const out = parseQtripAnswer(answer(), CURRENT, SUBJECT, PROGRAMME_RADIUS_KM);
  if (!out.ok) throw new Error((out as Extract<ProgrammeParse, { ok: false }>).reason);
  return out;
};

describe('the 2024 reading was reconciled against the current programme', () => {
  it('lists the editions newest first, including the one that is published and empty', () => {
    expect(QTRIP_EDITIONS.map((e) => e.edition)).toEqual([
      '2026-27 to 2029-30',
      '2025-26 to 2028-29',
    ]);
  });

  it('the current edition names its status column with its own as-at date', () => {
    // §13 read the 2024-25 edition, which publishes NO status at all. Relying
    // on it would have asserted a state of affairs the register never stated.
    expect(CURRENT.statusColumn).toBe('Investment status (as at 1 July 2025)');
    expect(QTRIP_EDITIONS[0].statusColumn).toBe('Investment status (as at 1 July 2026)');
  });

  it('keys on a coordinate, because the current edition dropped Local Government', () => {
    const url = qtripQuery(CURRENT, SUBJECT.lat, SUBJECT.lon, PROGRAMME_RADIUS_KM);
    expect(decodeURIComponent(url)).toContain('"Midpoint Latitude" BETWEEN');
    expect(decodeURIComponent(url)).toContain('"Midpoint Longitude" BETWEEN');
    expect(decodeURIComponent(url)).not.toContain('Local Government');
  });

  it('the box is generous enough that nothing inside the radius is excluded by it', () => {
    // A box that exactly circumscribed the radius would be fine; one that
    // inscribed it would silently drop real investments near the edge.
    const url = decodeURIComponent(qtripQuery(CURRENT, SUBJECT.lat, SUBJECT.lon, PROGRAMME_RADIUS_KM));
    const bounds = [...url.matchAll(/BETWEEN (-?[\d.]+) AND (-?[\d.]+)/g)].map((m) => m.slice(1).map(Number));
    const [[latLo, latHi], [lonLo, lonHi]] = bounds;
    // All four cardinal edges must sit at or beyond the radius, or a real
    // investment near the edge is dropped before the distance test sees it.
    for (const [la, lo] of [[latHi, SUBJECT.lon], [latLo, SUBJECT.lon],
      [SUBJECT.lat, lonHi], [SUBJECT.lat, lonLo]]) {
      expect(distanceKm(SUBJECT.lat, SUBJECT.lon, la, lo)).toBeGreaterThanOrEqual(PROGRAMME_RADIUS_KM);
    }
  });
});

describe('the publisher’s own answer, parsed', () => {
  it('names four investments inside 25 km, nearest first', () => {
    const { investments } = parsed();
    expect(investments).toHaveLength(4);
    expect(investments.map((i) => Number(i.distanceKm.toFixed(1)))).toEqual([5.9, 19.1, 21.3, 24.0]);
    // Ordered, so a reader meets the nearest first.
    const d = investments.map((i) => i.distanceKm);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });

  it('carries the publisher’s own name and reference on every one', () => {
    for (const i of parsed().investments) {
      expect(i.name.length).toBeGreaterThan(5);
      expect(i.reference).toMatch(/^\d+$/);
    }
    expect(parsed().investments[0].name)
      .toBe('Bruce Highway (Maryborough – Gin Gin), Walker Street, intersection improvement');
  });

  it('excludes what is outside the radius rather than reporting it as nearby', () => {
    // §4: "an LGA project is not automatically near the property."
    const tight = parseQtripAnswer(answer(), CURRENT, SUBJECT, 10);
    expect(tight.ok && tight.investments).toHaveLength(1);
  });

  it('counts a row with no coordinate rather than dropping or placing it', () => {
    const body = { success: true, result: { records: [
      { 'Project Title': 'Somewhere unplaced', 'Midpoint Latitude': null, 'Midpoint Longitude': null },
    ] } };
    const out = parseQtripAnswer(body, CURRENT, SUBJECT, PROGRAMME_RADIUS_KM);
    expect(out.ok && out.unplaced).toBe(1);
    expect(out.ok && out.investments).toHaveLength(0);
  });

  it('answers a failure with a reason rather than an empty list', () => {
    expect(parseQtripAnswer({ success: false }, CURRENT, SUBJECT, 25)).toEqual({
      ok: false, reason: 'the DataStore reported the query failed',
    });
    expect(parseQtripAnswer('not json', CURRENT, SUBJECT, 25).ok).toBe(false);
  });
});

describe('a status is the publisher’s word, read narrowly', () => {
  it('Contractually Committed is funded and Planned is proposed', () => {
    expect(programmeStanding('Contractually Committed', null)).toBe('funded');
    expect(programmeStanding('Planned', '2026-27')).toBe('proposed');
  });

  it('funding is never read as a start on site', () => {
    expect(programmeStanding('Contractually Committed', null)).not.toBe('under_construction');
    expect(programmeStanding('Contractually Committed', null)).not.toBe('approved');
  });

  it('only the publisher’s own "Underway" earns under construction', () => {
    expect(programmeStanding('Planned', 'Underway')).toBe('under_construction');
    expect(programmeStanding('Planned', 'Mid 2026')).toBe('proposed');
  });

  it('an unrecognised word maps to nothing, so it prints unmapped', () => {
    expect(programmeStanding('Under review', null)).toBeNull();
    expect(programmeStanding(null, null)).toBeNull();
  });
});

describe('a stage marker is never a completion date', () => {
  it('a construction start says it is a start', () => {
    expect(stageSentence('Construction', '2026-27'))
      .toBe('Construction expected to start 2026-27 — a start, not a completion');
  });

  it('a tick is a completed stage and "Underway" is one in progress', () => {
    expect(stageSentence('Planning', '✔')).toBe('Planning complete');
    expect(stageSentence('Procurement', 'Underway')).toBe('Procurement underway');
  });

  it('nothing is said where the publisher said nothing', () => {
    expect(stageSentence('Construction', null)).toBeNull();
    expect(stageSentence('Construction', '')).toBeNull();
  });

  it('a four-year programme is never presented as a ten-year outlook', () => {
    const caveat = horizonCaveat('2025-26 to 2028-29');
    expect(caveat).toContain('2025-26 to 2028-29');
    expect(caveat).toContain('states no completion date');
    expect(caveat).toContain('beyond that window');
  });
});

describe('a cost band is not a committed budget', () => {
  it('a planned investment carries a band and no figure', () => {
    const planned = parsed().investments.find((i) => i.status === 'Planned')!;
    expect(planned.committedBudget).toBeNull();
    expect(planned.costRange).toBe('Up to $250 million');
  });

  it('a committed investment carries a figure and no band, in dollars', () => {
    const committed = parsed().investments.find((i) => i.status === 'Contractually Committed')!;
    expect(committed.costRange).toBeNull();
    // The column is in thousands; the record is in dollars.
    expect(committed.committedBudget).toBe(1_200_000);
  });

  it('the rendered table prints the band as a band', () => {
    const table = render();
    expect(table).toContain('Up to $250 million (band, not a committed figure)');
    expect(table).toContain('$1,200,000 committed');
  });
});

describe('funding names contributors and never a split', () => {
  it('reads the marker columns as participation', () => {
    const boat = parsed().investments.find((i) => i.name.startsWith('Granville Road'))!;
    expect(boat.fundingPartners).toEqual([
      'the Australian Government',
      'the Queensland Government',
      'local government or another funding partner',
    ]);
  });

  it('states no amount per partner anywhere on the page', () => {
    expect(render()).toContain('amounts per partner not published');
  });
});

const render = () => renderInfrastructureOutlook(buildInfrastructureEvidence({
  planningData: {
    fetchedAt: '2026-09-18T05:00:00.000Z',
    jurisdiction: 'QLD',
    investmentProgramme: {
      status: 'ok',
      investments: parsed().investments,
      edition: CURRENT.edition,
      radiusKm: PROGRAMME_RADIUS_KM,
      unplaced: parsed().unplaced,
      source: QTRIP_SOURCE,
      licence: QTRIP_LICENCE,
    },
  },
}));

describe('the reading reaches the page', () => {
  it('draws every investment with its reference, distance and stages', () => {
    const table = render();
    expect(table).toContain('| 3555736 |');
    expect(table).toContain('5.9 km from the property');
    expect(table).toContain('Wide Bay/Burnett district');
    expect(table).toContain('Planning underway; Procurement expected Late 2025');
  });

  it('calls a statewide scope a programme rather than a district', () => {
    expect(render()).toContain('Statewide programme,');
    expect(render()).not.toContain('Statewide district');
  });

  it('states the window beside the table, not as an absence', () => {
    const table = render();
    expect(table).toContain('**The forward investment programme.**');
    // The absence heading must not appear over a reading that found four things.
    expect(table.split('**The forward investment programme.**')[0])
      .not.toContain('Searched, nothing found');
  });

  it('names the source and its licence', () => {
    expect(render()).toContain('Department of Transport and Main Roads 2025-26 to 2028-29 (CC BY 4.0)');
  });

  it('a programme that answered with nothing IS an absence', () => {
    const empty = renderInfrastructureOutlook(buildInfrastructureEvidence({
      planningData: {
        fetchedAt: '2026-09-18T05:00:00.000Z',
        investmentProgramme: {
          status: 'ok', investments: [], edition: CURRENT.edition, radiusKm: 25,
          unplaced: 0, source: QTRIP_SOURCE, licence: QTRIP_LICENCE,
        },
      },
    }));
    expect(empty).toContain('Searched, nothing found');
    expect(empty).not.toContain('**The forward investment programme.**');
  });
});

describe('no jurisdiction is told it has no programme', () => {
  it('names a publisher and a programme for every state and territory', () => {
    for (const code of ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']) {
      const pub = PROGRAMME_PUBLISHERS[code];
      expect(pub, code).toBeDefined();
      expect(pub.publisher.length, code).toBeGreaterThan(10);
      expect(pub.programme.length, code).toBeGreaterThan(10);
      expect(pub.url, code).toMatch(/^https:\/\//);
    }
  });

  it('NSW’s note names its programme and says the absence is ours', () => {
    const note = programmeCoverageNote('NSW');
    expect(note).toContain('NSW Budget Infrastructure Statement');
    expect(note).toContain('capital works programme');
    expect(note).toContain('Nothing about the area follows from its absence here');
    expect(note).toContain('https://www.budget.nsw.gov.au/');
  });

  it('and never says a jurisdiction has none', () => {
    for (const code of Object.keys(PROGRAMME_PUBLISHERS)) {
      const note = programmeCoverageNote(code);
      expect(note, code).not.toMatch(/no (relevant |forward |such )?programme (exists|is published)/i);
      expect(note, code).not.toMatch(/publishes no/i);
    }
  });

  it('an unknown jurisdiction states the limit as ours rather than as a finding', () => {
    expect(programmeCoverageNote('ZZ')).toContain('That is a limit of this report, not a finding about the area');
  });

  it('the NSW page says it was NOT searched', () => {
    const nsw = renderInfrastructureOutlook(buildInfrastructureEvidence({
      planningData: {
        fetchedAt: '2026-09-18T05:00:00.000Z',
        jurisdiction: 'NSW',
        investmentProgramme: { status: 'not_served', note: programmeCoverageNote('NSW') },
      },
    }));
    expect(nsw).toContain('**Not searched.**');
    expect(nsw).toContain('nothing about this area follows from it');
  });
});

describe('the coverage statement is true of THIS reading', () => {
  it('drops the state-programme limit once a state programme was read', () => {
    expect(coverageLimitsFor(true)).not.toContain('state and federal budget infrastructure programmes');
    expect(coverageLimitsFor(false)).toContain('state and federal budget infrastructure programmes');
  });

  it('keeps the two a transport programme does not close', () => {
    for (const limit of coverageLimitsFor(true)) expect(typeof limit).toBe('string');
    expect(coverageLimitsFor(true)).toContain('council capital works programmes and their budgets');
    expect(coverageLimitsFor(true))
      .toContain('transport, water, energy and health agency project announcements');
    expect(coverageLimitsFor(true))
      .toContain('federal budget programmes, and state programmes outside transport and roads');
  });
});

describe('the service publishes it, and a stale cache cannot serve it', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it('planning-data-service builds and returns the cell', () => {
    const src = read('supabase/functions/planning-data-service/index.ts');
    expect(src).toContain('investmentProgramme: programmeCell');
    expect(src).toContain('qtripQuery(edition, lat, lng, PROGRAMME_RADIUS_KM)');
    // Newest edition first, and the first that RETURNS ROWS wins — the
    // 2026-27 package is published and empty.
    expect(src).toContain('for (const edition of QTRIP_EDITIONS)');
  });

  it('the answer version was bumped, so a c2 row is never served for this shape', () => {
    // Pins the RULE, not the string. `c3` was the version that added the
    // programme and it has since moved on for other widenings; what must hold
    // is that the key is declared and that the version is past the one whose
    // rows carry no programme at all.
    const src = read('supabase/functions/_shared/planning/planningAnswerVersion.pure.ts');
    expect(src).toContain("'investmentProgramme',");
    const version = /PLANNING_ANSWER_VERSION = '(c\d+)'/.exec(src)?.[1];
    expect(version).toBeDefined();
    expect(Number(version!.slice(1))).toBeGreaterThanOrEqual(3);
    // And the row that documents it, so a bump is a decision rather than a
    // side effect — the module's own header says exactly that.
    expect(src).toMatch(/\|\s*`c3`\s*\|[^|]*investmentProgramme/);
  });

  it('needs no table and no migration — it is a live read like every other register', () => {
    const src = read('supabase/functions/planning-data-service/index.ts');
    expect(src).not.toMatch(/from\(['"]investment_programme/);
  });
});
