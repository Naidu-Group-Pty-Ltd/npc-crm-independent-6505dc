/**
 * Solicitor Portal client-side API wrapper.
 *
 * Mirrors the Finance Portal transport: cookie-authenticated edge invocation using an HttpOnly portal-scoped session so the Command Centre,
 * Client Portal, Finance Portal and Solicitor Portal never share a session.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


export interface SolicitorPortalUser {
  id: string;
  firm_id: string;
  email: string;
  name: string;
  phone: string | null;
  position: string | null;
  portal_role: string;
  firm_name: string | null;
  practising_states: string[];
  has_accepted_terms: boolean;
  has_completed_onboarding: boolean;
  must_change_password: boolean;
  current_terms_version: string | null;
  has_accepted_current_terms: boolean;
  has_completed_mandatory_onboarding: boolean;
}

/**
 * The Solicitor Portal's mandatory acknowledgments are the Portal Agreement's
 * acknowledgments — the same four the Builder/Developer and Finance portals
 * present. They live in `@/lib/portalAgreement` so that one agreement cannot
 * end up with three lists; these aliases stay so the Solicitor Portal's own
 * modules keep reading in its own vocabulary.
 */
export {
  PORTAL_TERMS_ACKNOWLEDGEMENTS as SOLICITOR_TERMS_ACKNOWLEDGEMENTS,
} from './portalAgreement';
export type { PortalAcknowledgementKey as SolicitorAcknowledgementKey } from './portalAgreement';

export async function invokeSolicitorFunction<T = any>(
  functionName: string,
  body: Record<string, unknown> = {},
  options: { signal?: AbortSignal } = {},
): Promise<{ data: T | null; error: { message: string; code?: string; status?: number } | null }> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'X-Portal-Request': 'solicitor-portal',
      },
      credentials: 'include',
      signal: options.signal,
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { data, error: { message: (data as any)?.error || `HTTP ${response.status}`, code: (data as any)?.code, status: response.status } };
    }
    return { data, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error?.message || 'Network error' } };
  }
}
