/**
 * Client Portal — which step an open AML request opens.
 *
 * ## The defect this exists to fix
 *
 * Routing used to key off `action_code` alone, so every
 * `complete_identity_verification` request opened the electronic capture step
 * — including the ones the Command Centre created *because* no provider was
 * available. Clients saw "Step 2 — take a photo of yourself" while the server
 * refused submission with "Electronic verification is not available for your
 * case", and the capture flow's submit needs a selfie that route can never
 * produce. Contradictory copy, and a dead end.
 *
 * `action_target.target_step` is what the Command Centre already resolved from
 * provider readiness when it created the request. It is authoritative here.
 *
 * ## Safety rules
 *
 *  - an electronic target is downgraded to manual upload when the provider is
 *    no longer available, so nobody is parked in a flow that cannot submit;
 *  - a missing or unrecognised target resolves to manual upload — the route
 *    that always works — never to capture;
 *  - only values in `TARGET_STEPS` are ever honoured, so a URL-shaped or
 *    otherwise crafted target is ignored rather than followed.
 */
import { CLIENT_ACTIONS } from
  '../../../supabase/functions/_shared/aml/clientRequestContract.pure';

/**
 * Closed vocabulary → button copy + the portal step each opens.
 *
 * DERIVED from the shared contract rather than restated. This list and the one
 * the server writes with must agree, and they did not have to: three
 * independent copies existed, so a code accepted by the writer could be a code
 * this router has no entry for — which reaches the client as a request with no
 * button, and nothing anywhere reports it.
 */
export const REQUEST_ACTIONS: Record<string, { label: string; step: string }> =
  Object.fromEntries(
    Object.entries(CLIENT_ACTIONS).map(([code, a]) => [code, { label: a.label, step: a.step }]),
  );

/**
 * The `target_step` values that mean something to the IDENTITY branch below.
 *
 * Deliberately narrower than the contract's storable vocabulary: this decides
 * electronic capture versus manual upload, and every other value — including a
 * perfectly valid `documents` or `review` — must fall to manual, which is what
 * `null` does here. Widening it to the full contract list would silently stop
 * unknown targets falling back.
 */
export const TARGET_STEPS = ['identity_verification', 'upload_document'] as const;
export type RequestTargetStep = (typeof TARGET_STEPS)[number];

/** Client-safe readiness, as `aml-client-portal` projects it. */
export type IdvAvailability =
  | 'available' | 'temporarily_unavailable' | 'manual_verification_required';

export interface PortalOpenRequest {
  action_code?: string | null;
  action_target?: { target_step?: string | null; section_code?: string | null } | null;
}

export interface ResolvedRequestRoute {
  step: string;
  label: string;
  /** The request wanted electronic capture but cannot have it — say so. */
  manualFallback: boolean;
}

export function resolveRequestStep(
  request: PortalOpenRequest,
  availability: IdvAvailability | null,
): ResolvedRequestRoute {
  const action = REQUEST_ACTIONS[String(request.action_code ?? '')] ?? null;
  if (!action) return { step: 'respond', label: 'Respond', manualFallback: false };

  if (request.action_code !== 'complete_identity_verification') {
    return { step: action.step, label: action.label, manualFallback: false };
  }

  const raw = request.action_target?.target_step;
  const target = (TARGET_STEPS as readonly string[]).includes(String(raw))
    ? (String(raw) as RequestTargetStep)
    : null;

  // Electronic capture only when the request asked for it AND a provider can
  // actually examine the result. Every other combination is manual upload.
  if (target === 'identity_verification' && availability === 'available') {
    return { step: 'verify', label: action.label, manualFallback: false };
  }

  return {
    step: 'documents',
    label: 'Upload identity document',
    manualFallback: target === 'identity_verification' || target === null,
  };
}
