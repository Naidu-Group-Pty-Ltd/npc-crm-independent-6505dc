/**
 * Shared helpers for the GHL dual-account migration system.
 * Workers call these to track progress against `migration_jobs` and
 * `migration_job_items`.
 *
 * IMPORTANT: All helpers must be invoked with a service_role Supabase client.
 * They bypass RLS intentionally — workers are the only writers to these tables.
 */

export type MigrationDomain =
  | 'contacts'
  | 'opportunities'
  | 'conversations'
  | 'conversations_replay'
  | 'notes'
  | 'calendar_groups'
  | 'calendars'
  | 'bookings'
  | 'workflows_snapshot'
  | 'workflow_enrollments_backfill'
  | 'workflow_reenroll';
export type MigrationStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type ItemStatus = 'pending' | 'succeeded' | 'failed' | 'skipped';

export interface CreateJobParams {
  domain: MigrationDomain;
  source_account: 'legacy' | 'new';
  target_account: 'legacy' | 'new';
  dry_run: boolean;
  payload?: Record<string, any>;
  created_by?: string | null;
}

export async function createJob(supabase: any, params: CreateJobParams): Promise<string> {
  const { data, error } = await supabase
    .from('migration_jobs')
    .insert({
      domain: params.domain,
      source_account: params.source_account,
      target_account: params.target_account,
      dry_run: params.dry_run,
      payload: params.payload ?? {},
      created_by: params.created_by ?? null,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) throw new Error(`createJob failed: ${error.message}`);
  return data.id as string;
}

export async function startJob(supabase: any, jobId: string, total: number): Promise<void> {
  // ── Resume-clobber guard ───────────────────────────────────────────
  // If we are (re-)starting a job that already has a non-zero total or
  // counters, do NOT overwrite them. A fresh leg legitimately calls
  // startJob() on cold-start; without this guard the second leg would
  // reset progress to zero and the dashboard would jump backwards.
  try {
    const { data: existing } = await supabase
      .from('migration_jobs')
      .select('total_items, processed_items, succeeded_items, failed_items, status')
      .eq('id', jobId)
      .maybeSingle();
    const hasProgress =
      Number(existing?.total_items || 0) > 0 ||
      Number(existing?.processed_items || 0) > 0 ||
      Number(existing?.succeeded_items || 0) > 0 ||
      Number(existing?.failed_items || 0) > 0;
    if (hasProgress) {
      console.warn(
        `[startJob] job=${jobId} already has progress (total=${existing?.total_items} processed=${existing?.processed_items}); ` +
        `preserving counters and only refreshing status/started_at.`,
      );
      const patch: Record<string, any> = { status: 'processing' };
      if (!existing?.status || existing.status === 'pending') {
        patch.started_at = new Date().toISOString();
      }
      const { error } = await supabase.from('migration_jobs').update(patch).eq('id', jobId);
      if (error) throw new Error(`startJob(guarded) failed: ${error.message}`);
      return;
    }
  } catch (e: any) {
    console.error(`[startJob] guard read failed (continuing): ${e?.message}`);
  }
  const { error } = await supabase
    .from('migration_jobs')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      total_items: total,
    })
    .eq('id', jobId);
  if (error) throw new Error(`startJob failed: ${error.message}`);
}

export async function updateJobProgress(
  supabase: any,
  jobId: string,
  patch: Partial<{
    processed_items: number;
    succeeded_items: number;
    failed_items: number;
    total_items: number;
  }>,
): Promise<void> {
  // ── Monotonic clamp ──────────────────────────────────────────────────
  // Counters must NEVER decrease. If a worker accidentally writes a value
  // lower than what's already persisted (e.g. a stale leg with a reset
  // local counter), drop that field rather than regress the dashboard.
  // total_items is also clamped: it can grow (more pages discovered) but
  // not shrink.
  try {
    const { data: current } = await supabase
      .from('migration_jobs')
      .select('processed_items, succeeded_items, failed_items, total_items')
      .eq('id', jobId)
      .maybeSingle();
    const clamped: Record<string, number> = {};
    const keys: Array<keyof typeof patch> = [
      'processed_items', 'succeeded_items', 'failed_items', 'total_items',
    ];
    for (const k of keys) {
      const v = (patch as any)[k];
      if (typeof v !== 'number' || Number.isNaN(v)) continue;
      const cur = Number((current as any)?.[k] || 0);
      if (v >= cur) {
        clamped[k as string] = v;
      } else {
        console.warn(
          `[updateJobProgress] job=${jobId} dropped regression on ${String(k)}: ${v} < persisted ${cur}`,
        );
      }
    }
    if (Object.keys(clamped).length === 0) return;
    const { error } = await supabase.from('migration_jobs').update(clamped).eq('id', jobId);
    if (error) console.error(`updateJobProgress failed: ${error.message}`);
  } catch (e: any) {
    // Fail open: if the read failed, fall back to the unclamped write so
    // we don't lose progress entirely.
    console.error(`updateJobProgress clamp threw: ${e?.message}; falling back to direct write`);
    const { error } = await supabase.from('migration_jobs').update(patch).eq('id', jobId);
    if (error) console.error(`updateJobProgress fallback failed: ${error.message}`);
  }
}

export async function finishJob(
  supabase: any,
  jobId: string,
  status: 'completed' | 'failed' | 'cancelled',
  errorSummary?: string,
): Promise<void> {
  const { error } = await supabase
    .from('migration_jobs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      error_summary: errorSummary ?? null,
    })
    .eq('id', jobId);
  if (error) console.error(`finishJob failed: ${error.message}`);
}

/**
 * Merge a partial JSON payload into migration_jobs.payload.
 * This is used by workers to persist run-time ingestion validation
 * diagnostics without clobbering orchestrator metadata.
 */
export async function mergeJobPayload(
  supabase: any,
  jobId: string,
  patch: Record<string, any>,
): Promise<void> {
  try {
    const { data: row, error: readErr } = await supabase
      .from('migration_jobs')
      .select('payload')
      .eq('id', jobId)
      .maybeSingle();
    if (readErr) {
      console.error(`mergeJobPayload read failed: ${readErr.message}`);
      return;
    }
    const current = (row?.payload && typeof row.payload === 'object') ? row.payload : {};
    const next = { ...current, ...patch };
    const { error: writeErr } = await supabase
      .from('migration_jobs')
      .update({ payload: next })
      .eq('id', jobId);
    if (writeErr) console.error(`mergeJobPayload write failed: ${writeErr.message}`);
  } catch (e: any) {
    console.error(`mergeJobPayload threw: ${e?.message}`);
  }
}

export interface RecordItemParams {
  job_id: string;
  source_id: string;
  target_id?: string | null;
  entity_label?: string | null;
  status: ItemStatus;
  error_message?: string | null;
}

export async function recordItem(supabase: any, params: RecordItemParams): Promise<void> {
  const classification = params.status === 'failed'
    ? classifyError(params.error_message || '')
    : { category: null as string | null, retryable: null as boolean | null };
  const { error } = await supabase.from('migration_job_items').upsert(
    {
      job_id: params.job_id,
      source_id: params.source_id,
      target_id: params.target_id ?? null,
      entity_label: params.entity_label ?? null,
      status: params.status,
      error_message: params.error_message ?? null,
      error_category: classification.category,
      is_retryable: classification.retryable,
      processed_at: new Date().toISOString(),
      attempts: 1,
    },
    { onConflict: 'job_id,source_id' },
  );
  if (error) console.error(`recordItem failed: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Checkpoints + self-redispatch
// ─────────────────────────────────────────────────────────────────────────

/**
 * Persist a worker's pagination cursor + last-processed-id so the next
 * dispatch can resume exactly where this run stopped.
 */
export async function saveCheckpoint(
  supabase: any,
  jobId: string,
  cursor: Record<string, any>,
  lastSourceId?: string | null,
): Promise<void> {
  const patch: Record<string, any> = { resume_cursor: cursor };
  if (lastSourceId !== undefined) patch.last_processed_source_id = lastSourceId;
  const { error } = await supabase.from('migration_jobs').update(patch).eq('id', jobId);
  if (error) console.error(`saveCheckpoint failed: ${error.message}`);
}

/**
 * Read the persisted cursor + auto_resume flag + dispatch_count for a job.
 */
export async function loadCheckpoint(
  supabase: any,
  jobId: string,
): Promise<{
  cursor: Record<string, any>;
  lastSourceId: string | null;
  autoResume: boolean;
  dispatchCount: number;
}> {
  const { data } = await supabase
    .from('migration_jobs')
    .select('resume_cursor, last_processed_source_id, auto_resume, dispatch_count')
    .eq('id', jobId)
    .maybeSingle();
  return {
    cursor: (data?.resume_cursor as any) || {},
    lastSourceId: data?.last_processed_source_id || null,
    autoResume: data?.auto_resume !== false,
    dispatchCount: data?.dispatch_count || 0,
  };
}

/**
 * Mark the job as still processing (NOT finished) and fire a fresh
 * worker invocation against the same job_id so it picks up from the
 * saved checkpoint. The caller returns immediately after this resolves.
 *
 * NOTE (Phase 2C): self-redispatch is DEPRECATED. Workers should now
 * call `partialExit()` instead. The cron-driven `migration-dispatcher`
 * picks up jobs whose lease (worker_lock_until) has expired.
 *
 * Kept here for safety so legacy code still compiles, but it now no-ops
 * (returns dispatched=false) and falls through to the dispatcher path.
 */
export async function selfRedispatch(
  supabase: any,
  jobId: string,
  _workerName: string,
  _workerBody: Record<string, any>,
  _opts?: { maxDispatches?: number },
): Promise<{ dispatched: boolean; reason?: string; dispatchCount: number }> {
  // Just release the lock so the dispatcher claims it next tick.
  try { await supabase.rpc('release_migration_job_lock', { p_job_id: jobId }); } catch {}
  const { data } = await supabase
    .from('migration_jobs')
    .select('dispatch_count')
    .eq('id', jobId)
    .maybeSingle();
  return {
    dispatched: false,
    reason: 'handed_off_to_dispatcher',
    dispatchCount: data?.dispatch_count || 0,
  };
}

/**
 * Worker-side helper for the new dispatcher architecture.
 *
 * Call this when the worker hits its time budget but has NOT finished the
 * job. It:
 *   1. Saves the cursor (so the next run resumes)
 *   2. Updates progress counters
 *   3. Releases the worker_lock_until lease (cron immediately re-claims)
 *   4. Leaves status='processing' — does NOT call finishJob
 *
 * The dispatcher will pick it up on the next tick (≤15s).
 */
export async function partialExit(
  supabase: any,
  jobId: string,
  cursor: Record<string, any>,
  progress: {
    processed_items?: number;
    succeeded_items?: number;
    failed_items?: number;
  },
  lastSourceId?: string | null,
): Promise<void> {
  await saveCheckpoint(supabase, jobId, cursor, lastSourceId);
  await updateJobProgress(supabase, jobId, progress);
  // Release lease so dispatcher re-claims on next tick.
  try {
    const { error } = await supabase.rpc('release_migration_job_lock', { p_job_id: jobId });
    if (error) console.error('[partialExit] release_lock failed:', error.message);
  } catch (e: any) {
    console.error('[partialExit] release_lock threw:', e?.message);
  }
}

/**
 * Worker-side: read the current control signal for a job.
 *   null    → no signal, keep going
 *   'pause' → finish current page, save checkpoint, exit (dispatcher will
 *             not re-claim while auto_resume=false)
 *   'cancel'→ finish current item, then finishJob('cancelled')
 *   'kill'  → drop everything, finishJob('cancelled') immediately
 *
 * Returns one of: 'pause' | 'cancel' | 'kill' | null
 */
export type ControlSignal = 'pause' | 'cancel' | 'kill' | null;

export async function readControlSignal(supabase: any, jobId: string): Promise<ControlSignal> {
  try {
    const { data, error } = await supabase.rpc('read_migration_control_signal', {
      p_job_id: jobId,
    });
    if (error) {
      console.error('[readControlSignal] failed:', error.message);
      return null;
    }
    const v = data as string | null;
    if (v === 'pause' || v === 'cancel' || v === 'kill') return v;
    return null;
  } catch (e: any) {
    console.error('[readControlSignal] threw:', e?.message);
    return null;
  }
}

/**
 * Worker-side heartbeat. Call periodically (e.g. once per page) so the
 * dispatcher knows the worker is alive and extends the lease.
 */
export async function heartbeat(supabase: any, jobId: string, leaseSeconds = 180): Promise<void> {
  try {
    const { error } = await supabase.rpc('heartbeat_migration_job', {
      p_job_id: jobId,
      p_lease_seconds: leaseSeconds,
    });
    if (error) console.error('[heartbeat] failed:', error.message);
  } catch (e: any) {
    console.error('[heartbeat] threw:', e?.message);
  }
}

/**
 * Categorize error strings into a small fixed taxonomy so the dashboard can
 * separate "transient/retryable" failures from "user-action-required" ones.
 *
 * Categories:
 *   auth       – 401/403/SCOPE/TOKEN/FORBIDDEN  (NOT retryable until secret fixed)
 *   validation – 400/422/INVALID/REQUIRED       (NOT retryable, data fix needed)
 *   not_found  – 404                            (NOT retryable)
 *   rate_limit – 429/RATE_LIMIT/TOO_MANY        (RETRYABLE)
 *   server     – 5xx / SERVER_ERROR             (RETRYABLE)
 *   network    – fetch/timeout/ECONNRESET       (RETRYABLE)
 *   conflict   – 409                            (NOT retryable)
 *   unknown    – everything else                (RETRYABLE)
 */
export function classifyError(msg: string): { category: string; retryable: boolean } {
  const m = (msg || '').toLowerCase();
  if (!m) return { category: 'unknown', retryable: true };

  if (/\b(401|403)\b|forbidden|unauthor|missing.*scope|invalid.*token|token.*invalid/.test(m)) {
    return { category: 'auth', retryable: false };
  }
  if (/\b429\b|rate[_ -]?limit|too[_ -]?many[_ -]?requests/.test(m)) {
    return { category: 'rate_limit', retryable: true };
  }
  if (/\b(400|422)\b|validation|invalid|required/.test(m)) {
    return { category: 'validation', retryable: false };
  }
  if (/\b404\b|not[_ -]?found/.test(m)) {
    return { category: 'not_found', retryable: false };
  }
  if (/\b409\b|conflict|duplicate|already/.test(m)) {
    return { category: 'conflict', retryable: false };
  }
  if (/\b5\d\d\b|server[_ -]?error|bad[_ -]?gateway|gateway[_ -]?timeout|service[_ -]?unavailable/.test(m)) {
    return { category: 'server', retryable: true };
  }
  if (/timeout|econnrefused|econnreset|enotfound|fetch.*failed|network/.test(m)) {
    return { category: 'network', retryable: true };
  }
  return { category: 'unknown', retryable: true };
}

/**
 * Persist (or refresh) an entry in `ghl_id_mapping` so future workers and
 * sync code can translate IDs between the legacy and new accounts.
 */
export async function recordIdMapping(
  supabase: any,
  params: {
    resource_type: 'contact' | 'opportunity' | 'conversation' | 'conversation_message' | 'note' | 'pipeline' | 'pipeline_stage' | 'calendar_group' | 'calendar' | 'appointment' | 'user' | 'team';
    old_ghl_id: string;
    new_ghl_id: string;
    source_account_label: 'legacy' | 'new';
    target_account_label: 'legacy' | 'new';
    notes?: string;
    /**
     * Confidence of the (old_ghl_id → new_ghl_id) match.
     *   high   = we created the target record ourselves (deterministic)
     *   medium = matched an existing target record on strong signals
     *            (e.g. contact + pipeline + name + monetary value)
     *   low    = matched on weak signals only — needs manual review
     * Defaults to 'high' so existing call sites keep their semantics.
     */
    match_confidence?: 'high' | 'medium' | 'low';
  },
): Promise<void> {
  // The live `ghl_id_mapping` table has a UNIQUE constraint on
  // (resource_type, old_ghl_id) only — match it exactly so ON CONFLICT works.
  const { error } = await supabase.from('ghl_id_mapping').upsert(
    {
      resource_type: params.resource_type,
      old_ghl_id: params.old_ghl_id,
      new_ghl_id: params.new_ghl_id,
      source_account_label: params.source_account_label,
      target_account_label: params.target_account_label,
      notes: params.notes ?? null,
      match_confidence: params.match_confidence ?? 'high',
      remapped_at: new Date().toISOString(),
    },
    { onConflict: 'resource_type,old_ghl_id' },
  );
  if (error) console.error(`recordIdMapping failed: ${error.message}`);
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Normalize a person name for fuzzy-equality comparison:
 *   - lowercase
 *   - collapse internal whitespace
 *   - strip surrounding whitespace
 *   - drop common punctuation we frequently see in GHL contact names
 *     (commas, parentheticals, mid-name dots, smart quotes, hyphens)
 *
 * Two names are considered "the same person" iff their normalized forms
 * are byte-equal. Returns null if the input is empty after normalization.
 */
export function normalizeContactName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`']/g, '')   // apostrophes
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036"]/g, '')   // double quotes
    .replace(/[.,\-_/\\()]+/g, ' ')                              // punctuation → space
    .replace(/\s+/g, ' ')                                         // collapse whitespace
    .trim();
  return cleaned.length ? cleaned : null;
}

/**
 * Smart-capitalize a name coming from GHL. Handles all-lowercase /
 * all-uppercase imports, McX / MacX / O'X prefixes, and hyphenated
 * surnames. Already-mixed-case input is returned unchanged so we don't
 * stomp on legitimately styled names like "van der Berg".
 *
 * Mirror of `src/utils/nameFormatting.ts#smartCapitalize` so the same
 * sanitization runs in Deno workers as in the browser.
 */
export function smartCapitalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = String(raw).replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  // Leave mixed-case names alone.
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) {
    return trimmed;
  }
  return trimmed
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((part) => {
      if (/^(\s+|-|')$/.test(part)) return part;
      if (part.startsWith('mc') && part.length > 2) {
        return 'Mc' + part.charAt(2).toUpperCase() + part.slice(3);
      }
      if (part.startsWith('mac') && part.length > 3) {
        return 'Mac' + part.charAt(3).toUpperCase() + part.slice(4);
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

/**
 * Detect "junk" contact names that should NEVER be pushed to the target
 * account — phone numbers stored as names, raw email addresses, "test"
 * placeholders, runs of digits, and other obvious garbage we observed
 * in the legacy GHL export. Returns a reason string when junk is
 * detected, or null when the name passes.
 */
export function detectJunkContactName(raw: string | null | undefined): string | null {
  if (!raw) return 'Empty name';
  const v = String(raw).trim();
  if (!v) return 'Empty name';
  if (v.length < 2) return 'Name too short';
  // Email address used as name
  if (/@/.test(v) && /\.[a-z]{2,}$/i.test(v)) return 'Email used as name';
  // Pure digit/phone-style strings (e.g. "00000000", "0412 478 751", "(02) 3814 5447")
  const digitsOnly = v.replace(/[^0-9]/g, '');
  const nonDigits = v.replace(/[0-9\s\-().+]/g, '');
  if (digitsOnly.length >= 6 && nonDigits.length === 0) return 'Phone number used as name';
  // Test/placeholder rows — NOTE: "Unknown" is allowed as an explicit
  // placeholder in the reference export (Client Management Export uses
  // "Unknown Unknown" when a contact has phone-only) so we exclude it
  // from the junk list. We still reject "test", "asdf", etc.
  if (/^(test|testing|asdf+|qwerty|sample|demo|na|n\/a|none|null)\b/i.test(v)) {
    return `Placeholder name "${v.substring(0, 40)}"`;
  }
  // Repeated single character (e.g. "aaaa")
  if (v.length >= 4 && /^(.)\1+$/.test(v.replace(/\s+/g, ''))) return 'Repeated-character name';
  return null;
}

/**
 * Normalize a phone string to E.164-ish format matching the reference
 * export (e.g. "+61433151743"). Rules:
 *   - Strip everything except digits and a leading `+`
 *   - If input already starts with `+`, keep as-is after digit-strip
 *   - If 10 digits and starts with `0` → assume Australian, prefix `+61`
 *     and drop the leading 0 (e.g. "0412345678" → "+61412345678")
 *   - If 11+ digits and looks international, prefix `+`
 *   - Otherwise, return the digits with a leading `+` (best-effort)
 *   - Empty / unparseable → empty string
 */
export function normalizePhoneE164(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s) return '';
  const hadPlus = s.startsWith('+');
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (hadPlus) return '+' + digits;
  // Australian local format
  if (digits.length === 10 && digits.startsWith('0')) return '+61' + digits.slice(1);
  // 9-digit Australian mobile/landline without leading 0
  if (digits.length === 9 && /^[2-478]/.test(digits)) return '+61' + digits;
  // Already includes country code
  return '+' + digits;
}

/**
 * Normalize an email for storage in GHL: trim + lowercase. Returns ''
 * for empty/invalid input. Does NOT validate beyond a basic shape.
 */
export function normalizeEmail(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = String(raw).trim().toLowerCase();
  if (!s || !/.+@.+\..+/.test(s)) return '';
  return s;
}

/**
 * Apply full sanitization to a {firstName, lastName} pair coming from
 * legacy GHL: trims, collapses whitespace, smart-capitalizes, and
 * computes the resulting display name. Returns the sanitized parts plus
 * a `junkReason` if the combined name should be skipped.
 */
export function sanitizeContactNameParts(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): { firstName: string; lastName: string; fullName: string; junkReason: string | null } {
  const first = smartCapitalizeName(firstName);
  const last = smartCapitalizeName(lastName);
  const fullName = [first, last].filter(Boolean).join(' ').trim();
  const junkReason = detectJunkContactName(fullName);
  return { firstName: first, lastName: last, fullName, junkReason };
}

/**
 * Resolve a SOURCE contact name → TARGET ghl contact id using the
 * `ghl_id_mapping.notes` column (which the contacts worker populates with
 * the contact's full name at mirror time).
 *
 * Behavior (per user policy "Name only — pick most recent on duplicates"):
 *   - Returns the most recently created mapping row whose normalized
 *     `notes` matches the normalized lookup name.
 *   - If multiple legacy contacts share the same normalized name, the
 *     opportunity / note gets routed to the *latest* mirrored target
 *     contact. Caller logs the ambiguity for audit.
 *   - Returns { newId: null, candidates: [] } if no match exists.
 */
export async function resolveTargetContactByName(
  supabase: any,
  params: {
    fullName: string | null | undefined;
    sourceAccount: 'legacy' | 'new';
    targetAccount: 'legacy' | 'new';
    excludeNewIds?: string[];
  },
): Promise<{
  newId: string | null;
  matchedName: string | null;
  candidateCount: number;
  ambiguous: boolean;
  normalizedKey: string | null;
}> {
  const key = normalizeContactName(params.fullName);
  if (!key) {
    return { newId: null, matchedName: null, candidateCount: 0, ambiguous: false, normalizedKey: null };
  }

  // Fetch all candidate rows for this target account (we filter in JS so we
  // don't have to push the same normalization into SQL — and so future
  // tweaks to `normalizeContactName` are picked up automatically).
  const { data, error } = await supabase
    .from('ghl_id_mapping')
    .select('new_ghl_id, notes, created_at, remapped_at')
    .eq('resource_type', 'contact')
    .eq('source_account_label', params.sourceAccount)
    .eq('target_account_label', params.targetAccount)
    .not('notes', 'is', null)
    .order('created_at', { ascending: false });

  if (error || !Array.isArray(data)) {
    return { newId: null, matchedName: null, candidateCount: 0, ambiguous: false, normalizedKey: key };
  }

  const excluded = new Set((params.excludeNewIds || []).filter(Boolean));
  const matches = data.filter((row: any) => {
    if (excluded.has(row.new_ghl_id)) return false;
    return normalizeContactName(row.notes) === key;
  });
  if (matches.length === 0) {
    return { newId: null, matchedName: null, candidateCount: 0, ambiguous: false, normalizedKey: key };
  }

  // Already sorted DESC by created_at — first match is the latest.
  const winner = matches[0];
  return {
    newId: winner.new_ghl_id,
    matchedName: winner.notes,
    candidateCount: matches.length,
    ambiguous: matches.length > 1,
    normalizedKey: key,
  };
}

/**
 * Resolve a SOURCE contact id → TARGET ghl contact id deterministically
 * via `ghl_id_mapping`. This is preferred over name-based resolution
 * because it survives placeholder names ("Unknown Unknown"), duplicate
 * names, and casing/punctuation drift.
 */
export async function resolveTargetContactBySourceId(
  supabase: any,
  params: {
    sourceContactId: string | null | undefined;
    sourceAccount: 'legacy' | 'new';
    targetAccount: 'legacy' | 'new';
  },
): Promise<{ newId: string | null; matchedName: string | null }> {
  const id = (params.sourceContactId || '').trim();
  if (!id) return { newId: null, matchedName: null };
  const { data, error } = await supabase
    .from('ghl_id_mapping')
    .select('new_ghl_id, notes')
    .eq('resource_type', 'contact')
    .eq('source_account_label', params.sourceAccount)
    .eq('target_account_label', params.targetAccount)
    .eq('old_ghl_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return { newId: null, matchedName: null };
  return { newId: data.new_ghl_id, matchedName: data.notes || null };
}
