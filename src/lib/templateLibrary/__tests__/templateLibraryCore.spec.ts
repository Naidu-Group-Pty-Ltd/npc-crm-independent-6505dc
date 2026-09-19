/**
 * Behavioural tests for the Template Library's decision logic.
 *
 * These execute the real functions the edge function calls, rather than
 * scanning its source. They are the guard on the one thing this feature could
 * damage: a working copy that reaches a customer's report.
 */
/* eslint-disable no-restricted-syntax --
 * The hex literals here are negative-test fixtures: `isBrandSafe` must REJECT
 * a hard-coded colour, so the test has to contain one to assert that.
 */
import { describe, it, expect } from 'vitest';
import {
  LIST_COLUMNS,
  blockTypesOf,
  buildNextVersionDraft,
  buildPreviewSchema,
  buildWorkingCopyPayload,
  deriveEntryFacts,
  editRequiresNewVersion,
  isBrandSafe,
  isProductionReady,
  pickEditable,
  requiredAuthzFor,
  requiredBindingsOf,
  slugify,
  statusForLifecycleOperation,
  unsupportedBlocks,
  validateForPublish,
  validateWorkingCopyName,
} from '../../../../supabase/functions/_shared/templateLibraryCore.pure';

const page = (blocks: unknown[], size = { width: 595, height: 842 }) => ({
  id: 'p1', name: 'Page', size, background: {}, blocks,
});
const block = (type: string, props: Record<string, unknown> = {}) => ({
  id: `b-${type}`, type, props, overlays: [],
});

describe('requiredAuthzFor — deny by default', () => {
  it('allows browsing with view permission', () => {
    expect(requiredAuthzFor('list')).toEqual({ kind: 'module', permission: 'can_view' });
    expect(requiredAuthzFor('get')).toEqual({ kind: 'module', permission: 'can_view' });
  });

  it('requires edit permission to create a working copy', () => {
    expect(requiredAuthzFor('instantiate')).toEqual({ kind: 'module', permission: 'can_edit' });
  });

  it('requires superadmin for every control-plane operation', () => {
    for (const op of ['promote', 'save_draft', 'publish', 'deprecate', 'archive', 'restore', 'events']) {
      expect(requiredAuthzFor(op)).toEqual({ kind: 'superadmin' });
    }
  });

  it('requires superadmin for an operation nobody has classified yet', () => {
    // The point of the default: adding an operation without thinking about
    // permissions makes it superadmin-only, not public.
    expect(requiredAuthzFor('some_future_operation')).toEqual({ kind: 'superadmin' });
    expect(requiredAuthzFor('')).toEqual({ kind: 'superadmin' });
  });
});

describe('buildWorkingCopyPayload', () => {
  const entry = {
    id: 'entry-1', name: 'Investor Compass', description: 'From the library',
    report_type: 'investment', tier: 'compass', variant: null, engine: 'weasyprint',
    config: { a: 1 }, custom_css: '.x{}', version: 3,
  };
  const payload = buildWorkingCopyPayload({
    userId: 'user-42', name: 'My copy', description: 'Mine', entry, schema: { version: 1, pages: [] },
  });

  it('is never active or default', () => {
    expect(payload.is_active).toBe(false);
    expect(payload.is_default).toBe(false);
  });

  it('starts as an unapproved draft at version 1, so the activation gate applies', () => {
    expect(payload.approval_status).toBe('draft');
    expect(payload.is_draft).toBe(true);
    expect(payload.version).toBe(1);
    expect(payload.locked_for_review).toBe(false);
  });

  it('leaves created_by null — the column is an FK to auth.users', () => {
    expect(payload.created_by).toBeNull();
  });

  it('scopes the copy to the caller from the verified session', () => {
    expect(payload.scope).toBe('user');
    expect(payload.owner_user_id).toBe('user-42');
    expect(payload.agency_id).toBeNull();
  });

  it('does not set parent_template_id — that FK points at report_templates', () => {
    expect(payload.parent_template_id).toBeNull();
  });

  it('always supplies config, which is NOT NULL on the column', () => {
    // The entry's own config, plus the lineage every copy now carries — the
    // `entryId` four separate readers resolve a copy's identity by.
    expect(payload.config.a).toBe(1);
    expect(payload.config.libraryLineage.entryId).toBe('entry-1');
    const noConfig = buildWorkingCopyPayload({
      userId: 'u', name: 'n', entry: { ...entry, config: undefined }, schema: {},
    });
    expect(Object.keys(noConfig.config)).toEqual(['libraryLineage']);
  });

  it('carries the report type through so the copy resolves like its source', () => {
    expect(payload.report_type).toBe('investment');
    expect(payload.tier).toBe('compass');
    expect(payload.engine).toBe('weasyprint');
  });

  it('falls back to the entry description when the user gives none', () => {
    const noDesc = buildWorkingCopyPayload({ userId: 'u', name: 'n', entry, schema: {} });
    expect(noDesc.description).toBe('From the library');
  });

  it('cannot be talked into activating itself by a hostile entry row', () => {
    // Even if the catalogue row were tampered with, these are fixed literals.
    const hostile = buildWorkingCopyPayload({
      userId: 'u',
      name: 'n',
      entry: {
        ...entry,
        is_active: true, is_default: true, approval_status: 'approved',
        scope: 'global', owner_user_id: 'someone-else', created_by: 'forged',
        version: 99, locked_for_review: true,
      } as Record<string, unknown>,
      schema: {},
    });
    expect(hostile.is_active).toBe(false);
    expect(hostile.is_default).toBe(false);
    expect(hostile.approval_status).toBe('draft');
    expect(hostile.scope).toBe('user');
    expect(hostile.owner_user_id).toBe('u');
    expect(hostile.created_by).toBeNull();
    expect(hostile.version).toBe(1);
    expect(hostile.locked_for_review).toBe(false);
  });
});

describe('validateWorkingCopyName', () => {
  it('rejects empty and whitespace-only names', () => {
    expect(validateWorkingCopyName('')?.code).toBe('name_required');
    expect(validateWorkingCopyName('   ')?.code).toBe('name_required');
    expect(validateWorkingCopyName(undefined)?.code).toBe('name_required');
  });

  it('rejects names past the column budget', () => {
    expect(validateWorkingCopyName('x'.repeat(201))?.code).toBe('name_too_long');
  });

  it('accepts a trimmed, reasonable name', () => {
    expect(validateWorkingCopyName('  My template  ')).toBeNull();
    expect(validateWorkingCopyName('x'.repeat(200))).toBeNull();
  });
});

describe('blockTypesOf / unsupportedBlocks', () => {
  const schema = {
    pages: [page([block('cover'), block('kpi-grid')]), page([block('cover'), block('data-table')])],
  };

  it('returns distinct sorted types across every page', () => {
    expect(blockTypesOf(schema)).toEqual(['cover', 'data-table', 'kpi-grid']);
  });

  it('tolerates a malformed schema instead of throwing', () => {
    expect(blockTypesOf(null)).toEqual([]);
    expect(blockTypesOf({ pages: 'nope' })).toEqual([]);
    expect(blockTypesOf({ pages: [{ blocks: null }] })).toEqual([]);
    expect(blockTypesOf({ pages: [{ blocks: [{ type: '' }, {}] }] })).toEqual([]);
  });

  it('flags block types the production renderer does not support', () => {
    expect(unsupportedBlocks(schema)).toEqual([]);
    expect(unsupportedBlocks({ pages: [page([block('experimental-widget')])] }))
      .toEqual(['experimental-widget']);
  });
});

describe('requiredBindingsOf', () => {
  it('collects bindings from anywhere in the tree, filters stripped', () => {
    const schema = {
      pages: [page([
        block('cover', { title: '{{property.address}}', subtitle: 'For {{client.name}}' }),
        block('kpi-grid', { items: [{ label: 'Rent', value: '{{financials.weeklyRent | currency}}' }] }),
      ])],
    };
    expect(requiredBindingsOf(schema))
      .toEqual(['client.name', 'financials.weeklyRent', 'property.address']);
  });

  it('excludes computed fields — the template calculates those itself', () => {
    expect(requiredBindingsOf({ pages: [page([block('text', { body: '{{=netYield}}' })])] }))
      .toEqual([]);
  });

  it('de-duplicates repeated bindings', () => {
    const schema = { pages: [
      page([block('text', { a: '{{x.y}}', b: '{{x.y}}' })]),
      page([block('text', { c: '{{ x.y }}' })]),
    ] };
    expect(requiredBindingsOf(schema)).toEqual(['x.y']);
  });

  it('returns nothing for a template with no bindings', () => {
    expect(requiredBindingsOf({ pages: [page([block('divider')])] })).toEqual([]);
  });
});

describe('isBrandSafe', () => {
  it('accepts a template whose colours are all tokens', () => {
    expect(isBrandSafe({ pages: [page([block('cover', { bg: 'token:bg', accent: 'token:primary' })])] }))
      .toBe(true);
  });

  it('accepts bindings in colour fields', () => {
    expect(isBrandSafe({ pages: [page([block('cover', { color: '{{brand.primary}}' })])] })).toBe(true);
  });

  it('rejects a hard-coded hex, rgb or hsl in a colour field', () => {
    expect(isBrandSafe({ pages: [page([block('cover', { bg: '#0C2340' })])] })).toBe(false);
    expect(isBrandSafe({ pages: [page([block('cover', { accent: 'rgb(12,35,64)' })])] })).toBe(false);
    expect(isBrandSafe({ pages: [page([block('cover', { headerBg: 'hsl(210 60% 15%)' })])] })).toBe(false);
  });

  it('ignores literal colours inside the token map — that is what tokens are', () => {
    expect(isBrandSafe({
      tokens: { colors: { primary: '#BF9B50', bg: '#141414' } },
      pages: [page([block('cover', { bg: 'token:bg' })])],
    })).toBe(true);
  });

  it('does not flag a hex that is not in a colour field', () => {
    expect(isBrandSafe({ pages: [page([block('text', { body: 'Use code #FF0000 at checkout' })])] }))
      .toBe(true);
  });
});

describe('isProductionReady', () => {
  const clean = { pages: [page([block('cover'), block('kpi-grid')])] };

  it('is true only for a report type with a production adapter', () => {
    expect(isProductionReady('investment', clean)).toBe(true);
    expect(isProductionReady('investment_compass', clean)).toBe(true);
    // `cashflow` joined the production types when it gained an adapter reading
    // the projection stored on `investment_reports` — see
    // `cashFlowProjection.pure.ts`. `suburb` still has no data source.
    expect(isProductionReady('cashflow', clean)).toBe(true);
    expect(isProductionReady('suburb', clean)).toBe(false);
  });

  it('is false when the report type is missing', () => {
    expect(isProductionReady(null, clean)).toBe(false);
    expect(isProductionReady('', clean)).toBe(false);
  });

  it('is case- and whitespace-insensitive on the report type', () => {
    expect(isProductionReady('  Investment  ', clean)).toBe(true);
  });

  it('is false when any block is outside the production allow-list', () => {
    expect(isProductionReady('investment', { pages: [page([block('experimental')])] })).toBe(false);
  });
});

describe('buildPreviewSchema', () => {
  it('keeps only page one, with the tokens needed to draw it', () => {
    const preview: any = buildPreviewSchema({
      tokens: { colors: { bg: '#fff' } },
      pages: [page([block('cover')]), page([block('footer')])],
    });
    expect(preview.pages).toHaveLength(1);
    expect(preview.pages[0].blocks[0].type).toBe('cover');
    expect(preview.tokens).toEqual({ colors: { bg: '#fff' } });
  });

  it('strips embedded base64 payloads so the list query stays small', () => {
    const preview: any = buildPreviewSchema({
      pages: [page([block('image', { imageUrl: 'data:image/png;base64,AAAA', alt: 'keep me' })])],
    });
    expect(preview.pages[0].blocks[0].props.imageUrl).toBe('');
    expect(preview.pages[0].blocks[0].props.alt).toBe('keep me');
  });

  it('returns null for a template with no pages', () => {
    expect(buildPreviewSchema({ pages: [] })).toBeNull();
    expect(buildPreviewSchema(null)).toBeNull();
  });
});

describe('deriveEntryFacts', () => {
  it('computes every catalogue fact from the schema', () => {
    const facts = deriveEntryFacts({
      report_type: 'investment',
      schema: {
        tokens: { colors: {} },
        pages: [
          page([block('cover', { title: '{{property.address}}', bg: 'token:bg' })]),
          page([block('data-table')]),
        ],
      },
    });
    expect(facts.page_count).toBe(2);
    expect(facts.supported_modules).toEqual(['cover', 'data-table']);
    expect(facts.required_bindings).toEqual(['property.address']);
    expect(facts.brand_safe).toBe(true);
    expect(facts.production_ready).toBe(true);
    expect(facts.orientation).toBe('portrait');
    expect(facts.compatibility_version).toBe(1);
  });

  it('detects landscape from the first page geometry', () => {
    const facts = deriveEntryFacts({
      schema: { pages: [page([block('cover')], { width: 842, height: 595 })] },
    });
    expect(facts.orientation).toBe('landscape');
  });

  it('never trusts a caller-supplied production_ready', () => {
    const facts = deriveEntryFacts({
      report_type: 'suburb',
      production_ready: true,
      schema: { pages: [page([block('cover')])] },
    } as Record<string, unknown>);
    expect(facts.production_ready).toBe(false);
  });

  it('degrades to safe defaults on an empty schema', () => {
    const facts = deriveEntryFacts({ schema: {} });
    expect(facts.page_count).toBe(0);
    expect(facts.production_ready).toBe(false);
    expect(facts.orientation).toBe('portrait');
    expect(facts.preview_schema).toBeNull();
  });
});

describe('validateForPublish', () => {
  const valid = {
    name: 'Investor Compass', slug: 'investor-compass',
    schema: { pages: [page([block('cover')])] },
  };

  it('passes a complete, renderable entry', () => {
    expect(validateForPublish(valid)).toBeNull();
  });

  it('blocks an entry with no schema or no pages', () => {
    expect(validateForPublish({ ...valid, schema: null })?.code).toBe('library_schema_invalid');
    expect(validateForPublish({ ...valid, schema: { pages: [] } })?.code).toBe('library_schema_empty');
  });

  it('blocks an entry using a block the production renderer cannot draw', () => {
    const problem = validateForPublish({
      ...valid, schema: { pages: [page([block('cover'), block('experimental')])] },
    });
    expect(problem?.code).toBe('library_renderer_blocked');
    expect(problem?.detail).toEqual(['experimental']);
  });

  it('blocks an entry with no name or no slug', () => {
    expect(validateForPublish({ ...valid, name: '  ' })?.code).toBe('library_name_required');
    expect(validateForPublish({ ...valid, slug: '' })?.code).toBe('library_slug_required');
  });

  it('does NOT block a preview-only entry — that is a badge, not a gate', () => {
    // A suburb template has no production adapter, but it is still a perfectly
    // good template to browse, copy and edit.
    expect(validateForPublish({ ...valid, report_type: 'suburb' })).toBeNull();
  });
});

describe('pickEditable', () => {
  it('keeps catalogue metadata', () => {
    expect(pickEditable({ name: 'A', tags: ['x'], category: 'suburb' }))
      .toEqual({ name: 'A', tags: ['x'], category: 'suburb' });
  });

  it('drops fields that are derived, governed or identity', () => {
    expect(pickEditable({
      name: 'A', id: 'forged', status: 'published', version: 99, usage_count: 500,
      production_ready: true, brand_safe: true, family_id: 'x', visibility: 'agency',
      published_at: 'now', source_template_id: 'y', created_by_user_id: 'z', slug: 'forced',
    })).toEqual({ name: 'A' });
  });

  it('returns an empty object for empty input', () => {
    expect(pickEditable(undefined)).toEqual({});
    expect(pickEditable(null)).toEqual({});
  });
});

describe('editRequiresNewVersion / buildNextVersionDraft', () => {
  it('forks only when the entry is published', () => {
    expect(editRequiresNewVersion('published')).toBe(true);
    for (const s of ['draft', 'in_review', 'deprecated', 'archived']) {
      expect(editRequiresNewVersion(s)).toBe(false);
    }
  });

  it('creates the next version as an unpublished draft with usage reset', () => {
    const current = {
      id: 'old-id', family_id: 'fam-1', slug: 's', version: 2, status: 'published',
      name: 'A', published_at: '2026-01-01', deprecated_at: null,
      usage_count: 17, last_used_at: '2026-02-01',
      created_at: '2025-01-01', updated_at: '2026-01-01',
      report_type: 'investment', schema: { pages: [page([block('cover')])] },
    };
    const next = buildNextVersionDraft(current, { name: 'B' }, 'editor-1');

    expect(next.id).toBeUndefined();
    expect(next.created_at).toBeUndefined();
    expect(next.updated_at).toBeUndefined();
    expect(next.version).toBe(3);
    expect(next.status).toBe('draft');
    expect(next.name).toBe('B');
    expect(next.published_at).toBeNull();
    expect(next.deprecated_at).toBeNull();
    // Usage belongs to the version that earned it.
    expect(next.usage_count).toBe(0);
    expect(next.last_used_at).toBeNull();
    // Same family, so lineage and the publish-supersede query still line up.
    expect(next.family_id).toBe('fam-1');
    expect(next.created_by_user_id).toBe('editor-1');
    // Facts are recomputed, not inherited.
    expect(next.page_count).toBe(1);
    expect(next.production_ready).toBe(true);
  });

  it('does not mutate the row it forks from', () => {
    const current = { version: 1, status: 'published', schema: { pages: [] }, usage_count: 5 };
    buildNextVersionDraft(current, { name: 'B' }, null);
    expect(current.version).toBe(1);
    expect(current.usage_count).toBe(5);
    expect((current as Record<string, unknown>).name).toBeUndefined();
  });
});

describe('statusForLifecycleOperation', () => {
  it('maps the three lifecycle verbs and nothing else', () => {
    expect(statusForLifecycleOperation('archive')).toBe('archived');
    expect(statusForLifecycleOperation('deprecate')).toBe('deprecated');
    expect(statusForLifecycleOperation('restore')).toBe('draft');
    expect(statusForLifecycleOperation('publish')).toBeNull();
    expect(statusForLifecycleOperation('delete')).toBeNull();
  });
});

describe('slugify', () => {
  it('produces a url-safe slug', () => {
    expect(slugify('Investor Compass — Premium')).toBe('investor-compass-premium');
    expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces');
  });

  it('never returns an empty slug', () => {
    expect(slugify('')).toBe('template');
    expect(slugify('!!!')).toBe('template');
    expect(slugify(null)).toBe('template');
  });

  it('bounds the length', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe('LIST_COLUMNS', () => {
  it('never includes the heavy schema payload', () => {
    // The Builder list learned this the hard way: PDF-imported templates carry
    // multi-hundred-MB schemas that blow the statement timeout.
    expect(LIST_COLUMNS).not.toContain('schema');
    expect(LIST_COLUMNS).not.toContain('config');
    expect(LIST_COLUMNS).not.toContain('custom_css');
  });

  it('includes the trimmed preview the card thumbnails need', () => {
    expect(LIST_COLUMNS).toContain('preview_schema');
  });
});
