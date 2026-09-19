/**
 * Frontend resolver for the most-specific active `report_templates` row for
 * a given report_type + variant + scope context. Precedence (first wins):
 *   1. scope=user    + owner_user_id  + variant match
 *   2. scope=agency  + agency_id      + variant match
 *   3. scope=global  + exact variant match
 *   4. scope=global  + variant IS NULL  (catch-all)
 * Ties break by priority DESC, then updated_at DESC.
 *
 * Phase 4: ranking now lives in the `resolve_report_template` SQL function
 * (single source of truth — see migration 20260611120000). This module calls
 * the RPC first and only falls back to the local JS ranking when the
 * function is unavailable (pre-migration deployments).
 *
 * The JS fallback mirrors supabase/functions/_shared/resolveReportTemplate.ts
 * and is locked together by src/lib/reportTemplate/__tests__/resolveTemplateParity.spec.ts.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';

export type ReportVariant = 'composite' | 'financial' | 'due_diligence';

export interface ResolveOpts {
  reportType: string;
  variant?: ReportVariant | null;
  agencyId?: string | null;
  userId?: string | null;
}

export interface ResolvedTemplate {
  template: any; // report_templates row
  engine: 'jspdf' | 'weasyprint';
  source: 'user' | 'agency' | 'global-variant' | 'global-any';
}

const ORDER = ['user', 'agency', 'global-variant', 'global-any'] as const;

/**
 * Pure ranking over already-fetched rows. Exported for the client/edge
 * parity test; must stay behaviourally identical to the SQL function and
 * the edge fallback.
 */
export function rankReportTemplates(
  rows: any[],
  opts: ResolveOpts,
): { source: ResolvedTemplate['source']; row: any } | null {
  const variant = opts.variant ?? null;
  const agencyId = opts.agencyId ?? null;
  const userId = opts.userId ?? null;

  const candidates: Array<{ source: ResolvedTemplate['source']; row: any }> = [];
  for (const r of rows) {
    const rScope = r.scope ?? 'global';
    const rVariant = r.variant ?? null;
    const variantOk = rVariant === null || rVariant === variant;
    if (rScope === 'user' && userId && r.owner_user_id === userId && variantOk) {
      candidates.push({ source: 'user', row: r });
    } else if (rScope === 'agency' && agencyId && r.agency_id === agencyId && variantOk) {
      candidates.push({ source: 'agency', row: r });
    } else if (rScope === 'global' && rVariant !== null && rVariant === variant) {
      candidates.push({ source: 'global-variant', row: r });
    } else if (rScope === 'global' && rVariant === null) {
      candidates.push({ source: 'global-any', row: r });
    }
  }
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const sa = ORDER.indexOf(a.source);
    const sb = ORDER.indexOf(b.source);
    if (sa !== sb) return sa - sb;
    const pa = Number(a.row.priority ?? 0);
    const pb = Number(b.row.priority ?? 0);
    if (pa !== pb) return pb - pa;
    return (
      new Date(b.row.updated_at ?? 0).getTime() -
      new Date(a.row.updated_at ?? 0).getTime()
    );
  });

  return candidates[0];
}

function toResolved(row: any, source: ResolvedTemplate['source']): ResolvedTemplate {
  const engine = (row.engine ?? 'jspdf') as 'jspdf' | 'weasyprint';
  return { template: row, engine, source };
}

export async function resolveReportTemplate(
  opts: ResolveOpts,
): Promise<ResolvedTemplate | null> {
  const reportType = (opts.reportType || '').toLowerCase();
  if (!reportType) return null;

  // 1) SQL ranking (authoritative). Empty result = authoritative no-match.
  try {
    const { data, error } = await (supabase.rpc as any)('resolve_report_template', {
      p_report_type: reportType,
      p_variant: opts.variant ?? null,
      p_agency_id: opts.agencyId ?? null,
      p_user_id: opts.userId ?? null,
    });
    if (!error) {
      const hit = Array.isArray(data) ? data[0] : data;
      if (!hit?.template) return null;
      return toResolved(hit.template, hit.source as ResolvedTemplate['source']);
    }
    console.warn('[resolveTemplate] RPC unavailable, using JS fallback:', error.message);
  } catch (e) {
    console.warn('[resolveTemplate] RPC threw, using JS fallback:', e);
  }

  // 2) Fallback: pull a superset of active templates and rank locally.
  const { data, error } = await invokeSecureFunction('manage-templates', {
    operation: 'list',
    table: 'report_templates',
    listOptions: {
      orderBy: 'updated_at',
      orderAsc: false,
      filters: { report_type: reportType, is_active: true },
      limit: 200,
    },
  });
  if (error || !data?.records?.length) return null;

  const winner = rankReportTemplates(data.records as any[], opts);
  if (!winner) return null;
  return toResolved(winner.row, winner.source);
}
