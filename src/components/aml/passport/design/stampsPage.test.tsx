/**
 * Stamps & Certifications — the page shows the whole set.
 *
 * The defect these pin: the page drew earned stamps and stopped, so a case
 * one certification into a fourteen-certification programme and a case whose
 * programme *is* one certification rendered identically. Production has five
 * cases; the best-covered earns two stamps and one earns none.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildPassportView, type PassportViewInput } from '@/lib/aml/passport';
import { StampsPage } from './pagesRecord';

const NOW = '2026-08-13T10:00:00Z';

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
      consents: [{ id: 'c1', kind: 'privacy_notice', accepted_at: NOW }],
      verification_checks: [], documents: [], screening_subjects: [], owners: [],
      source_of_funds: [], source_of_wealth: [], edd_cases: [], grants: [],
      assessments: [], refresh_obligations: [], transactions: [],
    },
    ...over,
  };
}

const pageFor = (over: Partial<PassportViewInput> = {}) =>
  render(<StampsPage view={buildPassportView('command', input(over))} />);

describe('StampsPage', () => {
  it('shows the outstanding certifications, not only the earned one', () => {
    // One consent accepted and nothing else — which is close to the shape of
    // every live case in production today.
    const { container } = pageFor();

    expect(screen.getByText('CLIENT CONSENT RECORDED')).toBeInTheDocument();
    // The rest of the programme is drawn as empty impressions. Each title
    // appears twice — on the impression, and in the panel that says what it
    // is waiting for.
    expect(screen.getAllByText('IDENTITY VERIFIED')).toHaveLength(2);
    expect(screen.getAllByText('PASSPORT ISSUED')).toHaveLength(2);
    expect(container.querySelectorAll('.passport-stamp--pending').length).toBeGreaterThan(3);
  });

  it('counts the set rather than just the earned half', () => {
    pageFor();
    expect(screen.getByText(/\b1 of \d+ earned/)).toBeInTheDocument();
  });

  it('an outstanding impression is not a button and says it is unearned', () => {
    // Nothing to open — there is no record behind it. And the distinction is
    // in words, not only in the dashed border, so it survives a screen reader.
    const { container } = pageFor();
    const pending = container.querySelector('.passport-stamp--pending')!;
    expect(pending.tagName).not.toBe('BUTTON');
    expect(pending.closest('button')).toBeNull();
    expect(pending.getAttribute('aria-label')).toMatch(/not yet earned/i);
  });

  it('captions each earned stamp with the portal its record came from', () => {
    const { container } = pageFor();
    const earned = container.querySelector('.passport-stamp:not(.passport-stamp--pending)')!;
    expect(within(earned.closest('.passport-stamp-button')!).getByText('Client Portal'))
      .toBeInTheDocument();
  });

  it('every struck impression carries the Aurixa watermark', () => {
    // The layer the approved design is built around, and the one the previous
    // face omitted entirely: an impression carries the mark of the system that
    // struck it. An unstruck die does not — nothing pressed it.
    //
    // The emblem is the MASK now and the impression's ink is the fill, so the
    // assertion is on the mask source rather than on an `<img src>`. That is
    // the change that made the layer visible at all: as an image under
    // `mix-blend-mode: screen` it was erased by the cream leaf and lost in the
    // dark register.
    const { container } = pageFor();
    const struck = container.querySelector('.passport-stamp:not(.passport-stamp--pending)')!;
    const watermark = struck.querySelector('.passport-stamp__watermark') as HTMLElement;
    expect(watermark).not.toBeNull();
    expect(watermark.getAttribute('data-emblem')).toBe('/brand/aurixa-emblem-240.png');
    expect(watermark.style.getPropertyValue('--stamp-watermark-src'))
      .toContain('/brand/aurixa-emblem-240.png');
    expect(struck.querySelector('.passport-stamp__grain')).not.toBeNull();
    expect(struck.querySelector('.passport-stamp__inner')).not.toBeNull();

    const unstruck = container.querySelector('.passport-stamp--pending')!;
    expect(unstruck.querySelector('.passport-stamp__watermark')).toBeNull();
  });

  it('inks a stamp by authority first, then by what it certifies', () => {
    // Consent is the customer's authority and takes its own ink. With
    // nothing else earned, nothing else is struck — so gold, which is the
    // issuer's identity and document work, is absent rather than default.
    const { container } = pageFor();
    expect(container.querySelector('.passport-stamp--violet')).not.toBeNull();
    expect(container.querySelector('.passport-stamp--gold')).toBeNull();
    expect(container.querySelector('.passport-stamp--final')).toBeNull(); // not yet issued
  });

  it('a real register is not one colour', () => {
    // THE defect. `STAMP_VOCABULARY` has carried a per-code tone since it was
    // written and the die threw all of it away, collapsing twenty-two
    // certifications into three inks — so a case with a full programme
    // rendered as a row of gold rectangles and one green circle.
    const { container } = pageFor({
      attestations: [{
        version: 1, issued_at: NOW, superseded_at: null,
        payload_sha256: 'a'.repeat(64), schema_version: 2,
      }],
      stamp_input: {
        issuer_org: 'Naidu Property Consulting Services',
        attestations: [{ version: 1, issued_at: NOW, superseded_at: null }],
        consents: [{ id: 'c1', kind: 'privacy_notice', accepted_at: NOW }],
        verification_checks: [{
          party_label: 'Meridian', check_type: 'electronic_idv',
          status: 'passed', completed_at: NOW,
        }],
        documents: [{ status: 'accepted', reviewed_at: NOW, created_at: NOW }],
        screening_subjects: [{ state: 'completed', completed_at: NOW }],
        owners: [],
        source_of_funds: [{ verified: true, verified_at: NOW }],
        source_of_wealth: [], edd_cases: [], grants: [],
        assessments: [], refresh_obligations: [], transactions: [],
      },
    } as Partial<PassportViewInput>);

    const inks = new Set(
      [...container.querySelectorAll('.passport-stamp:not(.passport-stamp--pending)')]
        .flatMap((el) => [...el.classList])
        .filter((c) => /^passport-stamp--(gold|azure|violet|emerald|final|partner|alert)$/.test(c)),
    );

    // Consent, identity/documents, screening, funding and the issuance —
    // five subjects, and a reader can tell them apart at a glance.
    expect(inks.size).toBeGreaterThanOrEqual(4);
    expect(inks.has('passport-stamp--violet')).toBe(true);   // consent
    expect(inks.has('passport-stamp--gold')).toBe(true);     // identity & documents
    expect(inks.has('passport-stamp--azure')).toBe(true);    // screening
    expect(inks.has('passport-stamp--emerald')).toBe(true);  // funding
    expect(inks.has('passport-stamp--final')).toBe(true);    // the Passport issued
  });

  it('says what each outstanding certification is waiting for', () => {
    pageFor({
      transactions: [{
        id: 't1', kind: 'purchase', status: 'under_contract', property_address: 'Lot 14',
        contract_date: NOW, settlement_date: '2026-10-15T00:00:00Z', purchase_price: 2480000,
      }],
      stamp_input: {
        ...input().stamp_input,
        transactions: [{ id: 't1', status: 'under_contract', settlement_date: '2026-10-15T00:00:00Z' }],
      },
    });
    // The design closes the page with its own panel for the settlement stamp,
    // so it is drawn there rather than in the outstanding list — and it is
    // drawn once, not in both.
    expect(screen.getByText('Final completion stamp — awaiting settlement')).toBeInTheDocument();
    expect(screen.getByText(/Applied on confirmed settlement, expected 15 Oct 2026/))
      .toBeInTheDocument();
    expect(screen.getAllByText(/TRANSACTION\s*COMPLETED/)).toHaveLength(1);
  });

  it('a closed case shows a finished register, not an action list', () => {
    const closed = pageFor({
      case: { ...input().case, status: 'closed', closed_at: NOW },
    });
    expect(closed.container.querySelector('.passport-stamp--pending')).toBeNull();
    expect(screen.queryByText(/still outstanding/)).not.toBeInTheDocument();
  });
});
