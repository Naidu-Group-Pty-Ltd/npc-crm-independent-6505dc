import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const source=readFileSync('supabase/functions/market-updates-archive/index.ts','utf8');

describe('market-updates-archive backend contract',()=>{
  it('requires authentication and edit permission',()=>{
    expect(source).toContain("verifyAuth(sb, req.headers");
    expect(source).toContain("'market_updates', 'can_edit'");
    expect(source).toContain("auth.userId === 'service_role'");
  });

  it('accepts only a canonical UUID and boolean archive state',()=>{
    expect(source).toContain("action === 'set_archive_state'");
    expect(source).toContain("typeof body.updateId==='string'");
    expect(source).toContain("typeof body.archived!=='boolean'");
    expect(source).toContain("code:'INVALID_UPDATE_ID'");
  });

  it('implements metadata-preserving idempotent archive and restore transitions',()=>{
    expect(source).toContain("wantsArchived===Boolean(row.archived_at)");
    expect(source).toContain("pre_archive_status:row.status");
    expect(source).toContain("status:restoredStatus");
    expect(source).toContain(".select('id,archived_at').maybeSingle()");
    expect(source).not.toMatch(/\.delete\(/);
  });

  it('returns status-specific structured, correlated failures',()=>{
    expect(source).toContain("code:'MARKET_NEWS_NOT_FOUND'");
    expect(source).toContain("code:'MARKET_NEWS_WRITE_FAILED'");
    expect(source).toContain("correlationId},404");
    expect(source).toContain("correlationId},500");
    expect(source).toContain("'x-correlation-id':correlationId");
  });
});
