/**
 * Template Builder — admin landing page (Phase 1).
 *
 * Lists report templates and lets superadmins create new ones.
 * The visual editor (EditorialCanvas WYSIWYG surface) lives at
 * /admin/template-builder/:id.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Trash2, Layers, History, Loader2, Search, Wand2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { StatusBadge } from '@/components/ui/status-badge';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useReportTemplates, useReportTemplateMutations } from '@/hooks/useReportTemplates';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { makeBlankTemplate } from '@/lib/reportTemplate/templateSchema';
import { getAdapter, listAdapters } from '@/lib/reportTemplate/adapters';
import {
  DEFAULT_TEMPLATE_LIST_FILTERS,
  filterAndSortTemplates,
  formatTemplateDate,
  getTemplateReportTypeOptions,
  getTemplateStats,
  deleteBlockedReason,
  type TemplateRowLike,
  readTemplateListFiltersFromParams,
  writeTemplateListFiltersToParams,
  type TemplateSortOption,
  type TemplateStatusFilter,
} from '@/lib/reportTemplate/templateListControls';
import { TemplateStartSplitButton } from '@/components/templateBuilder/TemplateStartSplitButton';
import { TemplateStartChoices } from '@/components/templateBuilder/TemplateStartChoices';
import { TemplateCard } from '@/components/templateBuilder/TemplateCard';
import { RecentConversions } from '@/components/templateBuilder/converter/RecentConversions';
import { ImportPdfDialog } from '@/components/templateBuilder/ImportPdfDialog';
import { ImportReviewDialog } from '@/components/templateBuilder/ImportReviewDialog';
import { usePersistedImportReviewController } from '@/components/templateBuilder/usePersistedImportReviewController';
import { readImportReviewDecision } from '@/lib/reportTemplate/ingestion/importArtifacts';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { ensureCatalogFontFaces } from '@/lib/reportTemplate/fontCatalog';
import { applyTemplateImportPlan, reconcilePdfImportAsset, TemplateDesignAgentReconciliationClient } from '@/lib/reportTemplate/ingestion/reconciliation';


const REPORT_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  listAdapters().map((adapter) => [adapter.reportType, adapter.label]),
);

export default function TemplateBuilder() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: templates = [], isLoading } = useReportTemplates();
  const { create, update, remove } = useReportTemplateMutations();
  const { canEdit, canDelete } = usePermissions();
  const { user } = useAuth();
  const canEditTemplates = canEdit('templates');
  const canDeleteTemplates = canDelete('templates');
  const [importOpen, setImportOpen] = useState(false);
  const [reconcilingReview, setReconcilingReview] = useState(false);
  /** The template a person has asked to delete. Drives the one page dialog. */
  const [deleteTarget, setDeleteTarget] = useState<TemplateRowLike | null>(null);
  const [filters, setFilters] = useState(() => readTemplateListFiltersFromParams(searchParams));
  const searchParamString = searchParams.toString();
  const { search, reportType: reportTypeFilter, status: statusFilter, sort } = filters;

  useEffect(() => {
    setFilters(readTemplateListFiltersFromParams(new URLSearchParams(searchParamString)));
  }, [searchParamString]);

  useEffect(() => {
    const next = writeTemplateListFiltersToParams(filters);
    if (next.toString() !== searchParamString) {
      setSearchParams(next, { replace: true });
    }
  }, [filters, searchParamString, setSearchParams]);

  const reportTypeOptions = useMemo(() => {
    return getTemplateReportTypeOptions(templates)
      .sort((a: string, b: string) => (REPORT_TYPE_LABELS[a] || a).localeCompare(REPORT_TYPE_LABELS[b] || b));
  }, [templates]);

  const visibleTemplates = useMemo(() => {
    return filterAndSortTemplates(templates, filters);
  }, [templates, filters]);

  const templateStats = useMemo(() => getTemplateStats(templates), [templates]);

  const hasTemplateFilters = search.trim() !== '' || reportTypeFilter !== 'all' || statusFilter !== 'all';
  const clearTemplateFilters = () => {
    setFilters((current) => ({
      ...current,
      search: DEFAULT_TEMPLATE_LIST_FILTERS.search,
      reportType: DEFAULT_TEMPLATE_LIST_FILTERS.reportType,
      status: DEFAULT_TEMPLATE_LIST_FILTERS.status,
    }));
  };
  const handleCreate = () => {
    if (!canEditTemplates) return;
    create.mutate(
      { name: 'Untitled template', schema: makeBlankTemplate() },
      {
        onSuccess: (record: any) => {
          if (record?.id) navigate(`/admin/template-builder/${record.id}`);
        },
      },
    );
  };


  const { data: recentImports = [], isLoading: importsLoading, refetch: refetchRecentImports } = useQuery({
    queryKey: ['template-imports', 'recent', user?.id],
    enabled: !!user?.id && canEditTemplates,
    queryFn: async () => {
      // Read through the secure edge function: the browser Supabase client is
      // anonymous under this app's custom-auth flow, so a direct query against
      // RLS-protected template_imports always returns 0 rows. The function runs
      // as service role after verifying the custom session (admins see all
      // recent imports, non-admins their own).
      const { data, error } = await invokeSecureFunction('template-import-pdf', {
        operation: 'list_recent_imports',
        limit: 10,
      });
      if (error) throw new Error(error.message);
      return ((data as any)?.records ?? []) as any[];
    },
  });
  // Stage 3 — the per-page visual critique is on. Unlike AI repair it cannot
  // change the document (it returns findings, and its endpoint has no path to a
  // template), so the gate it needs is an explicit click rather than an opt-in.
  const importReview = usePersistedImportReviewController({
    onDecisionSaved: () => { void refetchRecentImports(); },
    enableAiCritique: true,
  });

  const runPersistedPdfReconciliation = async () => {
    if (!importReview.reviewDraft || !importReview.reviewRecord?.created_template_id || !importReview.reviewImportAsset) {
      toast.error('This review does not have persisted PDF reference assets to reconcile.');
      return;
    }
    setReconcilingReview(true);
    const t = toast.loading('Reconciling persisted PDF references…');
    try {
      const result = await reconcilePdfImportAsset(importReview.reviewImportAsset, {
        manifests: importReview.reviewImportManifests ?? undefined,
        existingTemplate: importReview.reviewDraft.template,
        client: new TemplateDesignAgentReconciliationClient(invokeSecureFunction as any),
        constraints: {
          mode: 'persisted-import-review-reconcile',
          importId: importReview.reviewImportId,
          sourceFilename: importReview.reviewDraft.sourceFilename,
        },
      });
      const schema = ensureCatalogFontFaces(applyTemplateImportPlan(result.plan, {
        templateName: importReview.reviewDraft.sourceFilename ?? 'Reconciled PDF import',
        baseTemplate: importReview.reviewDraft.template,
      }));
      await update.mutateAsync({
        id: importReview.reviewRecord.created_template_id,
        patch: { schema },
        snapshot: true,
        note: `AI reconciled persisted PDF import ${importReview.reviewImportId ?? importReview.reviewRecord.id}`,
      });
      toast.success(`Applied reconciliation plan with ${result.plan.importSummary.editableElementsCreated} editable overlay(s).`, { id: t });
      navigate(`/admin/template-builder/${importReview.reviewRecord.created_template_id}`);
    } catch (err) {
      toast.error(`PDF reconciliation failed: ${(err as Error).message}`, { id: t });
    } finally {
      setReconcilingReview(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl space-y-6">
      {/* One control, not three.
          `New template` is the primary because it is the common case; the other
          two ways in live behind the chevron where each carries a sentence
          saying what it is for and what you end up with. Three unlabelled peer
          buttons is what made "where is the converter?" a fair question. */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            <Layers className="h-7 w-7 text-primary" aria-hidden />
            Template Builder
          </h1>
          <p className="text-muted-foreground mt-1 text-sm max-w-2xl">
            Every PDF report template lives here. Design one visually, bring an existing PDF in as
            editable pages, or refurbish a template you already send onto the report design system.
          </p>
        </div>
        {canEditTemplates && (
          <TemplateStartSplitButton
            onBlank={handleCreate}
            onImport={() => setImportOpen(true)}
            onConvert={() => navigate('/admin/template-builder/converter')}
            pending={create.isPending}
          />
        )}
      </div>
      <ImportPdfDialog open={importOpen} onOpenChange={setImportOpen} />
      <ImportReviewDialog
        {...importReview.dialogProps}
        reconciliationAvailable={!!importReview.reviewImportAsset && !!importReview.reviewRecord?.created_template_id}
        reconciliationBusy={reconcilingReview}
        onRunReconciliation={runPersistedPdfReconciliation}
      />


      {/* Four cards holding four numbers, none of them actionable, was the
          largest block of chrome on the page. One line says the same thing. */}
      {!isLoading && templates.length > 0 && (
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Templates</dt>
            <dd className="font-semibold tabular-nums">{templateStats.total}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Active</dt>
            <dd><StatusBadge tone="brand">{templateStats.active}</StatusBadge></dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Draft</dt>
            <dd><StatusBadge tone="neutral">{templateStats.draft}</StatusBadge></dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Preview-only</dt>
            <dd><StatusBadge tone="info">{templateStats.previewOnly}</StatusBadge></dd>
          </div>
        </dl>
      )}

      {/* A toolbar, not a card with a heading. "Find the right template
          quickly" was a label telling you a search box is a search box. */}
      {!isLoading && templates.length > 0 && (
        <DashboardThemeFrame variant="toolbar" className="p-4">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_150px_170px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  type="search"
                  aria-label="Search templates"
                  autoComplete="off"
                  spellCheck={false}
                  value={search}
                  onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))}
                  placeholder="Search by name, description, report type, or tier…"
                  className="pl-9"
                />
              </div>
              <Select
                value={reportTypeFilter}
                onValueChange={(value) => setFilters((current) => ({ ...current, reportType: value }))}
              >
                <SelectTrigger aria-label="Filter by report type">
                  <SelectValue placeholder="Report type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All report types</SelectItem>
                  {reportTypeOptions.map((type) => (
                    <SelectItem key={type} value={type}>{REPORT_TYPE_LABELS[type] || type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={statusFilter}
                onValueChange={(value) => setFilters((current) => ({ ...current, status: value as TemplateStatusFilter }))}
              >
                <SelectTrigger aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active only</SelectItem>
                  <SelectItem value="draft">Draft only</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sort}
                onValueChange={(value) => setFilters((current) => ({ ...current, sort: value as TemplateSortOption }))}
              >
                <SelectTrigger aria-label="Sort templates">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated_desc">Recently updated</SelectItem>
                  <SelectItem value="name_asc">Name A–Z</SelectItem>
                  <SelectItem value="name_desc">Name Z–A</SelectItem>
                  <SelectItem value="type">Report type</SelectItem>
                  <SelectItem value="active_first">Active first</SelectItem>
                  <SelectItem value="pages_desc">Most pages</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Showing {visibleTemplates.length} of {templates.length} template{templates.length === 1 ? '' : 's'}.</span>
              {/* The only "Clear filters" on the page, beside the controls it
                  clears. There were two, and they behaved differently — one
                  kept the sort, the other reset it. */}
              {hasTemplateFilters && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearTemplateFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        </DashboardThemeFrame>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        /* The three ways in, in full, exactly once. Visible only on day one —
           free at steady state, unmissable when it matters. */
        <Card>
          <CardContent className="py-10">
            <TemplateStartChoices
              onBlank={handleCreate}
              onImport={() => setImportOpen(true)}
              onConvert={() => navigate('/admin/template-builder/converter')}
              disabled={!canEditTemplates}
              heading="No templates yet"
              description="Three ways to make one. The last line of each card is what you end up with."
            />
          </CardContent>
        </Card>
      ) : (
        visibleTemplates.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" aria-hidden />
              <CardTitle className="text-lg">No templates match your filters</CardTitle>
              {/* No button here. There is one "Clear filters", and it sits in
                  the toolbar beside the controls it clears — two of them, doing
                  subtly different things, is what there used to be. */}
              <CardDescription className="mt-2 max-w-md mx-auto">
                Broaden the search or change the report type and status. Clear filters is in the
                toolbar above.
              </CardDescription>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleTemplates.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                template={tpl}
                reportTypeLabels={REPORT_TYPE_LABELS}
                canEdit={canEditTemplates}
                canDelete={canDeleteTemplates}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )
      )}

      {/* Activity, below the list and closed.
          Recent import reviews used to be the first thing under the header,
          empty for most people, pushing the templates themselves off the fold.
          Conversions join it, so both histories live in one place. */}
      {canEditTemplates && (
        <Accordion type="single" collapsible className="rounded-lg border px-4">
          {(importsLoading || recentImports.length > 0) && (
            <AccordionItem value="imports" className="border-b-0">
              <AccordionTrigger className="text-sm">
                <span className="flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" aria-hidden />
                  Recent import reviews
                  {recentImports.length > 0 && (
                    <span className="text-xs font-normal tabular-nums opacity-60" aria-hidden>
                      {recentImports.length}
                    </span>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-2 pb-4">
                <p className="text-xs text-muted-foreground">
                  Reopen persisted CDIR/fidelity reviews for recent PDF imports.
                </p>

                {importsLoading ? (
                  <Skeleton className="h-10" />
                ) : recentImports.map((imp: any) => {
                  const meta = (imp.meta as any) ?? {};
                  const summary = meta.cdir_fidelity_summary ?? {};
                  const savedDecision = readImportReviewDecision(meta);
                  const hasVisualQa = Boolean(meta.visual_quality_artifact_path);
                  const hasRepair = Boolean(meta.visual_repair_artifact_path);
                  return (
                    <div key={imp.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{imp.source_filename || 'Imported PDF'}</div>
                        <div className="text-xs text-muted-foreground">
                          {imp.page_count ?? 0} page{imp.page_count === 1 ? '' : 's'} · score {summary.overallScore == null ? '—' : `${Math.round(summary.overallScore * 100)}%`}
                          {savedDecision ? ` · ${savedDecision.decision.replace(/_/g, ' ')}` : ''}
                        </div>
                        {savedDecision?.note && <div className="text-[11px] text-muted-foreground line-clamp-1">Note: {savedDecision.note}</div>}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {hasVisualQa ? <Badge variant="default" className="text-[10px]">Visual QA saved</Badge> : <Badge variant="outline" className="text-[10px]">Needs QA</Badge>}
                          {hasRepair && <Badge variant="secondary" className="text-[10px]">Repair audit saved</Badge>}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => importReview.openPersistedReview(imp.id)}
                        disabled={importReview.reviewLoadingId === imp.id}
                      >
                        {importReview.reviewLoadingId === imp.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <History className="h-3.5 w-3.5 mr-1" />}
                        Review / Visual QA
                      </Button>
                    </div>
                  );
                })}
              </AccordionContent>
            </AccordionItem>
          )}

          <AccordionItem value="conversions" className="border-b-0">
            <AccordionTrigger className="text-sm">
              <span className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" aria-hidden />
                Recent conversions
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <RecentConversions heading="" limit={10} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* One dialog for the whole page.
          Every card used to mount its own `AlertDialogContent` tree, and a
          trigger nested inside a dropdown item loses focus when the menu
          closes. */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="border-destructive/25 bg-background text-foreground shadow-2xl shadow-destructive/10 sm:max-w-md">
          <AlertDialogHeader className="space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive sm:mx-0">
              <Trash2 className="h-5 w-5" aria-hidden />
            </div>
            <AlertDialogTitle className="text-destructive">Delete template?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left text-muted-foreground">
              <span className="block">
                This will permanently delete{' '}
                <span className="font-medium text-foreground">{deleteTarget?.name}</span>.
              </span>
              <span className="block">Only inactive, unlocked templates can be deleted. This cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="border-border bg-background text-foreground hover:bg-muted">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/40"
              onClick={() => {
                if (!deleteTarget || deleteBlockedReason(deleteTarget)) return;
                remove.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
