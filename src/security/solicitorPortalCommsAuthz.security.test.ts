import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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
   * `canViewNotification`, which caches a client permission matrix per client.
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
    expect(source).toContain("can(permissionCache.get(clientId) ?? null, 'messages', 'view')");
    // A notification for a client this solicitor is not assigned to never
    // reaches the permission check at all.
    expect(source).toContain('if (clientId && !assignedClientIds.includes(clientId)) return false;');
  });
});
