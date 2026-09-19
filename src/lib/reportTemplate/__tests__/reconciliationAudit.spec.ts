import { describe, expect, it, vi } from 'vitest';
import {
  AI_RECONCILIATION_AUDIT_VERSION,
  buildAiReconciliationAuditSummary,
  saveAiReconciliationAuditSummary,
} from '../ingestion/reconciliation/reconciliationAudit';
import { invokeSecureFunction } from '@/lib/secureInvoke';

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(),
}));

describe('buildAiReconciliationAuditSummary', () => {
  it('1. stamps the version', () => {
    const s = buildAiReconciliationAuditSummary({
      status: 'completed',
      recommendation: 'recommended',
      reason: 'r',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:05.000Z',
    });
    expect(s.version).toBe('ai-reconciliation-summary-v1');
    expect(AI_RECONCILIATION_AUDIT_VERSION).toBe('ai-reconciliation-summary-v1');
  });

  it('2. completed audit populates completedAt and leaves failure fields empty', () => {
    const s = buildAiReconciliationAuditSummary({
      status: 'completed',
      recommendation: 'recommended',
      reason: 'AI reconciliation recommended',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:05.000Z',
      visualQaScoreBefore: 0.7,
      repairFinalScoreBefore: 0.82,
      editableElementsCreated: 12,
      layoutChanges: 3,
    });
    expect(s.status).toBe('completed');
    expect(s.completedAt).toBe('2026-01-01T00:00:05.000Z');
    expect(s.failedAt ?? null).toBeNull();
    expect(s.errorMessage ?? null).toBeNull();
    expect(s.visualQaScoreBefore).toBe(0.7);
    expect(s.repairFinalScoreBefore).toBe(0.82);
    expect(s.editableElementsCreated).toBe(12);
    expect(s.layoutChanges).toBe(3);
    expect(s.warnings).toEqual([]);
  });

  it('3. failed audit populates failedAt and errorMessage', () => {
    const s = buildAiReconciliationAuditSummary({
      status: 'failed',
      recommendation: 'recommended',
      reason: 'AI reconciliation recommended',
      startedAt: '2026-01-01T00:00:00.000Z',
      failedAt: '2026-01-01T00:00:05.000Z',
      errorMessage: 'provider timeout',
    });
    expect(s.status).toBe('failed');
    expect(s.failedAt).toBe('2026-01-01T00:00:05.000Z');
    expect(s.errorMessage).toBe('provider timeout');
    expect(s.completedAt).toBeNull();
  });
});

describe('saveAiReconciliationAuditSummary', () => {
  const summary = buildAiReconciliationAuditSummary({
    status: 'completed',
    recommendation: 'recommended',
    reason: 'r',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:05.000Z',
  });

  it('4. sends append_meta with ai_reconciliation_summary patch', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { ok: true }, error: null } as any);
    await saveAiReconciliationAuditSummary('import_123', summary);
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'append_meta',
          import_id: 'import_123',
          meta_patch: { ai_reconciliation_summary: summary },
        }),
      }),
    );
  });

  it('5. success returns kind ok', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { ok: true }, error: null } as any);
    expect(await saveAiReconciliationAuditSummary('import_123', summary)).toEqual({ kind: 'ok' });
  });

  it('6. backend error returns kind error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { error: 'forbidden' }, error: { message: 'forbidden' } } as any);
    const r = await saveAiReconciliationAuditSummary('import_123', summary);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toContain('forbidden');
  });

  it('7. missing importId returns error', async () => {
    const r = await saveAiReconciliationAuditSummary('', summary);
    expect(r.kind).toBe('error');
  });

  it('8. missing summary returns error', async () => {
    const r = await saveAiReconciliationAuditSummary('import_123', undefined as any);
    expect(r.kind).toBe('error');
  });
});
