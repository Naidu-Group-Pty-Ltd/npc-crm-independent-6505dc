import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  IMPORT_INTELLIGENCE_PROFILE_VERSION,
  saveImportIntelligenceProfile,
  loadImportIntelligenceProfile,
  buildImportIntelligenceProfile,
  type ImportIntelligenceProfile,
} from '../ingestion/importIntelligence';
import { invokeSecureFunction } from '@/lib/secureInvoke';

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(),
}));

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

function profile(): ImportIntelligenceProfile {
  return buildImportIntelligenceProfile({
    importId: 'import-1',
    snapshot: { importId: 'import-1', importPageCount: 1, visualQaScore: 0.97 },
    now: NOW,
  });
}

beforeEach(() => {
  vi.mocked(invokeSecureFunction).mockReset();
});

describe('saveImportIntelligenceProfile', () => {
  it('returns error when importId missing', async () => {
    const res = await saveImportIntelligenceProfile('', profile());
    expect(res.kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });

  it('returns error when profile missing', async () => {
    const res = await saveImportIntelligenceProfile('import-1', undefined as any);
    expect(res.kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });

  it('calls template-import-pdf append_meta with the profile', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { ok: true }, error: null } as any);
    const p = profile();
    const res = await saveImportIntelligenceProfile('import-1', p);
    expect(res.kind).toBe('ok');
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'append_meta',
          import_id: 'import-1',
          meta_patch: expect.objectContaining({
            import_intelligence_profile: p,
          }),
        }),
      }),
    );
  });

  it('maps a backend error to kind error', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { error: 'forbidden' }, error: null } as any);
    const res = await saveImportIntelligenceProfile('import-1', profile());
    expect(res.kind).toBe('error');
  });
});

describe('loadImportIntelligenceProfile', () => {
  it('returns error when importId missing', async () => {
    const res = await loadImportIntelligenceProfile('');
    expect(res.kind).toBe('error');
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });

  it('calls get_status', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: {} } }, error: null } as any);
    await loadImportIntelligenceProfile('import-1');
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({ body: expect.objectContaining({ operation: 'get_status', import_id: 'import-1' }) }),
    );
  });

  it('returns missing when profile absent', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: { record: { meta: {} } }, error: null } as any);
    const res = await loadImportIntelligenceProfile('import-1');
    expect(res.kind).toBe('missing');
  });

  it('returns ok when profile present', async () => {
    const p = profile();
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { record: { meta: { import_intelligence_profile: p } } }, error: null,
    } as any);
    const res = await loadImportIntelligenceProfile('import-1');
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.profile.version).toBe(IMPORT_INTELLIGENCE_PROFILE_VERSION);
  });

  it('returns error for a wrong version', async () => {
    const p = { ...profile(), version: 'old-version' };
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { record: { meta: { import_intelligence_profile: p } } }, error: null,
    } as any);
    const res = await loadImportIntelligenceProfile('import-1');
    expect(res.kind).toBe('error');
  });
});
