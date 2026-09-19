/**
 * One designation, one row — and identity confirmed before anything merges.
 *
 * S5/S6 §9: *"confirm project identity before deduplication"*. Found by
 * executing `buildInfrastructureEvidence` on 18 September 2026, because no
 * retained fixture carries `planningData` at all — all seven predate the
 * planning wiring, so this class cannot be found by replaying them.
 *
 * ## The overlap is exact, not incidental
 *
 * `QLD_INSTRUMENT_LAYERS` queries layers 25, 30, 35 and 40 of
 * `PlanningCadastre/StatePlanning/MapServer` one at a time. The constraint
 * register calls `buildQldStatePlanningIdentify`, which is `identify` on the
 * SAME MapServer with `layers: all` — so those four layers answer it too, and
 * `classify()`'s `has('priority development', 'development area')` branch
 * files the second copy under `growthArea` / `context`.
 *
 * Measured before the fix: one designation, two rows, disagreeing on every
 * cell but the name —
 *
 *   | Maryborough Priority Living Area | Priority development area | Declared  | PLA-MBH |
 *   | Maryborough Priority Living Area | Growth / priority area    | Statutory | Wide Bay Burnett Regional Plan |
 *
 * which is the legacy report's own failure, the one `compassDocumentContract`
 * exists to describe: three copies of one zoning section on one lot,
 * disagreeing on every control.
 *
 * ## Why the merge is narrow
 *
 * Merging on resemblance would delete a real project. So identity is the
 * publisher's own source string plus the publisher's own name, equal after
 * trim, case-fold and whitespace collapse — nothing else, and never across
 * sources.
 */
import { describe, expect, it } from 'vitest';
import { buildInfrastructureEvidence, renderInfrastructureOutlook }
  from '../../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';

const QLD = 'Queensland StatePlanning layers (PDAs, SDAs, coordinated projects, infrastructure designations)';

const instrument = (name: string, extra: Record<string, unknown> = {}) => ({
  name, kind: 'priority_development_area', status: 'Declared',
  gazetted: '2023-12-01', detail: 'Fraser Coast', reference: 'PLA-MBH', ...extra,
});
const context = (label: string, extra: Record<string, unknown> = {}) => ({
  kind: 'context', family: 'growthArea', label, standingLabel: 'Statutory',
  currencyDate: '2023-12-01', region: 'Wide Bay Burnett',
  instrument: 'Wide Bay Burnett Regional Plan', source: QLD, licence: 'CC BY 4.0',
  // Layer 35 is the priority-development-area layer the instruments probe
  // reads. It makes this a CANDIDATE.
  sourceLayer: 35,
  /*
   * And `code` is what CONFIRMS it — matching the instrument reading's own
   * `reference`, so the default pair is a duplicate somebody can prove.
   *
   * It was not here before 18 Sep 2026, because the rule then merged wherever
   * nothing contradicted. It does not any more: **a missing identifier
   * confirms nothing**, and suppressing a record on publisher, layer and name
   * alone destroys evidence to tidy a list. Tests that want the unconfirmed
   * case now pass `{ code: null }` and say so.
   */
  code: 'PLA-MBH', ...extra,
});
const build = (instruments: unknown[], constraints: unknown[]) => buildInfrastructureEvidence({
  planningData: {
    fetchedAt: '2026-09-18T00:00:00Z',
    developmentInstruments: { status: 'ok', source: QLD, licence: 'CC BY 4.0', instruments },
    constraints,
  },
});

describe('the same designation from both Queensland reads is one row', () => {
  it('drops the identify-all copy and keeps the layer-specific reading', () => {
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Maryborough Priority Living Area')]);
    expect(ev.items).toHaveLength(1);
    const [only] = ev.items;
    // The layer-specific read wins: it parses pda_name / pda_status /
    // gazetted_date, where the identify-all row parses what the server offered.
    expect(only.kind).toBe('Priority development area');
    expect(only.statedStatus).toBe('Declared');
    expect(only.reference).toBe('PLA-MBH');
    expect(only.dateLabel).toBe('Gazetted');
  });

  it('matches through case, padding and collapsed whitespace, and nothing else', () => {
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('  maryborough   PRIORITY living area ')]);
    expect(ev.items).toHaveLength(1);
  });

  it('a different designation is a different project, however alike it reads', () => {
    // One word apart, same publisher, same point. Merging these would delete a
    // real designation, which is the failure §9 names.
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Hervey Bay Priority Living Area')]);
    expect(ev.items).toHaveLength(2);
    expect(ev.items.map((i) => i.name)).toEqual([
      'Maryborough Priority Living Area', 'Hervey Bay Priority Living Area',
    ]);
  });

  it('a shared word is not identity', () => {
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Maryborough')]);
    expect(ev.items).toHaveLength(2);
  });

  it('nothing merges across sources — a different publisher is a different fact', () => {
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Maryborough Priority Living Area', { source: 'Fraser Coast Regional Council' })]);
    expect(ev.items).toHaveLength(2);
    expect(ev.items[1].source).toBe('Fraser Coast Regional Council');
  });

  it('the context row still carries its own source when nothing collided', () => {
    const ev = build([], [context('Wide Bay Burnett Regional Plan', { family: 'regionalPlan' })]);
    expect(ev.items).toHaveLength(1);
    expect(ev.items[0].source).toBe(QLD);
    expect(ev.items[0].kind).toBe('Regional plan');
  });

  it('suppression is silent — a client document never narrates its own production', () => {
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Maryborough Priority Living Area')]);
    // No absence, no coverage note and no reading is manufactured by a merge:
    // a duplicate that was never printed is not something a reader lost.
    expect(ev.absences).toEqual([]);
    expect(ev.readings).toEqual([]);
    expect(ev.anyEvidenced).toBe(true);
  });

  it('the rule is written down where the next reader will look', () => {
    // A merge rule that lives only in a test is one the next change re-opens.
    const src = buildInfrastructureEvidence.toString();
    expect(src).toContain('instrumentIdentities');
  });
});

// ─── identity must be PROVEN, not inferred from a label ───────────────────

describe('publisher plus name is a candidate match, never identity', () => {
  it('no layer identifier — the row stands rather than being merged on a name', () => {
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Maryborough Priority Living Area', { sourceLayer: null })]);
    expect(ev.items, 'an unidentified reading is unidentified').toHaveLength(2);
  });

  it('a layer OUTSIDE the instruments probe\'s four is not the same register', () => {
    // Layer 12 is some other StatePlanning layer. Same publisher, same name,
    // different register — and a name is not proof.
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Maryborough Priority Living Area', { sourceLayer: 12 })]);
    expect(ev.items).toHaveLength(2);
  });

  it('the layer must map to the kind the instrument reading carries', () => {
    // Layer 25 is the coordinated-project layer; the instrument is a priority
    // development area. Same publisher, same name, two different registers.
    const ev = build([instrument('Maryborough Priority Living Area')],
      [context('Maryborough Priority Living Area', { sourceLayer: 25 })]);
    expect(ev.items).toHaveLength(2);
  });

  it('a MISSING source never establishes identity, even against another missing one', () => {
    // The defect the first version carried: `?? 'state planning layers'` made
    // two sourceless readings look like the same publisher.
    const ev = buildInfrastructureEvidence({ planningData: {
      fetchedAt: '2026-09-18T00:00:00Z',
      developmentInstruments: {
        status: 'ok', source: null, licence: null,
        instruments: [instrument('Maryborough Priority Living Area')],
      },
      constraints: [context('Maryborough Priority Living Area', { source: null })],
    } });
    expect(ev.items).toHaveLength(2);
  });

  it('the mapping agrees with the probe it is written from', async () => {
    // A layer added to QLD_INSTRUMENT_LAYERS and not here stops merging rather
    // than starting to merge the wrong thing — the safe direction, asserted.
    const { QLD_INSTRUMENT_LAYERS } = await import(
      '../../../../supabase/functions/_shared/planning/planningSources.pure');
    const { readFileSync } = await import('node:fs');
    // Read the SOURCE, not the transpiled function: vitest rewrites string
    // quoting, so `toString()` would assert on the compiler's taste.
    const src = readFileSync(
      'supabase/functions/_shared/planning/infrastructureEvidence.pure.ts', 'utf8');
    const map = src.slice(src.indexOf('INSTRUMENT_LAYER_KIND'), src.indexOf('instrumentIdentities'));
    for (const { layer, kind } of QLD_INSTRUMENT_LAYERS) {
      expect(map, `layer ${layer} must map to ${kind}`).toContain(`${layer}: '${kind}'`);
    }
    expect(QLD_INSTRUMENT_LAYERS).toHaveLength(4);
  });
});

// ─── a layer is a COLLECTION; the publisher's identifiers settle it ────────

/**
 * S5/S6 §3, 18 Sep 2026: *"a layer identifier identifies a collection, not
 * necessarily an individual designation. Confirm identity through the
 * publisher's feature/reference identifier or a documented equivalence. Add
 * the specific negative case of matching publisher, layer and name but
 * different instrument references."*
 *
 * Two priority development areas are both layer 35. A name can be reused. So
 * publisher + layer + name is a candidate and the publisher's own identifiers
 * decide — and there are TWO of them, identifying different things:
 *
 *   - `feature` — this designation's own reference or code: `PDA-MBH`, `DDO1`.
 *   - `instrument` — the planning instrument it sits UNDER: `Wide Bay Burnett
 *     Regional Plan`.
 *
 * Each is judged against its own channel only. Comparing a feature reference
 * against an instrument name is the publisher-plus-name mistake one level
 * down: two identifiers of different things disagree on every honest pair,
 * and a rule built on that comparison would refuse every real merge.
 *
 * Measured against the parsers on 18 Sep 2026: `parseQldInstrument` emits
 * NEITHER identifier on any of its four kinds, and a
 * `PlanningConstraintReading` carries both — so today every real match is
 * "one side published none", which merges. The guard is written before either
 * parser grows an identifier, because that is the change that would otherwise
 * start merging two designations silently.
 */
describe('the publisher\'s own identifiers refuse a match the layer admits', () => {
  it('matching publisher, layer and name but DIFFERENT feature references stay separate', () => {
    const ev = build(
      [instrument('Caboolture West', { reference: 'PDA-CBW-01' })],
      [context('Caboolture West', { code: 'PDA-CBW-02' })],
    );
    expect(ev.items, 'two references that disagree are two records').toHaveLength(2);
  });

  it('matching publisher, layer and name but DIFFERENT instruments stay separate', () => {
    const ev = build(
      [instrument('Caboolture West', { instrument: 'Caboolture West Development Scheme' })],
      [context('Caboolture West', { instrument: 'South East Queensland Regional Plan' })],
    );
    expect(ev.items).toHaveLength(2);
  });

  it('both rows keep their own provenance and the conflicting detail', () => {
    const ev = build(
      [instrument('Caboolture West', {
        reference: 'PDA-CBW-01', status: 'Declared', gazetted: '2023-12-01',
      })],
      [context('Caboolture West', {
        code: 'PDA-CBW-02', standingLabel: 'Statutory', currencyDate: '2024-06-30',
        region: 'South East Queensland', instrument: 'SEQ Regional Plan',
        licence: 'CC BY 4.0',
      })],
    );
    expect(ev.items).toHaveLength(2);
    const [fromLayer, fromIdentify] = ev.items;
    // The conflicting identifiers are both on the page, so a reader can look
    // either up rather than being handed one row that silently ate the other.
    expect(fromLayer.reference).toBe('PDA-CBW-01');
    expect(fromIdentify.reference).toBe('SEQ Regional Plan');
    // Each keeps the standing its own register stated, and neither borrows.
    expect(fromLayer.statedStatus).toBe('Declared');
    expect(fromIdentify.statedStatus).toBe('Statutory');
    expect(fromLayer.dateLabel).toBe('Gazetted');
    expect(fromIdentify.dateLabel).toBe('Current at');
    expect(fromIdentify.where).toBe('South East Queensland');
    // Still silent — a refused merge is not something a client document
    // narrates either.
    expect(ev.absences).toEqual([]);
  });

  it('identifiers that AGREE confirm the match rather than refusing it', () => {
    const ev = build(
      [instrument('Caboolture West', { reference: 'PDA-CBW-01' })],
      [context('Caboolture West', { code: ' pda-cbw-01 ' })],
    );
    expect(ev.items, 'case and padding are not a disagreement').toHaveLength(1);
  });

  it('a missing identifier CONFIRMS nothing — both rows stand, the second marked', () => {
    /*
     * The correction of 18 Sep 2026, and the whole of the difference from the
     * first version. Publisher, layer and name all match and NEITHER side
     * published an identifier that could settle it — so this is a candidate
     * nobody confirmed, and suppressing one of them would destroy a record on
     * the strength of a shared name.
     *
     * It is what production actually holds: three of `parseQldInstrument`'s
     * four kinds read no published reference at all.
     */
    const ev = build([instrument('Maryborough Priority Living Area', { reference: null })],
      [context('Maryborough Priority Living Area', { code: null, instrument: null })]);
    expect(ev.items, 'nothing confirmed it, so nothing is suppressed').toHaveLength(2);
    // And the danger is disclosed, because the extra row only does harm when
    // somebody adds the two together.
    expect(ev.items[1].unconfirmedDuplicateOf).toBe('Maryborough Priority Living Area');
    expect(ev.items[0].unconfirmedDuplicateOf ?? null).toBeNull();
  });

  it('the page says so, and says not to add them together', () => {
    const ev = build([instrument('Maryborough Priority Living Area', { reference: null })],
      [context('Maryborough Priority Living Area', { code: null, instrument: null })]);
    const page = renderInfrastructureOutlook(ev);
    expect(page).toContain('Two readings that may be one project');
    expect(page).toContain('Do not add their figures together');
  });

  it('a CONTRADICTION is never marked as a possible duplicate', () => {
    // The identifiers said these are two records. Calling a genuine second
    // designation "possibly a duplicate" is the same error pointing the other
    // way, and it would suppress a real one from any total that excludes marks.
    const ev = build([instrument('Caboolture West', { reference: 'PDA-CBW-01' })],
      [context('Caboolture West', { code: 'PDA-CBW-02' })]);
    expect(ev.items).toHaveLength(2);
    expect(ev.items[1].unconfirmedDuplicateOf ?? null).toBeNull();
  });

  it('the two channels are never compared across each other', () => {
    /*
     * A feature reference on one side and an instrument name on the other.
     * Read as ONE channel these two strings disagree, and the pair would be
     * filed as two confirmed-distinct records — which is a stronger claim than
     * the evidence supports and would suppress the disclosure below.
     *
     * Judged like for like, neither channel has both sides, so the verdict is
     * `unconfirmed`: both rows stand AND the second is marked, which is the
     * honest reading of "we cannot tell".
     */
    const ev = build(
      [instrument('Maryborough Priority Living Area', { reference: 'PDA-MBH' })],
      [context('Maryborough Priority Living Area', {
        code: null, instrument: 'Wide Bay Burnett Regional Plan',
      })],
    );
    expect(ev.items).toHaveLength(2);
    expect(ev.items[1].unconfirmedDuplicateOf).toBe('Maryborough Priority Living Area');
  });

  it('a merge fills the surviving row from the one it suppressed', () => {
    // The merge has to EARN the suppression: the identify row's plan name,
    // region, currency and licence are facts the layer read did not carry,
    // and dropping the row used to drop them with it.
    // Confirmed by the instrument channel: both name the same plan.
    const ev = build(
      [instrument('Maryborough Priority Living Area', {
        reference: null, gazetted: null, detail: null,
        instrument: 'Wide Bay Burnett Regional Plan',
      })],
      [context('Maryborough Priority Living Area', { code: null })],
    );
    expect(ev.items).toHaveLength(1);
    const [only] = ev.items;
    expect(only.reference).toBe('Wide Bay Burnett Regional Plan');
    expect(only.where).toBe('Wide Bay Burnett');
    expect(only.date).toBe('2023-12-01');
    expect(only.dateLabel).toBe('Current at');
    expect(only.licence).toBe('CC BY 4.0');
  });

  it('a fill never overwrites what the layer read already stated', () => {
    const ev = build(
      [instrument('Maryborough Priority Living Area', {
        reference: 'PLA-MBH', gazetted: '2019-05-17', detail: 'Fraser Coast',
      })],
      [context('Maryborough Priority Living Area', { currencyDate: '2023-12-01' })],
    );
    expect(ev.items).toHaveLength(1);
    const [only] = ev.items;
    // The gazettal is what the layer-specific register published; the
    // designation's currency date does not replace it.
    expect(only.date).toBe('2019-05-17');
    expect(only.dateLabel).toBe('Gazetted');
    expect(only.where).toBe('Fraser Coast');
  });

  it('no status word travels — a designation\'s standing is not an instrument\'s', () => {
    const ev = build(
      [instrument('Maryborough Priority Living Area', { reference: 'PLA-MBH', status: null })],
      [context('Maryborough Priority Living Area', { standingLabel: 'Statutory' })],
    );
    expect(ev.items).toHaveLength(1);
    // An instrument with no published status keeps none. Borrowing the
    // designation's would put a plan's standing in a project's Status column,
    // which is the defect rule 10's own comment records.
    expect(ev.items[0].statedStatus).toBeNull();
    expect(ev.items[0].standing).toBeNull();
  });

  it('the channels are written down, not only tested', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      'supabase/functions/_shared/planning/infrastructureEvidence.pure.ts', 'utf8');
    expect(src).toContain('compareIdentity');
    // The three verdicts are named, so the next reader cannot collapse
    // "we cannot tell" back into "nothing contradicted, so merge".
    for (const verdict of ['confirmed', 'contradicted', 'unconfirmed']) {
      expect(src, verdict).toContain(`'${verdict}'`);
    }
    // A channel is judged only where BOTH sides published it.
    expect(src.replace(/\s+/g, ' ')).toContain('if (x === null || y === null) continue;');
  });
});
