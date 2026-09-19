import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The picker offers the Template Library itself, tied to the report format —
 * and it offers it VISUALLY, families first.
 *
 * ## What this pins
 *
 * The chooser used to list only rows already in `report_templates`, and then
 * listed the library as sixty text rows — five variants of one family stacked
 * above the next family's first appearance. These assert the tie-up and the
 * gallery contract:
 *
 * - the library's production designs for the format are offered in the dialog
 *   and designs for other formats are not;
 * - the gallery leads with ONE tile per design family; a family's layout
 *   variants appear only once that family is opened, so different families are
 *   compared before same-family variants are;
 * - an active row that descends from a listed design is folded INTO that
 *   design's row (badged as the house default) instead of appearing twice;
 * - a stored selection is followed — its family opens pre-expanded with the
 *   design pre-checked and badged Current — and can still be changed;
 * - choosing a design that already exists as an active row selects that row
 *   directly, with no server copy; choosing a new one adopts it via
 *   `use_for_reports` FIRST and stores the returned id as the selection;
 * - an active row with no library lineage gets its face fetched — page one
 *   and tokens only, never the whole schema — and stays selectable.
 */

const invokeSecureFunction = vi.fn();
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: (...args: unknown[]) => invokeSecureFunction(...args),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: TestResizeObserver });

import { ReportTemplatePicker } from '../ReportTemplatePicker';
import { defaultColourwayFor } from '@/lib/templateLibrary/colourways';

const DEFAULT_CW = defaultColourwayFor('private_banking')!;

/** Raw snake_case rows, as `manage-template-library`'s list returns them. */
const libraryEntry = (overrides: Record<string, unknown>) => ({
  id: 'ent-a',
  family_id: 'fam-1',
  slug: 'report-qa-pb-01-chancery',
  version: 1,
  name: 'Chancery',
  description: 'The reference expression.',
  category: 'investment',
  report_type: 'qa',
  tier: 'compass',
  variant: null,
  status: 'published',
  engine: 'weasyprint',
  production_ready: true,
  page_count: 6,
  design_meta: {
    familyKey: 'private_banking',
    familyName: 'Private Banking',
    familyNote: 'Gold on obsidian, editorial ledger.',
    variantAxis: 'A · reference',
    density: 'balanced',
    defaultColourway: DEFAULT_CW.id,
    colourways: [DEFAULT_CW.id],
  },
  ...overrides,
});

const LIBRARY = [
  libraryEntry({}),
  libraryEntry({
    id: 'ent-b',
    slug: 'report-qa-pb-02-sovereign-folio',
    name: 'Sovereign Folio',
    description: 'The expansive expression.',
    design_meta: {
      familyKey: 'private_banking',
      familyName: 'Private Banking',
      familyNote: 'Gold on obsidian, editorial ledger.',
      variantAxis: 'C · expansive',
      density: 'spacious',
      defaultColourway: DEFAULT_CW.id,
      colourways: [DEFAULT_CW.id],
    },
  }),
  // A design outside any family — offered on its own, with its own face.
  libraryEntry({
    id: 'ent-l', slug: 'report-qa-voice-01', name: 'Executive Brief',
    design_meta: {}, page_count: 4,
  }),
  // A different format's design must not be offered here.
  libraryEntry({ id: 'ent-x', slug: 'portfolio-review-pb-01', name: 'Portfolio Chancery', report_type: 'portfolio' }),
];

/** The seeded house master: the global active row Chancery already IS. */
const HOUSE_MASTER = {
  id: 'tpl-house', name: 'Private Banking — Chancery', description: 'Seeded master.',
  report_type: 'qa', engine: 'weasyprint',
  is_active: true, is_draft: false, is_default: true, scope: 'global',
  priority: 0, updated_at: '2026-08-14T00:00:00Z',
  libraryLineage: {
    entryId: 'ent-a', entrySlug: 'report-qa-pb-01-chancery', entryVersion: 1,
    familyKey: 'private_banking', familyName: 'Private Banking', colourway: null,
  },
};

/** A hand-built active row with no library lineage: kept, and given a face. */
const HAND_BUILT = {
  id: 'tpl-hand', name: 'Bespoke QA Layout', description: 'Hand-built.',
  report_type: 'qa', engine: 'weasyprint',
  is_active: true, is_draft: false, is_default: false, scope: 'global',
  priority: 5, updated_at: '2026-08-01T00:00:00Z',
  libraryLineage: null,
};

let selections: any[] = [];
let writes: any[] = [];
let adoptions: any[] = [];
let previewListCalls: any[] = [];

function routeCall(fn: string, payload: any) {
  if (fn === 'manage-template-library') {
    if (payload?.operation === 'list') {
      return Promise.resolve({ data: { records: LIBRARY }, error: null });
    }
    if (payload?.operation === 'use_for_reports') {
      adoptions.push(payload);
      return Promise.resolve({
        data: { templateId: 'tpl-new', reused: false, colourwayId: payload.colourwayId ?? null },
        error: null,
      });
    }
  }
  if (payload?.table === 'report_templates' && payload.operation === 'list') {
    // The picker's second read: faces for lineage-less rows. Page one and the
    // palette alone — asking for `schema` whole here is the regression this
    // branch exists to catch.
    if (String(payload.listOptions?.select ?? '').includes('previewPage:')) {
      previewListCalls.push(payload);
      expect(payload.listOptions.select).toContain('schema->pages->0');
      expect(payload.listOptions.select).not.toMatch(/(^|,)schema(,|$)/);
      return Promise.resolve({
        data: {
          records: [{
            id: 'tpl-hand',
            previewPage: { size: { width: 595, height: 842 }, blocks: [] },
            previewTokens: { colors: {} },
          }],
        },
        error: null,
      });
    }
    return Promise.resolve({ data: { records: [HOUSE_MASTER, HAND_BUILT] }, error: null });
  }
  if (payload?.table === 'report_template_selections') {
    if (payload.operation === 'list') {
      return Promise.resolve({ data: { records: selections }, error: null });
    }
    writes.push(payload);
    if (payload.operation === 'upsert') {
      selections = [{
        id: 'sel-1',
        report_type: payload.data.report_type,
        template_id: payload.data.template_id,
      }];
    }
    if (payload.operation === 'delete') selections = [];
    return Promise.resolve({ data: { records: selections }, error: null });
  }
  return Promise.resolve({ data: null, error: null });
}

function renderPicker() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReportTemplatePicker
        reportType="qa"
        formatLabel="Report Q&A"
        open
        onOpenChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

/** The gallery's family tile — a disclosure, not a radio. */
const familyTile = () => screen.getByRole('button', { name: /Private Banking/ });

beforeEach(() => {
  invokeSecureFunction.mockReset();
  selections = [];
  writes = [];
  adoptions = [];
  previewListCalls = [];
  invokeSecureFunction.mockImplementation(routeCall);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('the gallery leads with families, not with one family’s variants', () => {
  it('renders one tile per family and holds the variants back until it is opened', async () => {
    renderPicker();
    const tile = await waitFor(() => familyTile());
    expect(tile.getAttribute('aria-expanded')).toBe('false');
    // The variants are not competing with the other families' first appearance.
    expect(screen.queryByText('Chancery')).toBeNull();
    expect(screen.queryByText('Sovereign Folio')).toBeNull();
    // The design outside any family is offered beside it, as itself.
    expect(screen.getByText('Executive Brief')).toBeTruthy();
    // The portfolio design is the same family — and not this format's.
    expect(screen.queryByText('Portfolio Chancery')).toBeNull();
  });

  it('opening the family reveals its layouts in variant order', async () => {
    renderPicker();
    fireEvent.click(await waitFor(() => familyTile()));
    expect(familyTile().getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText('Chancery')).toBeTruthy();
    expect(screen.getByText('Sovereign Folio')).toBeTruthy();
  });

  it('folds an active row into the design it descends from, keeping its badge', async () => {
    renderPicker();
    await waitFor(() => familyTile());
    // The seeded master is represented by the family's row, not listed twice…
    expect(screen.queryByText('Private Banking — Chancery')).toBeNull();
    // …and its house-default status shows on the family tile before it is
    // opened, and on the design itself once it is.
    expect(screen.getAllByText('House default').length).toBeGreaterThan(0);
    fireEvent.click(familyTile());
    await screen.findByText('Chancery');
    expect(screen.getAllByText('House default').length).toBeGreaterThan(1);
  });
});

describe('an existing selection is followed, and changeable', () => {
  it('opens the stored design’s family pre-expanded, pre-checked and badged', async () => {
    selections = [{ id: 'sel-1', report_type: 'qa', template_id: 'tpl-house' }];
    renderPicker();
    // Not a click in sight: the family the stored choice lives in is open.
    expect(await screen.findByText('Chancery')).toBeTruthy();
    expect((await screen.findAllByText('Current')).length).toBeGreaterThan(0);
    const checked = screen.getAllByRole('radio').filter(
      (r) => r.getAttribute('data-state') === 'checked' || r.getAttribute('aria-checked') === 'true',
    );
    expect(checked.length).toBe(1);
  });
});

describe('saving a library choice', () => {
  it('selects the existing house master directly — no server copy is made', async () => {
    renderPicker();
    fireEvent.click(await waitFor(() => familyTile()));
    fireEvent.click(await screen.findByText('Chancery'));
    fireEvent.click(screen.getByRole('button', { name: /Save choice/ }));

    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    expect(adoptions).toHaveLength(0);
    const upsert = writes.find((w) => w.operation === 'upsert');
    expect(upsert?.data?.template_id).toBe('tpl-house');
    expect(upsert?.data?.report_type).toBe('qa');
  });

  it('adopts a design with no active row first, then stores the returned id', async () => {
    renderPicker();
    fireEvent.click(await waitFor(() => familyTile()));
    fireEvent.click(await screen.findByText('Sovereign Folio'));
    fireEvent.click(screen.getByRole('button', { name: /Save choice/ }));

    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    expect(adoptions).toHaveLength(1);
    expect(adoptions[0].entryId).toBe('ent-b');
    const upsert = writes.find((w) => w.operation === 'upsert');
    expect(upsert?.data?.template_id).toBe('tpl-new');
  });
});

describe('an active row with no library lineage keeps its place, with a face', () => {
  it('lists it under its own section and fetches page one alone for its tile', async () => {
    renderPicker();
    expect(await screen.findByText('Bespoke QA Layout')).toBeTruthy();
    expect(screen.getByText('Other active templates')).toBeTruthy();
    await waitFor(() => expect(previewListCalls.length).toBe(1));
  });

  it('remains selectable exactly as before', async () => {
    renderPicker();
    fireEvent.click(await screen.findByText('Bespoke QA Layout'));
    fireEvent.click(screen.getByRole('button', { name: /Save choice/ }));
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    const upsert = writes.find((w) => w.operation === 'upsert');
    expect(upsert?.data?.template_id).toBe('tpl-hand');
    expect(adoptions).toHaveLength(0);
  });
});
