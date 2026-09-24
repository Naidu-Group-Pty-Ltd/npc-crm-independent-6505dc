/**
 * Managing assessments as records: starting one, deleting one, finding the
 * ones made of a property, and the client one is being prepared for.
 *
 * ## Why this is not part of `ciAssessmentApi`
 *
 * It talks to the same Edge Function (`manage-ci-assessments`) and could have
 * been more methods on `ciAssessmentApi` in `hooks/useCiAssessments.ts`. It is a
 * module of its own because its callers need more of the answer than that API
 * returns: a refusal carries a reason code AND a body (`archiveOffered` on a
 * refused delete, `existingClient` on a duplicate email), where the editing API
 * reduces a response to its message and code. Keeping the management calls here
 * also leaves the API every assessment step edits through untouched by them. A
 * server that has not yet been redeployed answers "Unknown operation", which
 * every caller below reports as an ordinary error.
 *
 * ## Errors keep their code
 *
 * Every call returns the server's `code` beside its message. The dialogs branch
 * on it — a refusal with a reason is not a failure to reach the server, and a
 * duplicate client is an offer to use the existing record, not an error.
 */

import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { AssessmentListRow, ClientSearchRow } from '@/hooks/useCiAssessments';
import type { DeletionBlock } from './assessmentDeletion';
import type { AssessmentPayload } from './types';

const FUNCTION = 'manage-ci-assessments';

export interface ManagementResult<T> {
  data: T | null;
  error: string | null;
  code?: string;
  /** The whole response body, for the few callers that read beyond `data`. */
  body?: Record<string, unknown> | null;
}

async function call<T>(operation: string, payload: Record<string, unknown>): Promise<ManagementResult<T>> {
  const res = await invokeSecureFunction<Record<string, unknown>>(FUNCTION, { operation, ...payload });
  const body = (res.data ?? null) as Record<string, unknown> | null;
  if (res.error) {
    return {
      data: null,
      error: typeof body?.error === 'string' ? body.error : res.error.message,
      code: res.error.code ?? (typeof body?.code === 'string' ? body.code : undefined),
      body,
    };
  }
  if (body && body.success === false) {
    return {
      data: null,
      error: typeof body.error === 'string' ? body.error : 'Request failed',
      code: typeof body.code === 'string' ? body.code : undefined,
      body,
    };
  }
  return { data: (body?.data ?? null) as T | null, error: null, body };
}

// ---------------------------------------------------------------------------
// Starting an assessment
// ---------------------------------------------------------------------------

export interface CreateAssessmentInput {
  title: string;
  segment: 'commercial' | 'industrial';
  assessmentType: string;
  payload: AssessmentPayload;
}

/**
 * Create a draft. `useStartAssessment` is the only caller: "New assessment"
 * creates on the click and opens the Type step.
 *
 * The server also accepts an `intendedClientId`, recorded as `client_intended`
 * (who the assessment is being prepared for, never a link). Only the "New
 * assessment" dialog sent one, and it went with the dialog. Assessments it
 * started still read it back, through `intendedClient`.
 */
export function createAssessment(input: CreateAssessmentInput) {
  return call<AssessmentListRow>('create', {
    segment: input.segment,
    data: { title: input.title, assessmentType: input.assessmentType },
    payload: input.payload,
  });
}

// ---------------------------------------------------------------------------
// The assessments made of one property
// ---------------------------------------------------------------------------

export async function listAssessmentsForProperty(propertyId: string) {
  const result = await call<AssessmentListRow[]>('list', { propertyId, limit: 100 });
  return { ...result, data: result.data ?? (result.error ? null : []) };
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

export interface DeletionPreview {
  allowed: boolean;
  block: DeletionBlock | null;
  message: string;
  archiveOffered: boolean;
  /** Whether this user holds delete permission on the module at all. */
  permitted: boolean;
  /** A completed assessment is deleted by typing its reference. */
  typedConfirmation: boolean;
  reference: string;
  title: string;
  status: string;
  counts: { calculationRuns: number; scenarios: number };
}

export function previewDeletion(assessmentId: string) {
  return call<DeletionPreview>('deletion_preview', { assessmentId });
}

export function deleteAssessment(assessmentId: string, confirmReference?: string) {
  return call<{ id: string; reference: string }>('delete', {
    assessmentId,
    ...(confirmReference ? { confirmReference } : {}),
  });
}

export function archiveAssessment(assessmentId: string) {
  return call<AssessmentListRow>('archive', { assessmentId });
}

export function restoreAssessment(assessmentId: string) {
  return call<AssessmentListRow>('restore', { assessmentId });
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export interface IntendedClient {
  clientId: string;
  /** Named when the assessment was started, or created from inside it. */
  source: 'intended' | 'created';
  recordedAt: string;
  /** Null when the client exists but is not one this user may reach. */
  client: ClientSearchRow | null;
}

export function intendedClient(assessmentId: string) {
  return call<IntendedClient | null>('intended_client', { assessmentId });
}

export function searchClients(search: string) {
  return call<ClientSearchRow[]>('search_clients', { search });
}

export interface NewClientInput {
  firstName: string;
  surname: string;
  email?: string;
  mobile?: string;
  /** The assessment the client is being created from — written to its audit trail. */
  assessmentId?: string;
}

/**
 * Create a client, and say plainly when one already exists.
 *
 * A duplicate email the user may reach comes back as `existingClient`, so the
 * caller can offer that record instead of an error.
 */
export async function createClient(input: NewClientInput) {
  const result = await call<ClientSearchRow>('create_client', { ...input });
  const existing = result.code === 'DUPLICATE_EMAIL' ? result.body?.existingClient : null;
  return {
    ...result,
    existingClient: existing && typeof existing === 'object' ? existing as ClientSearchRow : null,
  };
}
