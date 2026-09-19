import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'supabase/functions/one-time-bulk-conversation-sync/index.ts',
  'utf8',
);

describe('one-time bulk conversation sync security contract', () => {
  it('authenticates and requires superadmin authorization before sync queries', () => {
    const authIndex = source.indexOf('await verifyAuth(supabase, req.headers, body)');
    const authorizationIndex = source.indexOf('await actorIsSuperadmin(supabase, auth.userId)');
    const clientsQueryIndex = source.indexOf(".from('clients')");

    expect(authIndex).toBeGreaterThan(-1);
    expect(authorizationIndex).toBeGreaterThan(authIndex);
    expect(clientsQueryIndex).toBeGreaterThan(authorizationIndex);
  });

  it('bounds caller-controlled pagination', () => {
    expect(source).toContain('const MAX_BATCH_SIZE = 100;');
    expect(source).toContain('requestedBatchSize > MAX_BATCH_SIZE');
    expect(source).toContain('!Number.isInteger(requestedOffset) || requestedOffset < 0');
  });

  it('never creates a broadcast completion notification', () => {
    expect(source).toContain("if (auth.userId !== 'service_role') try");
    expect(source).toContain('target_user_id: auth.userId');
  });
});
