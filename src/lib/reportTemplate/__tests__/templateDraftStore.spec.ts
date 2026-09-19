import { describe, it, expect } from 'vitest';
import {
  makeDraftSignature,
  makeTemplateDraftKey,
  evaluateDraftRecovery,
  type DraftComparableFields,
  type TemplateDraft,
} from '../templateDraftStore';
import { type ReportTemplate } from '../templateSchema';

// A FIXED schema (deterministic page id) — `makeBlankTemplate()` assigns a random
// page id, which makes signature comparisons across two independently-built
// templates flaky. The signature is just a JSON serialization, so a stable plain
// object is all we need here.
const FIXED_SCHEMA = {
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: [{ id: 'fixed-page', name: 'Cover', size: { width: 595, height: 842 }, background: {}, blocks: [] }],
} as unknown as ReportTemplate;

function fields(overrides: Partial<DraftComparableFields> = {}): DraftComparableFields {
  return {
    name: 'My template',
    description: '',
    reportType: 'investment',
    tier: 'premium',
    variant: '',
    scope: 'global',
    priority: 0,
    customCss: '',
    schema: FIXED_SCHEMA,
    ...overrides,
  };
}

function draftFrom(f: DraftComparableFields, overrides: Partial<TemplateDraft> = {}): TemplateDraft {
  return {
    ownerId: 'user-1',
    templateId: 't1',
    baseServerVersion: 3,
    savedAt: '2026-06-07T00:00:00.000Z',
    sampleDataText: '{}',
    ...f,
    ...overrides,
  };
}

describe('makeDraftSignature', () => {
  it('is stable for identical content', () => {
    expect(makeDraftSignature(fields())).toBe(makeDraftSignature(fields()));
  });

  it('ignores non-content fields (savedAt / templateId / baseServerVersion)', () => {
    const f = fields();
    const a = draftFrom(f, { savedAt: '2026-01-01T00:00:00.000Z', baseServerVersion: 1, templateId: 'x' });
    const b = draftFrom(f, { savedAt: '2030-12-31T00:00:00.000Z', baseServerVersion: 99, templateId: 'y' });
    expect(makeDraftSignature(a)).toBe(makeDraftSignature(b));
  });

  it('changes when a content field changes', () => {
    expect(makeDraftSignature(fields())).not.toBe(makeDraftSignature(fields({ name: 'Renamed' })));
    expect(makeDraftSignature(fields())).not.toBe(makeDraftSignature(fields({ customCss: '.x{}' })));
  });

  it('changes when the schema changes', () => {
    const changed = { ...FIXED_SCHEMA, pages: [{ id: 'different-page', blocks: [] }] } as unknown as ReportTemplate;
    expect(makeDraftSignature(fields())).not.toBe(makeDraftSignature(fields({ schema: changed })));
  });

  it('normalizes missing/NaN priority to 0', () => {
    expect(makeDraftSignature(fields({ priority: NaN }))).toBe(makeDraftSignature(fields({ priority: 0 })));
  });
});

describe('makeTemplateDraftKey', () => {
  it('isolates the same template between authenticated users', () => {
    expect(makeTemplateDraftKey('user-a', 'template-1')).not.toBe(
      makeTemplateDraftKey('user-b', 'template-1'),
    );
  });

  it('cannot collide when ids contain separators', () => {
    expect(makeTemplateDraftKey('user:a', 'template')).not.toBe(
      makeTemplateDraftKey('user', 'a:template'),
    );
  });
});

describe('evaluateDraftRecovery', () => {
  const server = fields();
  const serverSignature = makeDraftSignature(server);

  it('does not recover when there is no draft', () => {
    expect(evaluateDraftRecovery({ draft: null, serverSignature, currentServerVersion: 3 })).toEqual({
      recover: false,
      staleBase: false,
    });
  });

  it('does not recover when the draft matches the server', () => {
    const draft = draftFrom(server, { baseServerVersion: 3 });
    expect(evaluateDraftRecovery({ draft, serverSignature, currentServerVersion: 3 })).toEqual({
      recover: false,
      staleBase: false,
    });
  });

  it('recovers when the draft differs from the server', () => {
    const draft = draftFrom(fields({ name: 'Local edit' }), { baseServerVersion: 3 });
    const decision = evaluateDraftRecovery({ draft, serverSignature, currentServerVersion: 3 });
    expect(decision.recover).toBe(true);
    expect(decision.staleBase).toBe(false);
  });

  it('flags a stale base when the server moved on', () => {
    const draft = draftFrom(fields({ name: 'Local edit' }), { baseServerVersion: 3 });
    const decision = evaluateDraftRecovery({ draft, serverSignature, currentServerVersion: 5 });
    expect(decision.recover).toBe(true);
    expect(decision.staleBase).toBe(true);
  });
});
