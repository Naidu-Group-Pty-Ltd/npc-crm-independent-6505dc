/**
 * generation-trace.ts
 *
 * Lightweight observability hooks for the report generation engine.
 * Every generator (composite, fork, regenerate, qualitative) calls these
 * to persist per-run + per-chunk telemetry into:
 *   - report_generation_runs
 *   - report_generation_chunks
 *
 * Tables are service_role-only; this helper is intended to be called from
 * inside edge functions that already hold the service role client.
 *
 * Design rules:
 *  - Fail-OPEN: tracing never throws into the caller. A logging failure
 *    must not break report generation.
 *  - No behavior change: we only observe what the generator already does.
 *  - Cheap: each call is one INSERT; payloads are JSONB.
 */

// deno-lint-ignore-file no-explicit-any

export interface StartRunInput {
  report_id?: string | null;
  scope?: string | null;            // compass | executive | suburb | comparison
  variant?: string | null;          // FIN | PLDD | composite
  engine_version?: string | null;
  trigger_source?: string | null;   // generate | regenerate | fork | bulk | chunked-resume
  template_ids?: any;
  registry_snapshot?: any;
  system_prompt?: string | null;
  data_packet?: any;
  model?: string | null;
  initiated_by?: string | null;
}

export interface ChunkRecord {
  section_key: string;
  section_label?: string | null;
  ordinal?: number;
  phase?: string | null;            // first-pass | refine | retry
  model?: string | null;
  system_prompt?: string | null;
  user_prompt?: string | null;
  attached_template_chunk_ids?: any;
  attached_packet_keys?: string[];
  retrieval_meta?: any;             // { query, threshold, k, hits[] }
  response?: string | null;
  tool_calls?: any;
  prompt_tokens?: number;
  completion_tokens?: number;
  latency_ms?: number;
  retry_count?: number;
  status?: string;                  // completed | failed
  error?: string | null;
  started_at?: string;
  finished_at?: string;
}

export interface FinishRunInput {
  // 'paused' is a *successful* non-terminal outcome: the run hit its wall-clock
  // budget with sections still to generate and handed off to a resume. It is
  // distinct from 'failed' — the work banked so far is good and the report is
  // still on its way. Anything auditing run outcomes should treat a trailing
  // 'paused' run as in-flight, not as an error.
  status: 'completed' | 'failed' | 'cancelled' | 'paused';
  error?: string | null;
  total_prompt_tokens?: number;
  total_completion_tokens?: number;
  total_cost_cents?: number;
}

function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  return crypto.subtle.digest('SHA-256', enc).then((buf) => {
    const b = new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
    return out;
  });
}

function byteLen(v: any): number {
  if (v == null) return 0;
  try {
    return new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v)).byteLength;
  } catch {
    return 0;
  }
}

function safe(fn: () => Promise<any>, label: string): Promise<any> {
  return fn().catch((e) => {
    try { console.warn(`[generation-trace] ${label} failed (suppressed):`, e?.message || e); } catch {}
    return null;
  });
}

/**
 * Start a generation run. Returns a runId or null on failure (caller must
 * tolerate null — tracing is best-effort).
 */
export async function startRun(supabase: any, input: StartRunInput): Promise<string | null> {
  return safe(async () => {
    const packetJson = input.data_packet != null
      ? (typeof input.data_packet === 'string' ? input.data_packet : JSON.stringify(input.data_packet))
      : null;
    const hash = packetJson ? await sha256Hex(packetJson) : null;
    const size = packetJson ? byteLen(packetJson) : 0;

    const { data, error } = await supabase
      .from('report_generation_runs')
      .insert({
        report_id: input.report_id ?? null,
        scope: input.scope ?? null,
        variant: input.variant ?? null,
        engine_version: input.engine_version ?? null,
        trigger_source: input.trigger_source ?? null,
        template_ids: input.template_ids ?? [],
        registry_snapshot: input.registry_snapshot ?? null,
        system_prompt: input.system_prompt ?? null,
        data_packet: input.data_packet ?? null,
        data_packet_hash: hash,
        data_packet_size_bytes: size,
        model: input.model ?? null,
        initiated_by: input.initiated_by ?? null,
        status: 'running',
      })
      .select('id')
      .single();

    if (error) throw error;
    return data?.id as string;
  }, 'startRun');
}

/**
 * Record a single chunk/section invocation. Caller passes the system+user
 * prompts as actually sent, plus the retrieved template chunk ids and
 * which data-packet keys were attached. The packet matrix in the UI is
 * built from attached_packet_keys.
 */
export async function recordChunk(
  supabase: any,
  runId: string | null,
  chunk: ChunkRecord,
): Promise<void> {
  if (!runId) return;
  await safe(async () => {
    const { error } = await supabase.from('report_generation_chunks').insert({
      run_id: runId,
      section_key: chunk.section_key,
      section_label: chunk.section_label ?? null,
      ordinal: chunk.ordinal ?? 0,
      phase: chunk.phase ?? null,
      model: chunk.model ?? null,
      system_prompt: chunk.system_prompt ?? null,
      user_prompt: chunk.user_prompt ?? null,
      user_prompt_size_bytes: byteLen(chunk.user_prompt),
      attached_template_chunk_ids: chunk.attached_template_chunk_ids ?? [],
      attached_packet_keys: chunk.attached_packet_keys ?? [],
      retrieval_meta: chunk.retrieval_meta ?? null,
      response: chunk.response ?? null,
      response_size_bytes: byteLen(chunk.response),
      tool_calls: chunk.tool_calls ?? null,
      prompt_tokens: chunk.prompt_tokens ?? 0,
      completion_tokens: chunk.completion_tokens ?? 0,
      latency_ms: chunk.latency_ms ?? null,
      retry_count: chunk.retry_count ?? 0,
      status: chunk.status ?? 'completed',
      error: chunk.error ?? null,
      started_at: chunk.started_at ?? new Date().toISOString(),
      finished_at: chunk.finished_at ?? new Date().toISOString(),
    });
    if (error) throw error;
  }, 'recordChunk');
}

/**
 * Finalise a run with totals + status.
 */
export async function finishRun(
  supabase: any,
  runId: string | null,
  input: FinishRunInput,
): Promise<void> {
  if (!runId) return;
  await safe(async () => {
    const { error } = await supabase
      .from('report_generation_runs')
      .update({
        status: input.status,
        error: input.error ?? null,
        total_prompt_tokens: input.total_prompt_tokens ?? 0,
        total_completion_tokens: input.total_completion_tokens ?? 0,
        total_cost_cents: input.total_cost_cents ?? 0,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
    if (error) throw error;
  }, 'finishRun');
}

/**
 * Helper: given the data packet object and the slice we actually inlined
 * into a prompt, return the list of top-level keys present. The UI uses
 * this for the "packet matrix" view.
 */
export function packetKeysAttached(packet: any, attached: any): string[] {
  if (attached == null || typeof attached !== 'object') return [];
  if (Array.isArray(attached)) return [];
  const keys = Object.keys(attached);
  if (!packet || typeof packet !== 'object') return keys;
  const packetKeys = new Set(Object.keys(packet));
  return keys.filter((k) => packetKeys.has(k));
}
