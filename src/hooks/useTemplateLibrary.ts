/**
 * Data access for the Template Library, via the secure
 * `manage-template-library` edge function.
 *
 * Deliberately separate from `useReportTemplates`: that hook is the Template
 * Builder's data layer and is not modified by this feature. Library entries are
 * catalogue data and never appear in `report_templates`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import type {
  CreateWorkingCopyInput,
  CreateWorkingCopyResult,
  TemplateLibraryEntryDetail,
  TemplateLibraryListEntry,
  TemplateLibraryStatus,
} from '@/lib/templateLibrary/types';

const LIST_KEY = ['template-library'] as const;
const ONE_KEY = (id: string) => ['template-library', id] as const;
const EVENTS_KEY = (id: string) => ['template-library', id, 'events'] as const;

/** The wire shape is snake_case (Postgres); the app speaks camelCase. */
function toListEntry(raw: any): TemplateLibraryListEntry {
  return {
    id: raw.id,
    familyId: raw.family_id,
    slug: raw.slug,
    version: raw.version ?? 1,
    name: raw.name,
    description: raw.description ?? null,
    longDescription: raw.long_description ?? null,
    category: raw.category,
    reportType: raw.report_type ?? null,
    tier: raw.tier ?? null,
    variant: raw.variant ?? null,
    industry: raw.industry ?? [],
    tags: raw.tags ?? [],
    style: raw.style ?? null,
    orientation: raw.orientation ?? 'portrait',
    pageSize: raw.page_size ?? 'A4',
    pageCount: raw.page_count ?? 0,
    status: raw.status,
    accessTier: raw.access_tier ?? 'standard',
    visibility: raw.visibility ?? 'global',
    compatibility: {
      productionReady: !!raw.production_ready,
      supportedModules: raw.supported_modules ?? [],
      requiredBindings: raw.required_bindings ?? [],
      brandSafe: !!raw.brand_safe,
      compatibilityVersion: raw.compatibility_version ?? 1,
      engine: raw.engine ?? 'weasyprint',
    },
    // `{}` is what a non-family entry carries, and `null` is what the app means
    // by "not part of a design family". Collapsing the two here keeps every
    // consumer from having to know that the column is NOT NULL.
    designMeta: raw.design_meta && typeof raw.design_meta === 'object'
      && Object.keys(raw.design_meta).length > 0
      ? raw.design_meta
      : null,
    thumbnailPath: raw.thumbnail_path ?? null,
    previewImagePaths: raw.preview_image_paths ?? [],
    sourceTemplateId: raw.source_template_id ?? null,
    createdByUserId: raw.created_by_user_id ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    publishedAt: raw.published_at ?? null,
    deprecatedAt: raw.deprecated_at ?? null,
    usageCount: raw.usage_count ?? 0,
    lastUsedAt: raw.last_used_at ?? null,
    previewSchema: raw.preview_schema ?? null,
  };
}

function toDetail(raw: any): TemplateLibraryEntryDetail {
  return {
    ...toListEntry(raw),
    schema: raw.schema,
    config: raw.config ?? {},
    customCss: raw.custom_css ?? null,
  };
}

export interface UseTemplateLibraryOptions {
  /** Superadmin-only. Ignored by the server for everyone else. */
  includeUnpublished?: boolean;
  status?: TemplateLibraryStatus;
  enabled?: boolean;
}

export function useTemplateLibraryEntries(options: UseTemplateLibraryOptions = {}) {
  const { includeUnpublished = false, status, enabled = true } = options;
  return useQuery<TemplateLibraryListEntry[]>({
    queryKey: [...LIST_KEY, { includeUnpublished, status: status ?? null }],
    enabled,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-template-library', {
        operation: 'list',
        filters: { includeUnpublished, ...(status ? { status } : {}) },
      });
      if (error) throw new Error(error.message);
      return ((data as any)?.records ?? []).map(toListEntry);
    },
    // The catalogue changes on a publish, not on a page view.
    staleTime: 5 * 60 * 1000,
  });
}

export function useTemplateLibraryEntry(entryId: string | undefined) {
  return useQuery<TemplateLibraryEntryDetail>({
    queryKey: entryId ? ONE_KEY(entryId) : ['template-library', 'none'],
    enabled: !!entryId,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-template-library', {
        operation: 'get',
        entryId,
      });
      if (error) throw new Error(error.message);
      const record = (data as any)?.record;
      if (!record) throw new Error('Template not found');
      return toDetail(record);
    },
  });
}

export function useTemplateLibraryEvents(entryId: string | undefined) {
  return useQuery({
    queryKey: entryId ? EVENTS_KEY(entryId) : ['template-library', 'no-events'],
    enabled: !!entryId,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-template-library', {
        operation: 'events',
        entryId,
      });
      if (error) throw new Error(error.message);
      return ((data as any)?.records ?? []) as Array<{
        id: string;
        event_type: string;
        summary: string | null;
        created_at: string;
        metadata: Record<string, unknown>;
      }>;
    },
  });
}

/**
 * "Use template" — creates an independent working copy in `report_templates`.
 *
 * The copy is built server-side from the verified session: the client cannot
 * influence `scope`, `owner_user_id`, `is_active`, `is_default` or
 * `approval_status`. See `manage-template-library/index.ts`.
 */
export function useCreateWorkingCopy() {
  const qc = useQueryClient();
  return useMutation<CreateWorkingCopyResult, Error, CreateWorkingCopyInput>({
    mutationFn: async ({ entryId, name, description, colourwayId }) => {
      const { data, error } = await invokeSecureFunction('manage-template-library', {
        operation: 'instantiate',
        entryId,
        name,
        description,
        // The server validates this against the entry's own colourway list and
        // rejects anything else, so sending it is a request rather than an
        // instruction.
        ...(colourwayId ? { colourwayId } : {}),
      });
      if (error) throw new Error(error.message);
      const templateId = (data as any)?.templateId;
      if (!templateId) throw new Error('Template copy returned no id');
      return {
        templateId,
        instantiationId: (data as any)?.instantiationId ?? '',
        colourwayId: (data as any)?.colourwayId ?? null,
      };
    },
    onSuccess: () => {
      // The new copy belongs in the Builder list, and the entry's usage count moved.
      qc.invalidateQueries({ queryKey: ['report-templates'] });
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
    onError: (e) => toast.error(`Could not create working copy: ${e.message}`),
  });
}

export interface AdoptForReportsInput {
  entryId: string;
  /** Null (or the entry's default) ships the authored palette, unbaked. */
  colourwayId?: string | null;
}

export interface AdoptForReportsResult {
  /** The selectable `report_templates` row — existing or newly created. */
  templateId: string;
  /** True when an existing copy (or the seeded house master) was reused. */
  reused: boolean;
  colourwayId: string | null;
}

/**
 * "Use this design for my reports" — the picker's path from the library to a
 * selectable template.
 *
 * Unlike `useCreateWorkingCopy` the result is not an editing draft: the server
 * returns an ACTIVE, user-scoped (or already-global) `report_templates` row,
 * idempotent on (entry, version, colourway), which the caller then stores as
 * their selection. Every safety-critical field is fixed server-side; the entry
 * must be published, production-ready and WeasyPrint-rendered or the server
 * refuses with the reason.
 */
export function useAdoptForReports() {
  const qc = useQueryClient();
  return useMutation<AdoptForReportsResult, Error, AdoptForReportsInput>({
    mutationFn: async ({ entryId, colourwayId }) => {
      const { data, error } = await invokeSecureFunction('manage-template-library', {
        operation: 'use_for_reports',
        entryId,
        ...(colourwayId ? { colourwayId } : {}),
      });
      if (error) throw new Error(error.message);
      const templateId = (data as any)?.templateId;
      if (!templateId) throw new Error('The template could not be prepared');
      return {
        templateId,
        reused: !!(data as any)?.reused,
        colourwayId: (data as any)?.colourwayId ?? null,
      };
    },
    onSuccess: (result) => {
      // A new active row exists (or an existing one is about to be selected):
      // the chooser's candidate list and the Builder list both moved.
      qc.invalidateQueries({ queryKey: ['report-template-selection'] });
      if (!result.reused) qc.invalidateQueries({ queryKey: ['report-templates'] });
    },
    // No onError toast here: the picker owns the failure copy, because "could
    // not adopt" needs to say what still works (the current selection stands).
  });
}

// ─── Administration (superadmin only; the server enforces it) ────────────────

export function useTemplateLibraryAdminMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: LIST_KEY });
  };

  const call = async (payload: Record<string, unknown>) => {
    const { data, error } = await invokeSecureFunction('manage-template-library', payload);
    if (error) throw new Error(error.message);
    return (data as any)?.record;
  };

  const promote = useMutation({
    mutationFn: (args: { templateId: string; entry?: Record<string, unknown> }) =>
      call({ operation: 'promote', templateId: args.templateId, entry: args.entry }),
    onSuccess: () => { invalidate(); toast.success('Promoted to a library draft'); },
    onError: (e: Error) => toast.error(`Promote failed: ${e.message}`),
  });

  const saveDraft = useMutation({
    mutationFn: (args: { entryId: string; entry: Record<string, unknown> }) =>
      call({ operation: 'save_draft', entryId: args.entryId, entry: args.entry }),
    onSuccess: (record: any) => {
      invalidate();
      if (record?.id) qc.invalidateQueries({ queryKey: ONE_KEY(record.id) });
      toast.success('Draft saved');
    },
    onError: (e: Error) => toast.error(`Save failed: ${e.message}`),
  });

  const publish = useMutation({
    mutationFn: (entryId: string) => call({ operation: 'publish', entryId }),
    onSuccess: () => { invalidate(); toast.success('Template published to the library'); },
    onError: (e: Error) => toast.error(`Publish failed: ${e.message}`),
  });

  const deprecate = useMutation({
    mutationFn: (entryId: string) => call({ operation: 'deprecate', entryId }),
    onSuccess: () => { invalidate(); toast.success('Template deprecated'); },
    onError: (e: Error) => toast.error(`Deprecate failed: ${e.message}`),
  });

  const archive = useMutation({
    mutationFn: (entryId: string) => call({ operation: 'archive', entryId }),
    onSuccess: () => { invalidate(); toast.success('Template archived'); },
    onError: (e: Error) => toast.error(`Archive failed: ${e.message}`),
  });

  const restore = useMutation({
    mutationFn: (entryId: string) => call({ operation: 'restore', entryId }),
    onSuccess: () => { invalidate(); toast.success('Template restored to draft'); },
    onError: (e: Error) => toast.error(`Restore failed: ${e.message}`),
  });

  return { promote, saveDraft, publish, deprecate, archive, restore };
}
