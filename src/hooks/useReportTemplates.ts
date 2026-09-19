/**
 * Hook for CRUD on `report_templates` and `report_template_versions`
 * via the secure `manage-templates` edge function.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import {
  type ReportTemplate,
  parseTemplate,
  makeBlankTemplate,
} from '@/lib/reportTemplate/templateSchema';

const LIST_KEY = ['report-templates'] as const;
const ONE_KEY = (id: string) => ['report-templates', id] as const;
const VERS_KEY = (id: string) => ['report-templates', id, 'versions'] as const;

export interface ReportTemplateRow {
  id: string;
  name: string;
  description: string | null;
  report_type: string | null;
  tier: string | null;
  schema: ReportTemplate;
  version: number;
  is_active: boolean;
  is_default: boolean;
  approval_status?: string | null;
  locked_for_review?: boolean;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Lightweight row for the Template Builder / Templates landing lists.
 *
 * IMPORTANT: the list intentionally omits the heavy `schema` (and `config`)
 * JSONB. Some templates created from PDF imports carry multi-hundred-MB
 * schemas (embedded raster data), and selecting `*` for every row makes the
 * list query detoast/serialise all of them — which blows past Postgres'
 * statement timeout and makes the `manage-templates` edge function fail.
 * The landing lists only need scalar metadata, so we never fetch `schema`
 * here. Per-template `schema` is still fetched on demand by
 * `useReportTemplate(id)` in the editor.
 */
export interface ReportTemplateListRow {
  id: string;
  name: string;
  description: string | null;
  report_type: string | null;
  tier: string | null;
  version: number;
  is_active: boolean;
  is_default: boolean;
  is_draft?: boolean | null;
  approval_status?: string | null;
  locked_for_review?: boolean;
  thumbnail_url: string | null;
  engine?: string | null;
  created_at: string;
  updated_at: string;
  /** Never populated by the list query; kept optional for shared consumers. */
  schema?: ReportTemplate | null;
}

/** Scalar-only column set for list queries — deliberately excludes `schema`/`config`. */
const TEMPLATE_LIST_SELECT =
  'id,name,description,report_type,tier,version,is_active,is_default,is_draft,approval_status,locked_for_review,thumbnail_url,engine,created_at,updated_at';

function normaliseRow(raw: any): ReportTemplateRow {
  try {
    return {
      ...raw,
      schema: parseTemplate(raw?.schema),
    };
  } catch (error) {
    console.warn('[templates] Could not parse template schema; showing row with a blank safe schema fallback.', {
      templateId: raw?.id ?? null,
      templateName: raw?.name ?? null,
      error: (error as Error).message,
    });
    return {
      ...raw,
      schema: makeBlankTemplate(),
    };
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────
export function useReportTemplates() {
  return useQuery<ReportTemplateListRow[]>({
    queryKey: LIST_KEY,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'report_templates',
        // Scalar-only select: never pull the heavy `schema` JSONB for the list.
        listOptions: { select: TEMPLATE_LIST_SELECT, orderBy: 'updated_at', orderAsc: false },
      });
      if (error) throw new Error(error.message);
      return ((data?.records || []) as any[]) as ReportTemplateListRow[];
    },
  });
}

// ─── Single ───────────────────────────────────────────────────────────────────
export function useReportTemplate(id: string | undefined) {
  return useQuery({
    queryKey: id ? ONE_KEY(id) : ['report-templates', 'none'],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'get',
        table: 'report_templates',
        recordId: id,
      });
      if (error) throw new Error(error.message);
      if (!data?.record) throw new Error('Template not found');
      return normaliseRow(data.record);
    },
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────
export function useReportTemplateMutations() {
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async (init: Partial<ReportTemplateRow>) => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'insert',
        table: 'report_templates',
        data: {
          name: init.name || 'Untitled template',
          description: init.description ?? null,
          report_type: init.report_type ?? null,
          tier: init.tier ?? null,
          schema: init.schema ?? makeBlankTemplate(),
          config: (init as any).config ?? {},
          version: 1,
          is_active: false,
          is_default: false,
        },
      });
      if (error) throw new Error(error.message);
      return data?.record;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('Template created');
    },
    onError: (e: Error) => toast.error(`Create failed: ${e.message}`),
  });

  const update = useMutation({
    mutationFn: async (args: { id: string; patch: Partial<ReportTemplateRow>; snapshot?: boolean; note?: string; expectedVersion?: number }) => {
      const { id, patch, snapshot, note, expectedVersion } = args;
      const guardedVersion = Number(expectedVersion);
      const hasExpectedVersion = Number.isFinite(guardedVersion);
      // Optionally snapshot current version first
      if (snapshot) {
        const current = await invokeSecureFunction('manage-templates', {
          operation: 'get',
          table: 'report_templates',
          recordId: id,
        });
        const cur = current.data?.record;
        if (cur) {
          if (cur.locked_for_review) {
            const err = new Error('Template is locked for review. Unlock it before saving a version.') as Error & { code?: string };
            err.code = 'template_locked_for_review';
            throw err;
          }
          if (hasExpectedVersion && Number(cur.version ?? 0) !== guardedVersion) {
            const err = new Error('Template changed on the server. Review the latest version before saving again.') as Error & { code?: string; current?: any };
            err.code = 'version_conflict';
            err.current = cur;
            throw err;
          }
          await invokeSecureFunction('manage-templates', {
            operation: 'insert',
            table: 'report_template_versions',
            data: {
              template_id: id,
              version: cur.version || 1,
              schema: cur.schema,
              note: note ?? null,
            },
          });
          patch.version = (cur.version || 1) + 1;
        }
      }
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'update',
        table: 'report_templates',
        recordId: id,
        expectedVersion: hasExpectedVersion ? guardedVersion : undefined,
        data: patch,
      });
      if (error) {
        const err = new Error(error.message) as Error & { code?: string; current?: any; currentVersion?: number | null };
        const rawError = (data as any)?.error;
        if (rawError?.code) err.code = rawError.code;
        if (rawError?.current) err.current = rawError.current;
        if (rawError?.currentVersion !== undefined) err.currentVersion = rawError.currentVersion;
        throw err;
      }
      return data?.record;
    },
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: ONE_KEY(args.id) });
      qc.invalidateQueries({ queryKey: VERS_KEY(args.id) });
    },
    onError: (e: Error & { code?: string }) => {
      if (e.code === 'version_conflict') return;
      toast.error(`Save failed: ${e.message}`);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await invokeSecureFunction('manage-templates', {
        operation: 'delete',
        table: 'report_templates',
        recordId: id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('Template deleted');
    },
    onError: (e: Error) => toast.error(`Delete failed: ${e.message}`),
  });

  return { create, update, remove };
}

// ─── Version history ──────────────────────────────────────────────────────────
export interface ReportTemplateVersionRow {
  id: string;
  template_id: string;
  version: number;
  schema: ReportTemplate;
  note: string | null;
  label: string | null;
  created_by_name: string | null;
  created_at: string;
}

export function useReportTemplateVersions(templateId: string | undefined) {
  return useQuery({
    queryKey: templateId ? VERS_KEY(templateId) : ['report-templates', 'no-versions'],
    enabled: !!templateId,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'report_template_versions',
        listOptions: {
          orderBy: 'version',
          orderAsc: false,
          filters: { template_id: templateId },
        },
      });
      if (error) throw new Error(error.message);
      return ((data?.records || []) as any[]).map((r) => ({
        ...r,
        schema: parseTemplate(r?.schema),
      })) as ReportTemplateVersionRow[];
    },
  });
}

/** Mutations specific to version snapshots: label edits + manual snapshots. */
export function useReportTemplateVersionMutations(templateId: string | undefined) {
  const qc = useQueryClient();

  const setLabel = useMutation({
    mutationFn: async (args: { versionRowId: string; label: string | null; note?: string | null }) => {
      const { error } = await invokeSecureFunction('manage-templates', {
        operation: 'update',
        table: 'report_template_versions',
        recordId: args.versionRowId,
        data: { label: args.label, ...(args.note !== undefined ? { note: args.note } : {}) },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      if (templateId) qc.invalidateQueries({ queryKey: VERS_KEY(templateId) });
    },
    onError: (e: Error) => toast.error(`Update failed: ${e.message}`),
  });

  /** Manually snapshot the current template (no schema change), incrementing version. */
  const snapshotNow = useMutation({
    mutationFn: async (args: { label?: string | null; note?: string | null }) => {
      if (!templateId) throw new Error('No template');
      const current = await invokeSecureFunction('manage-templates', {
        operation: 'get',
        table: 'report_templates',
        recordId: templateId,
      });
      const cur = current.data?.record;
      if (!cur) throw new Error('Template not found');
      const nextVersion = (cur.version || 1) + 1;
      const { error: insertErr } = await invokeSecureFunction('manage-templates', {
        operation: 'insert',
        table: 'report_template_versions',
        data: {
          template_id: templateId,
          version: cur.version || 1,
          schema: cur.schema,
          note: args.note ?? null,
          label: args.label ?? null,
        },
      });
      if (insertErr) throw new Error(insertErr.message);
      const { error: updateErr } = await invokeSecureFunction('manage-templates', {
        operation: 'update',
        table: 'report_templates',
        recordId: templateId,
        data: { version: nextVersion },
      });
      if (updateErr) throw new Error(updateErr.message);
    },
    onSuccess: () => {
      if (templateId) {
        qc.invalidateQueries({ queryKey: VERS_KEY(templateId) });
        qc.invalidateQueries({ queryKey: ONE_KEY(templateId) });
      }
      toast.success('Snapshot saved');
    },
    onError: (e: Error) => toast.error(`Snapshot failed: ${e.message}`),
  });

  return { setLabel, snapshotNow };
}
