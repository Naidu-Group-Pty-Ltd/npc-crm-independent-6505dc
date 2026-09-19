/**
 * Booklet composition — which leaves exist, and how they pair.
 *
 * This is the half of the booklet a component test cannot see. A render test
 * proves one fixture draws; these prove the document has the right pages for a
 * given case, which is what stops a bound artefact printing a blank leaf or
 * silently dropping a section.
 */
import { describe, expect, it } from 'vitest';
import {
  bookletCover,
  bookletLabel,
  bookletSpreads,
  buildBooklet,
  bookletGeometry,
  buildPassportView,
  LEAF_H,
  LEAF_W,
  type PassportViewInput,
} from './index';

const NOW = '2026-08-13T10:00:00Z';

function input(over: Partial<PassportViewInput> = {}): PassportViewInput {
  return {
    issuer_org: 'Naidu Property Consulting Services',
    officer_label: 'P. Naidu · MLRO',
    case: {
      id: 'c1', case_reference: 'AML-2026-1184', subject_display_name: 'Meridian Coast Holdings',
      subject_type: 'entity', status: 'cleared', case_stage: 'cleared',
      service_gate_status: 'approved', opened_at: '2026-08-01T00:00:00Z', closed_at: null,
    },
    attestations: [{ version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: null, payload_sha256: 'a'.repeat(64), schema_version: 2 }],
    material_inputs_current: true,
    open_refresh_obligations: 0,
    personal_details: null,
    entity_details: null,
    documents: [],
    transactions: [],
    screening: null,
    funding: null,
    partners: [],
    events: [],
    client_requests: [],
    stamp_input: {
      issuer_org: 'Naidu Property Consulting Services',
      attestations: [{ version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: null }],
      consents: [], verification_checks: [], documents: [], screening_subjects: [], owners: [],
      source_of_funds: [], source_of_wealth: [], edd_cases: [], grants: [],
      assessments: [], refresh_obligations: [], transactions: [],
    },
    ...over,
  };
}

const bookletFor = (over: Partial<PassportViewInput> = {}) =>
  buildBooklet(buildPassportView('command', input(over)));

/**
 * A transaction as the SERVER supplies one.
 *
 * `aml-reliance` feeds one `txns` result set into both `transactions` (what the
 * pages print) and `stamp_input.transactions` (what the certifications are
 * derived from), so a fixture that sets only the first describes a state
 * production cannot be in — and the completion page's certification would be
 * missing for a reason nothing outside the fixture shares.
 */
const withTransaction = (t: {
  status: string; settlement_date: string | null;
}): Partial<PassportViewInput> => ({
  transactions: [{
    id: 't1', kind: 'purchase', property_address: 'Lot 14', contract_date: NOW,
    purchase_price: 1, status: t.status, settlement_date: t.settlement_date,
  }],
  stamp_input: {
    ...input().stamp_input,
    transactions: [{ id: 't1', status: t.status, settlement_date: t.settlement_date }],
  },
});

describe('buildBooklet', () => {
  it('opens on the Aurixa cover, then Client Identity and Compliance Summary', () => {
    const pages = bookletFor();
    // A passport opens on its cover. A booklet whose first page is a data
    // table reads as a report — the opposite of what this artefact is.
    expect(pages[0].variant).toBe('cover');
    expect(pages[0].blocks).toHaveLength(0);
    expect(pages[1].title).toBe('Client Identity');
    expect(pages[2].title).toBe('Compliance Summary');
    expect(pages.length).toBeGreaterThanOrEqual(4);
  });

  it('does not number the cover — numbering starts on the first leaf', () => {
    const pages = bookletFor();
    expect(pages[0].numeral).toBeNull();
    expect(pages[1].numeral).toBe('I');
    // Adding or removing the cover must never shift a printed numeral.
    const leaves = pages.filter((p) => p.variant === 'leaf');
    expect(leaves[0].numeral).toBe('I');
    expect(leaves[leaves.length - 1].numeral).toBe(
      ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI'][leaves.length - 1],
    );
  });

  it('does NOT print a leaf whose records do not exist', () => {
    // An empty "Screening" leaf in a bound document reads as "screening found
    // nothing" — a different and much worse claim than "not part of this record".
    const titles = bookletFor().map((p) => p.title);
    expect(titles).not.toContain('Screening');
    expect(titles).not.toContain('Funding & Due Diligence');
    expect(titles).not.toContain('Evidence Wallet');
    expect(titles).not.toContain('Partner Access');
    expect(titles).not.toContain('Transaction & Matter');
  });

  it('grows as the case does', () => {
    const rich = bookletFor({
      screening: { subjects: [{ state: 'completed', completed_at: NOW }], pep_result: 'not_pep', pep_determined_at: NOW, list_freshness: { dfat: NOW } },
      funding: { sof: [{ verified: true, verified_at: NOW }], sow: [], edd: [] },
      documents: [{ id: 'd1', requirement_label: 'Primary photo ID', requirement_code: 'primary_id', required: true, status: 'accepted', created_at: NOW, version_number: 1 }],
      transactions: [{ id: 't1', kind: 'purchase', status: 'under_contract', property_address: 'Lot 14', contract_date: NOW, settlement_date: null, purchase_price: 2480000 }],
    });
    const titles = rich.map((p) => p.title);
    expect(titles).toContain('Screening');
    expect(titles).toContain('Funding & Due Diligence');
    expect(titles).toContain('Evidence Wallet');
    expect(titles).toContain('Transaction & Matter');
    expect(titles).toContain('Transaction Completion');
    expect(rich.length).toBeGreaterThan(bookletFor().length);
  });

  it('numbers leaves in sequence with no gaps, whatever the case holds', () => {
    const leaves = bookletFor().filter((p) => p.variant === 'leaf');
    expect(leaves[0].numeral).toBe('I');
    expect(leaves[1].numeral).toBe('II');
    expect(new Set(leaves.map((p) => p.numeral)).size).toBe(leaves.length);
  });

  it('closes on Review & Renewal, which states the reliance boundary', () => {
    const pages = bookletFor();
    const last = pages[pages.length - 1];
    expect(last.title).toBe('Review & Renewal');
    const note = last.blocks.find((b) => b.kind === 'note');
    expect(note && 'text' in note ? note.text : '').toMatch(/remains responsible for its own obligations/i);
  });

  it('leaves the settlement seal unstruck until settlement is confirmed', () => {
    // The completion page carries the register's OWN `transaction_completed`
    // certification, struck or unstruck — not a second seal with its own
    // wording. It used to read "AWAITING SETTLEMENT" / "SETTLEMENT COMPLETE",
    // a third name for a stamp the vocabulary already names once.
    const pending = bookletFor(
      withTransaction({ status: 'under_contract', settlement_date: null }),
    ).find((p) => p.id === 'completion');
    const hero = pending?.blocks.find((b) => b.kind === 'hero');
    expect(hero?.kind).toBe('hero');
    if (hero?.kind !== 'hero') throw new Error('no hero block');
    expect(hero.stamp).toBeNull();
    expect(hero.pending?.code).toBe('transaction_completed');

    const done = bookletFor(
      withTransaction({ status: 'settled', settlement_date: NOW }),
    ).find((p) => p.id === 'completion');
    const heroDone = done?.blocks.find((b) => b.kind === 'hero');
    if (heroDone?.kind !== 'hero') throw new Error('no hero block');
    expect(heroDone.pending).toBeNull();
    expect(heroDone.stamp?.code).toBe('transaction_completed');
    // The struck impression carries its record, not just a label.
    expect(heroDone.stamp?.at).toBeTruthy();
    expect(heroDone.stamp?.title).toBe('TRANSACTION COMPLETED');
  });

  it('carries no restricted material onto paper', () => {
    const pages = bookletFor({
      screening: { subjects: [{ state: 'completed', completed_at: NOW }], pep_result: 'not_pep', pep_determined_at: NOW, list_freshness: {} },
    });

    // The Screening leaf carries a boundary NOTE that names the excluded
    // material in order to say it is excluded ("Candidate matches, dismissed
    // hits …"). That sentence is the control, not a leak, so it is removed
    // before the scan — and asserted separately, because dropping it would
    // silently remove the statement this page exists to make.
    const boundary = pages
      .flatMap((p) => p.blocks)
      .find((b) => b.kind === 'note' && b.title === 'Internal boundary');
    expect(boundary && 'text' in boundary ? boundary.text : '').toMatch(/Candidate matches/);

    const json = JSON.stringify(pages).replace(
      boundary && 'text' in boundary ? boundary.text : '',
      '',
    );
    expect(json).not.toMatch(/not_pep|possible_match|candidate|risk_score|rationale|storage_path/i);
  });
});

describe('bookletCover', () => {
  const coverFor = (over: Partial<PassportViewInput> = {}) =>
    bookletCover(buildPassportView('command', input(over)));

  it('IS the booklet’s first page, not a second drawing of it', () => {
    // Every surface that shows a cover — the record miniature and page 1 of
    // the book — asks this one function. A separate "thumbnail version" is a
    // copy, and a copy drifts: a customer whose miniature says one thing and
    // whose booklet says another has been shown two documents.
    expect(bookletCover(buildPassportView('command', input()))).toEqual(bookletFor()[0]);
  });

  it('names its bearer, credential and state, so it is per-customer', () => {
    const cover = coverFor();
    expect(cover.sub).toBe('Meridian Coast Holdings');
    expect(cover.foot).toContain('AUX-AML-2026-1184-V1');

    // The same function, a different case: nothing about a cover can be
    // specialised to one customer.
    const other = coverFor({
      case: {
        id: 'c2', case_reference: 'AML-2026-2201', subject_display_name: 'Harriet Vance',
        subject_type: 'individual', status: 'in_progress', case_stage: 'verification',
        service_gate_status: 'pending', opened_at: '2026-08-02T00:00:00Z', closed_at: null,
      },
    });
    expect(other.sub).toBe('Harriet Vance');
    expect(other.foot).not.toBe(cover.foot);
  });

  it('is a cover rather than a leaf: unnumbered, and carrying no blocks', () => {
    const cover = coverFor();
    expect(cover.variant).toBe('cover');
    expect(cover.numeral).toBeNull();
    expect(cover.blocks).toHaveLength(0);
  });

  it('carries the short evidence fingerprint and never the full digest', () => {
    // The front board prints what a verifier checks by hand. The full hash is
    // not a cover element, and a miniature must not become the place it leaks.
    const cover = coverFor();
    expect(cover.fingerprint).toBeTruthy();
    expect(cover.fingerprint!.length).toBeLessThan(64);
    expect(JSON.stringify(cover)).not.toContain('a'.repeat(64));
  });
});

describe('bookletSpreads / bookletLabel', () => {
  it('pairs facing leaves on a wide viewport and singles on a narrow one', () => {
    expect(bookletSpreads(4, 2)).toEqual([[0, 1], [2, 3]]);
    expect(bookletSpreads(4, 1)).toEqual([[0], [1], [2], [3]]);
  });

  it('leaves the last leaf unpaired when the count is odd — never an empty page', () => {
    expect(bookletSpreads(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it('labels a spread the way the design labels it', () => {
    expect(bookletLabel([0, 1], 14)).toBe('PAGES 1–2 OF 14');
    expect(bookletLabel([0], 12)).toBe('PAGE 1 OF 12');
    expect(bookletLabel([], 12)).toBe('');
  });

  it('handles an empty document without producing a phantom spread', () => {
    expect(bookletSpreads(0, 2)).toEqual([]);
  });
});

describe('bookletGeometry', () => {
  it('scales the leaf instead of squeezing it — the design box never changes', () => {
    const g = bookletGeometry({ availableWidth: 500, availableHeight: 900, singleOnly: true });
    expect(g.perSpread).toBe(1);
    expect(g.width).toBeCloseTo(LEAF_W * g.scale, 5);
    expect(g.height).toBeCloseTo(LEAF_H * g.scale, 5);
    // Aspect ratio is preserved exactly, at every size.
    expect(g.width / g.height).toBeCloseTo(LEAF_W / LEAF_H, 10);
  });

  it('NEVER returns a spread larger than the space it was given', () => {
    // This is the contract the whole viewer rests on: the caller sizes the
    // board from these numbers, so a result wider than the container is a
    // cropped passport — which is exactly the defect this replaced.
    const widths = [420, 640, 768, 900, 1024, 1180, 1280, 1440, 1600, 1920, 2560, 3440];
    const heights = [360, 480, 560, 640, 720, 800, 900, 1080, 1440];
    for (const availableWidth of widths) {
      for (const availableHeight of heights) {
        for (const singleOnly of [false, true]) {
          const g = bookletGeometry({ availableWidth, availableHeight, singleOnly });
          // Exact, not within an epsilon: the scale is floored precisely so
          // this holds. Below the documented minimum-scale floor the viewer
          // scrolls rather than shrinking into nothing, so that case is exempt.
          if (g.scale > 0.28) {
            expect(
              g.width,
              `width overflowed at ${availableWidth}x${availableHeight} singleOnly=${singleOnly}`,
            ).toBeLessThanOrEqual(availableWidth);
            expect(
              g.height,
              `height overflowed at ${availableWidth}x${availableHeight} singleOnly=${singleOnly}`,
            ).toBeLessThanOrEqual(availableHeight);
          }
          // The scaled layer is laid out at spreadWidth and transformed, so the
          // two must agree exactly or the leaf is cropped or floats.
          expect(g.width).toBeCloseTo(g.spreadWidth * g.scale, 6);
        }
      }
    }
  });

  it('reports the unscaled spread width the scaled layer is laid out at', () => {
    const one = bookletGeometry({ availableWidth: 500, availableHeight: 900, singleOnly: true });
    expect(one.spreadWidth).toBe(LEAF_W);

    const two = bookletGeometry({ availableWidth: 1400, availableHeight: 900, spine: 26 });
    expect(two.perSpread).toBe(2);
    expect(two.spreadWidth).toBe(LEAF_W * 2 + 26);
  });

  it('shows a facing pair only when both leaves stay legible', () => {
    expect(bookletGeometry({ availableWidth: 1100, availableHeight: 900 }).perSpread).toBe(2);
    // Too narrow for two readable leaves: fall back to one rather than
    // shrinking both into illegibility.
    expect(bookletGeometry({ availableWidth: 560, availableHeight: 900 }).perSpread).toBe(1);
  });

  it('a short viewport forces a single leaf rather than cropping a pair', () => {
    // Height is what usually runs out first on a laptop. Fitting by height
    // alone would keep two leaves and shrink them below legibility.
    const short = bookletGeometry({ availableWidth: 1600, availableHeight: 380 });
    expect(short.height).toBeLessThanOrEqual(380);
    expect(short.width).toBeLessThanOrEqual(1600);
  });

  it('never enlarges a leaf beyond its design size by more than the cap', () => {
    expect(bookletGeometry({ availableWidth: 6000, availableHeight: 6000 }).scale)
      .toBeLessThanOrEqual(1.15);
  });

  it('degrades to a usable size rather than collapsing on a tiny viewport', () => {
    const tiny = bookletGeometry({ availableWidth: 100, availableHeight: 200 });
    expect(tiny.perSpread).toBe(1);
    expect(tiny.scale).toBeGreaterThanOrEqual(0.28);
  });

  it('honours singleOnly even when there is room for two', () => {
    expect(bookletGeometry({ availableWidth: 2000, availableHeight: 900, singleOnly: true }).perSpread)
      .toBe(1);
  });
});
