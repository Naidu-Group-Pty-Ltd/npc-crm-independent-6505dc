/**
 * The cover, as a record miniature.
 *
 * The point of this component is that there is no "thumbnail version" of the
 * cover — it draws the real front board and scales it. These tests pin that
 * property, because the failure mode it prevents is silent: a simplified copy
 * looks fine on the day it is written and drifts from the document afterwards.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildPassportView, type PassportViewInput } from '@/lib/aml/passport';
import { PassportCoverThumb } from './PassportBook';

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

const viewFor = (over: Partial<PassportViewInput> = {}) =>
  buildPassportView('command', input(over));

describe('PassportCoverThumb', () => {
  it('draws the approved cover artwork, not a placeholder', () => {
    const { container } = render(<PassportCoverThumb view={viewFor()} />);

    // The real board: emblem, wordmark, engraved frames, diamond rule, clasp.
    // The surface it replaced drew a navy rectangle with "AUX·AML" set in it.
    const board = container.querySelector('.passport-cover--board');
    expect(board).not.toBeNull();
    expect(board!.querySelector('img')).toHaveAttribute('src', '/brand/aurixa-emblem.png');
    expect(board).toHaveTextContent('Aurixa');
    expect(board).toHaveTextContent('AML/CTF');
    expect(container.querySelector('.passport-cover__frame')).not.toBeNull();
    expect(container.querySelector('.passport-cover__frame-inner')).not.toBeNull();
    expect(container.querySelector('.passport-cover__clasp')).not.toBeNull();
    expect(container).not.toHaveTextContent('AUX·AML');
  });

  it('reflects the customer it was given, and nothing is baked in', () => {
    const first = render(<PassportCoverThumb view={viewFor()} />);
    expect(first.container).toHaveTextContent('Meridian Coast Holdings');
    expect(first.container).toHaveTextContent('AUX-AML-2026-1184-V1');

    first.unmount();

    const second = render(
      <PassportCoverThumb
        view={viewFor({
          case: {
            id: 'c2', case_reference: 'AML-2026-2201', subject_display_name: 'Harriet Vance',
            subject_type: 'individual', status: 'in_progress', case_stage: 'verification',
            service_gate_status: 'pending', opened_at: '2026-08-02T00:00:00Z', closed_at: null,
          },
        })}
      />,
    );
    expect(second.container).toHaveTextContent('Harriet Vance');
    expect(second.container).not.toHaveTextContent('Meridian Coast Holdings');
  });

  it('takes its size from ONE number, so box and scale cannot disagree', () => {
    // The box width and the scale factor are both derived from
    // `--passport-thumb-w` in the stylesheet. Setting a width here must move
    // that one property and nothing else — a component that also wrote a
    // pixel width or a transform would be the second source of truth this
    // design exists to remove.
    const { container } = render(<PassportCoverThumb view={viewFor()} width={132} />);
    const thumb = container.querySelector<HTMLElement>('.passport-cover-thumb');
    const art = container.querySelector<HTMLElement>('.passport-cover-thumb__art');

    expect(thumb!.style.getPropertyValue('--passport-thumb-w')).toBe('132');
    expect(thumb!.style.width).toBe('');
    expect(art!.style.transform).toBe('');
    expect(art!.style.width).toBe('');
  });

  it('leaves the size to the stylesheet when none is asked for', () => {
    const { container } = render(<PassportCoverThumb view={viewFor()} />);
    expect(container.querySelector<HTMLElement>('.passport-cover-thumb')!.getAttribute('style'))
      .toBeNull();
  });

  it('does not announce the cover text a second time', () => {
    // Whatever frames the miniature already states bearer, credential and
    // state at full size; the control beside it carries the name.
    const { container } = render(
      <span className="passport-cover-thumb__slot">
        <PassportCoverThumb view={viewFor()} />
        <button type="button" aria-label="View the digital passport" className="passport-cover-thumb__open" />
      </span>,
    );
    expect(container.querySelector('.passport-cover-thumb__art')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'View the digital passport' })).toBeInTheDocument();
  });

  it('renders no interactive element of its own', () => {
    // It is presentation. The control that opens the booklet overlays it —
    // a <button> may not contain a <section> of headings, which is what the
    // board is, so the artwork must never be nested inside one.
    const { container } = render(<PassportCoverThumb view={viewFor()} />);
    expect(container.querySelector('button, a, input')).toBeNull();
  });

  it('carries the class the aspect ratio is defined on', () => {
    // The 470:648 ratio lives in passport-tokens.css on this class. Losing the
    // class is how a cover silently becomes a square.
    const { container } = render(<PassportCoverThumb view={viewFor()} />);
    expect(container.querySelector('.passport-cover-thumb')).not.toBeNull();
  });
});
