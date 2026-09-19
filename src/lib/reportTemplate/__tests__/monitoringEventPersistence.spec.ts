import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: vi.fn() }));

import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  acknowledgeMonitoringEvent,
  listMonitoringEvents,
  normalizeMonitoringEventRecord,
  runMonitoringCheck,
  suppressMonitoringEvent,
  PDF_IMPORT_MONITORING_FUNCTION,
} from '../ingestion/monitoring';

const mockInvoke = invokeSecureFunction as unknown as ReturnType<typeof vi.fn>;

const DB_ROW = {
  id: 'evt-1',
  event_key: 'import_failure_detected:global',
  rule_id: 'import_failure_detected',
  domain: 'import_pipeline',
  severity: 'high',
  status: 'open',
  owner: 'developer_fullstack',
  release_blocking: true,
  title: 'PDF import failures detected',
  summary: '2 PDF import(s) failed in the last 24h.',
  metric_value: 2,
  threshold: 1,
  occurrence_count: 3,
  first_seen_at: '2026-07-09T00:00:00.000Z',
  last_seen_at: '2026-07-09T01:00:00.000Z',
  acknowledged_at: null,
  acknowledged_by: null,
  resolved_at: null,
  resolved_by: null,
  suppressed_until: null,
  note: null,
  runbook_anchor: 'import-failure-detected',
  context: { failedImports24h: 2, nested: { dropped: true } },
  created_at: '2026-07-09T00:00:00.000Z',
  updated_at: '2026-07-09T01:00:00.000Z',
};

describe('normalizeMonitoringEventRecord', () => {
  it('maps a snake_case DB row and drops nested context', () => {
    const event = normalizeMonitoringEventRecord(DB_ROW);
    expect(event).not.toBeNull();
    expect(event!.ruleId).toBe('import_failure_detected');
    expect(event!.eventKey).toBe('import_failure_detected:global');
    expect(event!.occurrenceCount).toBe(3);
    expect(event!.releaseBlocking).toBe(true);
    expect(event!.context).toEqual({ failedImports24h: 2 });
    expect((event!.context as Record<string, unknown>).nested).toBeUndefined();
  });

  it('returns null when required fields are missing', () => {
    expect(normalizeMonitoringEventRecord({ id: 'x' })).toBeNull();
    expect(normalizeMonitoringEventRecord(null)).toBeNull();
  });
});

describe('persistence invokers', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('runMonitoringCheck posts run_check and normalizes events', async () => {
    mockInvoke.mockResolvedValue({
      data: { ok: true, events: [DB_ROW], rollup: { status: 'high_alerts_present' }, inserted: 1, updated: 0, auto_resolved: 2 },
      error: null,
    });
    const result = await runMonitoringCheck();
    expect(mockInvoke).toHaveBeenCalledWith(
      PDF_IMPORT_MONITORING_FUNCTION,
      expect.objectContaining({ body: expect.objectContaining({ operation: 'run_check' }) }),
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.value.events).toHaveLength(1);
      expect(result.value.autoResolved).toBe(2);
    }
  });

  it('listMonitoringEvents clamps the limit and defaults to active', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, events: [], rollup: null }, error: null });
    await listMonitoringEvents({ limit: 99999 });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(body.operation).toBe('list_events');
    expect(body.status).toBe('active');
    expect(body.limit).toBeLessThanOrEqual(500);
  });

  it('acknowledgeMonitoringEvent requires an id', async () => {
    const result = await acknowledgeMonitoringEvent('');
    expect(result.kind).toBe('error');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('suppressMonitoringEvent forwards the suppression window', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true, event: { ...DB_ROW, status: 'suppressed', suppressed_until: '2026-07-10T00:00:00.000Z' } }, error: null });
    const result = await suppressMonitoringEvent('evt-1', '2026-07-10T00:00:00.000Z');
    expect(mockInvoke.mock.calls[0][1].body).toMatchObject({
      operation: 'suppress_event',
      event_id: 'evt-1',
      suppress_until: '2026-07-10T00:00:00.000Z',
    });
    expect(result.kind).toBe('ok');
  });

  it('surfaces edge-function errors', async () => {
    mockInvoke.mockResolvedValue({ data: { error: 'permission denied' }, error: null });
    const result = await runMonitoringCheck();
    expect(result.kind).toBe('error');
  });
});
