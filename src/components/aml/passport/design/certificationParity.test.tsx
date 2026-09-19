/**
 * The register and the booklet certify the same thing, or neither ships.
 *
 * ## The defect these exist for
 *
 * `Stamps & Certifications` drew the approved Aurixa impression — a five-layer
 * struck die with the emblem watermark, its own shape, its org, its timestamp
 * and its actor. The Digital Passport's `Certification Seals` leaf drew a
 * generic wax blob, because `buildBooklet` flattened every stamp to
 * `{t, cap, tone, earned}` on the way to the page. That projection dropped the
 * code, the org, the timestamp, the actor, the version, the die shape and the
 * provenance, and re-read the vocabulary tone as a *different* five-value
 * palette belonging to another component. Two surfaces, one certification, two
 * drawings of it — and nothing in the type system to notice.
 *
 * The fix is not a paper-flavoured copy of the face. It is that the booklet
 * carries the `PassportStamp` OBJECTS and hands them to the same components
 * the register uses, so the surfaces are one implementation with one source.
 * These tests pin that: same stamps, same faces, same wording, same metadata,
 * and a newly earned certification reaching both with no other change.
 */
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  buildBooklet,
  buildPassportView,
  type PassportView,
  type PassportViewInput,
} from '@/lib/aml/passport';
import { StampsPage } from './pagesRecord';
import { BookletLeaf } from './PassportBook';

const NOW = '2026-08-13T10:00:00Z';
const LATER = '2026-08-14T09:30:00Z';

function input(over: Partial<PassportViewInput> = {}): PassportViewInput {
  return {
    issuer_org: 'Naidu Property Consulting Services',
    officer_label: 'P. Naidu · MLRO',
    case: {
      id: 'c1', case_reference: 'AML-2026-1184', subject_display_name: 'Meridian Coast Holdings',
      subject_type: 'entity', status: 'kyc_in_progress', case_stage: 'verification',
      service_gate_status: 'pending', opened_at: '2026-08-01T00:00:00Z', closed_at: null,
    },
    attestations: [],
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
      attestations: [],
      consents: [{ id: 'c1', kind: 'privacy_notice', accepted_at: NOW, actor_label: 'client@example.com' }],
      verification_checks: [], documents: [], screening_subjects: [], owners: [],
      source_of_funds: [], source_of_wealth: [], edd_cases: [], grants: [],
      assessments: [], refresh_obligations: [], transactions: [],
    },
    ...over,
  };
}

/** The case once an identity check has passed — a second certification earned. */
const withIdentity = (): Partial<PassportViewInput> => ({
  stamp_input: {
    ...input().stamp_input,
    verification_checks: [{
      id: 'v1', party_label: 'Director', check_type: 'electronic_idv',
      status: 'passed', completed_at: LATER,
    }],
  },
});

const viewFor = (over: Partial<PassportViewInput> = {}, audience: 'command' | 'client' = 'command') =>
  buildPassportView(audience, input(over));

/** The booklet's Certification Seals leaf, rendered as the reader sees it. */
function renderLeaf(view: PassportView) {
  const page = buildBooklet(view).find((p) => p.id === 'seals');
  if (!page) throw new Error('the booklet has no Certification Seals leaf');
  return render(<BookletLeaf page={page} />);
}

/** Every impression on a surface, as {title, shape, tone, struck}. */
function impressions(root: HTMLElement) {
  return [...root.querySelectorAll('.passport-stamp')].map((el) => {
    const cls = [...el.classList];
    return {
      title: el.querySelector('.passport-stamp__title')?.textContent ?? '',
      shape: cls.find((c) => /^passport-stamp--(circle|rect|seal)$/.test(c)) ?? '',
      tone: cls.find((c) => /^passport-stamp--(gold|partner|final)$/.test(c)) ?? '',
      struck: !cls.includes('passport-stamp--pending'),
    };
  });
}

describe('certification parity — register page vs Digital Passport leaf', () => {
  it('draws the SAME impressions, in the same dies and the same inks', () => {
    const view = viewFor(withIdentity());
    const register = render(<StampsPage view={view} />);
    const leaf = renderLeaf(view);

    const onPage = impressions(register.container);
    const onLeaf = impressions(leaf.container);

    // The register holds the settlement stamp back for its own closing panel;
    // nothing else may differ, in any field.
    expect(onLeaf.length).toBeGreaterThan(0);
    expect(onLeaf).toEqual(onPage);
  });

  it('the leaf strikes the approved Aurixa die, not a second drawing of one', () => {
    // Every layer the design is built around has to survive the change of
    // surface — above all the watermark, which is the mark of the system that
    // struck the impression.
    const leaf = renderLeaf(viewFor(withIdentity()));
    const struck = leaf.container.querySelector('.passport-stamp:not(.passport-stamp--pending)')!;

    const watermark = struck.querySelector('.passport-stamp__watermark') as HTMLElement;
    expect(watermark).not.toBeNull();
    // Masked and inked, so it survives cream paper as well as the dark
    // register — the surface change that used to erase it entirely.
    expect(watermark.style.getPropertyValue('--stamp-watermark-src'))
      .toContain('/brand/aurixa-emblem-240.png');
    expect(struck.querySelector('.passport-stamp__grain')).not.toBeNull();
    expect(struck.querySelector('.passport-stamp__burnish')).not.toBeNull();
    expect(struck.querySelector('.passport-stamp__tick')).not.toBeNull();
    expect(struck.querySelector('.passport-stamp__inner')).not.toBeNull();

    // And the wax blob it replaces is gone from the certification leaf.
    expect(leaf.container.querySelector('.passport-wax')).toBeNull();
  });

  it('carries the metadata an auditor asks for onto the page', () => {
    const leaf = renderLeaf(viewFor());
    const struck = leaf.container.querySelector('.passport-stamp:not(.passport-stamp--pending)')!;
    const slot = struck.closest('.passport-stamp-leaf__slot')!;

    // Type, issuing organisation, the date of the underlying record, the actor,
    // and the portal the record came from.
    expect(within(struck as HTMLElement).getByText('CLIENT CONSENT RECORDED')).toBeInTheDocument();
    expect(struck.querySelector('.passport-stamp__orgname')?.textContent)
      .toBe('Naidu Property Consulting Services');
    expect(struck.querySelector('.passport-stamp__date')?.textContent).toMatch(/2026/);
    expect(struck.querySelector('.passport-stamp__sub')?.textContent).toContain('client@example.com');
    expect(within(slot as HTMLElement).getByText('Client Portal')).toBeInTheDocument();
  });

  it('an unearned certification stays an empty impression on the leaf too', () => {
    const leaf = renderLeaf(viewFor());
    const unstruck = leaf.container.querySelector('.passport-stamp--pending')!;

    expect(unstruck.querySelector('.passport-stamp__watermark')).toBeNull();
    expect(unstruck.getAttribute('aria-label')).toMatch(/not yet earned/i);
    expect(unstruck.closest('button')).toBeNull();
    // It must never carry a date it has not earned.
    expect(unstruck.querySelector('.passport-stamp__date')?.textContent).toBe('NOT YET EARNED');
  });

  it('a newly earned certification reaches the passport with no other change', () => {
    // The propagation requirement, stated as a difference between two views
    // built from the same code: earning a stamp is the ONLY input that moves.
    const before = renderLeaf(viewFor());
    const beforeStruck = impressions(before.container).filter((s) => s.struck).map((s) => s.title);
    expect(beforeStruck).toEqual(['CLIENT CONSENT RECORDED']);

    const after = renderLeaf(viewFor(withIdentity()));
    const afterStruck = impressions(after.container).filter((s) => s.struck).map((s) => s.title);
    expect(afterStruck).toEqual(['CLIENT CONSENT RECORDED', 'IDENTITY VERIFIED']);

    // And it left the outstanding side: a certification is never on both.
    const stillPending = impressions(after.container).filter((s) => !s.struck).map((s) => s.title);
    expect(stillPending).not.toContain('IDENTITY VERIFIED');
  });

  it('the booklet re-derives nothing — it carries the register’s own records', () => {
    // The structural half of the guarantee. If the block held a projection the
    // two surfaces could drift again the moment one of them was edited; holding
    // the objects themselves makes that unrepresentable.
    const view = viewFor(withIdentity());
    const block = buildBooklet(view)
      .find((p) => p.id === 'seals')!
      .blocks.find((b) => b.kind === 'seals');
    if (block?.kind !== 'seals') throw new Error('no seals block');

    expect(block.earned).toBe(view.stamps);
    expect(block.pending).toBe(view.pending_stamps);
    expect(block.issuer_org).toBe(view.header.issuer_org);
    // Provenance survives onto the leaf's data, which is what lets Command open
    // the record behind an impression.
    for (const s of block.earned) expect(s.source).toBeTruthy();
  });

  it('the client’s booklet certifies only what the client may see', () => {
    // Audience is decided once, in the projection, and the booklet inherits it.
    // A leaf that re-filtered would be a second place for that rule to be wrong.
    const clientView = viewFor({
      stamp_input: { ...input().stamp_input, edd_cases: [{ status: 'completed', completed_at: NOW }] },
    }, 'client');
    const commandView = viewFor({
      stamp_input: { ...input().stamp_input, edd_cases: [{ status: 'completed', completed_at: NOW }] },
    }, 'command');

    const titles = (v: PassportView) =>
      impressions(renderLeaf(v).container).map((s) => s.title);

    expect(titles(commandView)).toContain('ENHANCED DUE DILIGENCE COMPLETED');
    expect(titles(clientView)).not.toContain('ENHANCED DUE DILIGENCE COMPLETED');
  });
});
