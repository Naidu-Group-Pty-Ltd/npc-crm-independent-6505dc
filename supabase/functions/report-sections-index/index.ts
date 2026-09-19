import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { internalError } from '../_shared/errorResponse.ts';
import { knownHeadings } from '../_shared/reports/investment/sectionRegistry.pure.ts';
import {
  toSectionIndex,
  type ReportSectionIndex,
} from '../_shared/reports/investment/sectionStorage.pure.ts';

/**
 * Build the per-section index over stored investment reports — Phase 3's
 * addressable projection of `investment_reports.report_content`.
 *
 * The document stays the source of truth. This walks the corpus in batches,
 * partitions each report with the section registry, proves the split is
 * lossless, and writes `investment_report_sections` /
 * `investment_report_section_index`. Nothing here rewrites a client's report:
 * the only tables it touches are the two derived ones.
 *
 * ## Two modes, and why measure exists
 *
 * `measure` does everything except write. It is how the round trip was proven
 * across the WHOLE corpus rather than a sample the sandbox could hold — 1,192
 * documents at up to 52 KB each will not fit through a review, and a
 * conservation claim about four of them is not a claim about the corpus.
 *
 * `index` is the same walk with the writes attached.
 *
 * ## The rules this function is responsible for
 *
 * **An index is written only when it proves lossless.** A report whose
 * re-assembly does not conserve non-whitespace content gets an index row
 * recording `conserves = false` and NO section rows. Half an index is worse
 * than none: a caller that reads `investment_report_sections` would silently
 * serve a truncated document.
 *
 * **The counts describe what is stored, never what was found.** A refused
 * report stores zero sections and says zero — a labelled row promises a figure.
 * What the partition saw is still visible through `absorbed` and through this
 * function's own response.
 *
 * **A repeat is an occurrence, never a merge**, enforced by the primary key
 * `(report_id, ordinal)`: document order is the key, so a section id appearing
 * four times is four rows rather than one overwritten four times.
 *
 * Auth: the internal edge secret (bearer or `X-Cron-Secret`) — or, per report,
 * the self-sealing arm: a report that has no index row yet may be indexed once
 * without it. The arm is per REPORT rather than per store because a
 * whole-store emptiness gate seals on the first batch and locks the remaining
 * 1,100 documents out (the crime ingest's per-state lesson). Re-indexing a
 * report that already has an index row, and `force`, both require the secret.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Batch ceiling. 50 documents ≈ 1.4 MB of markdown; 200 is the refusal bound. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * An absorbed heading is only reported when at least this many DISTINCT
 * reports in the batch carry it. A heading three different clients' documents
 * share is a template heading; one that appears once may be a property
 * address, and a diagnostic response is not the place for it.
 */
const ABSORBED_REPORT_FLOOR = 3;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A fingerprint of the vocabulary this deployment resolves headings with —
 * every normalised alias and the section it owns, in sorted order.
 *
 * Which registry built an index is a fact about the index: an alias added
 * later changes what a heading resolves to, so two reports indexed either side
 * of that change were partitioned by different rules. The digest is what makes
 * that visible instead of a mystery, and it is what an operator compares
 * against the repo before trusting a deployment's numbers.
 */
async function registryDigest(): Promise<string> {
  const lines = [...knownHeadings().entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return await sha256Hex(lines.map(([heading, id]) => `${heading}\t${id}`).join('\n'));
}

/**
 * The largest `sample` this will partition. Well past the corpus's longest
 * document (52 KB) and small enough that the pure walk stays trivial.
 */
const MAX_SAMPLE_BYTES = 256 * 1024;

interface ReportRow { id: string; report_content: string | null }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: Record<string, unknown> = {};
  try { body = JSON.parse(await req.text()); } catch { /* defaults below */ }

  const mode = body?.mode === 'index' ? 'index' : 'measure';
  const offset = Math.max(0, Number(body?.offset ?? 0) | 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body?.limit ?? DEFAULT_LIMIT) | 0));
  const force = body?.force === true;
  const reportIds = Array.isArray(body?.reportIds)
    ? (body.reportIds as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, MAX_LIMIT)
    : null;

  const internalSecret = Deno.env.get('INTERNAL_EDGE_SECRET') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const authorised = internalSecret !== '' &&
    (bearer === internalSecret || req.headers.get('x-cron-secret') === internalSecret);

  // `force` re-indexes a report that already has a row, so it is never in the
  // self-sealing arm's reach.
  if (force && !authorised) return json({ success: false, error: 'forbidden' }, 403);

  // `sample` partitions the text it is handed and reads nothing. It exists so
  // a DEPLOYMENT can be checked against the repo rather than assumed to match
  // it: the same text through the same modules must produce the same index
  // here and in the source tree, and the registry digest beside it says which
  // vocabulary did the resolving. A deployed copy that silently differs from
  // the file it was built from is the fault this makes visible.
  if (typeof body?.sample === 'string') {
    const sample = body.sample as string;
    if (sample.length > MAX_SAMPLE_BYTES) return json({ success: false, error: 'sample_too_large' }, 413);
    return json({
      success: true,
      mode: 'sample',
      registry: { headings: knownHeadings().size, digest: await registryDigest() },
      index: toSectionIndex(sample),
    });
  }

  try {
    let query = supabase
      .from('investment_reports')
      .select('id, report_content')
      // Deterministic order, or paging by offset revisits and skips documents.
      .order('id', { ascending: true });
    query = reportIds && reportIds.length > 0
      ? query.in('id', reportIds)
      : query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw new Error(`investment_reports read failed: ${error.message}`);
    const rows = (data ?? []) as ReportRow[];

    // Which of these already carry an index row. Two jobs: idempotence (an
    // unchanged document is skipped rather than rewritten) and the per-report
    // seal (an indexed report is out of the bootstrap arm's reach).
    const existing = new Map<string, string>();
    if (rows.length > 0) {
      const { data: idx, error: idxError } = await supabase
        .from('investment_report_section_index')
        .select('report_id, content_hash')
        .in('report_id', rows.map((r) => r.id));
      if (idxError) throw new Error(`section index read failed: ${idxError.message}`);
      for (const r of (idx ?? []) as Array<{ report_id: string; content_hash: string }>) {
        existing.set(r.report_id, r.content_hash);
      }
    }

    const levels: Record<string, number> = { '1': 0, '2': 0 };
    const absorbedReports = new Map<string, Set<string>>();
    let scanned = 0;
    let empty = 0;
    let conserving = 0;
    let refused = 0;
    let written = 0;
    let sealed = 0;
    let unchanged = 0;
    let totalSections = 0;
    let withNoSections = 0;
    const refusedIds: string[] = [];

    for (const row of rows) {
      const content = row.report_content ?? '';
      if (content.trim() === '') { empty += 1; continue; }
      scanned += 1;

      const index: ReportSectionIndex = toSectionIndex(content);
      levels[String(index.level)] += 1;
      totalSections += index.totalSections;
      if (index.totalSections === 0) withNoSections += 1;
      if (index.conserves) conserving += 1; else { refused += 1; if (refusedIds.length < 20) refusedIds.push(row.id); }
      for (const a of index.absorbed) {
        if (!absorbedReports.has(a.heading)) absorbedReports.set(a.heading, new Set());
        absorbedReports.get(a.heading)!.add(row.id);
      }

      if (mode !== 'index') continue;

      const hash = await sha256Hex(content);
      const had = existing.get(row.id);
      if (had !== undefined && !force) {
        // Already indexed. Unchanged → nothing to do; changed → the document
        // moved under an index, which is a re-index and needs the secret.
        if (had === hash) { unchanged += 1; continue; }
        if (!authorised) { sealed += 1; continue; }
      }

      // Section rows are replaced wholesale: an edited document can lose a
      // section, and leaving the old row behind would serve a section the
      // report no longer contains.
      const { error: clearError } = await supabase
        .from('investment_report_sections').delete().eq('report_id', row.id);
      if (clearError) throw new Error(`clearing sections for ${row.id} failed: ${clearError.message}`);

      if (index.conserves && index.sections.length > 0) {
        const { error: insertError } = await supabase.from('investment_report_sections').insert(
          index.sections.map((s) => ({
            report_id: row.id,
            ordinal: s.ordinal,
            section_id: s.sectionId,
            occurrence: s.occurrence,
            heading: s.heading,
            body: s.body,
          })),
        );
        if (insertError) throw new Error(`section insert for ${row.id} failed: ${insertError.message}`);
      }

      const { error: upsertError } = await supabase.from('investment_report_section_index').upsert({
        report_id: row.id,
        heading_level: index.level,
        preamble: index.conserves ? index.preamble : '',
        distinct_sections: index.conserves ? index.distinctSections : 0,
        total_sections: index.conserves ? index.totalSections : 0,
        absorbed: index.absorbed,
        conserves: index.conserves,
        content_hash: hash,
        indexed_at: new Date().toISOString(),
      }, { onConflict: 'report_id' });
      if (upsertError) throw new Error(`section index upsert for ${row.id} failed: ${upsertError.message}`);
      written += 1;
    }

    const absorbed = [...absorbedReports.entries()]
      .filter(([, reports]) => reports.size >= ABSORBED_REPORT_FLOOR)
      .map(([heading, reports]) => ({ heading, reports: reports.size }))
      .sort((a, b) => b.reports - a.reports)
      .slice(0, 40);

    return json({
      success: true,
      mode,
      authorised,
      registry: { headings: knownHeadings().size, digest: await registryDigest() },
      batch: { offset, limit, returned: rows.length, nextOffset: reportIds ? null : offset + rows.length },
      scanned,
      empty,
      conserving,
      refused,
      refusedIds,
      withNoSections,
      totalSections,
      levels,
      written,
      unchanged,
      sealed,
      absorbed,
      absorbedReportFloor: ABSORBED_REPORT_FLOOR,
    });
  } catch (e) {
    // A write or read fault aborts the BATCH and never leaves a report half
    // indexed: sections are cleared and re-inserted per report, and the index
    // row is upserted last, so a report the loop never reached is simply
    // un-indexed and the next run picks it up.
    console.error('[report-sections-index] batch failed:', e);
    return json({ success: false, ...internalError(e, 'report-sections-index') }, 500);
  }
});
