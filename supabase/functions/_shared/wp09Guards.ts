/**
 * WP-09 — shared guards for high-value transactional surfaces:
 *   - manage-generated-documents (WP-09A: docs + DocuSign)
 *   - manage-compliance-records  (WP-09B)
 *   - manage-commission-ledger    (WP-09B)
 *   - generate-commission-payout  (WP-09B, maker/checker)
 *
 * All helpers are pure/deterministic where possible. Runtime checks fail
 * closed. Callers must NOT bypass with untrusted body fields.
 */

export const GENERATED_DOC_BUCKET_ALLOWLIST = new Set<string>([
  'client-documents',
  'generated-documents',
  'compliance-records',
]);

/** Server-side bucket resolver — caller-supplied bucket is IGNORED. */
export function resolveDocumentBucket(templateType?: string | null): string {
  if (templateType && /compliance/i.test(templateType)) return 'compliance-records';
  return 'generated-documents';
}

// ─── Generated-document state machine ──────────────────────────────────────
export type DocStatus =
  | 'draft' | 'prepared' | 'approved' | 'sent' | 'delivered' | 'viewed'
  | 'signed' | 'declined' | 'voided' | 'cancelled';

const DOC_TRANSITIONS: Record<DocStatus, DocStatus[]> = {
  draft:     ['prepared', 'approved', 'cancelled'],
  prepared:  ['approved', 'cancelled', 'draft'],
  approved:  ['sent', 'cancelled', 'draft'],
  sent:      ['delivered', 'viewed', 'signed', 'declined', 'voided'],
  delivered: ['viewed', 'signed', 'declined', 'voided'],
  viewed:    ['signed', 'declined', 'voided'],
  signed:    [],  // terminal
  declined:  [],  // terminal
  voided:    [],  // terminal
  cancelled: [],  // terminal
};

export function isValidDocTransition(from: DocStatus | null | undefined, to: DocStatus): boolean {
  if (!from) return to === 'draft' || to === 'prepared';
  const allowed = DOC_TRANSITIONS[from as DocStatus];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** Human-callable fields for update_status. Signed-envelope fields NOT included. */
export const DOC_STATUS_HUMAN_FIELDS = new Set([
  'status', 'title', 'notes',
]);

/** Fields humans can NEVER set (service/webhook-only). */
export const DOC_SERVICE_ONLY_FIELDS = new Set([
  'docusign_envelope_id', 'docusign_status',
  'signed_pdf_storage_path', 'pdf_hash',
  'sent_at', 'viewed_at', 'signed_at', 'voided_at',
  'sent_to', 'audit', 'generated_by',
]);

/** Whitelist for `update` — anything else is silently dropped. */
export const DOC_UPDATE_ALLOWED_FIELDS = new Set([
  'title', 'notes', 'metadata', 'pdf_storage_path', 'template_type', 'template_id',
  'client_id', 'deal_id', 'submission_id',
]);

// ─── Compliance record FSM ────────────────────────────────────────────────
export const COMPLIANCE_SERVICE_ONLY_FIELDS = new Set([
  'signed_at', 'signed_by_name', 'docusign_status', 'signed_pdf_storage_path',
  'version', 'is_current', 'generated_by', 'docusign_envelope_id',
]);

export const COMPLIANCE_STATUS_ALLOWED_HUMAN: Record<string, string[]> = {
  draft:     ['ready', 'archived'],
  ready:     ['sent', 'archived'],
  sent:      ['archived'],
  signed:    ['archived'],
  archived:  [],
};

export function isValidComplianceStatusTx(from: string | null | undefined, to: string): boolean {
  if (!from) return to === 'draft';
  const allowed = COMPLIANCE_STATUS_ALLOWED_HUMAN[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

// ─── Commission ledger sanitizer ──────────────────────────────────────────
export const LEDGER_UPDATE_ALLOWED_FIELDS = new Set([
  'broker_name', 'lender_name', 'notes', 'expected_date',
  'gross_amount', 'gst_amount', 'net_amount', 'commission_type',
  'reference',
]);

/** Service/state-only — callers cannot mutate on update. */
export const LEDGER_SERVICE_ONLY_FIELDS = new Set([
  'status', 'received_date', 'reconciled_date',
  'broker_id', 'deal_id', 'client_id', 'lender_id',
  'created_by',
]);

// ─── Generic sanitizer ────────────────────────────────────────────────────
export function pickAllowed<T extends Record<string, unknown>>(
  input: T | null | undefined,
  allowed: Set<string>,
  denied?: Set<string>,
): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (denied && denied.has(k)) continue;
    if (!allowed.has(k)) continue;
    out[k] = v;
  }
  return out;
}

// ─── Resource-ownership access check (best-effort) ────────────────────────
/**
 * Verifies the caller can access a generated document. Superadmin bypasses.
 * Otherwise we require ONE of:
 *   - caller is `generated_by`
 *   - client_id is assigned to caller via finance_portal_client_assignments
 *   - deal_id belongs to a client assigned to caller
 */
export async function resolveGeneratedDocumentAccess(
  supabase: any,
  userId: string,
  isSuper: boolean,
  doc: { generated_by?: string | null; client_id?: string | null; deal_id?: string | null } | null,
): Promise<{ ok: boolean; reason?: string }> {
  if (!doc) return { ok: false, reason: 'not_found' };
  if (isSuper) return { ok: true };
  if (doc.generated_by === userId) return { ok: true };
  if (doc.client_id) {
    const { data } = await supabase
      .from('finance_portal_client_assignments')
      .select('id')
      .eq('client_id', doc.client_id)
      .eq('finance_user_id', userId)
      .maybeSingle();
    if (data) return { ok: true };
  }
  return { ok: false, reason: 'resource_denied' };
}

// ─── PDF hashing ──────────────────────────────────────────────────────────
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `Uint8Array<ArrayBufferLike>` is not assignable to `BufferSource`, because
  // `ArrayBufferLike` admits `SharedArrayBuffer` and WebCrypto will not accept
  // one. Copying into a plain `Uint8Array` narrows the buffer type honestly
  // rather than asserting past the check — and a hash input is small.
  const view = new Uint8Array(bytes);
  const buf = await crypto.subtle.digest('SHA-256', view);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Idempotency ──────────────────────────────────────────────────────────
export function normalizeIdempotencyKey(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length < 8 || t.length > 128) return null;
  if (!/^[A-Za-z0-9_.:-]+$/.test(t)) return null;
  return t;
}

// ─── Recipient bounds ─────────────────────────────────────────────────────
export const MAX_FREEFORM_RECIPIENTS = 10;
export const MAX_FREEFORM_TABS = 200;
export const MAX_EMAIL_LEN = 254;

export function validateEmail(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_EMAIL_LEN) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
