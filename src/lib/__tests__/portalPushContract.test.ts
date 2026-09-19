/**
 * Contract tests for push notifications across the three portals.
 *
 * `send-web-push` read `public.notifications` unconditionally. The portal
 * dispatcher handed it a `client_portal_notifications.id` /
 * `finance_portal_notifications.id`, the lookup found nothing, and the function
 * answered "No target" — every time, silently, for as long as the feature has
 * existed. Solicitors had no dispatcher at all, and no subscriber type, so
 * nothing about that portal could ever reach a device.
 *
 * Each portal keeps its own table with its own column names:
 *
 *   client_portal_notifications     client_id,          title, message, action_url, type
 *   finance_portal_notifications    portal_user_id,     title, body,    link_path,  notification_type
 *   solicitor_portal_notifications  solicitor_user_id,  title, body,    link_path,  notification_type
 *
 * Note client_portal addresses a CLIENT, not a portal user — recipients fan out
 * from client_portal_users, which is why it has no recipient column.
 *
 * Separately: `client_portal_notifications` carried a policy named "Service role
 * full access" that was actually `ALL TO public USING (true)`. `TO public`
 * includes `anon`, so with the table's anon grants every client's notifications
 * were readable — and writable — by anyone. Verified against production: after
 * the fix, anon gets `permission denied for table client_portal_notifications`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const sqlCode = (s: string) => s.replace(/^\s*--.*$/gm, '');
const tsCode = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIGRATION = 'supabase/migrations/20260803060000_portal_push_dispatch_and_rls.sql';

describe('send-web-push reads the table the notification actually lives in', () => {
  const src = tsCode(read('supabase/functions/send-web-push/index.ts'));

  it('knows all four sources', () => {
    for (const type of ['staff', 'client_portal', 'finance_portal', 'solicitor_portal']) {
      expect(src, `no source mapping for ${type}`).toContain(type);
    }
  });

  it('maps each portal to its own column names', () => {
    // finance and solicitor use body/link_path/notification_type; the client
    // portal uses message/action_url/type. Reading `message` off a finance row
    // returns undefined, which is how a push becomes a blank notification.
    expect(src).toMatch(/table: 'client_portal_notifications'[\s\S]{0,160}action_url/);
    expect(src).toMatch(/table: 'finance_portal_notifications'[\s\S]{0,160}link_path/);
    expect(src).toMatch(/table: 'solicitor_portal_notifications'[\s\S]{0,160}link_path/);
  });

  it('fans the client portal out to that client\'s active portal users', () => {
    // client_portal_notifications addresses a client, not a user.
    expect(src).toMatch(/recipientColumn: null/);
    expect(src).toMatch(/from\('client_portal_users'\)[\s\S]{0,200}eq\('status', 'active'\)/);
  });

  it('never takes user-visible content from the request', () => {
    // `source` selects a table. Title, body, link and audience are still read
    // from the persisted row.
    expect(src).toMatch(/row\[src\.titleColumn\]/);
    expect(src).toMatch(/row\[src\.bodyColumn\]/);
    expect(src).toMatch(/sanitizeUrl\(src\.linkColumn/);
  });

  it('falls back to staff for an unknown source rather than trusting it', () => {
    expect(src).toMatch(/VALID_SUBSCRIBERS\.includes\(requested as SubscriberType\)[\s\S]{0,60}'staff'/);
  });

  it('logs delivery against the subscription owner, not a single recipient', () => {
    // With fan-out there is no one target user.
    expect(src).toMatch(/user_id: sub\.user_id/);
    expect(src).not.toMatch(/targetUserId/);
  });
});

describe('the portal dispatcher', () => {
  const sql = read(MIGRATION);
  const code = sqlCode(sql);

  it('tells send-web-push which portal it is', () => {
    for (const s of ['client_portal', 'finance_portal', 'solicitor_portal']) {
      expect(code).toContain(`then '${s}'`);
    }
    expect(code).toMatch(/jsonb_build_object\('notification_id', NEW\.id, 'source', v_source\)/);
  });

  it('gives solicitors a dispatcher for the first time', () => {
    expect(code).toMatch(/create trigger trg_dispatch_web_push_solicitor_portal[\s\S]{0,120}solicitor_portal_notifications/);
  });

  it('drops the hardcoded anon key and authenticates like everything else', () => {
    expect(code).not.toMatch(/eyJhbGciOiJIUzI1NiI/);
    expect(code).toMatch(/vault\.decrypted_secrets/);
    expect(code).toMatch(/cron_signed_internal_headers/);
  });

  it('warns instead of swallowing', () => {
    expect(code).toMatch(/exception when others then[\s\S]{0,220}raise warning/i);
  });

  it('asserts no portal trigger reads a missing field', () => {
    expect(code).toMatch(/raise exception[\s\S]{0,120}read missing fields/i);
  });
});

describe('the client portal notification table is no longer world-readable', () => {
  const code = sqlCode(read(MIGRATION));

  it('replaces the TO public policy with a service-role one', () => {
    expect(code).toMatch(/drop policy if exists "Service role full access on portal notifications"/);
    expect(code).toMatch(/create policy client_portal_notifications_service_role_only[\s\S]{0,120}for all to service_role/);
  });

  it('removes the grants that made the open policy reachable', () => {
    expect(code).toMatch(/revoke all on public\.client_portal_notifications from anon, authenticated/);
  });
});

describe('solicitor devices can register for push', () => {
  const src = tsCode(read('supabase/functions/push-subscribe/index.ts'));

  it('accepts the solicitor subscriber type', () => {
    expect(src).toMatch(/'solicitor_portal'/);
    expect(src).toMatch(/subscriber_type === 'solicitor_portal'/);
  });

  it('reuses the portal resolver instead of re-implementing a hashed lookup', () => {
    // solicitor_portal_sessions stores token_hash, never a plaintext token.
    expect(src).toMatch(/resolveSolicitorSession\(supabase, req\.headers, body\)/);
    expect(src).not.toMatch(/from\('solicitor_portal_sessions'\)/);
  });

  it('refuses an invalid solicitor session', () => {
    expect(src).toMatch(/if \(!session\.ok \|\| !session\.user\?\.id\)/);
  });
});
