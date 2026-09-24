/**
 * W3.5 — does ACT, NT, TAS or WA publish a COUNT of residential sales?
 *
 * The assertion that matters most here is the one that stops a success being
 * declared where nothing changed. All four jurisdictions ALREADY hold a price
 * series at state grain (`absResDwell`, the ABS mean price of residential
 * dwellings), and every one of them publishes something called "property
 * sales" — so finding a sales dataset and reporting the gap closed is the easy
 * and wrong outcome. `scoreTransactionVolume` needs a **count**, over four
 * periods, at an area finer than the state.
 *
 * So `medians_only` and `state_grain_only` are asserted to be distinct
 * readings with their own sentences, and neither may be paraphrased into a
 * find.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COUNT_PATTERN,
  MACHINE_READABLE_FORMATS,
  MEDIAN_PATTERN,
  SUB_STATE_PATTERN,
  VOLUME_CATALOGUES,
  VOLUME_GAP_STATES,
  VOLUME_PERIODS_REQUIRED,
  VOLUME_QUERIES,
  VOLUME_SCORED_STATES,
  assessVolumeCoverage,
  attributableTo,
  catalogueAnswered,
  judgeCatalogueReach,
  MEASURED_VOLUME_COVERAGE,
  SOCRATA_PORTALS,
  VOLUME_READING_IS_CURRENT,
  judgeVolumeDataset,
  parseSocrataCatalogue,
  socrataInventoryUrl,
  socrataSearchUrl,
  measuredVolumeNote,
  mergeVolumeReads,
  parseVolumeCatalogue,
  rankVolumeCandidates,
  volumeCoverageNote,
  VOLUME_COUNT_SOURCE,
  volumeRemedyClause,
  volumeInventoryUrl,
  volumeSearchUrl,
  type VolumeCoverage,
  type VolumeDataset,
  type VolumeGapState,
  JURISDICTION_DOMAINS,
  catalogueProbesFor,
  ckanRootFor,
  datasetsNamingASale,
  harvestOrgFacetUrl,
  isJurisdictionHost,
  jurisdictionOrganisations,
  orgDatasetsUrl,
  parseDcatCatalogue,
  parseOrgFacet,
  publicationHostsOf,
  readCatalogueDialect,
  ACADEMIC_PUBLISHER,
  enumerationComplete,
  governmentPublishers,
  attributedRead,
} from '../../../../supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure';
import { VOLUME_BASELINE_PERIODS } from '../../../../supabase/functions/_shared/reports/market/demandScoring.pure';

const dataset = (over: Partial<VolumeDataset> = {}): VolumeDataset => ({
  id: 'id-1',
  name: 'slug',
  title: 'Property Sales',
  notes: null,
  organisation: 'A Publisher',
  licence: 'CC BY 4.0',
  metadataModified: '2026-09-01T00:00:00Z',
  resources: [],
  ...over,
});

describe('the number a demand reading needs', () => {
  /*
   * The one literal this module could not avoid — it must parse under Deno
   * with no dependency on the scoring engine's evidence vocabulary. So the
   * pair is held together by a test instead: `AML_COMMAND_REFRESH_EVENT`'s
   * rule, that a literal at each end is how two ends drift.
   */
  it('equals the scorer’s own baseline plus the latest period', () => {
    expect(VOLUME_PERIODS_REQUIRED).toBe(VOLUME_BASELINE_PERIODS + 1);
  });

  /*
   * A probe that only knows about the four it is looking at cannot tell you it
   * is looking at the right four.
   */
  it('names the four that cannot score and the four that can, without overlap', () => {
    expect([...VOLUME_GAP_STATES].sort()).toEqual(['ACT', 'NT', 'TAS', 'WA']);
    expect([...VOLUME_SCORED_STATES].sort()).toEqual(['NSW', 'QLD', 'SA', 'VIC']);
    for (const s of VOLUME_GAP_STATES) {
      expect(VOLUME_SCORED_STATES, s).not.toContain(s);
    }
  });

  /*
   * The scored four are asserted against the LOADERS rather than trusted,
   * because `market-sales-ingest` has already lost a jurisdiction's counts
   * once by writing `sales_count: null` into `ON CONFLICT DO UPDATE SET` on
   * every daily run. A silent regression should contradict this list.
   */
  it('is corroborated by a loader that writes a count for each scored state', () => {
    const loaders: Record<string, string> = {
      NSW: 'supabase/functions/_shared/reports/market/openData/nswDcjSales.pure.ts',
      QLD: 'supabase/functions/_shared/reports/market/openData/qgsoRldaSales.pure.ts',
      SA: 'supabase/functions/_shared/reports/market/openData/saLsgStats.pure.ts',
      VIC: 'supabase/functions/_shared/reports/market/openData/vicVpsrSuburb.pure.ts',
    };
    for (const state of VOLUME_SCORED_STATES) {
      const path = loaders[state];
      expect(path, state).toBeTruthy();
      const src = readFileSync(path, 'utf8');
      /*
       * Either spelling. The first cut asked for `salesCount:` followed by
       * something other than `null` and missed South Australia, which passes
       * the value as a SHORTHAND property — `salesCount,`. That is the
       * repository's own TS18004 lesson in a test: shorthand is how almost
       * everything here is passed around, so a guard that cannot see it is
       * blind to most of the code it claims to judge.
       */
      expect(src, state).toMatch(/salesCount:\s*(?!null\b)|\bsalesCount\s*,/);
    }
    /* And Victoria's four counted periods come from the backfill, not the file. */
    const backfill = readFileSync(
      'supabase/functions/_shared/reports/market/openData/vicVolumeBackfill.pure.ts', 'utf8');
    expect(backfill).toContain('ONE `No. of Sales` column');
  });
});

describe('a median series is not a count series', () => {
  it('recognises a count in the publisher’s own vocabulary', () => {
    for (const words of [
      'Number of sales', 'No. of Sales', 'no of sales', 'sales volume', 'Sales Count',
      'transaction count', 'number of transfers', 'properties sold', 'dwellings sold',
      'volume of transfers', 'number of dwellings',
    ]) {
      expect(COUNT_PATTERN.test(words), words).toBe(true);
    }
  });

  /*
   * The narrowness is the point. These four already hold a price at state
   * grain, so a dataset that mentions sales and publishes only prices closes
   * nothing — and would look like a fix.
   */
  it('does not read a price as a count', () => {
    for (const words of [
      'Median sale price', 'Mean price of residential dwellings', 'Average sale value',
      'Price index', 'sale price quartiles', 'Property sales', 'Land sales report',
    ]) {
      expect(COUNT_PATTERN.test(words), words).toBe(false);
    }
  });

  it('tells a median dataset apart from a count one', () => {
    expect(MEDIAN_PATTERN.test('Median sale price by suburb')).toBe(true);
    expect(MEDIAN_PATTERN.test('Number of sales by suburb')).toBe(false);
  });

  it('recognises an area finer than the state and nothing coarser', () => {
    for (const w of ['by suburb', 'by postcode', 'local government area', 'LGA', 'SA2',
      'statistical area', 'by locality', 'by district', 'by council']) {
      expect(SUB_STATE_PATTERN.test(w), w).toBe(true);
    }
    for (const w of ['Western Australia', 'territory total', 'whole of state']) {
      expect(SUB_STATE_PATTERN.test(w), w).toBe(false);
    }
  });
});

describe('judging a candidate', () => {
  it('reads the title, the notes and the resource names together', () => {
    /* A title alone is a headline; the notes are where a publisher lists columns. */
    const c = judgeVolumeDataset(dataset({
      title: 'Property Sales',
      notes: 'Quarterly median price and number of sales by suburb.',
      resources: [{ id: 'r1', name: 'sales.csv', format: 'CSV', url: 'https://h/x.csv', datastoreActive: true, size: 10 }],
    }));
    expect(c.count).toBe(true);
    expect(c.subState).toBe(true);
    expect(c.median).toBe(true);
    expect(c.machineReadable?.id).toBe('r1');
  });

  it('prefers a queryable resource to a download', () => {
    const c = judgeVolumeDataset(dataset({
      notes: 'number of sales by LGA',
      resources: [
        { id: 'dl', name: 'a.csv', format: 'CSV', url: 'https://h/a.csv', datastoreActive: false, size: null },
        { id: 'q', name: 'b.csv', format: 'CSV', url: 'https://h/b.csv', datastoreActive: true, size: null },
      ],
    }));
    expect(c.machineReadable?.id).toBe('q');
  });

  /* A document is not a register — the formats are carried back so
   * "published, but not as a feed" is a sayable sentence. */
  it('offers no machine-readable resource for a PDF-only dataset, and names the formats', () => {
    const c = judgeVolumeDataset(dataset({
      notes: 'number of sales by suburb',
      resources: [{ id: 'p', name: 'report.pdf', format: 'PDF', url: 'https://h/r.pdf', datastoreActive: false, size: null }],
    }));
    expect(c.machineReadable).toBeNull();
    expect(c.formats).toEqual(['PDF']);
    expect(MACHINE_READABLE_FORMATS).not.toContain('PDF');
  });

  it('ranks only datasets carrying a count, best first', () => {
    const ranked = rankVolumeCandidates([
      dataset({ id: 'price', title: 'Median sale price by suburb' }),
      dataset({ id: 'state', title: 'Number of sales, Tasmania' }),
      dataset({
        id: 'good', title: 'Number of sales by locality',
        resources: [{ id: 'r', name: 'x.csv', format: 'CSV', url: 'https://h/x', datastoreActive: true, size: null }],
      }),
    ]);
    expect(ranked.map((c) => c.dataset.id)).toEqual(['good', 'state']);
  });
});

describe('reading a catalogue', () => {
  it('reads a CKAN package_search answer', () => {
    const body = JSON.stringify({
      success: true,
      result: {
        count: 2,
        results: [{
          id: 'a', name: 'slug-a', title: 'Number of sales by suburb',
          notes: 'quarterly', license_title: 'CC BY 4.0',
          organization: { title: 'Valuer-General' },
          metadata_modified: '2026-08-01T00:00:00Z',
          resources: [{ id: 'r1', url: 'https://h/x.csv', format: 'csv', datastore_active: true, size: '12' }],
        }],
      },
    });
    const p = parseVolumeCatalogue(body);
    expect(p.kind).toBe('catalogue');
    if (p.kind !== 'catalogue') return;
    expect(p.total).toBe(2);
    expect(p.datasets[0].organisation).toBe('Valuer-General');
    expect(p.datasets[0].resources[0].format).toBe('CSV');
    expect(p.datasets[0].resources[0].size).toBe(12);
  });

  /*
   * A parser that cannot say what it received cannot be debugged from a CI
   * log — the ABS structure parser read no dimension out of 3.1 MB of real
   * bytes and reported an empty document.
   */
  it('names what it received when it cannot read it', () => {
    const p = parseVolumeCatalogue('<html>not ckan</html>');
    expect(p.kind).toBe('refused');
    if (p.kind === 'refused') {
      expect(p.reason).toContain('not JSON');
      expect(p.reason).toContain('not ckan');
    }
    expect(parseVolumeCatalogue(JSON.stringify({ success: false, error: { message: 'nope' } })).kind)
      .toBe('refused');
    expect(parseVolumeCatalogue(JSON.stringify({ result: {} })).kind).toBe('refused');
  });

  it('de-duplicates a dataset several queries all found', () => {
    const one = parseVolumeCatalogue(JSON.stringify({
      result: { count: 1, results: [{ id: 'x', name: 'x', title: 'T', resources: [] }] },
    }));
    const merged = mergeVolumeReads([one, one, one]);
    expect(merged.kind).toBe('catalogue');
    if (merged.kind === 'catalogue') expect(merged.datasets).toHaveLength(1);
  });

  it('carries a refusal rather than smoothing it', () => {
    const merged = mergeVolumeReads([{ kind: 'refused', reason: 'HTTP 503' }]);
    expect(merged.kind).toBe('refused');
  });
});

describe('what may be stated', () => {
  const catalogue = (datasets: VolumeDataset[]): Extract<VolumeCatalogueParseLike, { kind: 'catalogue' }> =>
    ({ kind: 'catalogue', total: datasets.length, datasets });
  type VolumeCatalogueParseLike = ReturnType<typeof parseVolumeCatalogue>;

  it('reports a sub-state, machine-readable count as countable', () => {
    const c = assessVolumeCoverage(catalogue([dataset({
      title: 'Number of sales by suburb',
      resources: [{ id: 'r', name: 'x.csv', format: 'CSV', url: 'https://h/x', datastoreActive: true, size: null }],
    })]), true);
    expect(c.kind).toBe('countable');
  });

  /*
   * The two near misses. Both are the shape that could be reported as a
   * success while changing nothing, because the ABS already hands these four
   * a state-grain price.
   */
  it('keeps a state-grain count and a document-only count as distinct near misses', () => {
    expect(assessVolumeCoverage(catalogue([dataset({ title: 'Number of sales, Tasmania' })]), true).kind)
      .toBe('state_grain_only');
    expect(assessVolumeCoverage(catalogue([dataset({
      title: 'Number of sales by suburb',
      resources: [{ id: 'p', name: 'r.pdf', format: 'PDF', url: 'https://h/r', datastoreActive: false, size: null }],
    })]), true).kind).toBe('published_as_documents');
  });

  it('separates "prices only" from "nothing published"', () => {
    expect(assessVolumeCoverage(catalogue([dataset({ title: 'Median sale price by suburb' })]), true).kind)
      .toBe('medians_only');
    expect(assessVolumeCoverage(catalogue([dataset({ title: 'Bus routes' })]), true).kind)
      .toBe('no_count_published');
  });

  /*
   * An absence carries the SIZE of the question that found it. The first
   * version carried only what survived attribution, and the Northern
   * Territory's sentence then read "0 datasets examined" — a five-query
   * search of a populated catalogue described as looking at nothing.
   */
  it('carries the size of the question into an absence', () => {
    const c = assessVolumeCoverage(
      { kind: 'catalogue', total: 434, datasets: [dataset({ title: 'Median sale price' })] }, true, 2911);
    expect(c.kind).toBe('medians_only');
    if (c.kind !== 'medians_only') return;
    expect(c.searched).toBe(434);
    expect(c.inventory).toBe(2911);
  });

  /*
   * One catalogue's silence is a statement about that catalogue. This is the
   * fault W3.2's probe committed twice, so an absence requires corroboration
   * and an uncorroborated read cannot produce one.
   */
  it('refuses to read an absence from one catalogue', () => {
    const c = assessVolumeCoverage(catalogue([dataset({ title: 'Bus routes' })]), false);
    expect(c.kind).toBe('catalogue_unavailable');
    if (c.kind === 'catalogue_unavailable') expect(c.reason).toMatch(/one catalogue/i);
  });

  /*
   * But corroboration gates an ABSENCE, not a FIND — and the first version
   * gated both. Tasmania read `catalogue_unavailable` while the Commonwealth
   * catalogue held one dataset attributed to Tasmania: a dataset that had
   * answered, from an index that had answered, discarded because a second
   * index had not.
   *
   * Requiring a second witness to a thing you are holding is not
   * conservatism, it is discarding evidence.
   */
  it('accepts a find from one catalogue that answered', () => {
    const found = assessVolumeCoverage(catalogue([dataset({
      title: 'Number of sales by locality',
      resources: [{ id: 'r', name: 'x.csv', format: 'CSV', url: 'https://h/x', datastoreActive: true, size: null }],
    })]), false);
    expect(found.kind).toBe('countable');
  });

  it('still refuses a find from a catalogue that did not answer at all', () => {
    expect(assessVolumeCoverage({ kind: 'refused', reason: 'DNS' }, false).kind)
      .toBe('catalogue_unavailable');
  });

  it('never reads a refusal as an absence', () => {
    expect(assessVolumeCoverage({ kind: 'refused', reason: 'HTTP 503' }, true).kind)
      .toBe('catalogue_unavailable');
  });
});

describe('the sentence a report may carry', () => {
  const ALL: VolumeCoverage[] = [
    { kind: 'countable', title: 'T', publisher: 'P', resourceId: 'r', format: 'CSV', licence: 'CC BY 4.0' },
    { kind: 'state_grain_only', title: 'T', publisher: 'P' },
    { kind: 'published_as_documents', title: 'T', publisher: 'P', formats: ['PDF'] },
    { kind: 'medians_only', searched: 434, inventory: 2911 },
    { kind: 'no_count_published', searched: 0, inventory: null },
    { kind: 'catalogue_unavailable', reason: 'HTTP 503' },
  ];

  it('names the jurisdiction in every reading', () => {
    for (const state of VOLUME_GAP_STATES) {
      for (const c of ALL) {
        expect(volumeCoverageNote(c, state), `${state}/${c.kind}`).toContain(state);
      }
    }
  });

  /*
   * §9's rule, applied to a register rather than to a layer: an absence may
   * not be rated, and a count nobody publishes is not a count of zero.
   */
  it('rates nothing and never reads an absence as few sales', () => {
    for (const state of VOLUME_GAP_STATES) {
      for (const c of ALL) {
        const note = volumeCoverageNote(c, state);
        const where = `${state}/${c.kind}`;
        expect(note, where).not.toMatch(/\|\s*(?:low|minimal|negligible|limited|favourable)\s*\|/i);
        expect(note, where).not.toMatch(/\b(?:few|little|no|weak|thin|quiet)\s+(?:sales|demand|activity|turnover)\b/i);
        expect(note, where).not.toMatch(/\bdemand is\b/i);
        expect(note, where).not.toMatch(/\b0 sales\b|\bzero sales\b/i);
      }
    }
  });

  /* Every sentence is about the REGISTER, and the two near misses say why. */
  it('says which kind of limit each absence is', () => {
    expect(volumeCoverageNote({ kind: 'state_grain_only', title: 'T', publisher: 'P' }, 'TAS'))
      .toMatch(/whole state|no smaller area/i);
    expect(volumeCoverageNote({ kind: 'published_as_documents', title: 'T', publisher: 'P', formats: ['PDF'] }, 'WA'))
      .toMatch(/rather than as a data feed/i);
    expect(volumeCoverageNote({ kind: 'medians_only', searched: 3, inventory: 9 }, 'NT'))
      .toMatch(/prices and not counts/i);
    expect(volumeCoverageNote({ kind: 'catalogue_unavailable', reason: 'x' }, 'ACT'))
      .toMatch(/about the retrieval/i);
  });

  /* A territory is not a state, and printing it as one reads as carelessness. */
  it('calls the ACT and the NT territories', () => {
    for (const s of ['ACT', 'NT'] as VolumeGapState[]) {
      expect(volumeCoverageNote({ kind: 'state_grain_only', title: 'T', publisher: 'P' }, s)).toContain('territory');
    }
    expect(volumeCoverageNote({ kind: 'state_grain_only', title: 'T', publisher: 'P' }, 'WA')).toContain('state');
  });

  it('calls a countable find outstanding work rather than a limit of the source', () => {
    expect(volumeCoverageNote(ALL[0], 'WA')).toMatch(/outstanding work rather than a limitation/i);
  });
});

describe('where it asks', () => {
  /*
   * Two catalogues per jurisdiction that fail differently — W3.4's
   * corroboration rule. The jurisdiction's own is the authority on what it
   * publishes; the harvest is the one this repository has measured answering.
   */
  it('gives every jurisdiction its own catalogue and keeps one harvest', () => {
    for (const s of VOLUME_GAP_STATES) {
      const own = VOLUME_CATALOGUES.filter((c) => c.state === s && c.kind === 'own');
      expect(own, s).toHaveLength(1);
    }
    expect(VOLUME_CATALOGUES.filter((c) => c.kind === 'harvest')).toHaveLength(1);
  });

  /* An API root is typed; a dataset id never is. */
  it('types an API root and never a dataset or resource id', () => {
    for (const c of VOLUME_CATALOGUES) {
      expect(c.api, c.state).toMatch(/^https:\/\//);
      expect(c.api, c.state).not.toContain('?');
      expect(c.api, c.state).not.toMatch(/\/(?:dataset|package_show|resource)\b/);
      expect(c.api, c.state).toMatch(/\/api\/3$/);
    }
  });

  it('composes a bounded search from the root', () => {
    const u = volumeSearchUrl('https://h/api/3', 'property sales', 50, 0);
    expect(u).toBe('https://h/api/3/action/package_search?q=property+sales&rows=50&start=0');
    expect(volumeSearchUrl('https://h/api/3/', 'x', 9999)).toContain('rows=200');
    expect(volumeSearchUrl('https://h/api/3', 'x', 0)).toContain('rows=1');
  });

  /*
   * Several queries rather than one, because a publisher's own words differ by
   * jurisdiction and a single phrase would measure our vocabulary rather than
   * theirs.
   */
  it('asks in more than one publisher’s vocabulary', () => {
    expect(VOLUME_QUERIES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(VOLUME_QUERIES).size).toBe(VOLUME_QUERIES.length);
  });
});

describe('the probe writes nothing', () => {
  const probe = readFileSync('scripts/market/sales-volume-liveness.ts', 'utf8');
  const module = readFileSync(
    'supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure.ts', 'utf8');

  /*
   * The whole reason this step needs no approval: loading a series is a
   * register WRITE, and discovery is not. A source scan rather than a promise.
   */
  it('names no table, no client and no credential', () => {
    for (const [name, src] of [['probe', probe], ['module', module]] as const) {
      expect(src, name).not.toMatch(/createClient|SERVICE_ROLE|SUPABASE_URL|\.from\(/);
      expect(src, name).not.toMatch(/\b(?:insert|upsert|update|delete)\s*\(/);
      expect(src, name).not.toMatch(/market_sales_medians/);
    }
  });

  /*
   * And it constructs no evidence, so nothing here can reach the scorer.
   *
   * Stated as ASSERTED FORMS rather than as the bare names, because the
   * module's own header says *"No `EvidencePoint` is constructed, no row shape
   * is emitted"* — and a guard that flags the sentence stating the prohibition
   * would have the rule deleted to keep the guard passing. That is exactly
   * what the infrastructure paragraph's rating scan cost once, and it is the
   * second time this programme has paid for it.
   */
  it('constructs no EvidencePoint and emits no register row', () => {
    for (const asserted of [
      /\bnew\s+EvidencePoint\b/,
      /:\s*EvidencePoint\b/,
      /\bas\s+EvidencePoint\b/,
      /\bEvidencePoint\s*</,
      /:\s*SalesMedianRow\b/,
      /\bSalesMedianRow\s*\[/,
      /\bimport\b[^;]*\b(?:EvidencePoint|SalesMedianRow)\b/,
    ]) {
      expect(module, String(asserted)).not.toMatch(asserted);
    }
  });

  /* The exit contract, the fourth time. */
  it('fails only where a catalogue answered and this reader refused', () => {
    expect(probe).toMatch(/process\.exit\(1\)/);
    expect(probe).toMatch(/function ours\(/);
    /* A refusal from the publisher exits 0 — asserted as the absence of a
     * second failure path rather than as prose. */
    expect(probe.match(/process\.exit\(1\)/g) ?? []).toHaveLength(1);
  });
});


/**
 * How each jurisdiction's counts arrive, and the remedy that reads it.
 *
 * The demand remedy a client's report prints was already wrong about two
 * states — it said *"NSW and QLD carry one on every row, VIC and SA one per
 * load"*. South Australia publishes TWO counted quarters per release, and
 * Victoria's four periods have been recovered from the archived workbooks
 * since 21 Sep 2026. So the record is asserted against the loaders rather
 * than trusted, and the sentence is composed from the record.
 */
describe('how each jurisdiction’s counts arrive', () => {
  it('agrees with the loaders about which states carry a count', () => {
    for (const state of VOLUME_SCORED_STATES) {
      expect(VOLUME_COUNT_SOURCE[state], state).not.toBe('unwired');
    }
    for (const state of VOLUME_GAP_STATES) {
      expect(VOLUME_COUNT_SOURCE[state], state).toBe('unwired');
    }
  });

  /*
   * South Australia looks its count column up PER PERIOD. A shared figure
   * would be worse than a null: four identical counts make
   * `scoreTransactionVolume`'s ratio exactly 1.0 and print "in line with the
   * 3-period average" off one quarter's data.
   */
  it('reads South Australia as accumulating, with its count inside the period loop', () => {
    expect(VOLUME_COUNT_SOURCE.SA).toBe('accumulates');
    const src = readFileSync(
      'supabase/functions/_shared/reports/market/openData/saLsgStats.pure.ts', 'utf8');
    const loop = src.indexOf('for (const period of periods)');
    const lookup = src.indexOf("cols.find((c) => c.kind === 'sales'");
    expect(loop, 'the period loop').toBeGreaterThan(-1);
    expect(lookup, 'the sales column lookup').toBeGreaterThan(loop);
  });

  it('reads Victoria as backfilled rather than one-per-load', () => {
    expect(VOLUME_COUNT_SOURCE.VIC).toBe('backfilled');
  });

  /* The national series is the ABS mean price and carries no count at all. */
  it('gives the national series no clause of its own', () => {
    expect(VOLUME_COUNT_SOURCE.AU).toBe('unwired');
    expect(volumeRemedyClause('AU')).toBeNull();
  });

  /*
   * The distinction the old remedy could not draw: more loads will close one
   * of these and cannot close the other. A remedy that cannot discharge its
   * reason is never offered as the next step — `refreshRemedy`'s rule.
   */
  it('does not tell an operator to run more loads where no loader exists', () => {
    for (const s of VOLUME_GAP_STATES) {
      const clause = volumeRemedyClause(s) as string;
      expect(clause, s).toContain(s);
      expect(clause, s).toMatch(/no transaction-count publisher is wired/i);
      expect(clause, s).toMatch(/cannot close it/i);
      expect(clause, s).not.toMatch(/successive loads|completed load|completed backfill/i);
    }
    expect(volumeRemedyClause('NSW')).toMatch(/every period/i);
    expect(volumeRemedyClause('SA')).toMatch(/accumulate/i);
    expect(volumeRemedyClause('VIC')).toMatch(/backfill/i);
  });

  it('names no jurisdiction it cannot establish', () => {
    for (const bad of [null, undefined, '', '   ', 'Queensland', 'XYZ']) {
      expect(volumeRemedyClause(bad), String(bad)).toBeNull();
    }
    /* Case and padding are tolerated, because a subject's state is free text. */
    expect(volumeRemedyClause(' nsw ')).toMatch(/NSW/);
  });

  /*
   * A module with no call site is not shipped — the Builder Portal's rule,
   * paid for twice there. The clause has to reach the remedy a report prints.
   */
  it('is read by the demand grade gap rather than merely exported', () => {
    const src = readFileSync(
      'supabase/functions/_shared/reports/market/scoringV2Production.pure.ts', 'utf8');
    expect(src).toContain("from './openData/salesVolumePublishers.pure.ts'");
    expect(src).toContain('volumeRemedyClause(input.subject.state)');
    /*
     * And the wrong parenthetical is gone rather than reworded around — but
     * asserted so that the COMMENT recording it survives.
     *
     * This is the third time in one sitting that a guard written as a bare
     * phrase flagged the sentence documenting the defect it forbids (the
     * infrastructure rating scan, the module's own "no EvidencePoint is
     * constructed", and this). The generalised rule: **a guard on a defect's
     * own wording has to distinguish the RECORD of the defect from the
     * defect.** Here that is a line test — a comment line may carry the old
     * words, a code line may not — which is checkable rather than a promise.
     */
    const offending = src
      .split('\n')
      .filter((line) => /VIC and SA one/.test(line))
      .filter((line) => !/^\s*(?:\*|\/\/|\/\*)/.test(line));
    expect(offending, 'the old parenthetical survives in code, not just in a comment').toEqual([]);
  });
});


/**
 * The defect the probe's own first run produced, and the two rules that close it.
 *
 * It read **`countable` for the Northern Territory over "datasets examined
 * 0"** and composed a sentence naming *"Guide to Property Values, from
 * Department of Energy, Environment and Climate Action"* — a **Victorian**
 * department. Western Australia read the same over 201 datasets of which 0
 * carried a count. The harvest catalogue's datasets had been folded into the
 * jurisdiction's own and then ranked.
 *
 * The log is what exposed it, because it prints both numbers: the counts came
 * from the jurisdiction's own read and the verdict from the merged one, so the
 * output contradicted itself on one screen. *A load is judged by its effect.*
 */
describe('a harvest hit is not a statement about a jurisdiction', () => {
  const vicDept = dataset({
    title: 'Guide to Property Values',
    notes: 'number of sales by suburb',
    organisation: 'Department of Energy, Environment and Climate Action',
    resources: [{ id: 'r', name: 'x.xls', format: 'XLS', url: 'https://h/x', datastoreActive: false, size: null }],
  });

  it('refuses the exact dataset that produced the defect', () => {
    for (const s of VOLUME_GAP_STATES) {
      expect(attributableTo(vicDept, s, 'harvest'), s).toBe(false);
    }
  });

  /*
   * The bare abbreviation is deliberately not accepted from a harvest: "ACT"
   * is inside "Climate Action", which is the very organisation name that
   * produced this.
   */
  it('does not attribute on a bare abbreviation', () => {
    expect(attributableTo(dataset({ organisation: 'Climate Action Directorate' }), 'ACT', 'harvest')).toBe(false);
    expect(attributableTo(dataset({ organisation: 'Water Authority' }), 'WA', 'harvest')).toBe(false);
  });

  it('attributes a harvest hit whose publisher names the jurisdiction in full', () => {
    expect(attributableTo(dataset({ organisation: 'Northern Territory Government' }), 'NT', 'harvest')).toBe(true);
    expect(attributableTo(dataset({ organisation: 'Landgate, Government of Western Australia' }), 'WA', 'harvest')).toBe(true);
    expect(attributableTo(dataset({ organisation: 'Tasmanian Planning Commission' }), 'TAS', 'harvest')).toBe(true);
    expect(attributableTo(dataset({ organisation: 'ACT Revenue Office' }), 'ACT', 'harvest')).toBe(true);
  });

  /*
   * Judged on the ORGANISATION alone. A dataset titled for a jurisdiction and
   * published by another is that other's at best, and the conservative reading
   * of an unattributable one is that it is not this jurisdiction's.
   */
  it('judges the publisher and never the title', () => {
    const titled = dataset({
      title: 'Property sales, Northern Territory',
      organisation: 'Department of Energy, Environment and Climate Action',
    });
    expect(attributableTo(titled, 'NT', 'harvest')).toBe(false);
    expect(attributableTo(dataset({ organisation: null }), 'NT', 'harvest')).toBe(false);
  });

  /* Everything in a jurisdiction's own catalogue is its own by construction. */
  it('needs no attribution for a jurisdiction’s own catalogue', () => {
    expect(attributableTo(vicDept, 'NT', 'own')).toBe(true);
  });

  /*
   * `200 · 0 declared` on every query conflates two cases the queries cannot
   * tell apart — a populated catalogue matching nothing, and an endpoint that
   * is not this jurisdiction's index. The first version called both
   * unavailable: conservative, and an answer to nothing.
   *
   * The distinction is one question away, and it is this programme's own
   * rule — corroborate from a second endpoint that fails differently. Here
   * that endpoint is the same catalogue asked its own size.
   */
  const reach = (inventory: number | null, matched: number) => judgeCatalogueReach(
    { kind: 'catalogue', total: matched, datasets: [] }, { inventory, matched });

  it('asks a catalogue its own size with the cheapest question it takes', () => {
    expect(volumeInventoryUrl('https://h/api/3')).toBe('https://h/api/3/action/package_search?rows=0');
    expect(volumeInventoryUrl('https://h/api/3/')).toBe('https://h/api/3/action/package_search?rows=0');
  });

  it('tells a populated catalogue matching nothing from a wrong endpoint', () => {
    /* 3,000 datasets and none matching five sales phrasings: an ANSWER. */
    expect(reach(3000, 0).kind).toBe('answered_empty_handed');
    /* It says it holds nothing at all: not this index. */
    expect(reach(0, 0).kind).toBe('not_this_index');
    /* It could not say: not this index either. */
    expect(reach(null, 0).kind).toBe('not_this_index');
    expect(reach(3000, 12).kind).toBe('answered');
  });

  /*
   * An absence from a populated index IS an answer. Treating it as a failure
   * is what made the first version silent about the one jurisdiction it had
   * actually measured.
   */
  it('counts an empty-handed answer as an answer', () => {
    expect(catalogueAnswered(reach(3000, 0))).toBe(true);
    expect(catalogueAnswered(reach(3000, 5))).toBe(true);
    expect(catalogueAnswered(reach(0, 0))).toBe(false);
    expect(catalogueAnswered(reach(null, 0))).toBe(false);
  });

  it('never reads a refused parse as an index', () => {
    expect(judgeCatalogueReach({ kind: 'refused', reason: 'HTTP 503' }, { inventory: 9, matched: 0 }).kind)
      .toBe('not_this_index');
  });

  /*
   * The call site is what filters, because a parse does not carry which
   * catalogue each dataset came from — so passing an unattributed parse would
   * silently reintroduce this. A source assertion, not a promise.
   */
  it('is applied by the probe before it assesses', () => {
    const probe = readFileSync('scripts/market/sales-volume-liveness.ts', 'utf8');
    expect(probe).toMatch(/attributableTo\(d, state, 'own'\)/);
    expect(probe).toMatch(/attributableTo\(d, state, 'harvest'\)/);
    expect(probe).toMatch(/catalogueAnswered\(ownRead\.verdict\)\s*&&\s*catalogueAnswered\(harvestRead\.verdict\)/);
    /* And the index's own size is asked, not inferred from the queries. */
    expect(probe).toMatch(/volumeInventoryUrl\(c\.api\)/);
    /*
     * And the harvest's datasets no longer reach the assessment unfiltered.
     * Asserted as the absence of the old merge, by line so the comment
     * recording the defect survives — the rule this sitting wrote down.
     */
    const offending = probe.split('\n')
      .filter((line) => /mergeVolumeReads\(\[ownParse, harvest\]/.test(line))
      .filter((line) => !/^\s*(?:\*|\/\/|\/\*)/.test(line));
    expect(offending, 'the harvest is merged in unfiltered again').toEqual([]);
  });
});


/**
 * The measured readings, and the sentence a client's page carries.
 *
 * All four are now a real limit of what is published — and two of them got
 * there only when the instrument did (the ACT through Socrata on 22 Sep,
 * Tasmania through the harvest's own records on 23 Sep). Until then each
 * read that it could not be established, which was true. Keeping the two
 * kinds of reading apart is the whole point.
 */
describe('the measured readings', () => {
  it('records a reading for each of the four and nothing else', () => {
    expect(Object.keys(MEASURED_VOLUME_COVERAGE).sort()).toEqual([...VOLUME_GAP_STATES].sort());
  });

  /*
   * The ACT moved from `catalogue_unavailable` once the Socrata reader
   * existed — the whole reason its CKAN 404 was kept and printed rather than
   * replaced with another guess — and Tasmania once the probe read where its
   * publishers actually publish, rather than typing a second host.
   */
  it('records what each jurisdiction was established to publish', () => {
    expect(MEASURED_VOLUME_COVERAGE.WA.kind).toBe('medians_only');
    expect(MEASURED_VOLUME_COVERAGE.NT.kind).toBe('no_count_published');
    expect(MEASURED_VOLUME_COVERAGE.ACT.kind).toBe('no_count_published');
    expect(MEASURED_VOLUME_COVERAGE.TAS.kind).toBe('no_count_published');
  });

  /*
   * Tasmania has no catalogue of its own, so its reading is the enumeration
   * of everything its government lists in the Commonwealth catalogue — and
   * its sentence must say THAT, not claim a catalogue it does not have.
   */
  it('reads Tasmania from its whole list in the Commonwealth catalogue', () => {
    const tas = MEASURED_VOLUME_COVERAGE.TAS;
    expect(tas).toEqual({ kind: 'no_count_published', searched: 5, inventory: 982, route: 'harvest_enumeration' });
    const note = measuredVolumeNote('TAS') as string;
    expect(note).toContain('of the 982 datasets its own publishers list in the Commonwealth catalogue, read in full, 5 name a sale');
    expect(note).toMatch(/TAS runs no open-data catalogue of its own/);
    expect(note).not.toMatch(/across its own catalogue/);
    expect(note).not.toMatch(/could not be established/);
  });

  /*
   * The count is the ENUMERATED list's own. The 23 Sep run's sentence said
   * 6 beside its own line "datasets naming a sale 5 of 982", because the
   * relevance search's one attributed find had been folded into a number
   * describing a list it is not part of.
   */
  it('counts the list its sentence describes, not the search that corroborated it', () => {
    const tas = MEASURED_VOLUME_COVERAGE.TAS;
    if (tas.kind !== 'no_count_published') return expect.fail('expected no_count_published');
    expect(tas.searched).toBe(5);
    expect(tas.searched).not.toBe(6);
  });

  /*
   * Each established reading carries the size of the index it was taken
   * from. A bare zero would say the same thing as looking at nothing.
   */
  it('carries the index size behind each established reading', () => {
    for (const s of VOLUME_GAP_STATES) {
      const c = MEASURED_VOLUME_COVERAGE[s];
      if (c.kind === 'catalogue_unavailable') continue;
      if (c.kind !== 'medians_only' && c.kind !== 'no_count_published') continue;
      expect(c.inventory, s).toBeGreaterThan(0);
    }
  });

  /*
   * Never a bare zero. An absence found by searching 434 of 2,911 datasets
   * means something a bare "0 examined" does not.
   */
  it('states the size of the question the index was asked', () => {
    const wa = measuredVolumeNote('WA') as string;
    expect(wa).toContain('203');
    expect(wa).toContain('2,911');
    const act = measuredVolumeNote('ACT') as string;
    expect(act).toContain('378');
    const nt = measuredVolumeNote('NT') as string;
    expect(nt).toContain('1,075');
    const tas = measuredVolumeNote('TAS') as string;
    expect(tas).toContain('982');
  });

  /*
   * `searched` is the number the INSTRUMENT printed, not one query's declared
   * total. The first version recorded 434 — what `property sales` alone
   * declared — while the probe's own sentence said 203.
   */
  it('records the number the probe reported, not a single query’s total', () => {
    const wa = MEASURED_VOLUME_COVERAGE.WA;
    expect(wa.kind).toBe('medians_only');
    if (wa.kind !== 'medians_only') return;
    expect(wa.searched).toBe(203);
    expect(wa.searched).not.toBe(434);
  });

  /* A zero matched is stated as such, beside the index it was asked of. */
  it('never prints a bare zero for an index that answered', () => {
    for (const s of ['NT', 'ACT'] as VolumeGapState[]) {
      const note = measuredVolumeNote(s) as string;
      expect(note, s).toMatch(/0 datasets matched a sales query out of a published index of/);
    }
  });

  /*
   * A reading that narrows a sentence must never widen the set of pages it
   * appears on: the other five jurisdictions keep `NOT_ASSESSED_REASON`.
   */
  it('says nothing for a jurisdiction it does not describe', () => {
    for (const s of ['NSW', 'VIC', 'QLD', 'SA', 'AU', '', null, undefined, 'XYZ']) {
      expect(measuredVolumeNote(s), String(s)).toBeNull();
    }
    expect(measuredVolumeNote(' tas ')).toBeTruthy();
  });

  /*
   * A measurement stored against an instrument that has since been replaced
   * is the *asserted by configuration rather than by effect* trap, so which
   * readings the current instrument took is asserted rather than promised.
   * Two have already moved when the instrument did — the ACT's and
   * Tasmania's — and both moved from "could not be established" to an
   * answer, which is the only direction a stale conservative reading may go.
   */
  it('names which readings the current instrument has taken', () => {
    /*
     * All four, as of the 23 Sep run that added harvest discovery and the
     * enumeration route. Nothing is `false` today and the flag is kept
     * anyway, because the point is to have somewhere for the NEXT instrument
     * change to be declared — the assertion below is a ratchet rather than a
     * live measurement of anything, and saying so is better than letting it
     * look like one.
     */
    for (const s of VOLUME_GAP_STATES) {
      expect(VOLUME_READING_IS_CURRENT[s], s).toBe(true);
    }
  });

  /*
   * And an un-re-measured entry may only be the conservative reading. It must
   * never claim an absence about a jurisdiction on the strength of a probe
   * that could not reach it.
   */
  it('lets an un-re-measured entry say only that it could not be established', () => {
    for (const s of VOLUME_GAP_STATES) {
      if (VOLUME_READING_IS_CURRENT[s]) continue;
      expect(MEASURED_VOLUME_COVERAGE[s].kind, s).toBe('catalogue_unavailable');
      expect(measuredVolumeNote(s), s).toMatch(/could not be established/i);
    }
  });

  /* Read by the demand gap's client sentence — not merely exported. */
  it('is read by the demand grade gap', () => {
    const src = readFileSync(
      'supabase/functions/_shared/reports/market/scoringV2Production.pure.ts', 'utf8');
    expect(src).toMatch(/reasonOverride = measuredVolumeNote\(input\.subject\.state\)/);
  });

  /* And it is still a statement about the register, never about the market. */
  it('rates nothing and never reads an absence as few sales', () => {
    for (const s of VOLUME_GAP_STATES) {
      const note = measuredVolumeNote(s) as string;
      expect(note, s).not.toMatch(/\b(?:few|little|no|weak|thin|quiet)\s+(?:sales|demand|activity|turnover)\b/i);
      expect(note, s).not.toMatch(/\bdemand is\b/i);
      expect(note, s).toContain(s);
    }
  });
});


/**
 * The second catalogue dialect, added because the measurement named it.
 *
 * The ACT answered a CKAN 3 path with `404 {"code":"not_found","message":"No
 * service found for this URL."}` — a JSON API that exists and does not speak
 * CKAN. That body is what bought this reader, and it is why the wrong root
 * was kept and printed rather than swapped for another guess.
 */
describe('Socrata, because the ACT portal is not CKAN', () => {
  const socrataBody = (results: unknown[], total?: number) => JSON.stringify({
    resultSetSize: total ?? results.length,
    results,
  });
  const resource = (over: Record<string, unknown> = {}) => ({
    resource: {
      id: 'abcd-1234',
      name: 'Property sales',
      description: 'Quarterly sales',
      columns_name: ['Suburb', 'Number of sales', 'Median price'],
      updatedAt: '2026-07-01T00:00:00Z',
      ...over,
    },
    classification: { domain_metadata: [{ key: 'Publisher', value: 'ACT Revenue Office' }] },
    metadata: { domain: 'www.data.act.gov.au' },
    permalink: 'https://www.data.act.gov.au/d/abcd-1234',
  });

  /*
   * Domain-scoped, which is a real advantage: the catalog API cannot return
   * another jurisdiction's dataset, so the Victorian-department defect cannot
   * recur through this route by construction rather than by a name test.
   */
  it('scopes every request to one domain', () => {
    const u = socrataSearchUrl('www.data.act.gov.au', 'property sales', 50);
    expect(u).toContain('domains=www.data.act.gov.au');
    expect(u).toContain('only=dataset');
    expect(u).toContain('limit=50');
    expect(socrataSearchUrl('d', 'x', 9999)).toContain('limit=100');
    expect(socrataInventoryUrl('d')).toContain('limit=0');
  });

  it('declares a portal only where one was measured', () => {
    expect(SOCRATA_PORTALS.map((p) => p.state)).toEqual(['ACT']);
    for (const p of SOCRATA_PORTALS) {
      /* A DOMAIN, never a URL and never a dataset id. */
      expect(p.domain).not.toMatch(/^https?:/);
      expect(p.domain).not.toContain('/');
    }
  });

  /*
   * One projection onto `VolumeDataset`, so `judgeVolumeDataset`,
   * `rankVolumeCandidates` and `assessVolumeCoverage` are written once and
   * cannot disagree between dialects.
   */
  it('projects onto the same shape the CKAN reader produces', () => {
    const p = parseSocrataCatalogue(socrataBody([resource()], 7));
    expect(p.kind).toBe('catalogue');
    if (p.kind !== 'catalogue') return;
    expect(p.total).toBe(7);
    const d = p.datasets[0];
    expect(d.title).toBe('Property sales');
    expect(d.organisation).toBe('ACT Revenue Office');
    expect(d.resources[0].format).toBe('JSON');
    /* A Socrata dataset is queryable by construction — that is the API it serves. */
    expect(d.resources[0].datastoreActive).toBe(true);
    expect(d.resources[0].url).toBe('https://www.data.act.gov.au/d/abcd-1234');
  });

  /*
   * `columns_name` is Socrata's own list of the dataset's COLUMNS — exactly
   * what `COUNT_PATTERN` needs, and what a CKAN `notes` field only sometimes
   * carries. Folding it into `notes` is what lets one judgement serve both.
   */
  it('folds the column list in, so a count is visible to the one judgement', () => {
    const p = parseSocrataCatalogue(socrataBody([resource()]));
    if (p.kind !== 'catalogue') return expect.fail('expected a catalogue');
    const judged = judgeVolumeDataset(p.datasets[0]);
    expect(judged.count, 'the "Number of sales" column should be read as a count').toBe(true);
    expect(judged.subState, 'the "Suburb" column should be read as sub-state').toBe(true);
  });

  it('names what it received when it cannot read it', () => {
    expect(parseSocrataCatalogue('<html/>').kind).toBe('refused');
    expect(parseSocrataCatalogue(JSON.stringify({ message: 'nope' })).kind).toBe('refused');
    expect(parseSocrataCatalogue(JSON.stringify({ error: true })).kind).toBe('refused');
    const p = parseSocrataCatalogue('<html/>');
    if (p.kind === 'refused') expect(p.reason).toContain('not JSON');
  });

  it('skips a result carrying no id or name rather than inventing one', () => {
    const p = parseSocrataCatalogue(socrataBody([
      resource(), { resource: { id: 'x' } }, { resource: { name: 'no id' } }, {},
    ], 4));
    if (p.kind !== 'catalogue') return expect.fail('expected a catalogue');
    expect(p.datasets).toHaveLength(1);
    /* And the publisher's own declared total is kept, not recomputed. */
    expect(p.total).toBe(4);
  });

  /* The probe reaches for it only where the CKAN root did not answer. */
  it('is asked only as the fallback the CKAN 404 bought', () => {
    const probe = readFileSync('scripts/market/sales-volume-liveness.ts', 'utf8');
    expect(probe).toMatch(/if \(socrata && !catalogueAnswered\(ownRead\.verdict\)\)/);
    expect(probe).toMatch(/askSocrata\(socrata\)/);
  });
});


/*
 * ── Where a jurisdiction publishes, read off the harvest ──────────────────
 *
 * Tasmania's typed root does not resolve. The answer to that is not a second
 * typed host — it is to ask the harvest where Tasmania's own publishers serve
 * their files, and then ask those hosts whether they are catalogues.
 */
describe('discovering where a jurisdiction publishes, rather than typing it', () => {
  const ds = (id: string, org: string | null, urls: string[], title = id, notes: string | null = null): VolumeDataset => ({
    id, name: id, title, notes, organisation: org, licence: null, metadataModified: null,
    resources: urls.map((url, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, format: 'CSV', url, datastoreActive: false, size: null })),
  });

  it('knows a jurisdiction host by its domain, and not by a lookalike', () => {
    expect(isJurisdictionHost('listdata.thelist.tas.gov.au', 'TAS')).toBe(true);
    expect(isJurisdictionHost('tas.gov.au', 'TAS')).toBe(true);
    expect(isJurisdictionHost('TAS.GOV.AU.', 'TAS')).toBe(true);
    expect(isJurisdictionHost('nottas.gov.au', 'TAS')).toBe(false);
    expect(isJurisdictionHost('tas.gov.au.example.com', 'TAS')).toBe(false);
    expect(isJurisdictionHost('data.gov.au', 'TAS')).toBe(false);
    for (const state of VOLUME_GAP_STATES) expect(JURISDICTION_DOMAINS[state]).toMatch(/\.gov\.au$/);
  });

  it('asks the harvest for its publishers through the facet, never a paged list', () => {
    const url = new URL(harvestOrgFacetUrl('https://data.gov.au/data/api/3/', 'tasmania'));
    expect(url.pathname).toBe('/data/api/3/action/package_search');
    expect(url.searchParams.get('rows')).toBe('0');
    expect(url.searchParams.get('facet.field')).toBe('["organization"]');
    expect(url.searchParams.get('facet.limit')).toBe('-1');
    expect(url.pathname).not.toContain('organization_list');
  });

  it('reads the facet, most datasets first, and refuses a body that has none', () => {
    const body = JSON.stringify({ success: true, result: { count: 40, search_facets: { organization: { items: [
      { name: 'dpac-tas', display_name: 'Department of Premier and Cabinet (Tasmania)', count: 3 },
      { name: 'nre-tas', display_name: 'Department of Natural Resources and Environment Tasmania', count: 31 },
      { name: 'csiro', display_name: 'CSIRO', count: 6 },
      { name: 'broken', display_name: 'no count' },
    ] } } } });
    const parsed = parseOrgFacet(body);
    expect(parsed.kind).toBe('facet');
    if (parsed.kind !== 'facet') return;
    expect(parsed.organisations.map((o) => o.name)).toEqual(['nre-tas', 'csiro', 'dpac-tas']);
    expect(jurisdictionOrganisations(parsed.organisations, 'TAS').map((o) => o.name)).toEqual(['nre-tas', 'dpac-tas']);
    expect(parseOrgFacet(JSON.stringify({ success: true, result: { count: 0 } })).kind).toBe('refused');
    expect(parseOrgFacet('<html>').kind).toBe('refused');
  });

  it('filters one publisher by the slug the facet returned, quoted', () => {
    const url = new URL(orgDatasetsUrl('https://data.gov.au/data/api/3', 'nre-tas', 5000));
    expect(url.searchParams.get('fq')).toBe('organization:"nre-tas"');
    expect(url.searchParams.get('rows')).toBe('1000');
    expect(new URL(orgDatasetsUrl('https://x/api/3', 'a"b')).searchParams.get('fq')).toBe('organization:"ab"');
  });

  it('tallies where the files are served from, most datasets first, with the paths that name the directory', () => {
    const hosts = publicationHostsOf([
      ds('a', 'Tas', ['https://listdata.thelist.tas.gov.au/opendata/data/LIST_A.zip', 'https://listdata.thelist.tas.gov.au/opendata/data/LIST_B.zip']),
      ds('b', 'Tas', ['https://listdata.thelist.tas.gov.au/opendata/data/LIST_C.zip']),
      ds('c', 'Tas', ['https://www.treasury.tas.gov.au/Documents/x.xlsx', 'not a url', 'ftp://old.example/x']),
    ]);
    expect(hosts.map((h) => [h.host, h.datasets, h.resources])).toEqual([
      ['listdata.thelist.tas.gov.au', 2, 3],
      ['www.treasury.tas.gov.au', 1, 1],
    ]);
    expect(hosts[0].paths[0]).toBe('/opendata/data/');
  });

  it('asks each host in five dialects, and the CKAN roots it would then search are the ones it asked', () => {
    const probes = catalogueProbesFor('Data.Example.tas.gov.au');
    expect(probes.map((p) => p.dialect)).toEqual(['ckan', 'ckan_data', 'socrata', 'dcat', 'arcgis']);
    expect(probes[0].url).toBe(volumeInventoryUrl(ckanRootFor('data.example.tas.gov.au', 'ckan')));
    expect(probes[1].url).toBe(volumeInventoryUrl(ckanRootFor('data.example.tas.gov.au', 'ckan_data')));
    expect(probes[2].url).toBe(socrataInventoryUrl('data.example.tas.gov.au'));
  });

  it('judges a dialect by the SHAPE of the answer, never the digit alone', () => {
    const ckan = JSON.stringify({ success: true, result: { count: 812, results: [] } });
    expect(readCatalogueDialect('ckan', 200, ckan)).toMatchObject({ answered: true, inventory: 812 });
    // A portal that is not CKAN answers its path with a 200 HTML page.
    expect(readCatalogueDialect('ckan', 200, '<!doctype html><title>Home</title>').answered).toBe(false);
    // The ACT's Socrata portal answered CKAN's path with a JSON 404.
    expect(readCatalogueDialect('ckan', 404, '{"code":"not_found"}').answered).toBe(false);
    // An index that says it is empty has not answered the question.
    expect(readCatalogueDialect('ckan', 200, JSON.stringify({ success: true, result: { count: 0, results: [] } })).answered).toBe(false);
    expect(readCatalogueDialect('socrata', 200, JSON.stringify({ resultSetSize: 378, results: [] })))
      .toMatchObject({ answered: true, inventory: 378 });
    expect(readCatalogueDialect('dcat', 200, JSON.stringify({ dataset: [{ identifier: 'x', title: 'X' }] })))
      .toMatchObject({ answered: true, inventory: 1 });
    expect(readCatalogueDialect('dcat', 200, JSON.stringify({ something: [] })).answered).toBe(false);
    const arc = readCatalogueDialect('arcgis', 200, JSON.stringify({ folders: ['Public'], services: [] }));
    expect(arc.answered).toBe(true);
    expect(arc.detail).toMatch(/catalogue of layers, not of datasets/);
  });

  it('reads a DCAT feed into the same dataset shape, and judges it whole', () => {
    const feed = JSON.stringify({ dataset: [
      { identifier: 'https://x/1', title: 'Property sales by suburb', description: 'Number of sales per quarter',
        publisher: { name: 'Valuer-General Tasmania' }, distribution: [{ downloadURL: 'https://x/1.csv', mediaType: 'text/csv' }] },
      { identifier: 'https://x/2', title: 'Road network', distribution: [] },
      { title: 'no identifier' },
    ] });
    const parsed = parseDcatCatalogue(feed, 'example.tas.gov.au');
    expect(parsed.kind).toBe('catalogue');
    if (parsed.kind !== 'catalogue') return;
    expect(parsed.total).toBe(2);
    expect(parsed.datasets[0].resources[0]).toMatchObject({ format: 'CSV', url: 'https://x/1.csv' });
    expect(parsed.datasets[0].organisation).toBe('Valuer-General Tasmania');
    expect(parsed.datasets[1].organisation).toBe('example.tas.gov.au');
    expect(datasetsNamingASale(parsed.datasets).map((d) => d.title)).toEqual(['Property sales by suburb']);
    // And the judgement that follows is the one every dialect gets.
    expect(rankVolumeCandidates(parsed.datasets).map((c) => c.dataset.title)).toEqual(['Property sales by suburb']);
    expect(parseDcatCatalogue('{"nope":1}', 'x').kind).toBe('refused');
  });

  it('types no Tasmanian host in the probe: the host it searches comes from the harvest', () => {
    const probe = readFileSync('scripts/market/sales-volume-liveness.ts', 'utf8');
    expect(probe).not.toMatch(/https?:\/\/[a-z0-9.-]+\.tas\.gov\.au/i);
    expect(probe).toContain('discoverOwnCatalogue(state, harvestEntry.api, own.api)');
    // Only where the typed root did not answer — a working root is never second-guessed.
    expect(probe).toMatch(/if \(!catalogueAnswered\(ownRead\.verdict\)\) \{\s*const discovered = await discoverOwnCatalogue/);
  });
});

/*
 * ── A jurisdiction with no catalogue of its own ───────────────────────────
 *
 * Measured from CI on 23 Sep 2026: `data.tas.gov.au` answers ENOTFOUND, and
 * none of the eight Tasmanian hosts its publishers' files are served from
 * answers as a searchable catalogue (one is a map-layer directory). The
 * Commonwealth catalogue is where Tasmania's data is indexed — so the reading
 * is taken from EVERYTHING Tasmania's government lists there, read in full.
 */
describe('reading a jurisdiction whose data is indexed only in the harvest', () => {
  const org = (name: string, title: string, count: number) => ({ name, title, count });

  it('counts the jurisdiction’s government, not every body named for it', () => {
    const orgs = [
      org('tas-government-the-list', "Tasmania Government's The List Data", 792),
      org('department-of-justice-tasmania', 'Department of Justice (Tasmania)', 68),
      org('sbs-utas', 'School of Biological Sciences (SBS), University of Tasmania (UTAS)', 7),
      org('imas-utas', 'Institute for Marine and Antarctic Studies (IMAS), University of Tasmania (UTAS)', 6),
      org('tmag', 'Tasmanian Museum and Art Gallery', 2),
      org('vic', 'Department of Energy, Environment and Climate Action', 40),
    ];
    expect(governmentPublishers(orgs, 'TAS').map((o) => o.name))
      .toEqual(['tas-government-the-list', 'department-of-justice-tasmania', 'tmag']);
    expect(ACADEMIC_PUBLISHER.test('Libraries Tasmania')).toBe(false);
  });

  it('calls an enumeration complete only when every publisher was read to what it declared', () => {
    expect(enumerationComplete([])).toBe(false);
    expect(enumerationComplete([{ name: 'a', title: 'A', declared: 792, read: 792 }])).toBe(true);
    expect(enumerationComplete([
      { name: 'a', title: 'A', declared: 792, read: 792 },
      { name: 'b', title: 'B', declared: 68, read: 50 },
    ])).toBe(false);
    // A publisher the index says holds nothing has not been enumerated.
    expect(enumerationComplete([{ name: 'a', title: 'A', declared: 0, read: 0 }])).toBe(false);
  });

  it('says where the absence was established, and why that index is the right one', () => {
    const cov = assessVolumeCoverage(
      { kind: 'catalogue', total: 3, datasets: [] },
      true,
      1_021,
      'harvest_enumeration',
    );
    expect(cov).toEqual({ kind: 'no_count_published', searched: 3, inventory: 1_021, route: 'harvest_enumeration' });
    const note = volumeCoverageNote(cov, 'TAS');
    expect(note).toMatch(/of the 1,021 datasets its own publishers list in the Commonwealth catalogue, read in full, 3 name a sale/);
    expect(note).toMatch(/TAS runs no open-data catalogue of its own/);
    // Never the ordinary route's words, which would claim a catalogue it does not have.
    expect(note).not.toMatch(/across its own catalogue/);
  });

  it('leaves the ordinary route’s sentence exactly as it was', () => {
    const cov = assessVolumeCoverage({ kind: 'catalogue', total: 0, datasets: [] }, true, 1_075);
    expect(cov).toEqual({ kind: 'no_count_published', searched: 0, inventory: 1_075 });
    expect('route' in cov).toBe(false);
    expect(volumeCoverageNote(cov, 'NT')).toMatch(/across its own catalogue and the Commonwealth catalogue/);
  });

  it('still refuses an absence nobody corroborated, whatever the route', () => {
    expect(assessVolumeCoverage({ kind: 'catalogue', total: 0, datasets: [] }, false, 1_021, 'harvest_enumeration').kind)
      .toBe('catalogue_unavailable');
  });
});

/*
 * ── What an assessment is handed, and the number its sentence states ─────
 *
 * The 23 Sep run printed `datasets naming a sale  5 of 982` and then a
 * sentence saying "6 name a sale": the relevance search's one attributed
 * find had been folded into a number describing the enumerated list, and on
 * that route the list and the search ask the SAME index — so a dataset can
 * also arrive by both and be counted twice.
 */
describe('the read an assessment is handed', () => {
  const sale = (id: string, over: Partial<VolumeDataset> = {}) =>
    dataset({ id, title: `Sales dataset ${id}`, organisation: 'Department of Justice (Tasmania)', ...over });

  it('holds a dataset both routes returned once', () => {
    const r = attributedRead({ own: [sale('a'), sale('b')], harvest: [sale('b'), sale('c')] });
    expect(r.parse.datasets.map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(r.parse.total).toBe(3);
    expect(r.overlap).toBe(1);
    expect(r.harvestOnly.map((d) => d.id)).toEqual(['c']);
  });

  it('holds a dataset a route returned twice once', () => {
    const r = attributedRead({ own: [sale('a'), sale('a')], harvest: [sale('c'), sale('c')] });
    expect(r.parse.datasets.map((d) => d.id)).toEqual(['a', 'c']);
    expect(r.overlap).toBe(0);
  });

  it('counts the enumerated list on the enumeration route, and every distinct dataset otherwise', () => {
    const own = [sale('a'), sale('b'), sale('c'), sale('d'), sale('e')];
    const harvest = [sale('f')];
    const enumerated = attributedRead({ own, harvest, route: 'harvest_enumeration' });
    expect(enumerated.parse.total).toBe(5);
    expect(enumerated.parse.datasets).toHaveLength(6);
    const ordinary = attributedRead({ own, harvest });
    expect(ordinary.parse.total).toBe(6);
  });

  it('prints the enumeration’s own count in the sentence, as the probe’s line does', () => {
    const own = [sale('a'), sale('b'), sale('c'), sale('d'), sale('e')];
    const r = attributedRead({ own, harvest: [sale('f')], route: 'harvest_enumeration' });
    const note = volumeCoverageNote(assessVolumeCoverage(r.parse, true, 982, 'harvest_enumeration'), 'TAS');
    expect(note).toContain('of the 982 datasets its own publishers list in the Commonwealth catalogue, read in full, 5 name a sale');
  });

  /*
   * The count is narrowed; the ranking is not. A find needs one endpoint
   * that answered, so a dataset only the search returned — attributed and
   * saying it carries a count — is still a find on the enumeration route.
   */
  it('still ranks what only the search found', () => {
    const counted = sale('f', {
      title: 'Residential property sales by suburb',
      notes: 'Number of sales and median sale price by suburb, quarterly.',
      resources: [{ id: 'r1', name: 'sales.csv', format: 'CSV', url: 'https://x/sales.csv', datastoreActive: true, size: null }],
    });
    const r = attributedRead({ own: [sale('a')], harvest: [counted], route: 'harvest_enumeration' });
    const judged = judgeVolumeDataset(counted);
    expect(judged.count).toBe(true);
    expect(r.parse.datasets.map((d) => d.id)).toContain('f');
    expect(assessVolumeCoverage(r.parse, true, 982, 'harvest_enumeration').kind).not.toBe('no_count_published');
  });

  it('is what the probe hands the assessment, with the route the reads were taken by', () => {
    const probe = readFileSync('scripts/market/sales-volume-liveness.ts', 'utf8');
    expect(probe).toMatch(/const read = attributedRead\(\{/);
    expect(probe).toMatch(/route: ownRead\.route,\s*\}\);/);
    expect(probe).toMatch(/const merged = read\.parse;/);
  });
});
