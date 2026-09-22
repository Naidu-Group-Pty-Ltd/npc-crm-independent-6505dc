/**
 * W3.4 — the declared provider orders, and the licence nobody had read.
 *
 * Two modules are under test and they answer different questions, which is
 * why they are separate files and why this spec keeps them apart:
 *
 *  - `planningProviders.pure.ts` decides WHICH KINDS of register are
 *    consulted and in what order. It is `AMENITY_PROVIDERS`' shape with
 *    floor-plus-refinement semantics instead of first-that-answers.
 *  - `jurisdictionLayerProbe.pure.ts` decides what a reading may SAY about a
 *    jurisdiction whose layers are not read — and, crucially, reads a licence
 *    from the publisher's own metadata rather than asserting one.
 *
 * The assertions that matter most here are the ones that stop a reading
 * overstating itself. §9 of `PLANNING_CONTROLS_IN_THE_REPORT.md`'s rule —
 * *an absence may not be rated* — is asserted over every note, and so is the
 * narrower rule this work exists for: a 404 against a host this repository
 * typed may never render as a jurisdiction publishing nothing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVELOPMENT_PROVIDERS,
  DEFAULT_PLANNING_PROVIDERS,
  DEVELOPMENT_FLOOR,
  DEVELOPMENT_PROVIDERS_ENV,
  PLANNING_FLOOR,
  PLANNING_PROVIDERS_ENV,
  developmentProviderOrder,
  floorAnswered,
  planningProviderOrder,
  refinementsThatAnswered,
} from '../../../../supabase/functions/_shared/planning/planningProviders.pure';
import {
  FOLDER_WALK_CEILING,
  LAYER_CANDIDATES,
  LICENCE_CLAIMS,
  OPEN_LICENCE_PATTERN,
  RESTRICTED_LICENCE_PATTERN,
  UNREAD_JURISDICTIONS,
  assessJurisdictionLayers,
  candidatesFor,
  classifyCandidateFailure,
  jurisdictionLayerNote,
  layerMetadataUrl,
  parseArcgisAnswer,
  parseWfsCapabilities,
  bodyLooksChallenged,
  claimNeedsAttention,
  folderRootFor,
  folderWalkIsComplete,
  licenceMetadataUrl,
  readLicenceEvidence,
  verifyLicenceClaim,
  type CandidateOutcome,
  type JurisdictionLayerReading,
  type LayerCandidate,
} from '../../../../supabase/functions/_shared/planning/jurisdictionLayerProbe.pure';
import { buildActZoningQuery } from '../../../../supabase/functions/_shared/planning/planningSources.pure';
import {
  buildPlanningFacts,
  instrumentCurrencyLine,
  renderConstraintRegister,
} from '../../../../supabase/functions/_shared/planning/planningFacts.pure';

const env = (vars: Record<string, string>) => (k: string): string | undefined => vars[k];

describe('the declared planning and development orders', () => {
  it('defaults to the floor first, with the refinement after it', () => {
    expect(planningProviderOrder(env({}))).toEqual(DEFAULT_PLANNING_PROVIDERS);
    expect(developmentProviderOrder(env({}))).toEqual(DEFAULT_DEVELOPMENT_PROVIDERS);
    expect(DEFAULT_PLANNING_PROVIDERS[0]).toBe(PLANNING_FLOOR);
    expect(DEFAULT_DEVELOPMENT_PROVIDERS[0]).toBe(DEVELOPMENT_FLOOR);
  });

  it('honours a declared order', () => {
    expect(planningProviderOrder(env({ [PLANNING_PROVIDERS_ENV]: 'state_layer' })))
      .toEqual(['state_layer']);
    expect(developmentProviderOrder(env({ [DEVELOPMENT_PROVIDERS_ENV]: 'da_register,major_projects' })))
      .toEqual(['da_register', 'major_projects']);
  });

  /*
   * The rule the whole module exists for. An operator who names only a
   * refinement gets the floor back at the FRONT, because a deployment that
   * answered the planning question yesterday must not answer it with a draft
   * amendment register alone today.
   */
  it('prepends the floor wherever configuration omits it', () => {
    expect(planningProviderOrder(env({ [PLANNING_PROVIDERS_ENV]: 'amendment_register' })))
      .toEqual(['state_layer', 'amendment_register']);
    expect(developmentProviderOrder(env({ [DEVELOPMENT_PROVIDERS_ENV]: 'major_projects' })))
      .toEqual(['da_register', 'major_projects']);
  });

  it('drops an unknown name rather than erring, and cannot spell "no providers"', () => {
    expect(planningProviderOrder(env({ [PLANNING_PROVIDERS_ENV]: 'state_layer,nope' })))
      .toEqual(['state_layer']);
    expect(planningProviderOrder(env({ [PLANNING_PROVIDERS_ENV]: '' })))
      .toEqual(DEFAULT_PLANNING_PROVIDERS);
    expect(planningProviderOrder(env({ [PLANNING_PROVIDERS_ENV]: '   ,  ,' })))
      .toEqual(DEFAULT_PLANNING_PROVIDERS);
    expect(developmentProviderOrder(env({ [DEVELOPMENT_PROVIDERS_ENV]: 'garbage' })))
      .toEqual(DEFAULT_DEVELOPMENT_PROVIDERS);
  });

  it('is case-insensitive and de-duplicates', () => {
    expect(planningProviderOrder(env({ [PLANNING_PROVIDERS_ENV]: 'AMENDMENT_REGISTER, State_Layer, state_layer' })))
      .toEqual(['amendment_register', 'state_layer']);
  });

  it('never ranks a refinement as a refinement when the floor did not answer', () => {
    const outcomes = [
      { provider: 'state_layer', answered: false },
      { provider: 'amendment_register', answered: true },
    ];
    expect(floorAnswered(outcomes, PLANNING_FLOOR)).toBe(false);
    expect(refinementsThatAnswered(outcomes, PLANNING_FLOOR)).toEqual([]);
  });

  it('names the refinements that added something once the floor answered', () => {
    const outcomes = [
      { provider: 'state_layer', answered: true },
      { provider: 'amendment_register', answered: true },
    ];
    expect(refinementsThatAnswered(outcomes, PLANNING_FLOOR)).toEqual(['amendment_register']);
  });

  /*
   * A source assertion, because this is the one that could be quietly undone:
   * `planningFacts`' rule 2 gives an audited operator figure precedence over a
   * layer, and an environment variable able to drop it would silently overrule
   * a person who had recorded a correction.
   */
  it('does not admit the operator override as a provider', () => {
    const names = [...DEFAULT_PLANNING_PROVIDERS, ...DEFAULT_DEVELOPMENT_PROVIDERS].join(' ');
    expect(names).not.toMatch(/operator/i);
  });
});

describe('a licence is read from the publisher, never assumed', () => {
  it('reads an open licence only where the publisher names one', () => {
    expect(readLicenceEvidence(['Creative Commons Attribution 4.0']).kind).toBe('open');
    expect(readLicenceEvidence(['CC-BY 4.0']).kind).toBe('open');
    expect(readLicenceEvidence(['CC0']).kind).toBe('open');
  });

  /*
   * Deliberately narrow. A service free to call is not a service whose data
   * may be republished in a commercial PDF, and "free"/"public" are not
   * licences.
   */
  it('does not read "free" or "public" as a licence', () => {
    expect(readLicenceEvidence(['Free public web service']).kind).toBe('unverified');
    expect(readLicenceEvidence(['Publicly available data']).kind).toBe('unverified');
  });

  it('treats silence as unverified, and carries no evidence for it', () => {
    expect(readLicenceEvidence([])).toEqual({ kind: 'unverified', evidence: null });
    expect(readLicenceEvidence([null, undefined, '  '])).toEqual({ kind: 'unverified', evidence: null });
  });

  /* The conservative side: one layer's CC BY does not licence another's terms. */
  it('lets a stated restriction beat a stated open licence in the same body', () => {
    const r = readLicenceEvidence(['Creative Commons Attribution 4.0', 'Personal use only']);
    expect(r.kind).toBe('restricted');
  });

  it('recognises the restriction WA_LICENCE_NOTE asserts, if a service states it', () => {
    expect(RESTRICTED_LICENCE_PATTERN.test('for personal, non-commercial use')).toBe(true);
    expect(RESTRICTED_LICENCE_PATTERN.test('requires written authorisation')).toBe(true);
    expect(OPEN_LICENCE_PATTERN.test('for personal, non-commercial use')).toBe(false);
  });
});

describe('three failures that must never look alike', () => {
  it('blames us for a 404 and them for a 403', () => {
    expect(classifyCandidateFailure(404, false)).toBe('no_such_service');
    expect(classifyCandidateFailure(410, false)).toBe('no_such_service');
    expect(classifyCandidateFailure(403, false)).toBe('refused');
    expect(classifyCandidateFailure(401, false)).toBe('refused');
  });

  it('blames nobody for a network failure or a 5xx', () => {
    expect(classifyCandidateFailure(null, true)).toBe('unreachable');
    expect(classifyCandidateFailure(503, false)).toBe('unreachable');
    expect(classifyCandidateFailure(500, false)).toBe('unreachable');
  });
});

describe('reading what a service answered', () => {
  /*
   * An ArcGIS service answers an error as HTTP 200 with `{error:{code}}`
   * inside it. Read after the shape branches, that parses as an empty
   * directory — a refusal rendering as a publisher with nothing to publish.
   */
  it('reads an ArcGIS error before it reads a shape', () => {
    const a = parseArcgisAnswer(JSON.stringify({ error: { code: 499, message: 'Token Required' }, services: [] }));
    expect(a.kind).toBe('error');
    if (a.kind === 'error') expect(a.message).toContain('Token Required');
  });

  it('tells a service directory from a service', () => {
    const dir = parseArcgisAnswer(JSON.stringify({
      folders: ['Planning', 'Cadastre'],
      services: [{ name: 'Planning/Zones', type: 'MapServer' }],
    }));
    expect(dir.kind).toBe('directory');
    if (dir.kind === 'directory') {
      expect(dir.folders).toEqual(['Planning', 'Cadastre']);
      expect(dir.services).toEqual(['Planning/Zones (MapServer)']);
    }

    const svc = parseArcgisAnswer(JSON.stringify({
      currentVersion: 11.1,
      copyrightText: 'Creative Commons Attribution 4.0',
      layers: [{ id: 0, name: 'Heritage Overlay' }],
    }));
    expect(svc.kind).toBe('service');
    if (svc.kind === 'service') {
      expect(svc.layers).toEqual(['Heritage Overlay']);
      expect(svc.licence.kind).toBe('open');
    }
  });

  it('names what it received when it cannot read it', () => {
    expect(parseArcgisAnswer('<html>nope</html>').kind).toBe('unreadable');
    expect(parseArcgisAnswer(JSON.stringify({ hello: 'world' })).kind).toBe('unreadable');
    const u = parseArcgisAnswer('<html>nope</html>');
    if (u.kind === 'unreadable') expect(u.reason).toContain('nope');
  });

  /*
   * OGC's convention is that `NONE` in both elements is the publisher SAYING
   * there are no constraints — a statement, not silence — which is exactly
   * why these are parsed rather than assumed.
   */
  it('reads Fees: NONE and AccessConstraints: NONE as an open statement', () => {
    const caps = `<wfs:WFS_Capabilities xmlns:wfs="x"><ows:ServiceIdentification>
      <ows:Fees>NONE</ows:Fees><ows:AccessConstraints>NONE</ows:AccessConstraints>
      </ows:ServiceIdentification><FeatureTypeList><FeatureType><Name>plan:overlay</Name></FeatureType>
      </FeatureTypeList></wfs:WFS_Capabilities>`;
    const a = parseWfsCapabilities(caps);
    expect(a.kind).toBe('service');
    if (a.kind === 'service') {
      expect(a.licence.kind).toBe('open');
      expect(a.layers).toEqual(['plan:overlay']);
    }
  });

  it('reads a stated WFS restriction as restricted', () => {
    const caps = `<wfs:WFS_Capabilities xmlns:wfs="x"><ows:ServiceIdentification>
      <ows:Fees>NONE</ows:Fees>
      <ows:AccessConstraints>Personal use only; commercial republication requires written authorisation</ows:AccessConstraints>
      </ows:ServiceIdentification></wfs:WFS_Capabilities>`;
    const a = parseWfsCapabilities(caps);
    if (a.kind === 'service') expect(a.licence.kind).toBe('restricted');
    else expect.fail(`expected a service reading, got ${a.kind}`);
  });

  it('refuses a body that is not capabilities at all', () => {
    expect(parseWfsCapabilities('{"error":1}').kind).toBe('unreadable');
  });
});

describe('what may be concluded about a jurisdiction', () => {
  const candidate = (service: string): LayerCandidate => ({
    jurisdiction: 'SA', publisher: 'p', service, kind: 'arcgis', root: 'https://example.invalid/x',
  });
  const failed = (failure: 'no_such_service' | 'refused' | 'unreachable'): CandidateOutcome =>
    ({ kind: 'failed', failure, status: null, detail: failure });

  it('ranks an open answer above everything', () => {
    const r = assessJurisdictionLayers([
      { candidate: candidate('a'), outcome: failed('refused') },
      {
        candidate: candidate('b'),
        outcome: { kind: 'answered', layers: ['x'], licence: { kind: 'open', evidence: 'CC BY 4.0' }, bytes: 1 },
      },
    ]);
    expect(r.kind).toBe('integratable');
  });

  it('ranks a stated restriction above an unstated one', () => {
    const r = assessJurisdictionLayers([
      { candidate: candidate('a'), outcome: { kind: 'answered', layers: [], licence: { kind: 'unverified', evidence: null }, bytes: 1 } },
      { candidate: candidate('b'), outcome: { kind: 'answered', layers: [], licence: { kind: 'restricted', evidence: 'non-commercial' }, bytes: 1 } },
    ]);
    expect(r.kind).toBe('licence_restricted');
  });

  /*
   * A reachable catalogue outranks every failure, and it is the finding that
   * settles `SA_NT_NOTE`: a directory answering means the host is reachable
   * and "every candidate host refused" is a statement about a past egress.
   */
  it('lets a reachable catalogue outrank a failure elsewhere', () => {
    const r = assessJurisdictionLayers([
      { candidate: candidate('a'), outcome: failed('no_such_service') },
      { candidate: candidate('b'), outcome: { kind: 'directory', services: ['s1', 's2'], folders: ['f'], bytes: 9 } },
    ]);
    expect(r.kind).toBe('catalogue_readable');
    if (r.kind === 'catalogue_readable') expect(r.services).toBe(2);
  });

  it('blames us where every candidate 404d, and them where one refused', () => {
    expect(assessJurisdictionLayers([
      { candidate: candidate('a'), outcome: failed('no_such_service') },
      { candidate: candidate('b'), outcome: failed('no_such_service') },
    ]).kind).toBe('no_candidate_resolved');
    expect(assessJurisdictionLayers([
      { candidate: candidate('a'), outcome: failed('no_such_service') },
      { candidate: candidate('b'), outcome: failed('refused') },
    ]).kind).toBe('refused_us');
  });

  it('never reads a verdict out of zero requests', () => {
    expect(assessJurisdictionLayers([]).kind).toBe('unreachable');
  });
});

describe('the sentence a report may carry', () => {
  const READINGS: JurisdictionLayerReading[] = [
    { kind: 'integratable', service: 'S', licence: 'CC BY 4.0', layers: 12 },
    { kind: 'licence_restricted', service: 'S', evidence: 'non-commercial' },
    { kind: 'licence_unverified', service: 'S', layers: 3 },
    { kind: 'catalogue_readable', service: 'S', services: 214, folders: 11 },
    { kind: 'refused_us', asked: 3 },
    { kind: 'no_candidate_resolved', asked: 3 },
    { kind: 'unreachable', asked: 3 },
  ];

  /*
   * §9's rule. A sentence about a retrieval must not carry an exposure word,
   * because *an absence may not be rated* — and the shapes a rating takes are
   * a bare cell or a levelled claim, which a coverage sentence has no reason
   * to contain at all.
   */
  const RATING_SHAPES = /\|\s*(?:low|minimal|limited|negligible|favourable|favorable|high|moderate)\s*\|/i;

  it('rates nothing, and says nothing about the property', () => {
    for (const r of READINGS) {
      const note = jurisdictionLayerNote(r, 'SA');
      expect(note, r.kind).not.toMatch(RATING_SHAPES);
      expect(note, r.kind).not.toMatch(/\brisk is (?:low|minimal|negligible)\b/i);
      expect(note, r.kind).not.toMatch(/\bno (?:overlay|constraint|hazard)s? appl/i);
    }
  });

  it('names the jurisdiction in every reading', () => {
    for (const r of READINGS) {
      expect(jurisdictionLayerNote(r, 'Western Australia'), r.kind).toContain('Western Australia');
    }
  });

  /*
   * The rule this whole module was written for. `no_candidate_resolved` is
   * OUR gap and its sentence must say so — collapsing it into "the
   * jurisdiction publishes nothing" is how `SA_NT_NOTE` came to be a
   * statement about South Australia when it was a statement about our URLs.
   */
  it('says an unresolved candidate is a gap here, not an absence there', () => {
    const note = jurisdictionLayerNote({ kind: 'no_candidate_resolved', asked: 3 }, 'SA');
    expect(note).toMatch(/no working endpoint/i);
    expect(note).toMatch(/not a statement that SA publishes no planning layer/i);
  });

  it('never presents an unstated licence as permission', () => {
    const note = jurisdictionLayerNote({ kind: 'licence_unverified', service: 'S', layers: 3 }, 'NT');
    expect(note).toMatch(/not permission/i);
  });

  it('distinguishes integration work from a limitation of the source', () => {
    for (const kind of ['integratable', 'catalogue_readable'] as const) {
      const r = READINGS.find((x) => x.kind === kind);
      expect(r, kind).toBeDefined();
      expect(jurisdictionLayerNote(r as JurisdictionLayerReading, 'ACT'))
        .toMatch(/outstanding.*(?:work|integration)/i);
    }
  });
});

describe('the candidates', () => {
  it('gives every unread jurisdiction more than one candidate', () => {
    for (const j of UNREAD_JURISDICTIONS) {
      /*
       * A single 404 may never stand for a jurisdiction publishing nothing,
       * so one candidate is not enough to ask the question with.
       */
      expect(candidatesFor(j).length, j).toBeGreaterThan(1);
    }
  });

  it('covers exactly the four jurisdictions whose layers are not read', () => {
    expect([...new Set(LAYER_CANDIDATES.map((c) => c.jurisdiction))].sort())
      .toEqual([...UNREAD_JURISDICTIONS].sort());
  });

  /*
   * A host is typed; a layer id never is. A root ending in a layer index, or
   * carrying a query, is a path somebody guessed — and the whole point of
   * asking a service directory is that the publisher's own list answers
   * instead.
   */
  it('types a service root and never a layer id or a query', () => {
    for (const c of LAYER_CANDIDATES) {
      expect(c.root, c.service).toMatch(/^https:\/\//);
      expect(c.root, c.service).not.toContain('?');
      expect(c.root, c.service).not.toMatch(/\/(?:query|\d+)$/);
    }
  });

  /*
   * Asserted on a constructed candidate rather than by finding one of each
   * kind in the list: which kinds the list happens to hold is data that the
   * measurements change, and a spec pinning it fails for the wrong reason.
   * Both composers are production paths — the WFS one serves Victoria's
   * licence claim.
   */
  it('composes its own metadata request from the root', () => {
    const base: LayerCandidate = {
      jurisdiction: 'SA', publisher: 'p', service: 's', kind: 'arcgis', root: 'https://h/x',
    };
    expect(layerMetadataUrl(base)).toBe('https://h/x?f=json');
    expect(layerMetadataUrl({ ...base, kind: 'wfs' }))
      .toBe('https://h/x?service=WFS&request=GetCapabilities');
    expect(layerMetadataUrl({ ...base, root: 'https://h/x///' })).toBe('https://h/x?f=json');
  });

  /* A folder is a candidate composed from the PUBLISHER'S own folder name. */
  it('composes a folder candidate without typing a path', () => {
    const root = candidatesFor('WA')[0];
    const folder = folderRootFor(root, 'SLIP_Public_Services');
    expect(folder.root).toBe(`${root.root}/SLIP_Public_Services`);
    expect(folder.jurisdiction).toBe('WA');
    expect(folder.service).toContain('SLIP_Public_Services');
    expect(layerMetadataUrl(folder)).toMatch(/\?f=json$/);
  });

  /*
   * `catalogueWalkIsComplete`'s rule one level down. The ceiling has to clear
   * SA's measured thirty folders, or the walk truncates and an absence read
   * from it is the `limit=1000` answered with 25 fault again.
   */
  it('can walk every folder either measured jurisdiction published', () => {
    expect(FOLDER_WALK_CEILING).toBeGreaterThanOrEqual(30);
    expect(folderWalkIsComplete(Array.from({ length: 30 }, (_, i) => `f${i}`))).toBe(true);
    expect(folderWalkIsComplete(Array.from({ length: FOLDER_WALK_CEILING + 1 }, (_, i) => `f${i}`)))
      .toBe(false);
  });
});

/**
 * The bot-protection interstitial, and why it is not a refusal.
 *
 * Measured 22 Sep 2026: `www.ntlis.nt.gov.au` answered **403** with
 * `<title>Just a moment...</title>`. Read as `refused`, the note said *"NT's
 * planning service declined this platform's requests"* — which sends an
 * operator to write to the Northern Territory about a decision nobody there
 * made. The remedy is ours.
 */
describe('a challenge page is not a decision the publisher made', () => {
  const CHALLENGE = '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>'
    + '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">';

  it('recognises the interstitial NT actually served', () => {
    expect(bodyLooksChallenged(CHALLENGE)).toBe(true);
    expect(classifyCandidateFailure(403, false, CHALLENGE)).toBe('challenged');
  });

  /*
   * Matched on the page and never on the digit, because the same challenge is
   * served under 403, 429 and 503 depending on the edge's mood — and the same
   * 403 is how a service genuinely declines.
   */
  it('is decided by the page rather than the status', () => {
    expect(classifyCandidateFailure(503, false, CHALLENGE)).toBe('challenged');
    expect(classifyCandidateFailure(429, false, CHALLENGE)).toBe('challenged');
    expect(classifyCandidateFailure(403, false, '{"error":{"code":403,"message":"Access denied"}}'))
      .toBe('refused');
  });

  it('does not read an ordinary refusal as a challenge', () => {
    expect(bodyLooksChallenged('You are not authorised to access this service.')).toBe(false);
    expect(bodyLooksChallenged('')).toBe(false);
  });

  /* A 400 is the request, not the address — and both are ours. */
  it('blames us for a 400 as well as a 404', () => {
    expect(classifyCandidateFailure(400, false, '<title>ArcGIS Server Error</title>')).toBe('bad_request');
    expect(classifyCandidateFailure(405, false)).toBe('bad_request');
    const outcomes = [
      { candidate: { jurisdiction: 'WA', publisher: 'p', service: 'a', kind: 'arcgis', root: 'https://h' } as LayerCandidate,
        outcome: { kind: 'failed', failure: 'bad_request', status: 400, detail: '400' } as CandidateOutcome },
      { candidate: { jurisdiction: 'WA', publisher: 'p', service: 'b', kind: 'arcgis', root: 'https://h' } as LayerCandidate,
        outcome: { kind: 'failed', failure: 'no_such_service', status: 404, detail: '404' } as CandidateOutcome },
    ];
    expect(assessJurisdictionLayers(outcomes).kind).toBe('no_candidate_resolved');
  });

  it('names a challenge ahead of everything else it could be confused with', () => {
    const c = { jurisdiction: 'NT', publisher: 'p', service: 's', kind: 'arcgis', root: 'https://h' } as LayerCandidate;
    const r = assessJurisdictionLayers([
      { candidate: c, outcome: { kind: 'failed', failure: 'challenged', status: 403, detail: 'x' } },
      { candidate: c, outcome: { kind: 'failed', failure: 'unreachable', status: null, detail: 'dns' } },
    ]);
    expect(r.kind).toBe('challenged');
    const note = jurisdictionLayerNote(r, 'NT');
    expect(note).toMatch(/bot-protection challenge/i);
    expect(note).toMatch(/rather than a decision NT made/i);
    expect(note).not.toMatch(/declined/i);
  });
});

/**
 * A catalogue outranks an unstated licence.
 *
 * Measured: the ACT's verified organisation answers **391 services** while
 * its one Territory Plan service answers a `copyrightText` of `"TP"`. Ranked
 * the other way the note read *"nothing from it is republished here"* about
 * a jurisdiction whose zone this product publishes on every ACT report.
 */
describe('the reading order the first live run settled', () => {
  const c = (service: string): LayerCandidate =>
    ({ jurisdiction: 'ACT', publisher: 'p', service, kind: 'arcgis', root: 'https://h' });

  it('prefers a catalogue of 391 to one service saying "TP"', () => {
    const r = assessJurisdictionLayers([
      { candidate: c('org directory'), outcome: { kind: 'directory', services: Array.from({ length: 391 }, (_, i) => `s${i}`), folders: [], bytes: 1 } },
      { candidate: c('TP FeatureServer'), outcome: { kind: 'answered', layers: ['Territory Plan Land Use Zones'], licence: { kind: 'unverified', evidence: 'TP' }, bytes: 1 } },
    ]);
    expect(r.kind).toBe('catalogue_readable');
    if (r.kind === 'catalogue_readable') expect(r.services).toBe(391);
  });

  /* A stated RESTRICTION still outranks a catalogue: it is a prohibition. */
  it('keeps a stated restriction above a catalogue', () => {
    const r = assessJurisdictionLayers([
      { candidate: c('dir'), outcome: { kind: 'directory', services: ['a', 'b'], folders: [], bytes: 1 } },
      { candidate: c('svc'), outcome: { kind: 'answered', layers: [], licence: { kind: 'restricted', evidence: 'non-commercial' }, bytes: 1 } },
    ]);
    expect(r.kind).toBe('licence_restricted');
  });

  /*
   * Folders and no services: WA's measured answer. A catalogue that lists
   * zero services has not answered the question, and saying it "lists 0
   * services" is a sentence about our walk wearing the shape of a finding
   * about Landgate.
   */
  it('does not call a folders-only directory a catalogue of nothing', () => {
    const r = assessJurisdictionLayers([
      { candidate: c('SLIP root'), outcome: { kind: 'directory', services: [], folders: ['SLIP_Public_Services', 'Utilities'], bytes: 1 } },
    ]);
    expect(r.kind).toBe('catalogue_folders_only');
    const note = jurisdictionLayerNote(r, 'WA');
    expect(note).toMatch(/2 folders and no service/);
    expect(note).toMatch(/outstanding work here/);
    expect(note).not.toMatch(/\b0 services\b/);
  });
});

/**
 * The licence claims this product already republishes under.
 *
 * The mirror of `WA_LICENCE_NOTE`: there a restriction is asserted and
 * nothing is fetched, here a permission is asserted and everything is. A
 * wrong restriction costs a report a row; a wrong permission puts somebody
 * else's data in a document that has already been emailed.
 */
describe('the licence claims, checked against the publisher', () => {
  it('names a claim for every jurisdiction whose layers are read', () => {
    expect([...new Set(LICENCE_CLAIMS.map((c) => c.jurisdiction))].sort())
      .toEqual(['ACT', 'NSW', 'QLD', 'TAS', 'VIC']);
  });

  /* Each claim names the constant it comes from, so a reader can check it. */
  it('names where each claim is made', () => {
    for (const c of LICENCE_CLAIMS) {
      expect(c.claimedIn, c.jurisdiction).toMatch(/\.pure\.ts — [A-Z_]+$/);
      expect(c.root, c.jurisdiction).toMatch(/^https:\/\//);
      expect(c.root, c.jurisdiction).not.toContain('?');
      expect(licenceMetadataUrl(c), c.jurisdiction).toContain(c.root);
    }
  });

  /*
   * Three-valued on purpose, and `silent` is the load-bearing one. A
   * three-character `copyrightText` is silence about terms, not a denial of
   * them — downgrading a real CC BY 4.0 grant on the strength of it is the
   * same error as upgrading an unstated licence to permission.
   */
  it('reads silence as silence and only a stated restriction as a contradiction', () => {
    expect(verifyLicenceClaim({ kind: 'unverified', evidence: 'TP' }).kind).toBe('silent');
    expect(verifyLicenceClaim({ kind: 'unverified', evidence: null }).kind).toBe('silent');
    expect(verifyLicenceClaim({ kind: 'open', evidence: 'CC BY 4.0' }).kind).toBe('corroborated');
    expect(verifyLicenceClaim({ kind: 'restricted', evidence: 'non-commercial' }).kind).toBe('contradicted');
    expect(verifyLicenceClaim(null, 'HTTP 503').kind).toBe('unasked');
  });

  it('asks for attention only where the publisher states a restriction', () => {
    expect(claimNeedsAttention({ kind: 'contradicted', evidence: 'x' })).toBe(true);
    expect(claimNeedsAttention({ kind: 'silent', evidence: 'TP' })).toBe(false);
    expect(claimNeedsAttention({ kind: 'unasked', detail: 'x' })).toBe(false);
    expect(claimNeedsAttention({ kind: 'corroborated', evidence: 'CC BY' })).toBe(false);
  });

  /*
   * `corroborated` means the publisher names AN open licence, not THIS one.
   * Matching the exact string would report `CC BY 3.0 AU` against a service
   * saying `CC BY 4.0` as a contradiction of a claim that is substantively
   * right — and what matters for a commercial report is whether
   * republication is permitted at all.
   */
  it('does not demand the publisher name the same version', () => {
    expect(verifyLicenceClaim({ kind: 'open', evidence: 'Creative Commons Attribution 4.0' }).kind)
      .toBe('corroborated');
  });

  /*
   * The ACT entry is not a guess: it is the ArcGIS organisation this product
   * already reads a GAZETTED Territory Plan zone from in production. A
   * literal at each end is how two ends drift, so the two spellings are
   * pinned together rather than trusted.
   */
  it('reaches the ACT through the organisation the verified zone query uses', () => {
    const live = buildActZoningQuery(149.13, -35.28);
    const org = /services1\.arcgis\.com\/([A-Za-z0-9]+)\//.exec(live);
    expect(org, 'the ACT zone query no longer names an AGOL organisation').not.toBeNull();
    const act = candidatesFor('ACT');
    expect(act.every((c) => c.root.includes((org as RegExpExecArray)[1]))).toBe(true);
  });
});


/**
 * The refinement that was already being read and thrown away.
 *
 * `parseNswInstrument` reads the LEP's amendment number and commencement date
 * off layer 8 of the same Identify the height and the minimum lot size come
 * from, and handed both to `console.log`. So the register's Instrument column
 * named *The Hills Local Environmental Plan 2019* over a record that knew
 * which amendment of it was in force.
 */
describe('instrument currency — the amendment the controls come from', () => {
  const factsWith = (instrumentCurrency: unknown, constraints: unknown[] = []) => buildPlanningFacts({
    planningData: {
      jurisdiction: 'NSW',
      fetchedAt: '2026-09-22T00:00:00.000Z',
      zoning: { status: 'ok', zoneCode: 'R2', zoneLabel: 'Low Density Residential' },
      constraints,
      constraintsAsked: [],
      constraintRegisters: { answered: ['NSW principal'], unavailable: [] },
      instrumentCurrency,
    },
  });

  it('names the instrument and the amendment in force, with its commencement', () => {
    const line = instrumentCurrencyLine(factsWith({
      name: 'The Hills Local Environmental Plan 2019',
      amendment: '12',
      commenced: '2026-03-03',
      lga: 'THE HILLS SHIRE',
    }));
    expect(line).toContain('The Hills Local Environmental Plan 2019');
    expect(line).toContain('Amendment 12');
    expect(line).toContain('3 Mar 2026');
  });

  it('does not say "Amendment Amendment 12"', () => {
    const line = instrumentCurrencyLine(factsWith({ name: 'X LEP 2019', amendment: 'Amendment 12' }));
    expect(line).toContain('Amendment 12');
    expect(line).not.toMatch(/Amendment\s+Amendment/i);
  });

  /*
   * `stripPlaceholderRows`' rule: an absence is omitted, never worded. There
   * is nothing a reader can do with "the amendment in force was not
   * published", and the sentence still carries the instrument.
   */
  it('omits an absent amendment rather than wording it', () => {
    const line = instrumentCurrencyLine(factsWith({ name: 'X LEP 2019', amendment: null }));
    expect(line).toBe('The controls above are read from *X LEP 2019*.');
    expect(line).not.toMatch(/not (?:published|available|stated)/i);
  });

  it('is absent entirely for a jurisdiction that answers none, and on a legacy enrichment', () => {
    expect(instrumentCurrencyLine(factsWith(null))).toBeNull();
    expect(instrumentCurrencyLine(factsWith(undefined))).toBeNull();
    /* A reading with no instrument name is no reading, not a partial one. */
    expect(instrumentCurrencyLine(factsWith({ amendment: '12' }))).toBeNull();
  });

  /*
   * Drawn only beside a register that returned something: "the controls above"
   * refers to nothing otherwise, which is the `verdict.pricingUrl` defect —
   * a value computed and never rendered — inverted into a value rendered
   * where its subject does not exist.
   */
  it('reaches the register only where the register returned something', () => {
    const currency = { name: 'X LEP 2019', amendment: '12', commenced: '2026-03-03', lga: 'L' };
    const empty = renderConstraintRegister(factsWith(currency));
    expect(empty).not.toContain('X LEP 2019');

    const withRow = renderConstraintRegister(factsWith(currency, [{
      family: 'heritage', kind: 'overlay', label: 'Heritage Conservation Area',
      instrument: 'X LEP 2019', clause: '5.10', currencyDate: '2026-03-03',
      source: 'NSW principal', licence: 'CC BY 4.0',
    }]));
    expect(withRow).toContain('X LEP 2019');
    expect(withRow).toContain('Amendment 12');
  });

  /*
   * It states no control and admits no use — it is a fact about the DOCUMENT.
   * The same rule `planningControlGuide`'s spec enforces for the guide: a
   * sentence written in advance may carry no measurement.
   */
  it('states no control, no measurement and no permission', () => {
    const line = instrumentCurrencyLine(factsWith({
      name: 'X LEP 2019', amendment: '12', commenced: '2026-03-03', lga: 'L',
    })) as string;
    expect(line).not.toMatch(/\d+(?:\.\d+)?\s?(?:m|m²|sqm|metres|%)\b/);
    expect(line).not.toMatch(/\bpermit(?:ted|s)?\b|\bmay be built\b|\bapprov/i);
  });
});

/**
 * A module with no call site is not shipped.
 *
 * The Builder Portal paid for this rule twice — three components written,
 * documented, merged and deployed with nothing rendering them, then 28 CSS
 * classes nothing wore. An unused export typechecks, lints and builds, so the
 * only thing that catches it is an assertion that something calls it.
 */
describe('the declared orders are actually consulted', () => {
  const service = readFileSync('supabase/functions/planning-data-service/index.ts', 'utf8');

  it('is read by planning-data-service, not merely exported', () => {
    expect(service).toContain("planningProviders.pure.ts");
    expect(service).toContain('planningProviderOrder(');
    expect(service).toContain('developmentProviderOrder(');
    expect(service).toContain('refinementsThatAnswered(');
  });

  /*
   * The order is a configuration; what a report may state turns on what
   * ANSWERED. Publishing only the order would let a coverage sentence claim a
   * refinement that contributed nothing.
   */
  it('publishes what answered beside what was configured', () => {
    expect(service).toMatch(/floorAnswered:\s*floorAnswered\(/);
    expect(service).toMatch(/refinementsAnswered:\s*refinementsThatAnswered\(/);
  });

  /* The amendment is published now, not logged. */
  it('publishes the NSW instrument reading rather than logging it', () => {
    expect(service).toContain('instrumentCurrency = parseNswInstrument(');
    expect(service).not.toMatch(/console\.log\([^)]*NSW instrument/);
  });
});
