import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/solicitor-portal-comms/index.ts', 'utf8');

describe('solicitor portal notification authorization', () => {
  it('rechecks effective message permissions before exposing notification previews', () => {
    expect(source).toContain("notification.notification_type !== 'message_received'");
    expect(source).toContain('resolveClientPermissions(supabase, me.id, clientId)');
    expect(source).toContain("can(permissionCache.get(clientId) ?? null, 'messages', 'view')");
    expect(source).toContain('filterViewableNotifications(notifications || [])');
  });

  it('does not expose or mutate inaccessible notifications through parallel operations', () => {
    expect(source).toContain('filterViewableNotifications(unreadNotifications || [])');
    expect(source).toContain('!(await canViewNotification(notification))');
    expect(source).toContain("return json({ error: 'Notification not found' }, 404)");
    expect(source).toContain(".in('id', viewable.map((notification: any) => notification.id))");
  });
});
