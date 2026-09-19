import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canResyncTemplate } from '../templateResyncAuthorization.ts';

Deno.test('template resync allows the template owner', () => {
  assertEquals(canResyncTemplate({ requesterId: 'owner', templateOwnerId: 'owner' }), true);
});

Deno.test('template resync rejects an unrelated low-privilege requester', () => {
  assertEquals(canResyncTemplate({
    requesterId: 'attacker',
    templateOwnerId: 'victim',
    customUserRole: 'user',
    assignedRoles: ['user'],
    canEditTemplates: false,
  }), false);
});

Deno.test('template resync allows effective template editors and superadmins', () => {
  assertEquals(canResyncTemplate({
    requesterId: 'editor',
    templateOwnerId: 'victim',
    canEditTemplates: true,
  }), true);
  assertEquals(canResyncTemplate({
    requesterId: 'admin',
    templateOwnerId: 'victim',
    assignedRoles: ['superadmin'],
  }), true);
});
