/**
 * The design a render request names, resolved for the person who asked.
 *
 * Every standard render route calls this once, after it has authenticated the
 * caller and before it draws. A catalogue design is resolved from code alone.
 * A template row is read with only the columns a design needs — its tokens and
 * its library lineage, never its pages, which run to megabytes on some rows —
 * and is honoured only where the Template Builder would list it for this
 * person and the chooser would offer it for this report type
 * (`templateDesignRoute.pure.ts`). That starts with the Builder's own
 * permission: a person who may not view templates has no row the Builder
 * would list, which is also what the drawn documents are told, because they
 * read through the Builder's broker. The permission is asked before the row
 * is read, so a refusal says nothing about whether the row exists.
 *
 * It never throws and never fails the document: whatever goes wrong, the
 * answer is the standard design plus an echo that says why. A read that failed
 * is logged with the database's own words and told to the person as a read
 * that failed (`template_unreadable`: try again), never as a template that is
 * gone (`template_unavailable`: choose another).
 */
import { requireModulePermission, requireSuperadmin } from '../authz.ts';
import {
  appliedEcho,
  designFromTemplateRow,
  refusedEcho,
  resolveCatalogueDesign,
  type DesignEcho,
  type ReportTemplateDesign,
  type TemplateDesignReference,
} from '../reportDesign/templateDesign.pure.ts';
import {
  designLenderFor,
  designRowUsableFor,
  templateVisibleTo,
  type DesignTemplateRow,
} from './templateDesignRoute.pure.ts';
import { normaliseReportType } from './reportTemplateSelection.pure.ts';

export interface RequestedDesign {
  /** The design to draw in, or null for the standard design. */
  design: ReportTemplateDesign | null;
  /** What the response says about it, or null when none was asked for. */
  echo: DesignEcho | null;
}

const NONE: RequestedDesign = { design: null, echo: null };

/** Only the columns a design is read from. */
const TEMPLATE_DESIGN_COLUMNS =
  'id, name, report_type, engine, scope, owner_user_id, is_active, is_draft, '
  + 'tokens:schema->tokens, lineage:config->libraryLineage';

export async function resolveRequestedDesign(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: {
    reference: TemplateDesignReference | null;
    reportType: string;
    actor: { userId: string; authMethod?: string | null };
    /** The route's name, for the log line. */
    route: string;
  },
): Promise<RequestedDesign> {
  const { reference, reportType, actor, route } = args;
  if (!reference) return NONE;

  const result = await (async () => {
    try {
      if (reference.kind === 'catalogue') return resolveCatalogueDesign(reference);
      const mayView = await requireModulePermission(supabase, actor, 'templates', 'can_view');
      if (!mayView.ok) {
        return { ok: false as const, reason: 'template_unavailable' as const, detail: 'no permission to view templates' };
      }
      const { data, error } = await supabase
        .from('report_templates')
        .select(TEMPLATE_DESIGN_COLUMNS)
        .eq('id', reference.templateId)
        .maybeSingle();
      // A failed read is not a missing row: log what the database said, and
      // tell the person to try again rather than to choose another.
      if (error) {
        console.warn(`[${route}] design template ${reference.templateId} unreadable: ${error.message}`);
        return { ok: false as const, reason: 'template_unreadable' as const, detail: 'unreadable' };
      }
      const row = data as (DesignTemplateRow & { tokens?: unknown; lineage?: unknown }) | null;
      if (!row) return { ok: false as const, reason: 'template_unavailable' as const, detail: 'no such template' };

      const owned = templateVisibleTo(row, actor.userId, false);
      const visible = owned || (await requireSuperadmin(supabase, actor)).ok;
      if (!visible || !designRowUsableFor(row, reportType)) {
        return { ok: false as const, reason: 'template_unavailable' as const, detail: 'not offered for this report' };
      }
      return designFromTemplateRow({ id: row.id, name: row.name ?? null, tokens: row.tokens, lineage: row.lineage });
    } catch (e) {
      // A design is never worth the document: whatever threw, the answer is the
      // standard design and a sentence saying the choice was not honoured.
      const message = e instanceof Error ? e.message : String(e);
      if (reference.kind !== 'template') {
        console.warn(`[${route}] catalogue design ${reference.code} unresolvable: ${message}`);
        return { ok: false as const, reason: 'unknown_design' as const, detail: 'unresolvable' };
      }
      console.warn(`[${route}] design template ${reference.templateId} unreadable: ${message}`);
      return { ok: false as const, reason: 'template_unreadable' as const, detail: 'unreadable' };
    }
  })();

  if (result.ok === false) {
    console.warn(`[${route}] design not applied (${result.reason}): ${result.detail}`);
    return { design: null, echo: refusedEcho(result.reason) };
  }
  for (const note of result.design.notes) console.warn(`[${route}] design ${result.design.label}: ${note}`);
  return { design: result.design, echo: appliedEcho(result.design) };
}

/**
 * The design a person chose for a report type, read on the server.
 *
 * For a render nobody is watching — the scheduled Market Intelligence send —
 * which renders on its owner's behalf and must come out the way that owner's
 * own download does. The browser reads the same choice before every render it
 * asks for (`standardDesign.ts`); this is that reading, with the same lending
 * rule, for the one caller that has no browser.
 *
 * Only a template row's id is returned: whether that row may be drawn for this
 * person is still decided by `resolveRequestedDesign`, exactly as for a
 * design a browser sent. A failed read is no choice at all, and is logged.
 */
export async function chosenDesignReference(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: { userId: string; reportType: string; route: string },
): Promise<TemplateDesignReference | null> {
  const { userId, reportType, route } = args;
  if (!userId || userId === 'service_role') return null;
  try {
    const { data, error } = await supabase
      .from('report_template_selections')
      .select('report_type, template_id')
      .eq('owner_user_id', userId);
    if (error) {
      console.warn(`[${route}] template choice unreadable for ${userId}: ${error.message}`);
      return null;
    }
    const byFormat = new Map<string, string>();
    for (const row of (data ?? []) as Array<{ report_type?: unknown; template_id?: unknown }>) {
      const key = normaliseReportType(String(row.report_type ?? ''));
      if (key && typeof row.template_id === 'string' && row.template_id) byFormat.set(key, row.template_id);
    }
    const own = byFormat.get(normaliseReportType(reportType));
    const lender = designLenderFor(reportType);
    const templateId = own ?? (lender ? byFormat.get(lender) : undefined);
    return templateId ? { kind: 'template', templateId: templateId.toLowerCase() } : null;
  } catch (e) {
    console.warn(`[${route}] template choice unreadable for ${userId}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
