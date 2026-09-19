import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'supabase/functions/finance-portal-batch9-10/index.ts'),
  'utf8',
);

describe('finance portal voice memo authorization', () => {
  const operationStart = source.indexOf("if (operation === 'voice_memo_save')");
  const nextOperation = source.indexOf("if (operation === '", operationStart + 1);
  const operationSource = source.slice(operationStart, nextOperation === -1 ? undefined : nextOperation);

  it('authorizes client and purchase-file references before the service-role insert', () => {
    expect(operationStart).toBeGreaterThan(-1);
    expect(operationSource).toContain('canAccessPurchaseFile(supabase, portalUser.id, purchaseFileId)');
    expect(operationSource).toContain('canAccessFinanceClient(supabase, portalUser.id, clientId)');
    expect(operationSource).toContain('purchaseFile.client_id !== clientId');
    expect(operationSource.indexOf('canAccessPurchaseFile')).toBeLessThan(
      operationSource.indexOf(".from('ai_voice_memos')"),
    );
  });

  it('bounds request sizes and applies a persistent per-user rate limit', () => {
    expect(operationSource).toContain('transcript.length > 20_000');
    expect(operationSource).toContain('summary.length > 4_000');
    expect(operationSource).toContain('durationSeconds > 3_600');
    expect(operationSource).toContain('consumeRateLimit(');
    expect(operationSource).toContain('finance-voice-memo:user:${portalUser.id}');
  });
});
