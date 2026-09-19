/**
 * `use_for_reports` — the library entry → selectable template rules.
 *
 * The operation exists so the report-template picker can offer the library's
 * designs directly: choosing one asks the server for an ACTIVE, user-scoped
 * copy it can store as the selection. These are the rules that make that safe,
 * executed rather than scanned:
 *
 * - only a published, production-ready, WeasyPrint entry with a production
 *   report pipeline may back live generation (`validateEntryForReportUse`);
 * - the copy is born in the activation gate's state but scoped to its owner,
 *   so it can never reach anyone else's documents
 *   (`buildReportUseCopyPayload`);
 * - the entry's default colourway is recorded as null — the authored palette,
 *   unbaked — which is how the seeded global masters record it, so adopting
 *   the house default finds the house master instead of duplicating it
 *   (`normaliseRequestedColourwayId` + `matchesReportUseCopy`).
 */
import { describe, expect, it } from 'vitest';
import {
  buildReportUseCopyPayload,
  matchesReportUseCopy,
  normaliseRequestedColourwayId,
  requiredAuthzFor,
  validateEntryForReportUse,
} from '../../../../supabase/functions/_shared/templateLibraryCore.pure.ts';
import { defaultColourwayFor } from '@/lib/templateLibrary/colourways';

const DEFAULT_CW = defaultColourwayFor('private_banking');

const entry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'entry-1',
  slug: 'report-qa-pb-01-chancery',
  version: 1,
  name: 'Chancery',
  description: 'The reference expression.',
  report_type: 'qa',
  tier: 'compass',
  variant: null,
  engine: 'weasyprint',
  status: 'published',
  production_ready: true,
  custom_css: null,
  config: {},
  schema: { version: 1, tokens: {}, pages: [] },
  design_meta: {
    familyKey: 'private_banking',
    familyName: 'Private Banking',
    templateCode: 'pb-01',
    variantAxis: 'A · reference',
    density: 'balanced',
    defaultColourway: DEFAULT_CW?.id,
    colourways: [DEFAULT_CW?.id],
  },
  ...overrides,
});

describe('validateEntryForReportUse', () => {
  it('accepts a published, production-ready WeasyPrint entry', () => {
    expect(validateEntryForReportUse(entry())).toBeNull();
  });

  it('refuses everything the render path would silently drop', () => {
    // Each of these would otherwise become a selection that changes nothing —
    // the picker promising a document the route cannot produce.
    expect(validateEntryForReportUse(entry({ status: 'draft' }))?.code).toBe('not_published');
    expect(validateEntryForReportUse(entry({ engine: 'jspdf' }))?.code).toBe('engine_not_supported');
    expect(validateEntryForReportUse(entry({ production_ready: false }))?.code)
      .toBe('not_production_ready');
    expect(validateEntryForReportUse(entry({ report_type: 'cash_flow_comparison' }))?.code)
      .toBe('format_not_production');
    expect(validateEntryForReportUse(entry({ report_type: null }))?.code)
      .toBe('format_not_production');
  });
});

describe('normaliseRequestedColourwayId', () => {
  it('maps the entry default — and nothing at all — to null', () => {
    expect(normaliseRequestedColourwayId(entry(), DEFAULT_CW?.id)).toBeNull();
    expect(normaliseRequestedColourwayId(entry(), null)).toBeNull();
    expect(normaliseRequestedColourwayId(entry(), '')).toBeNull();
  });

  it('passes a non-default choice through', () => {
    expect(normaliseRequestedColourwayId(entry(), 'pb-oxblood-night')).toBe('pb-oxblood-night');
  });
});

describe('buildReportUseCopyPayload', () => {
  const payload = buildReportUseCopyPayload({
    userId: 'user-9',
    entry: entry(),
    schema: { version: 1, tokens: {}, pages: [] },
    colourway: null,
  });

  it('is born selectable: active, approved, not a draft', () => {
    expect(payload.is_active).toBe(true);
    expect(payload.is_draft).toBe(false);
    expect(payload.approval_status).toBe('approved');
  });

  it('is scoped to its owner, so it reaches nobody else', () => {
    expect(payload.scope).toBe('user');
    expect(payload.owner_user_id).toBe('user-9');
    // Never the house default — that is a global, superadmin-made decision.
    expect(payload.is_default).toBe(false);
  });

  it('inherits the working copy’s lineage block, with the authored palette as null', () => {
    const lineage = (payload.config as Record<string, any>).libraryLineage;
    expect(lineage.entryId).toBe('entry-1');
    expect(lineage.entryVersion).toBe(1);
    expect(lineage.colourway).toBeNull();
  });

  it('names the copy after the design, not the user', () => {
    expect(payload.name).toBe('Private Banking — Chancery');
  });

  it('carries the colourway in the name and the lineage when one is baked', () => {
    const coloured = buildReportUseCopyPayload({
      userId: 'user-9',
      entry: entry(),
      schema: { version: 1, tokens: {}, pages: [] },
      colourway: DEFAULT_CW,
    });
    expect(String(coloured.name)).toContain(` · ${DEFAULT_CW?.name}`);
    expect((coloured.config as Record<string, any>).libraryLineage.colourway).toBe(DEFAULT_CW?.id);
  });
});

describe('matchesReportUseCopy', () => {
  const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'tpl-1',
    is_active: true,
    is_draft: false,
    config: {
      libraryLineage: { entryId: 'entry-1', entryVersion: 1, colourway: null },
    },
    ...overrides,
  });

  it('matches on entry, version and colourway', () => {
    expect(matchesReportUseCopy(row(), entry(), null)).toBe(true);
  });

  it('never matches a row that is not currently selectable', () => {
    expect(matchesReportUseCopy(row({ is_active: false }), entry(), null)).toBe(false);
    expect(matchesReportUseCopy(row({ is_draft: true }), entry(), null)).toBe(false);
  });

  it('treats a library version bump as a different design', () => {
    // The user picked the design as the library shows it NOW; a copy of the
    // previous version is a document the library no longer stands behind.
    expect(matchesReportUseCopy(row(), entry({ version: 2 }), null)).toBe(false);
  });

  it('treats a different colourway as a different choice', () => {
    expect(matchesReportUseCopy(row(), entry(), 'pb-oxblood-night')).toBe(false);
  });

  it('never matches a row with no lineage at all', () => {
    expect(matchesReportUseCopy(row({ config: {} }), entry(), null)).toBe(false);
  });
});

describe('the operation’s authority', () => {
  it('is the same bar as instantiate — an edit, not control-plane', () => {
    // The copy is user-scoped and affects only its owner's documents; the
    // superadmin bar protects the GLOBAL candidate set, which this operation
    // cannot touch.
    expect(requiredAuthzFor('use_for_reports')).toEqual({ kind: 'module', permission: 'can_edit' });
  });

  it('any unknown operation stays superadmin-only', () => {
    expect(requiredAuthzFor('nonexistent_op')).toEqual({ kind: 'superadmin' });
  });
});
