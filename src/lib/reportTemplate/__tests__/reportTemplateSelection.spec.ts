import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  REPORT_TYPE_ALIASES, isSelectableTemplate, normaliseReportType,
  resolveTemplateSelection, selectableTemplatesForFormat, templateMatchesFormat,
  templateRendersThroughDesignSystem,
  type SelectableTemplateRow,
} from '../templateSelection';
import { buildFormatTemplateState, selectionsByFormat } from '../templateSelection';
import { getAdapter } from '../adapters';
import { findReportFormat, listReportFormats, reportFormatLabel } from '../reportFormats';

/**
 * Which template a report format is generated with.
 *
 * Before this, ranking alone decided and nobody could see or change the answer.
 * These cover the two things that make a choice trustworthy: it has to mean the
 * same format whichever spelling a template was saved under, and it has to stop
 * applying — visibly — when the template it names stops being a candidate.
 */

const template = (over: Partial<SelectableTemplateRow> = {}): SelectableTemplateRow => ({
  id: 'tpl-1',
  name: 'Investment Compass — Dark Executive',
  report_type: 'investment',
  engine: 'weasyprint',
  is_active: true,
  is_draft: false,
  is_default: false,
  scope: 'global',
  priority: 0,
  updated_at: '2026-08-01T00:00:00Z',
  ...over,
});

describe('one format, several spellings', () => {
  it('folds every Investment spelling onto one key', () => {
    for (const spelling of ['compass', 'investment_compass', 'investment_report', 'property_investment']) {
      expect(normaliseReportType(spelling), spelling).toBe('investment');
    }
  });

  it('folds the other aliased formats', () => {
    expect(normaliseReportType('borrowing')).toBe('borrowing_capacity');
    expect(normaliseReportType('cash_flow')).toBe('cashflow');
    expect(normaliseReportType('formara')).toBe('client_details');
    expect(normaliseReportType('commercial_industrial')).toBe('commercial_capacity');
  });

  it('is case- and whitespace-insensitive, and safe on nothing', () => {
    expect(normaliseReportType('  Investment_Compass ')).toBe('investment');
    expect(normaliseReportType(null)).toBe('');
    expect(normaliseReportType(undefined)).toBe('');
  });

  it('matches a template stored under any spelling of its format', () => {
    expect(templateMatchesFormat(template({ report_type: 'investment_compass' }), 'investment')).toBe(true);
    expect(templateMatchesFormat(template({ report_type: 'investment' }), 'compass')).toBe(true);
    expect(templateMatchesFormat(template({ report_type: 'portfolio' }), 'investment')).toBe(false);
  });

  /**
   * The check that found `commercial_industrial`.
   *
   * `manage-templates` will ACTIVATE a template stored under any spelling in
   * `PRODUCTION_REPORT_TEMPLATE_TYPES`. A spelling that activates but resolves
   * to no adapter is a template that can be published, cannot be picked, and
   * renders nothing — which is what that one did.
   */
  it('resolves every spelling the broker will activate onto an adapter', () => {
    const source = readFileSync(
      join(process.cwd(), 'supabase/functions/manage-templates/index.ts'), 'utf8');
    const block = source.match(
      /PRODUCTION_REPORT_TEMPLATE_TYPES = new Set\(\[([\s\S]*?)\]\)/)?.[1];
    expect(block).toBeDefined();

    const spellings = [...block!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(spellings.length).toBeGreaterThan(10);

    const unresolvable = spellings.filter((spelling) => !getAdapter(spelling));
    expect(unresolvable, `activatable but unresolvable: ${unresolvable.join(', ')}`).toEqual([]);
  });

  it('keeps the alias map as the single definition', () => {
    // The registry re-exports this map rather than holding a second copy; two
    // copies is how the spelling above came to be activatable and unresolvable.
    const registry = readFileSync(
      join(process.cwd(), 'src/lib/reportTemplate/adapters/index.ts'), 'utf8');
    expect(registry).toContain('reportTemplateSelection.pure.ts');
    expect(registry).not.toMatch(/const ALIASES\s*[:=]/);
    expect(Object.keys(REPORT_TYPE_ALIASES).length).toBeGreaterThan(5);
  });
});

describe('what may be chosen', () => {
  it('accepts an active, published template for the format', () => {
    expect(isSelectableTemplate(template(), 'investment')).toBe(true);
  });

  it('refuses an inactive template', () => {
    // Activation is the approval gate — superadmin, approved, production
    // adapter, schema renders. An inactive row has passed none of it.
    expect(isSelectableTemplate(template({ is_active: false }), 'investment')).toBe(false);
  });

  it('refuses a draft, and a template for another format', () => {
    expect(isSelectableTemplate(template({ is_draft: true }), 'investment')).toBe(false);
    expect(isSelectableTemplate(template({ report_type: 'portfolio' }), 'investment')).toBe(false);
  });

  it('accepts a jsPDF template but does not claim it renders through the design system', () => {
    // Selectable, because it is what the ranking would have picked anyway —
    // and flagged, because the document comes out of the legacy generator.
    const legacy = template({ engine: 'jspdf' });
    expect(isSelectableTemplate(legacy, 'investment')).toBe(true);
    expect(templateRendersThroughDesignSystem(legacy)).toBe(false);
    expect(templateRendersThroughDesignSystem(template())).toBe(true);
  });

  it('treats a missing engine as the legacy generator, as the resolver does', () => {
    expect(templateRendersThroughDesignSystem(template({ engine: null }))).toBe(false);
  });
});

describe('the candidate list', () => {
  it('puts templates that actually get drawn first', () => {
    const rows = [
      template({ id: 'legacy', engine: 'jspdf', is_default: true, priority: 99 }),
      template({ id: 'drawn', engine: 'weasyprint', priority: 0 }),
    ];
    expect(selectableTemplatesForFormat(rows, 'investment').map((r) => r.id))
      .toEqual(['drawn', 'legacy']);
  });

  it('then mirrors the ranking: house default, priority, recency', () => {
    const rows = [
      template({ id: 'old', updated_at: '2026-01-01T00:00:00Z' }),
      template({ id: 'new', updated_at: '2026-08-01T00:00:00Z' }),
      template({ id: 'priority', priority: 10 }),
      template({ id: 'default', is_default: true, priority: 0 }),
    ];
    expect(selectableTemplatesForFormat(rows, 'investment').map((r) => r.id))
      .toEqual(['default', 'priority', 'new', 'old']);
  });

  it('spans every spelling of the format and excludes everything else', () => {
    const rows = [
      template({ id: 'a', report_type: 'investment_compass' }),
      template({ id: 'b', report_type: 'compass' }),
      template({ id: 'c', report_type: 'portfolio' }),
      template({ id: 'd', report_type: 'investment', is_active: false }),
    ];
    expect(selectableTemplatesForFormat(rows, 'investment').map((r) => r.id).sort())
      .toEqual(['a', 'b']);
  });

  it('is empty rather than throwing on nothing', () => {
    expect(selectableTemplatesForFormat(null, 'investment')).toEqual([]);
    expect(selectableTemplatesForFormat([], '')).toEqual([]);
  });
});

describe('resolving a stored choice', () => {
  const rows = [template({ id: 'chosen' }), template({ id: 'other' })];

  it('is "none" when nothing has been chosen', () => {
    const resolved = resolveTemplateSelection({ templates: rows, reportType: 'investment' });
    expect(resolved.status).toBe('none');
    expect(resolved.template).toBeNull();
    expect(resolved.rendersThroughDesignSystem).toBe(false);
  });

  it('honours a choice that still applies', () => {
    const resolved = resolveTemplateSelection({
      selectedTemplateId: 'chosen', templates: rows, reportType: 'investment',
    });
    expect(resolved.status).toBe('selected');
    expect(resolved.template?.id).toBe('chosen');
    expect(resolved.rendersThroughDesignSystem).toBe(true);
  });

  it('reports a deactivated choice as unavailable rather than silently swapping it', () => {
    // The document would change template under somebody. Falling back is right;
    // doing it quietly is not.
    const resolved = resolveTemplateSelection({
      selectedTemplateId: 'chosen',
      templates: [template({ id: 'chosen', is_active: false }), template({ id: 'other' })],
      reportType: 'investment',
    });
    expect(resolved.status).toBe('unavailable');
    expect(resolved.template).toBeNull();
    expect(resolved.selectedTemplateId).toBe('chosen');
    expect(resolved.rendersThroughDesignSystem).toBe(false);
  });

  it('reports a choice retyped onto another format as unavailable', () => {
    const resolved = resolveTemplateSelection({
      selectedTemplateId: 'chosen',
      templates: [template({ id: 'chosen', report_type: 'portfolio' })],
      reportType: 'investment',
    });
    expect(resolved.status).toBe('unavailable');
  });

  it('says a chosen jsPDF template will not be drawn by the design system', () => {
    const resolved = resolveTemplateSelection({
      selectedTemplateId: 'chosen',
      templates: [template({ id: 'chosen', engine: 'jspdf' })],
      reportType: 'investment',
    });
    expect(resolved.status).toBe('selected');
    expect(resolved.rendersThroughDesignSystem).toBe(false);
  });
});

describe('a format\'s whole state', () => {
  it('indexes stored rows by the normalised format key', () => {
    const map = selectionsByFormat([
      { id: 's1', report_type: 'investment_compass', template_id: 'tpl-1' },
      { id: 's2', report_type: 'portfolio', template_id: 'tpl-2' },
    ]);
    expect(map.get('investment')?.template_id).toBe('tpl-1');
    expect(map.get('portfolio')?.template_id).toBe('tpl-2');
  });

  it('carries the selection row id so a choice can be cleared without a second lookup', () => {
    const state = buildFormatTemplateState({
      reportType: 'compass',
      templates: [template({ id: 'chosen' })],
      selections: [{ id: 'sel-1', report_type: 'investment', template_id: 'chosen' }],
    });
    expect(state.reportType).toBe('investment');
    expect(state.status).toBe('selected');
    expect(state.selectionId).toBe('sel-1');
    expect(state.candidates).toHaveLength(1);
  });

  it('is "none" with the candidates still listed when nothing is chosen', () => {
    const state = buildFormatTemplateState({
      reportType: 'investment',
      templates: [template({ id: 'a' }), template({ id: 'b' })],
      selections: [],
    });
    expect(state.status).toBe('none');
    expect(state.selectionId).toBeNull();
    expect(state.candidates.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('the formats a template can be tied to', () => {
  it('is derived from the adapter registry, production formats first', () => {
    const formats = listReportFormats();
    expect(formats.length).toBeGreaterThan(5);
    const firstPreviewOnly = formats.findIndex((f) => !f.supportsProduction);
    const lastProduction = formats.map((f) => f.supportsProduction).lastIndexOf(true);
    expect(firstPreviewOnly === -1 || firstPreviewOnly > lastProduction).toBe(true);
  });

  it('says why a preview-only format would not be changed by a choice', () => {
    const previewOnly = listReportFormats().find((f) => !f.supportsProduction);
    expect(previewOnly).toBeDefined();
    expect(previewOnly!.label.length).toBeGreaterThan(0);
  });

  it('finds a format through any spelling', () => {
    expect(findReportFormat('investment_compass')?.reportType).toBe('investment');
    expect(findReportFormat('formara')?.reportType).toBe('client_details');
    expect(findReportFormat('nonsense_format')).toBeNull();
  });

  it('never shows a raw key to a person', () => {
    expect(reportFormatLabel('investment_compass')).toBe(findReportFormat('investment')!.label);
    expect(reportFormatLabel('some_new_format')).toBe('Some New Format');
    expect(reportFormatLabel(null)).toBe('Report');
  });
});

describe('the server writes what the client cannot', () => {
  const broker = readFileSync(
    join(process.cwd(), 'supabase/functions/manage-templates/index.ts'), 'utf8');

  it('scopes every selection read and write to the session user', () => {
    // This broker holds a service-role client, which bypasses RLS — ownership
    // has to be enforced here or not at all.
    expect(broker).toContain("const isTemplateSelection = table === 'report_template_selections'");
    expect(broker).toMatch(/isTemplateSelection\) query = query\.eq\('owner_user_id', userId\)/);
    expect(broker).toMatch(/isTemplateSelection && \['get', 'update', 'delete'\]/);
  });

  it('stamps the owner from the session and drops a caller-supplied id', () => {
    const stamp = broker.slice(
      broker.indexOf("isTemplateSelection && ['insert', 'upsert']"),
      broker.indexOf('// Handle list operation'));
    expect(stamp).toContain('owner_user_id: userId');
    expect(stamp).toContain('id: _ignored');
  });

  it('carries the table through every allow-list the broker checks', () => {
    const occurrences = broker.split("'report_template_selections'").length - 1;
    // TableName union, DEFAULT_SELECTS, validTables, the ownership guard.
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });
});
