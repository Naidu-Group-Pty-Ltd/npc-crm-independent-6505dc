import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withoutComments } from './sourceCode';

const source = readFileSync('supabase/functions/solicitor-portal-comms/index.ts', 'utf8');

describe('solicitor portal notification authorization', () => {
  /**
   * A preview is shown only when the matter it names is on this solicitor's
   * `messages` list.
   *
   * This asserted `resolveClientPermissions(supabase, me.id, clientId)` and a
   * `permissionCache` lookup. Both were still in the source while the import
   * and the client list they depended on were gone (cea3d88, 30 Jul 2026), so
   * the source matched and every call threw. The check is the same matter list
   * the thread view reads now, and the names that could not run are asserted
   * absent, so they cannot come back half-wired.
   */
  it('rechecks effective message permissions before exposing notification previews', () => {
    expect(source).toContain("notification.notification_type !== 'message_received'");
    expect(source).toContain("listAccessibleMatterIds(supabase, me.id, me.firm_id, 'messages')");
    expect(source).toContain('return messagesViewable.has(matterId);');
    expect(source).toContain('filterViewableNotifications(notifications || [])');
    expect(withoutComments(source)).not.toMatch(/resolveClientPermissions|assignedClientIds|permissionCache/);
  });

  it('does not expose or mutate inaccessible notifications through parallel operations', () => {
    expect(source).toContain('filterViewableNotifications(unreadNotifications || [])');
    expect(source).toContain('!(await canViewNotification(notification))');
    expect(source).toContain("return json({ error: 'Notification not found' }, 404)");
    expect(source).toContain(".in('id', viewable.map((notification: any) => notification.id))");
  });
});
