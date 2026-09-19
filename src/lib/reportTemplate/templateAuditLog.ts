/**
 * templateAuditLog — fire-and-forget logger for the template_audit_log table.
 * Never throws to callers; failures are swallowed and console-warned.
 */
import { supabase } from '@/integrations/supabase/client';

export type TemplateAuditAction =
  | 'schema_saved'
  | 'version_created'
  | 'version_restored'
  | 'branch_created'
  | 'branch_merged'
  | 'approval_requested'
  | 'approval_approved'
  | 'approval_changes_requested'
  | 'approval_cancelled'
  | 'locked'
  | 'unlocked'
  | 'activated'
  | 'deactivated'
  | 'exported_pdf'
  | 'exported_docx'
  | 'exported_pptx'
  | 'exported_html';

export async function logTemplateAudit(
  templateId: string,
  action: TemplateAuditAction,
  summary?: string,
  metadata: Record<string, any> = {},
) {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const user = sess?.session?.user;
    await supabase.from('template_audit_log' as any).insert({
      template_id: templateId,
      actor_id: user?.id ?? null,
      actor_name: (user?.user_metadata as any)?.full_name || user?.email || 'Unknown',
      action,
      summary: summary ?? null,
      metadata,
    });
  } catch (e) {
    console.warn('[templateAuditLog]', e);
  }
}
