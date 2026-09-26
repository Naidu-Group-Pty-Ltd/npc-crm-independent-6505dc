/**
 * The national pipeline register — discovery, and the four different sentences.
 *
 * Every fixture here is written to CKAN's own published envelope shape
 * (`{success, result: {count, results: [{organization, resources: [...]}]}}`),
 * which is what `data.gov.au` serves and what `investmentProgramme.pure.ts`
 * already reads Queensland's QTRIP through. The publisher's OWN bytes are
 * verified separately and from CI, by `scripts/market/national-pipeline-liveness.ts`,
 * because this egress answers 403 to CONNECT for `data.gov.au` — which is why
 * a fixture suite alone is never the verification here, only the shape.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildInfrastructureEvidence, renderInfrastructureOutlook }
  from '@/lib/reports/../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';

import {
  MACHINE_READABLE_FORMATS,
  NATIONAL_PIPELINE_COVERAGE_PHRASE,
  NATIONAL_PIPELINE_ORG_PATTERN,
  NATIONAL_PIPELINE_PUBLISHER,
  NATIONAL_PIPELINE_QUERIES,
  NATIONAL_PIPELINE_REGISTER,
  assessPipelineAvailability,
  catalogueWalkIsComplete,
  ckanFieldsUrl,
  ckanOrganisationFacetUrl,
  ckanOrganisationPackagesUrl,
  ckanOrganisationShowUrl,
  ckanOrganisationSlugsUrl,
  corroborateOrganisations,
  ckanSampleUrl,
  ckanSearchUrl,
  findPipelinePublisher,
  mergeCatalogueReads,
  parseCkanSearch,
  parseOrganisationFacet,
  parseOrganisationShow,
  parseOrganisationSlugs,
  publisherFromEnumeration,
  pipelineCoverageNote,
  rankPipelineResources,
  surveyPipelinePackages,
  type CkanPackage,
  type CkanParse,
  type PublisherLookup,
} from '@/lib/reports/../../../supabase/functions/_shared/planning/nationalPipeline.pure';

interface ResourceSeed {
  id?: string;
  name?: string;
  format?: string;
  url?: string;
  datastore_active?: boolean;
  size?: number | string;
  last_modified?: string;
}

function ckan(
  results: {
    id: string;
    name: string;
    title: string;
    org?: string;
    licence?: string;
    modified?: string;
    resources?: ResourceSeed[];
  }[],
  count = results.length,
): string {
  return JSON.stringify({
    success: true,
    result: {
      count,
      results: results.map((r) => ({
        id: r.id,
        name: r.name,
        title: r.title,
        license_title: r.licence ?? 'Creative Commons Attribution 4.0 International',
        metadata_modified: r.modified ?? '2026-07-01T00:00:00.000000',
        organization: r.org === undefined ? undefined : { name: 'slug', title: r.org },
        resources: (r.resources ?? []).map((res, i) => ({
          id: res.id ?? `res-${r.id}-${i}`,
          name: res.name ?? `resource ${i}`,
          format: res.format ?? 'CSV',
          url: res.url ?? `https://data.gov.au/dataset/${r.name}/resource/${i}/download/file.csv`,
          datastore_active: res.datastore_active ?? false,
          size: res.size,
          last_modified: res.last_modified,
        })),
      })),
    },
  });
}

const IA = 'Infrastructure Australia';

/** The publisher, found. Every availability reading below needs one. */
const FOUND: PublisherLookup = {
  kind: 'publisher',
  organisation: { id: 'org', name: 'infrastructure-australia', title: IA, packageCount: 3 },
};

function orgs(list: { id: string; name: string; title: string; package_count?: number }[]): string {
  return JSON.stringify({ success: true, result: list });
}

function show(o: { id: string; name: string; title: string; package_count?: number }): string {
  return JSON.stringify({ success: true, result: o });
}

function slugList(slugs: string[]): string {
  return JSON.stringify({ success: true, result: slugs });
}

function facet(slugs: string[]): string {
  return JSON.stringify({
    success: true,
    result: { count: 0, results: [], search_facets: { organization: { items: slugs.map((name) => ({ name, count: 1 })) } } },
  });
}

/** Every organisation reading the enumeration tests go through. */
function enumerate(list: string[], published: string[] = list) {
  return corroborateOrganisations(parseOrganisationSlugs(slugList(list)), parseOrganisationFacet(facet(published)));
}

function catalogueOf(text: string): CkanPackage[] {
  const parse = parseCkanSearch(text);
  if (parse.kind !== 'catalogue') throw new Error(`expected a catalogue, got ${parse.reason}`);
  return parse.packages;
}

describe('reading the Commonwealth catalogue', () => {
  it('reads a package, its organisation title and its resources', () => {
    const parse = parseCkanSearch(
      ckan([
        {
          id: 'pkg-1',
          name: 'infrastructure-priority-list',
          title: 'Infrastructure Priority List 2026',
          org: IA,
          resources: [{ format: 'csv', datastore_active: true, size: '81920' }],
        },
      ], 1),
    );
    expect(parse.kind).toBe('catalogue');
    if (parse.kind !== 'catalogue') return;
    expect(parse.total).toBe(1);
    expect(parse.packages[0].organisation).toBe(IA);
    expect(parse.packages[0].licence).toContain('Creative Commons');
    // The publisher's own format word, upper-cased — never inferred from the URL.
    expect(parse.packages[0].resources[0].format).toBe('CSV');
    expect(parse.packages[0].resources[0].datastoreActive).toBe(true);
    expect(parse.packages[0].resources[0].size).toBe(81920);
  });

  it('refuses a body that is not JSON, naming the size and the first bytes', () => {
    const html = `<!DOCTYPE html><html><head><title>Service unavailable</title></head>${'x'.repeat(4000)}`;
    const parse = parseCkanSearch(html);
    expect(parse.kind).toBe('refused');
    if (parse.kind !== 'refused') return;
    expect(parse.reason).toContain(String(html.length));
    expect(parse.reason).toContain('DOCTYPE');
  });

  it('refuses CKAN’s own failure envelope rather than reading it as empty', () => {
    const parse = parseCkanSearch(JSON.stringify({ success: false, error: { message: 'Not found' } }));
    expect(parse.kind).toBe('refused');
    if (parse.kind !== 'refused') return;
    expect(parse.reason).toContain('Not found');
  });

  it('refuses a 200 whose shape it does not recognise', () => {
    const parse = parseCkanSearch(JSON.stringify({ success: true, result: { count: 3 } }));
    expect(parse.kind).toBe('refused');
    if (parse.kind !== 'refused') return;
    expect(parse.reason).toContain('no result.results array');
  });
});

describe('which packages are the register', () => {
  it('needs the publisher AND the register’s name, because either alone is wrong', () => {
    const packages = catalogueOf(
      ckan([
        // The register.
        { id: 'a', name: 'ipl', title: 'Infrastructure Priority List', org: IA },
        // Right publisher, different publication.
        { id: 'b', name: 'audit', title: 'Australian Infrastructure Audit 2026', org: IA },
        // Right name, a different jurisdiction's register with a different coverage claim.
        { id: 'c', name: 'nsw-ipl', title: 'NSW Infrastructure Priority List', org: 'Infrastructure NSW' },
        // Neither.
        { id: 'd', name: 'roads', title: 'Road deaths by month', org: 'BITRE' },
      ]),
    );
    expect(surveyPipelinePackages(packages).map((p) => p.id)).toEqual(['a']);
  });

  it('accepts the names the publisher has actually used for this list', () => {
    const packages = catalogueOf(
      ckan([
        { id: 'a', name: 'p1', title: 'Infrastructure Priority List 2026', org: IA },
        { id: 'b', name: 'p2', title: 'Infrastructure Pipeline', org: IA },
        { id: 'c', name: 'p3', title: 'Priority Initiatives and Projects', org: IA },
      ]),
    );
    expect(surveyPipelinePackages(packages)).toHaveLength(3);
  });

  it('never returns the same package twice', () => {
    const packages = catalogueOf(
      ckan([
        { id: 'a', name: 'ipl', title: 'Infrastructure Priority List', org: IA },
        { id: 'a', name: 'ipl', title: 'Infrastructure Priority List', org: IA },
      ]),
    );
    expect(surveyPipelinePackages(packages)).toHaveLength(1);
  });
});

describe('which resource is tried first', () => {
  it('puts a queryable resource before a download, whatever its date', () => {
    const packages = catalogueOf(
      ckan([
        {
          id: 'a',
          name: 'ipl',
          title: 'Infrastructure Priority List',
          org: IA,
          modified: '2024-01-01T00:00:00.000000',
          resources: [{ id: 'live', format: 'CSV', datastore_active: true }],
        },
        {
          id: 'b',
          name: 'ipl-2026',
          title: 'Infrastructure Priority List 2026',
          org: IA,
          modified: '2026-09-01T00:00:00.000000',
          resources: [{ id: 'file', format: 'CSV' }],
        },
      ]),
    );
    const ranked = rankPipelineResources(packages);
    expect(ranked.map((c) => c.resource.id)).toEqual(['live', 'file']);
    expect(ranked[0].access).toBe('queryable');
    expect(ranked[1].access).toBe('download');
  });

  it('prefers the newer edition, then the declared format order', () => {
    const packages = catalogueOf(
      ckan([
        {
          id: 'a',
          name: 'ipl-2024',
          title: 'Infrastructure Priority List 2024',
          org: IA,
          modified: '2024-06-01T00:00:00.000000',
          resources: [{ id: 'old-csv', format: 'CSV' }],
        },
        {
          id: 'b',
          name: 'ipl-2026',
          title: 'Infrastructure Priority List 2026',
          org: IA,
          modified: '2026-06-01T00:00:00.000000',
          resources: [
            { id: 'new-xlsx', format: 'XLSX' },
            { id: 'new-csv', format: 'CSV' },
          ],
        },
      ]),
    );
    expect(rankPipelineResources(packages).map((c) => c.resource.id))
      .toEqual(['new-csv', 'new-xlsx', 'old-csv']);
  });

  it('refuses a document as a register, and leaves it findable as a format', () => {
    const packages = catalogueOf(
      ckan([
        {
          id: 'a',
          name: 'ipl',
          title: 'Infrastructure Priority List',
          org: IA,
          resources: [
            { id: 'pdf', format: 'PDF' },
            { id: 'doc', format: 'DOCX' },
          ],
        },
      ]),
    );
    expect(rankPipelineResources(packages)).toHaveLength(0);
    const availability = assessPipelineAvailability(FOUND, parseCkanSearch(
      ckan([
        {
          id: 'a',
          name: 'ipl',
          title: 'Infrastructure Priority List',
          org: IA,
          resources: [
            { id: 'pdf', format: 'PDF' },
            { id: 'doc', format: 'DOCX' },
          ],
        },
      ]),
    ));
    expect(availability.kind).toBe('published_as_documents');
    if (availability.kind !== 'published_as_documents') return;
    expect(availability.formats).toEqual(['DOCX', 'PDF']);
  });

  it('takes a datastore-active resource even when its format is one we cannot decode', () => {
    // Rule 3: a queryable endpoint is not a format. CKAN answers JSON for it
    // however the catalogue labels the underlying distribution.
    const packages = catalogueOf(
      ckan([
        {
          id: 'a',
          name: 'ipl',
          title: 'Infrastructure Priority List',
          org: IA,
          resources: [{ id: 'live', format: 'PDF', datastore_active: true }],
        },
      ]),
    );
    expect(rankPipelineResources(packages).map((c) => c.resource.id)).toEqual(['live']);
  });
});

describe('merging several searches', () => {
  it('de-duplicates by package id and keeps the larger declared total', () => {
    const a = parseCkanSearch(ckan([{ id: 'x', name: 'ipl', title: 'Infrastructure Priority List', org: IA }], 4));
    const b = parseCkanSearch(ckan([
      { id: 'x', name: 'ipl', title: 'Infrastructure Priority List', org: IA },
      { id: 'y', name: 'pipe', title: 'Infrastructure Pipeline', org: IA },
    ], 9));
    const merged = mergeCatalogueReads([a, b]);
    expect(merged.kind).toBe('catalogue');
    if (merged.kind !== 'catalogue') return;
    expect(merged.packages.map((p) => p.id)).toEqual(['x', 'y']);
    expect(merged.total).toBe(9);
  });

  it('a refusal anywhere refuses the whole reading', () => {
    const good = parseCkanSearch(ckan([{ id: 'x', name: 'ipl', title: 'Infrastructure Priority List', org: IA }]));
    const bad: CkanParse = { kind: 'refused', reason: 'HTTP 502' };
    expect(mergeCatalogueReads([good, bad]).kind).toBe('refused');
    // A partial catalogue read as a complete one makes an absent package
    // indistinguishable from a query that failed.
    expect(mergeCatalogueReads([]).kind).toBe('refused');
  });
});

describe('the readings are five different sentences', () => {
  const ABSENT: PublisherLookup = { kind: 'publisher_absent', organisationsSeen: 1873 };
  const catalogues: CkanParse[] = [
    parseCkanSearch(ckan([{
      id: 'a', name: 'ipl', title: 'Infrastructure Priority List', org: IA,
      resources: [{ id: 'live', format: 'CSV', datastore_active: true }],
    }])),
    parseCkanSearch(ckan([{
      id: 'a', name: 'ipl', title: 'Infrastructure Priority List', org: IA,
      resources: [{ id: 'pdf', format: 'PDF' }],
    }])),
    parseCkanSearch(ckan([{ id: 'z', name: 'roads', title: 'Road deaths', org: 'BITRE' }])),
    { kind: 'refused', reason: 'HTTP 503' },
  ];

  /** Every reading, with the publisher lookup that produces it. */
  const readings = [
    ...catalogues.map((c) => assessPipelineAvailability(FOUND, c)),
    // The fifth: the catalogue names no such publisher. A different remedy.
    assessPipelineAvailability(ABSENT, catalogues[0]),
  ];

  it('names a distinct availability for each', () => {
    expect(readings.map((r) => r.kind)).toEqual([
      'readable',
      'published_as_documents',
      'not_in_catalogue',
      'catalogue_unavailable',
      'publisher_absent',
    ]);
  });

  it('a missing publisher outranks whatever the packages say', () => {
    /*
     * `catalogues[0]` is the readable one. If the publisher lookup were
     * consulted second, a stale package set would report a register this
     * catalogue does not distribute.
     */
    const reading = assessPipelineAvailability(ABSENT, catalogues[0]);
    expect(reading.kind).toBe('publisher_absent');
    if (reading.kind !== 'publisher_absent') return;
    expect(reading.organisationsSeen).toBe(1873);
  });

  it('a publisher lookup that failed is a retrieval failure, never an absence', () => {
    const reading = assessPipelineAvailability({ kind: 'refused', reason: 'HTTP 502' }, catalogues[0]);
    expect(reading.kind).toBe('catalogue_unavailable');
  });

  it('writes five distinct notes, each naming the register that was asked', () => {
    const notes = readings.map((r) => pipelineCoverageNote(r));
    expect(new Set(notes).size).toBe(5);
    for (const note of notes) {
      expect(note).toContain(NATIONAL_PIPELINE_PUBLISHER);
      expect(note).toContain(NATIONAL_PIPELINE_REGISTER);
    }
  });

  it('rates no absence — the level is never a judgement about the area', () => {
    // §9 of PLANNING_CONTROLS_IN_THE_REPORT.md: an absence may not be rated,
    // and never as a strength either.
    const forbidden = /\b(low|minimal|limited|negligible|favourable|favorable|strong|weak|poor|good)\b/i;
    for (const reading of readings) {
      expect(pipelineCoverageNote(reading)).not.toMatch(forbidden);
    }
  });

  it('never states that the area has no planned infrastructure', () => {
    const forbidden = /\bno (?:planned |named |major )?(?:infrastructure|projects?|works)\b/i;
    for (const reading of readings) {
      expect(pipelineCoverageNote(reading)).not.toMatch(forbidden);
    }
  });

  it('every note says what its absence is a statement ABOUT', () => {
    /*
     * The whole point of five readings rather than one: a reader must be able
     * to tell "the publisher distributes this elsewhere" from "we could not
     * reach the catalogue today", because the two send a person to opposite
     * remedies. A note that does not name its own subject collapses them.
     */
    for (const reading of readings.slice(1)) {
      expect(pipelineCoverageNote(reading)).toMatch(/statement about|not as a machine-readable register/i);
    }
  });
});

describe('an absence is only an absence if the question could have found it', () => {
  it('matches the publisher across a slug’s hyphen as well as a title’s space', () => {
    /*
     * Written `/infrastructure\s+australia/i` the rule matched the TITLE and
     * could never have matched the slug `infrastructure-australia` — a rule
     * that only ever half worked, found when the enumeration moved to slugs.
     */
    expect(NATIONAL_PIPELINE_ORG_PATTERN.test('infrastructure-australia')).toBe(true);
    expect(NATIONAL_PIPELINE_ORG_PATTERN.test('infrastructure_australia')).toBe(true);
    expect(NATIONAL_PIPELINE_ORG_PATTERN.test('Infrastructure Australia')).toBe(true);
    expect(NATIONAL_PIPELINE_ORG_PATTERN.test('infrastructure-nsw')).toBe(false);
  });

  it('finds the publisher from the corroborated slugs and its own show record', () => {
    const lookup = publisherFromEnumeration(
      enumerate(['geoscience-australia', 'infrastructure-australia', 'bitre']),
      parseOrganisationShow(show({ id: 'o2', name: 'infrastructure-australia', title: IA, package_count: 12 })),
    );
    expect(lookup.kind).toBe('publisher');
    if (lookup.kind !== 'publisher') return;
    expect(lookup.organisation.id).toBe('o2');
    expect(lookup.organisation.packageCount).toBe(12);
  });

  it('prefers the duplicate holding the most packages, never the list order', () => {
    const lookup = findPipelinePublisher({
      kind: 'organisations',
      organisations: [
        { id: 'empty', name: 'infrastructure-australia-old', title: IA, packageCount: 0 },
        { id: 'live', name: 'infrastructure-australia', title: IA, packageCount: 9 },
      ],
    });
    expect(lookup.kind === 'publisher' && lookup.organisation.id).toBe('live');
  });

  it('reports a genuine absence with the size of the enumeration behind it', () => {
    const lookup = publisherFromEnumeration(
      enumerate(['bitre', 'nsw-government', 'geoscience-australia']),
      { kind: 'refused', reason: 'nothing to resolve' },
    );
    expect(lookup.kind).toBe('publisher_absent');
    if (lookup.kind !== 'publisher_absent') return;
    expect(lookup.organisationsSeen).toBe(3);
  });

  it('a matched slug that cannot be resolved is a refusal, never an absence', () => {
    const lookup = publisherFromEnumeration(
      enumerate(['infrastructure-australia']),
      { kind: 'refused', reason: 'HTTP 500' },
    );
    expect(lookup.kind).toBe('refused');
    if (lookup.kind !== 'refused') return;
    expect(lookup.reason).toContain('infrastructure-australia');
  });

  it('refuses organisation OBJECTS from the slug endpoint rather than reading a page as a list', () => {
    /*
     * The measured defect: `organization_list?all_fields=true&limit=1000` was
     * answered with 25 — CKAN's default page size, the `limit` ignored — and
     * the walk read a short page as the end of the list. The reader for that
     * endpoint is deleted; this is the guard that stops it coming back.
     */
    const parse = parseOrganisationSlugs(orgs([{ id: 'o1', name: 'a', title: 'A' }]));
    expect(parse.kind).toBe('refused');
    if (parse.kind !== 'refused') return;
    expect(parse.reason).toContain('paged');
  });

  it('refuses when the facet names an organisation the list does not', () => {
    // A facet bucket outside the list means the list is incomplete, and an
    // incomplete list cannot establish that anything is absent from it.
    const reading = enumerate(['bitre'], ['bitre', 'infrastructure-australia']);
    expect(reading.kind).toBe('refused');
    if (reading.kind !== 'refused') return;
    expect(reading.reason).toContain('infrastructure-australia');
    expect(reading.reason).toContain('cannot establish an absence');
  });

  it('needs both endpoints — either refusing refuses the enumeration', () => {
    expect(corroborateOrganisations({ kind: 'refused', reason: 'HTTP 502' }, parseOrganisationFacet(facet(['a']))).kind)
      .toBe('refused');
    expect(corroborateOrganisations(parseOrganisationSlugs(slugList(['a'])), { kind: 'refused', reason: 'HTTP 502' }).kind)
      .toBe('refused');
  });

  it('refuses a body that is not an organisation list, naming what it got', () => {
    const slugs = parseOrganisationSlugs('<html>503</html>');
    expect(slugs.kind).toBe('refused');
    if (slugs.kind !== 'refused') return;
    expect(slugs.reason).toContain('html');
    const f = parseOrganisationFacet(JSON.stringify({ success: true, result: { count: 0, results: [] } }));
    expect(f.kind).toBe('refused');
    if (f.kind !== 'refused') return;
    expect(f.reason).toContain('no organisation facet');
  });

  it('refuses an organization_show answer that carries no organisation', () => {
    const parse = parseOrganisationShow(JSON.stringify({ success: true, result: {} }));
    expect(parse.kind).toBe('refused');
  });

  it('an incomplete walk is a retrieval failure, never a smaller register', () => {
    // A package missing because the walk stopped is indistinguishable from one
    // that does not exist. The urban-centre register's rule, one register along.
    const partial = parseCkanSearch(ckan([
      { id: 'a', name: 'x', title: 'Australian Infrastructure Audit', org: IA },
    ], 40));
    expect(catalogueWalkIsComplete(partial)).toBe(false);
    const reading = assessPipelineAvailability(FOUND, partial);
    expect(reading.kind).toBe('catalogue_unavailable');
    if (reading.kind !== 'catalogue_unavailable') return;
    expect(reading.reason).toContain('1 of 40');
  });

  it('a complete walk with nothing matching IS an absence', () => {
    const complete = parseCkanSearch(ckan([
      { id: 'a', name: 'x', title: 'Australian Infrastructure Audit', org: IA },
      { id: 'b', name: 'y', title: 'Infrastructure Reform Report', org: IA },
    ]));
    expect(catalogueWalkIsComplete(complete)).toBe(true);
    const reading = assessPipelineAvailability(FOUND, complete);
    expect(reading.kind).toBe('not_in_catalogue');
    if (reading.kind !== 'not_in_catalogue') return;
    expect(reading.searched).toBe(2);
  });

  it('a refused read is never a complete walk', () => {
    expect(catalogueWalkIsComplete({ kind: 'refused', reason: 'HTTP 500' })).toBe(false);
  });

  it('filters the publisher’s packages rather than ranking them', () => {
    /*
     * `fq` constrains the result set; `q` scores it. That difference is the
     * whole reason the first version of this probe reported an absence over 53
     * packages of marine-park research, so it is asserted rather than assumed.
     */
    const url = ckanOrganisationPackagesUrl('o-1', 100, 200);
    /*
     * The colon stays unencoded: it is Solr's field separator, and percent-
     * encoding it turns `owner_org:"o-1"` into a search TERM — which would be
     * the loose query all over again, wearing the filter's name. The value is
     * encoded, quotes and all, because that is where a caller's id goes.
     */
    expect(url).toContain('fq=owner_org:%22o-1%22');
    expect(url).not.toMatch(/[?&]q=/);
    expect(url).toContain('rows=100&start=200');
  });

  it('asks the organisation list plainly, and the facet for every bucket', () => {
    // `all_fields` is what got capped. Its absence is the design.
    expect(ckanOrganisationSlugsUrl()).not.toContain('all_fields');
    expect(ckanOrganisationSlugsUrl()).not.toContain('limit');
    expect(ckanOrganisationFacetUrl()).toContain('rows=0');
    expect(ckanOrganisationFacetUrl()).toContain('facet.limit=-1');
    expect(ckanOrganisationShowUrl('a/b')).toContain('id=a%2Fb');
  });
});

describe('the URLs', () => {
  it('asks for the declarations without a single row', () => {
    expect(ckanFieldsUrl('abc-123')).toContain('limit=0');
    expect(ckanSampleUrl('abc-123', 5)).toContain('limit=5');
  });

  it('encodes a resource id rather than interpolating it', () => {
    expect(ckanFieldsUrl('a/b c')).toContain('resource_id=a%2Fb%20c');
  });

  it('encodes a quoted search phrase', () => {
    expect(ckanSearchUrl('"infrastructure priority list"')).toContain('q=%22infrastructure%20priority%20list%22');
    expect(ckanSearchUrl('x', 10, 20)).toContain('rows=10&start=20');
  });

  it('asks more than one question of the catalogue', () => {
    // One query is one guess about how a publisher titles its own work.
    expect(NATIONAL_PIPELINE_QUERIES.length).toBeGreaterThan(1);
  });

  it('names no organisation slug, package id or resource id anywhere in the module', () => {
    /*
     * An identifier nobody here could verify fails exactly like an absent one —
     * `absBuildingApprovals.pure.ts` pays for this rule, and it is why the
     * dataflow there is discovered rather than typed. A resource id is
     * something this module OUTPUTS, so a CKAN uuid appearing in its source
     * would mean a future edition silently reads a past one.
     */
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/functions/_shared/planning/nationalPipeline.pure.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(code).not.toMatch(/organization:\s*\S/);
    // The declared preference order is the one thing that IS a literal here.
    expect(MACHINE_READABLE_FORMATS.join(',')).toBe('CSV,XLSX,XLS,JSON,GEOJSON');
  });
});

describe('the acceptance criterion is about the PAGE', () => {
  /*
   * W3.2 accepts *"page 22's sentence is replaced by named, dated, sourced
   * entries, or by a coverage statement that names the register asked."*
   *
   * The existing assertion is that `coverageLimitsFor` CONTAINS the named
   * limit, which is a fact about an array. An array a renderer drops is a
   * guarantee nobody reads — the `verdict.pricingUrl` defect, and
   * `stripEditorialBlocks`' whole lesson: an instruction is a request, this is
   * the guarantee. So the statement is asserted where a client meets it.
   */
  const outlook = (programmeRead: boolean): string => renderInfrastructureOutlook(
    buildInfrastructureEvidence({
      planningData: {
        fetchedAt: '2026-09-22T00:00:00.000Z',
        jurisdiction: programmeRead ? 'QLD' : 'NSW',
        investmentProgramme: programmeRead
          ? {
            status: 'ok',
            investments: [],
            edition: '2025-26 to 2028-29',
            radiusKm: 25,
            unplaced: 0,
            source: 'Queensland Transport and Roads Investment Program (QTRIP), Department of Transport and Main Roads',
            licence: 'CC BY 4.0',
          }
          : { status: 'not_served', note: 'the NSW programme is published as budget papers.' },
      },
    }),
  );

  it('names the national register on the page, whether or not a state programme was read', () => {
    for (const programmeRead of [true, false]) {
      const page = outlook(programmeRead);
      expect(page, `programmeRead=${programmeRead}`).toContain(NATIONAL_PIPELINE_COVERAGE_PHRASE);
      expect(page, `programmeRead=${programmeRead}`).toContain(NATIONAL_PIPELINE_PUBLISHER);
    }
  });

  it('and states it as coverage rather than as a finding about the area', () => {
    /*
     * Reading one state's forward works says nothing about a national list,
     * which is why `coverageLimitsFor` keeps this entry in both branches. What
     * the page may never do is turn the absence into a claim about the area.
     *
     * The guard is written as ASSERTED forms, and that bound was found by
     * execution rather than chosen: the paragraph carries the sentence *"it is
     * not a basis for rating infrastructure risk as low"*, and a bare-word
     * scan reads its own prohibition as the thing it prohibits. A rating is a
     * level ASSERTED of the subject; a sentence forbidding one is the
     * guarantee working, and rewording it to satisfy a regex would delete the
     * guarantee to keep the guard. `NO_RATING_FROM_AN_ABSENCE`'s own lesson.
     */
    const claimsAbsence = /\bno (?:planned |named |major )?(?:infrastructure|projects?|works)\b/i;
    const assertsALevel = new RegExp(
      '(\\|\\s*(?:low|minimal|negligible|favourable)\\s*\\|)'
      + '|(\\*\\*\\s*(?:low|minimal|negligible|favourable)\\s*\\*\\*)'
      + '|(\\bis\\s+(?:low|minimal|negligible|favourable)\\b)',
      'i',
    );
    for (const programmeRead of [true, false]) {
      const page = outlook(programmeRead);
      const sentence = page.split('\n').find((l) => l.includes(NATIONAL_PIPELINE_COVERAGE_PHRASE)) ?? '';
      expect(sentence, `programmeRead=${programmeRead}`).not.toMatch(claimsAbsence);
      expect(sentence, `programmeRead=${programmeRead}`).not.toMatch(assertsALevel);
      // And it says whose statement the absence is.
      expect(sentence, `programmeRead=${programmeRead}`)
        .toMatch(/not a finding that nothing is planned nearby/i);
    }
  });
});

describe('the register is named in exactly one module', () => {
  it('and the coverage phrase is not a second literal', () => {
    /*
     * `INFRASTRUCTURE_COVERAGE_LIMITS` carried its own copy of the phrase, so
     * the page said "Infrastructure Australia Priority List" while this module
     * said "Infrastructure Priority List". Two spellings of one register is
     * how `AML_COMMAND_REFRESH_EVENT` came to be named once, and it was found
     * by asserting on the rendered page rather than on the array behind it.
     */
    const evidence = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/functions/_shared/planning/infrastructureEvidence.pure.ts'),
      'utf8',
    );
    const code = evidence.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('NATIONAL_PIPELINE_COVERAGE_PHRASE');
    expect(code).not.toContain('Infrastructure Australia Priority List');
  });
});
