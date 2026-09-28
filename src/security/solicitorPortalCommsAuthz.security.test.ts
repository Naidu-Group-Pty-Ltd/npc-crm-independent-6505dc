import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutComments } from './sourceCode';

const source = readFileSync('supabase/functions/solicitor-portal-comms/index.ts', 'utf8');

describe('solicitor-portal-comms authorization', () => {
  /**
   * The scoping is by accessible MATTER now, not by permitted client.
   *
   * This asserted a verbatim `assignedClientIds.map(async (clientId) => {…`
   * block, a `can(perms, 'messages', 'view') ? clientId : null` ternary and
   * `.in('client_id', permittedClientIds)`. None survives: the global thread
   * list filters `.in('legal_matter_id', accessibleMatterIds)` and the
   * `messages`/`view` check moved onto the per-matter path
   * (`resolveSolicitorMatterAccess` → `resolveMatterPermissions`) and onto
   * `canViewNotification`, which checks a notification against the same matter
   * list the threads are read from.
   *
   * `canViewNotification` used a per-client matrix until 28 Sep 2026, and that
   * code could not run: a merge on 30 Jul 2026 (cea3d88) deleted
   * `assignedClientIds` and the `resolveClientPermissions` import while keeping
   * the lines that used them, so every notification list, summary and
   * mark-read threw a ReferenceError. This test asserted those exact lines, and
   * it went on passing because it read the source rather than running it.
   *
   * The property is unchanged and asserted below: a solicitor's global list is
   * bounded by what they may access AND by their firm, a matter thread needs
   * `messages`/`view`, and a `message_received` notification is filtered by the
   * same permission rather than shown because it arrived.
   *
   * Matching a multi-line source block verbatim is what made this brittle
   * enough to go stale unnoticed; these are behavioural anchors instead.
   */
  it('bounds the global thread list by accessible matters and firm', () => {
    expect(source).toContain(".in('legal_matter_id', accessibleMatterIds)");
    expect(source).toContain(".eq('firm_id', me.firm_id)");
    // An empty access set returns nothing rather than falling through to an
    // unfiltered query.
    expect(source).toContain('if (accessibleMatterIds.length === 0)');
  });

  it('requires messages view on the matter path', () => {
    expect(source).toContain("can(perms, 'messages', 'view')");
    expect(source).toContain('resolveMatterPermissions(supabase, access)');
  });

  it('filters message notifications by the same permission', () => {
    expect(source).toContain('canViewNotification');
    expect(source).toContain('filterViewableNotifications');
    // The list the threads are read from, under `messages`, is the list a
    // message notification is checked against.
    expect(source).toContain(
      "const accessibleMatterIds = await listAccessibleMatterIds(supabase, me.id, me.firm_id, 'messages');",
    );
    expect(source).toContain('const messagesViewable = new Set(accessibleMatterIds);');
    expect(source).toContain(
      "if (notification.notification_type === 'message_received') return messagesViewable.has(matterId);",
    );
    // Any other notification about a matter follows that matter's own view
    // permission.
    expect(source).toContain("listAccessibleMatterIds(supabase, me.id, me.firm_id, 'matters')");
    // A notification that names no matter can be checked against nothing, so
    // it is shown only when it names no client either.
    expect(source).toContain(
      "return notification.notification_type !== 'message_received' && !notification.client_id;",
    );
    // Every read that feeds the check selects the fields the check reads.
    expect(
      source.match(/\.select\('id, client_id, legal_matter_id, notification_type'\)/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    // The per-client names cea3d88 deleted must not come back half-wired.
    expect(withoutComments(source)).not.toMatch(/assignedClientIds|permissionCache|resolveClientPermissions/);
  });
});
