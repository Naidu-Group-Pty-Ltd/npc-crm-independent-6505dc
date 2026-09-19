/**
 * notify — targeted notification helper (second-round audit: "target all
 * notification rows to an explicit user unless intentionally system-wide").
 *
 * The notifications RLS treats target_user_id IS NULL as a broadcast visible to
 * every authenticated user, so a null-target notification about a central
 * mailbox email leaked sender names/subjects to all staff. This helper inserts
 * notifications targeted to specific recipients:
 *   - a single explicit user (personal mailbox / direct notifications), or
 *   - the set of users who can view a given module (+ superadmins), for
 *     shared/central resources.
 */

interface NotificationFields {
  type: string;
  title: string;
  message: string;
  entity_id?: string | null;
  read?: boolean;
  [key: string]: unknown;
}

/** Resolve user IDs that can view a module, plus all superadmins. */
async function resolveModuleViewerIds(supabase: any, moduleKey: string): Promise<string[]> {
  const ids = new Set<string>();

  const { data: superadmins } = await supabase
    .from('user_roles').select('user_id').eq('role', 'superadmin');
  for (const r of superadmins ?? []) if (r.user_id) ids.add(r.user_id);

  const { data: mod } = await supabase
    .from('dashboard_modules').select('id').eq('module_key', moduleKey).eq('is_active', true).maybeSingle();
  if (mod?.id) {
    const { data: perms } = await supabase
      .from('user_permissions').select('user_id').eq('module_id', mod.id).eq('can_view', true);
    for (const p of perms ?? []) if (p.user_id) ids.add(p.user_id);
  }
  return [...ids];
}

/**
 * Insert a notification targeted to explicit recipients. Provide EITHER
 * targetUserId (single user) OR moduleKey (fan out to module viewers +
 * superadmins). Never inserts a null-target (broadcast) row. Best-effort:
 * never throws into the caller's request path.
 */
export async function insertTargetedNotification(
  supabase: any,
  opts: { targetUserId?: string | null; moduleKey?: string; notification: NotificationFields },
): Promise<void> {
  try {
    const base = { read: false, ...opts.notification };
    let recipients: string[] = [];

    if (opts.targetUserId) {
      recipients = [opts.targetUserId];
    } else if (opts.moduleKey) {
      recipients = await resolveModuleViewerIds(supabase, opts.moduleKey);
    }

    // If we could not resolve any recipient, do NOT fall back to a broadcast —
    // skip rather than leak. (A misconfigured module simply yields no bell.)
    if (recipients.length === 0) return;

    const rows = recipients.map((uid) => ({ ...base, target_user_id: uid }));
    await supabase.from('notifications').insert(rows);
  } catch (_e) {
    // Notification delivery must never break the sync/request path.
  }
}
