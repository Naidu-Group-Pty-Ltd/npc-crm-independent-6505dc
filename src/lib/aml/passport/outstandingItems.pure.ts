/**
 * What the Passport is still waiting for — derived, never stored.
 *
 * The Command Centre's complaint that this exists to answer: an operator can
 * see on the Verification page that facial match was never performed, then has
 * to leave, remember it, open Requests, choose a generic type and retype the
 * whole thing in the client's words. The system already knows what is missing.
 * It should offer to ask for it.
 *
 * ## Rules
 *
 *  - **Derived from the projection, never a second status.** Every item here is
 *    read out of the `PassportView` the server already built. Nothing is
 *    stored, nothing is a new readiness column, and turning this off changes no
 *    record.
 *  - **A client-safe message or nothing.** Each item carries the sentence the
 *    CLIENT will read. It names the thing needed, in their words. It never
 *    carries the internal reason — no risk band, no screening finding, no
 *    reviewer note — because that message is transmitted verbatim.
 *  - **Whose move it is, stated.** An item is blocked on the client, on staff,
 *    or on nobody. An operator who cannot tell the difference chases the wrong
 *    party, and asking a client for something already sitting in a review queue
 *    is worse than asking for nothing.
 */
import type { PassportView } from './index';
import type { ClientActionCode } from
  '../../../../supabase/functions/_shared/aml/clientRequestContract.pure';

/** Who the next move belongs to. */
export type ActionOwner = 'client' | 'staff' | 'mlro' | 'none';

export interface OutstandingItem {
  /** Stable identity for lists and tests. */
  key: string;
  /** What an OPERATOR calls it. */
  title: string;
  /** Why it is outstanding, for the operator. May be internal. */
  detail: string;
  owner: ActionOwner;
  /** The Passport page that shows the underlying facts, when there is one. */
  page?: string;
  /** Present when this is something the client can be asked for. */
  request?: {
    action: ClientActionCode;
    subject: string;
    /** The CLIENT-facing message. Plain English. Never an internal reason. */
    message: string;
    /** Routing hint, validated server-side against the closed vocabulary. */
    target?: { target_step?: string; section_code?: string; requirement_id?: string };
  };
}

/** Groups for the summary line (§15). */
export interface OutstandingSummary {
  total: number;
  awaitingClient: number;
  awaitingStaff: number;
  awaitingMlro: number;
}

/**
 * The IDV components a Passport reports, and what to ask the client for when
 * one has not been performed. All four are answered by the same client action —
 * the client completes verification once and every component it produces lands
 * together — so they collapse into a single request rather than four.
 */
const IDV_REQUEST = {
  action: 'complete_identity_verification' as ClientActionCode,
  subject: 'Complete your identity verification',
  message:
    'We need you to complete your identity verification so we can finish your compliance checks. ' +
    'It takes a few minutes and you can do it on your phone.',
  target: { target_step: 'identity_verification' },
};

export function deriveOutstandingItems(view: PassportView): OutstandingItem[] {
  const items: OutstandingItem[] = [];

  /* ── identity verification ──────────────────────────────────────────── */
  const parties = view.verification?.parties ?? [];
  const anyIncomplete = parties.some(
    (p) => !p.verified || (p.components ?? []).some((c) => c.status !== 'passed'),
  );
  if (parties.length === 0 || anyIncomplete) {
    items.push({
      key: 'verification_incomplete',
      title: 'Identity verification incomplete',
      detail: parties.length === 0
        ? 'No verification has been recorded for this customer.'
        : 'One or more verification components have not been performed.',
      owner: 'client',
      page: 'verification',
      request: IDV_REQUEST,
    });
  }

  /* ── documents ──────────────────────────────────────────────────────── */
  const docs = view.documents ?? [];
  const missing = docs.filter(
    (d) => d.required && (d.status === 'requested' || d.status === 'missing' || !d.status),
  );
  for (const d of missing) {
    const label = d.label || 'a supporting document';
    items.push({
      key: `document_${d.id}`,
      title: `Document outstanding — ${label}`,
      detail: 'The requirement has no accepted document against it.',
      owner: 'client',
      page: 'evidence',
      // `id` is the DOCUMENT row, never the requirement, so it is deliberately
      // NOT sent as `requirement_id`: a wrong routing id opens the wrong
      // upload, and the server would reject a non-uuid anyway. The step alone
      // lands the client on Documents, which is the honest destination.
      request: {
        action: 'upload_document',
        subject: `Please upload ${label}`,
        message:
          `We still need ${label} to complete your file. You can upload a clear photo or a PDF.`,
        target: { target_step: 'documents' },
      },
    });
  }

  const awaitingReview = docs.filter((d) => d.status === 'pending_review');
  if (awaitingReview.length > 0) {
    items.push({
      key: 'documents_awaiting_review',
      title: `${awaitingReview.length} document${awaitingReview.length === 1 ? '' : 's'} awaiting review`,
      detail: 'The client has supplied evidence that has not yet been accepted or rejected.',
      owner: 'staff',
      page: 'evidence',
    });
  }

  /* ── client requests already open ───────────────────────────────────── */
  // `open_requests` is what the projection publishes; there is no separate
  // client_requests array on the view.
  const openReqs = (view.open_requests ?? []).filter((r) => r.status === 'open');
  const responded = (view.open_requests ?? []).filter((r) => r.status === 'responded');
  if (openReqs.length > 0) {
    items.push({
      key: 'requests_awaiting_client',
      title: `${openReqs.length} request${openReqs.length === 1 ? '' : 's'} awaiting the client`,
      detail: 'Already asked. The client has not responded yet.',
      owner: 'client',
    });
  }
  if (responded.length > 0) {
    items.push({
      key: 'requests_awaiting_staff',
      title: `${responded.length} client response${responded.length === 1 ? '' : 's'} to review`,
      detail: 'The client has answered. Somebody needs to look at it.',
      owner: 'staff',
    });
  }

  /* ── the Passport itself ────────────────────────────────────────────── */
  const state = view.header?.state?.code ?? null;
  if (state === 'ready_for_issuance') {
    items.push({
      key: 'ready_for_issuance',
      title: 'Ready for issuance',
      detail: 'Every prerequisite the issuance gate checks is satisfied.',
      owner: 'mlro',
    });
  } else if (state === 'refresh_required' || state === 'superseded') {
    items.push({
      key: 'refresh_required',
      title: 'A new version is required',
      detail: 'Material inputs changed after the current version was issued.',
      owner: 'mlro',
    });
  }

  return items;
}

export function summariseOutstanding(items: OutstandingItem[]): OutstandingSummary {
  return {
    total: items.length,
    awaitingClient: items.filter((i) => i.owner === 'client').length,
    awaitingStaff: items.filter((i) => i.owner === 'staff').length,
    awaitingMlro: items.filter((i) => i.owner === 'mlro').length,
  };
}

/**
 * The headline (§15). Says what is in the way, and whose move it is — never
 * "AML complete", which is a claim no derived count can support.
 */
export function outstandingHeadline(
  view: PassportView, s: OutstandingSummary,
): { title: string; detail: string } {
  const state = view.header?.state?.code ?? null;
  if (String(state) === 'current' || String(state) === 'issued_current') {
    return {
      title: 'Passport current',
      detail: 'The issued version is the current one. Partners may be given access to it.',
    };
  }
  if (s.total === 0) {
    return {
      title: 'Nothing outstanding',
      detail: 'No compliance item on this Passport is waiting on anybody.',
    };
  }
  const parts: string[] = [];
  if (s.awaitingClient > 0) parts.push(`${s.awaitingClient} awaiting the client`);
  if (s.awaitingStaff > 0) parts.push(`${s.awaitingStaff} awaiting staff review`);
  if (s.awaitingMlro > 0) parts.push(`${s.awaitingMlro} awaiting an MLRO decision`);
  return {
    title: state === 'ready_for_issuance' ? 'Ready for issuance' : 'Passport not yet issued',
    detail: `${s.total} compliance item${s.total === 1 ? '' : 's'} remain — ${parts.join(', ')}.`,
  };
}
