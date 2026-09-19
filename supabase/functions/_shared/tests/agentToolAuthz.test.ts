import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { AgentToolAuthzError, authorizeAgentTool } from '../agentToolAuthz.ts';

function authorizationSupabase() {
  const checkedClientIds: string[] = [];
  return {
    checkedClientIds,
    from(table: string) {
      let clientId: string | undefined;
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          if (table === 'clients' && column === 'id') clientId = value;
          return query;
        },
        maybeSingle: async () => {
          if (table === 'custom_users') return { data: { role: 'user' } };
          if (table === 'user_roles') return { data: [] };
          if (table === 'dashboard_modules') return { data: { id: 'client-management' } };
          if (table === 'user_permissions') return { data: { can_edit: true } };
          if (table === 'clients') {
            checkedClientIds.push(clientId!);
            return { data: { created_by: clientId === 'owned-client' ? 'staff-user' : 'other-user', assigned_team_user_id: null } };
          }
          return { data: null };
        },
        insert: async () => ({ error: null }),
      };
      return query;
    },
  };
}

Deno.test('bulk client actions deny a confirmed request containing an unowned client', async () => {
  const sb = authorizationSupabase();

  await assertRejects(
    () => authorizeAgentTool(
      sb,
      'bulk_update_clients',
      { client_ids: ['owned-client', 'other-client'], field: 'status', value: 'active' },
      'staff-user',
      { actorType: 'human', stepUpVerified: true },
    ),
    AgentToolAuthzError,
    'User does not own client_ids=other-client',
  );

  assertEquals(sb.checkedClientIds, ['owned-client', 'other-client']);
});
