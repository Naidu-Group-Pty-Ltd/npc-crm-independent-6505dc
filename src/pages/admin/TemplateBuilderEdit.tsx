/**
 * Template Builder — Editor (Phase 2).
 *
 * Layout: [PagesPanel] [EditorialCanvas] [PropertiesInspector]
 *                                              + collapsible Live PDF preview
 *
 * The template JSON remains the single source of truth. The canvas only edits
 * overlays (position, size, text content); blocks and bindings are edited in
 * the inspector / page panel. Live PDF regenerates on a 500ms debounce.
 */
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Save, Eye, Loader2, History, Code2, Layout,
  Download, Copy as CopyIcon, CheckCircle2, Undo2, Redo2, Upload, Palette, Database, Plus, Trash2,
  ShieldAlert, Component, Sparkles, Command as CommandIcon, Wand2, LayoutTemplate, ClipboardCopy, ClipboardPaste,
  RefreshCw, GitCompareArrows, GitBranch, ClipboardCheck, Lock, FileText,
  ChevronDown, MoreHorizontal, CheckSquare, Settings2, Image as ImageIcon, Type, Table as TableIcon, MapPinned,
  Zap, Cpu, Activity,
} from 'lucide-react';
// Always-mounted editor chrome stays eagerly imported; the heavy on-demand
// dialogs below are React.lazy + MountOnFirstOpen so they're code-split out of
// the editor chunk and cost nothing until first opened (rehaul Phase 2).
import { SaveConflictDialog } from '@/components/templateBuilder/SaveConflictDialog';
import { DraftRecoveryDialog } from '@/components/templateBuilder/DraftRecoveryDialog';
import { BulkEditBar } from '@/components/templateBuilder/BulkEditBar';
import { CommandPalette } from '@/components/templateBuilder/CommandPalette';
import { BindingPathsPopover } from '@/components/templateBuilder/BindingPathsPopover';
import { ComputedFieldsDialog } from '@/components/templateBuilder/ComputedFieldsDialog';
import { PageMastersDialog } from '@/components/templateBuilder/PageMastersDialog';
import { ThemesDialog } from '@/components/templateBuilder/ThemesDialog';
import { LiveHtmlPreview } from '@/components/templateBuilder/LiveHtmlPreview';
import { MountOnFirstOpen } from '@/components/templateBuilder/MountOnFirstOpen';
import { ImportReviewDialog } from '@/components/templateBuilder/ImportReviewDialog';
import { usePersistedImportReviewController } from '@/components/templateBuilder/usePersistedImportReviewController';

const ResyncPdfDialog = lazy(() => import('@/components/templateBuilder/ResyncPdfDialog').then((m) => ({ default: m.ResyncPdfDialog })));
const ReferenceImportDialog = lazy(() => import('@/components/templateBuilder/ReferenceImportDialog').then((m) => ({ default: m.ReferenceImportDialog })));
const PdfFidelityDiffDialog = lazy(() => import('@/components/templateBuilder/PdfFidelityDiffDialog').then((m) => ({ default: m.PdfFidelityDiffDialog })));
const TemplateBranchingDialog = lazy(() => import('@/components/templateBuilder/TemplateBranchingDialog').then((m) => ({ default: m.TemplateBranchingDialog })));
const TemplateApprovalDialog = lazy(() => import('@/components/templateBuilder/TemplateApprovalDialog').then((m) => ({ default: m.TemplateApprovalDialog })));
const TemplateAuditLogDialog = lazy(() => import('@/components/templateBuilder/TemplateAuditLogDialog').then((m) => ({ default: m.TemplateAuditLogDialog })));
const PageTemplatesMarketplaceDialog = lazy(() => import('@/components/templateBuilder/PageTemplatesMarketplaceDialog').then((m) => ({ default: m.PageTemplatesMarketplaceDialog })));
const ExportPipelineDialog = lazy(() => import('@/components/templateBuilder/ExportPipelineDialog').then((m) => ({ default: m.ExportPipelineDialog })));
const TemplateCommentsPanel = lazy(() => import('@/components/templateBuilder/TemplateCommentsPanel').then((m) => ({ default: m.TemplateCommentsPanel })));
const ShareLinksDialog = lazy(() => import('@/components/templateBuilder/ShareLinksDialog').then((m) => ({ default: m.ShareLinksDialog })));
const VersionHistoryDialog = lazy(() => import('@/components/templateBuilder/VersionHistoryDialog').then((m) => ({ default: m.VersionHistoryDialog })));
const TemplateAnalyticsDialog = lazy(() => import('@/components/templateBuilder/TemplateAnalyticsDialog').then((m) => ({ default: m.TemplateAnalyticsDialog })));
const TemplateAIAuthorDialog = lazy(() => import('@/components/templateBuilder/TemplateAIAuthorDialog').then((m) => ({ default: m.TemplateAIAuthorDialog })));
const TemplateDesignAgentPanel = lazy(() => import('@/components/templateBuilder/TemplateDesignAgentPanel').then((m) => ({ default: m.TemplateDesignAgentPanel })));
const PreviewQADialog = lazy(() => import('@/components/templateBuilder/PreviewQADialog').then((m) => ({ default: m.PreviewQADialog })));
const ComponentLibraryDialog = lazy(() => import('@/components/templateBuilder/ComponentLibraryDialog').then((m) => ({ default: m.ComponentLibraryDialog })));
const SpellCheckDialog = lazy(() => import('@/components/templateBuilder/SpellCheckDialog').then((m) => ({ default: m.SpellCheckDialog })));
const SnippetLibraryDialog = lazy(() => import('@/components/templateBuilder/SnippetLibraryDialog').then((m) => ({ default: m.SnippetLibraryDialog })));
const FindReplaceDialog = lazy(() => import('@/components/templateBuilder/FindReplaceDialog').then((m) => ({ default: m.FindReplaceDialog })));
const AssetLibraryDialog = lazy(() => import('@/components/templateBuilder/AssetLibraryDialog').then((m) => ({ default: m.AssetLibraryDialog })));
const TextStylesDialog = lazy(() => import('@/components/templateBuilder/TextStylesDialog').then((m) => ({ default: m.TextStylesDialog })));
const TableEditorDialog = lazy(() => import('@/components/templateBuilder/TableEditorDialog').then((m) => ({ default: m.TableEditorDialog })));
import { CascadeMapPanel } from '@/components/templateBuilder/CascadeMapPanel';
import { logTemplateEvent } from '@/lib/reportTemplate/analyticsClient';
import { logTemplateAudit } from '@/lib/reportTemplate/templateAuditLog';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useTemplateDraftAutosave } from '@/hooks/templateBuilder/useTemplateDraftAutosave';
import {
  loadTemplateDraft,
  deleteTemplateDraft,
  makeDraftSignature,
  evaluateDraftRecovery,
  type TemplateDraft,
} from '@/lib/reportTemplate/templateDraftStore';
import * as editorActions from '@/lib/reportTemplate/editorActions';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { BindingFixerPopover } from '@/components/templateBuilder/BindingFixerPopover';
import { getSnippet } from '@/lib/reportTemplate/snippetLibrary';
import { getThemePreset } from '@/lib/reportTemplate/themePresets';
import { STARTER_PAGE_PRESETS, getStarterPreset } from '@/lib/reportTemplate/starterTemplates';
import { SAMPLE_DATA_PRESETS, DEFAULT_SAMPLE_DATA_PRESET } from '@/lib/reportTemplate/sampleDataPresets';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  useReportTemplate,
  useReportTemplateMutations,
  useReportTemplateVersions,
} from '@/hooks/useReportTemplates';
import {
  parseTemplate,
  type Block,
  type Overlay,
  type Page,
  type ReportTemplate,
} from '@/lib/reportTemplate/templateSchema';
// jsPDF preview retired — PDF tab now renders via WeasyPrint for production parity.
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { renderHtmlToPdfUrl, pdfFileNameFor } from '@/lib/reportTemplate/weasyRenderClient';
import {
  compileTemplateHtmlForPdf, describeDroppedAssets, describeUnresolvedRasterPages,
} from '@/lib/reportTemplate/compileTemplateForPdf';
import { downloadUrlAsFile } from '@/lib/downloadFile';
import {
  buildCascadeActivationReadiness,
  buildCascadeAnchorSuggestions,
  buildCascadeMap,
  contractFromStructureTemplate,
  selectStructureTemplate,
  withSampleSectionData,
  type ReportStructureTemplateLike,
} from '@/lib/reportTemplate/cascadeMap';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { PdfImportEngine } from '@/lib/reportTemplate/pdfImport/types';
import { supabase } from '@/integrations/supabase/client';
import { lintTemplate, type LintIssue } from '@/lib/reportTemplate/lintTemplate';
import { useTemplateAnalysis } from '@/hooks/templateBuilder/useTemplateAnalysis';
import { useTemplateHistory } from '@/hooks/templateBuilder/useTemplateHistory';
import { useTemplateMutators } from '@/hooks/templateBuilder/useTemplateMutators';
import { templateEditorActions, useTemplateEditorStore } from '@/stores/templateEditorStore';
import { useEditorKeyboardShortcuts } from '@/hooks/templateBuilder/useEditorKeyboardShortcuts';
import { useWeasyPdfPreview } from '@/hooks/templateBuilder/useWeasyPdfPreview';
import { useBrand } from '@/branding/BrandProvider';
import { BLOCK_DEFS, getBlockRendererCapabilities } from '@/lib/reportTemplate/blocks';
import { getAdapter, listAdapters } from '@/lib/reportTemplate/adapters';
import { EditorialCanvas } from '@/components/templateBuilder/EditorialCanvas';
import { EditorEmptyState } from '@/components/templateBuilder/EditorEmptyState';
import { EditorOnboardingTour, hasSeenEditorTour, markEditorTourSeen } from '@/components/templateBuilder/EditorOnboardingTour';
import { isTemplateEditorV2Enabled, setTemplateEditorV2 } from '@/lib/reportTemplate/editorV2Flag';
import { TemplateShortcutsDialog } from '@/components/templateBuilder/TemplateShortcutsDialog';
import { PagesPanel } from '@/components/templateBuilder/PagesPanel';
import { PropertiesInspector } from '@/components/templateBuilder/PropertiesInspector';
import { BrandKitPanel } from '@/components/admin/template-builder/BrandKitPanel';
import { CanvasChrome } from '@/components/templateBuilder/CanvasChrome';
import { OutlinePanel } from '@/components/templateBuilder/OutlinePanel';
import { AlignDistributeBar } from '@/components/templateBuilder/AlignDistributeBar';
import { TokensEditor } from '@/components/templateBuilder/TokensEditor';
import { SlotsEditor } from '@/components/templateBuilder/SlotsEditor';
import { ThemePresetsGallery } from '@/components/templateBuilder/ThemePresetsGallery';
import * as layoutActions from '@/lib/reportTemplate/editorActions.layout';


const DEFAULT_SAMPLE_DATA = DEFAULT_SAMPLE_DATA_PRESET.data;

type TemplateCommentAnchorRow = {
  id: string;
  page_id: string | null;
  block_id: string | null;
  overlay_id: string | null;
  resolved: boolean;
};

type TemplateMeta = {
  parent_template_id: string | null;
  is_draft: boolean;
  approval_status: string | null;
  locked_for_review: boolean;
  is_active: boolean;
  is_default: boolean;
};

type TemplateEditSignatureInput = {
  name: string;
  description: string;
  reportType: string;
  tier: string;
  variant: string;
  scope: string;
  priority: number;
  customCss: string;
  template: ReportTemplate;
};

function makeTemplateEditSignature(input: TemplateEditSignatureInput): string {
  return JSON.stringify(input);
}

function describeJsonError(error: unknown, text: string): string {
  if (!(error instanceof SyntaxError)) return error instanceof Error ? error.message : 'Invalid JSON';
  const match = /position (\d+)/i.exec(error.message);
  if (!match) return error.message;
  const position = Number(match[1]);
  const before = text.slice(0, position);
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  return `${error.message} (line ${line}, column ${column})`;
}

const RENDERER_ISSUE_CODES = new Set<LintIssue['code']>(['renderer-partial', 'renderer-unsupported']);

function isRendererIssue(issue: LintIssue): boolean {
  return RENDERER_ISSUE_CODES.has(issue.code);
}

export default function TemplateBuilderEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: tplRow, isLoading } = useReportTemplate(id);
  const { update, create } = useReportTemplateMutations();
  const { data: versions = [] } = useReportTemplateVersions(id);
  const qc = useQueryClient();
  // Stage 3 — see TemplateBuilder.tsx: a critique reports and cannot write.
  const importReview = usePersistedImportReviewController({
    onRepairApplied: () => { if (id) void qc.invalidateQueries({ queryKey: ['report-templates', id] }); },
    enableAiCritique: true,
  });
  const { data: linkedImport, isLoading: linkedImportLoading } = useQuery({
    queryKey: ['template-imports', 'linked-template', id],
    enabled: !!id,
    queryFn: async () => {
      // Read through the secure edge function: the browser Supabase client is
      // anonymous under this app's custom-auth flow, so a direct query against
      // RLS-protected template_imports always returns null. The function runs
      // as service role after verifying the custom session.
      const { data, error } = await invokeSecureFunction('template-import-pdf', {
        operation: 'get_linked_import',
        template_id: id,
      });
      if (error) throw new Error(error.message);
      return ((data as any)?.record ?? null) as { id: string; source_filename: string | null } | null;
    },
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [reportType, setReportType] = useState('');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [showAnalyticsDialog, setShowAnalyticsDialog] = useState(false);
  const [showAIAuthor, setShowAIAuthor] = useState(false);
  const [showDesignAgent, setShowDesignAgent] = useState(false);
  const [showPreviewQA, setShowPreviewQA] = useState(false);
  const [showSpellCheck, setShowSpellCheck] = useState(false);
  const [showComponentLib, setShowComponentLib] = useState(false);
  const [showResync, setShowResync] = useState(false);
  const [resyncEngine, setResyncEngine] = useState<PdfImportEngine | undefined>(undefined);
  const [showReferenceImport, setShowReferenceImport] = useState(false);
  // V2 (Canva-style) editor flag — gates drag-and-drop drop-to-place. ON by
  // default since rehaul Phase 8; `?editorV2=0` / localStorage is the kill-switch.
  const editorV2 = useMemo(() => isTemplateEditorV2Enabled(), []);
  // First-run coachmark for the new V2 drag-and-drop (dismiss persists per-browser).
  const [showV2Hint, setShowV2Hint] = useState(() => {
    try { return editorV2 && localStorage.getItem('tpl-v2-coachmark-seen') !== '1'; } catch { return false; }
  });
  const dismissV2Hint = () => {
    setShowV2Hint(false);
    try { localStorage.setItem('tpl-v2-coachmark-seen', '1'); } catch { /* ignore */ }
  };
  // Multi-step onboarding tour (Phase 7) — opens once per browser; reopenable
  // from the shortcuts dialog via `resetEditorTour()`.
  const [showTour, setShowTour] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [showBranches, setShowBranches] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [cascadeCompareLeftId, setCascadeCompareLeftId] = useState('working');
  const [cascadeCompareRightId, setCascadeCompareRightId] = useState('');
  const [tplMeta, setTplMeta] = useState<TemplateMeta | null>(null);
  const [customCss, setCustomCss] = useState<string>('');
  const { user } = useAuth();
  const { isSuperadmin } = usePermissions();
  const [tier, setTier] = useState('');
  const [variant, setVariant] = useState<string>(''); // '' = any
  const [scope, setScope] = useState<string>('global');
  const [priority, setPriority] = useState<number>(0);
  // ── Template document + undo/redo history + governance guard ───────────────
  // Owned by templateEditorStore via the useTemplateHistory façade (rehaul
  // Phase 2). Mounting the hook starts a fresh editor session, so it must run
  // before the selection subscriptions below.
  const { template, setTemplate, loadTemplate, undo, redo, setGovernanceReadOnly } = useTemplateHistory();
  const brand = useBrand();
  // ── Selection (store slices + permanently stable actions) ──────────────────
  const activePageId = useTemplateEditorStore((s) => s.activePageId);
  const selectedOverlayId = useTemplateEditorStore((s) => s.selectedOverlayId);
  const selectedBlockId = useTemplateEditorStore((s) => s.selectedBlockId);
  const multiOverlayIds = useTemplateEditorStore((s) => s.multiOverlayIds);
  const {
    setActivePageId,
    setSelectedOverlayId,
    setSelectedBlockId,
    setMultiOverlayIds,
    clearMultiSelect,
  } = templateEditorActions();
  const [workspaceMode, setWorkspaceMode] = useState<'preview' | 'canvas' | 'pdf'>('canvas');
  const [activeMainTab, setActiveMainTab] = useState('visual');
  const [previewScope, setPreviewScope] = useState<'page' | 'document'>('page');
  const [lastSavedSignature, setLastSavedSignature] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState<{ message: string; serverVersion: number | null } | null>(null);
  const [showConflict, setShowConflict] = useState(false);
  const [dirtySince, setDirtySince] = useState<string | null>(null);
  const [commentRows, setCommentRows] = useState<TemplateCommentAnchorRow[]>([]);
  // ── Local draft recovery (Phase 3B) ─────────────────────────────────────────
  const [draftRecovery, setDraftRecovery] = useState<TemplateDraft | null>(null);
  const [showDraftRecovery, setShowDraftRecovery] = useState(false);
  const [staleDraftBase, setStaleDraftBase] = useState(false);

  // ── Sample data (editable in the Data tab, used for live preview) ───────────
  const [sampleDataText, setSampleDataText] = useState(JSON.stringify(DEFAULT_SAMPLE_DATA, null, 2));
  const parsedSampleData = useMemo(() => {
    try { return { data: JSON.parse(sampleDataText), valid: true }; }
    catch { return { data: DEFAULT_SAMPLE_DATA, valid: false }; }
  }, [sampleDataText]);
  // NB: `sampleData` (the parsed data merged with placeholder `sections.*`
  // content from the cascade contract) is derived below, after the cascade
  // structure query — nothing consumes it before then.
  const sampleDataValid = parsedSampleData.valid;
  const [sampleDataError, setSampleDataError] = useState<string | null>(null);
  const [templateJsonText, setTemplateJsonText] = useState('');
  const [templateJsonError, setTemplateJsonError] = useState<string | null>(null);
  const [templateJsonFocused, setTemplateJsonFocused] = useState(false);

  useEffect(() => {
    try {
      JSON.parse(sampleDataText);
      setSampleDataError(null);
    } catch (error) {
      setSampleDataError(describeJsonError(error, sampleDataText));
    }
  }, [sampleDataText]);

  useEffect(() => {
    if (templateJsonFocused || templateJsonError) return;
    setTemplateJsonText(JSON.stringify(template, null, 2));
  }, [template, templateJsonError, templateJsonFocused]);

  const applyTemplateJsonText = useCallback((text: string) => {
    try {
      const parsed = parseTemplate(JSON.parse(text));
      setTemplate(parsed);
      setTemplateJsonError(null);
      return true;
    } catch (error) {
      setTemplateJsonError(describeJsonError(error, text));
      return false;
    }
  }, [setTemplate]);

  // ── Block clipboard (cross-page copy/paste) ─────────────────────────────────
  const clipboardRef = useRef<Block | null>(null);
  // ── Style clipboard (overlay style copy/paste) ──────────────────────────────
  const styleClipboardRef = useRef<Partial<Overlay> | null>(null);
  const [hasStyleClipboard, setHasStyleClipboard] = useState(false);
  // ── Overlay clipboard (cut/copy/paste of one or more overlays) ──────────────
  const overlayClipboardRef = useRef<Overlay[] | null>(null);
  // ── Shortcuts help dialog ───────────────────────────────────────────────────
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // ── Page templates marketplace dialog ───────────────────────────────────────
  const [showPageMarket, setShowPageMarket] = useState(false);
  // Track which (id, version) we've already hydrated local state from so that
  // background refetches (e.g. on window focus or post-save invalidation) do
  // NOT silently overwrite the user's in-progress edits with the previously
  // persisted schema. We only re-hydrate when the template id or its server
  // version actually changes.
  const hydratedKeyRef = useRef<string | null>(null);
  // Ensures the local-draft recovery check runs once per (id, server version).
  const draftCheckedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tplRow) return;
    const key = `${user.id}:${tplRow.id}:${tplRow.version ?? 0}`;
    if (hydratedKeyRef.current === key) {
      // Same id+version we already loaded — keep local edits intact, but still
      // refresh lightweight metadata flags that don't risk clobbering work.
      setTplMeta({
        parent_template_id: (tplRow as any).parent_template_id ?? null,
        is_draft: !!(tplRow as any).is_draft,
        approval_status: (tplRow as any).approval_status ?? 'draft',
        locked_for_review: !!(tplRow as any).locked_for_review,
        is_active: !!(tplRow as any).is_active,
        is_default: !!(tplRow as any).is_default,
      });
      return;
    }
    hydratedKeyRef.current = key;
    setName(tplRow.name || '');
    setDescription(tplRow.description || '');
    setReportType(tplRow.report_type || '');
    setTier(tplRow.tier || '');
    setVariant(((tplRow as any).variant as string) || '');
    setScope(((tplRow as any).scope as string) || 'global');
    setPriority(Number((tplRow as any).priority ?? 0));
    setCustomCss(((tplRow as any).custom_css as string) || '');
    setTplMeta({
      parent_template_id: (tplRow as any).parent_template_id ?? null,
      is_draft: !!(tplRow as any).is_draft,
      approval_status: (tplRow as any).approval_status ?? 'draft',
      locked_for_review: !!(tplRow as any).locked_for_review,
      is_active: !!(tplRow as any).is_active,
      is_default: !!(tplRow as any).is_default,
    });
    const parsed = parseTemplate(tplRow.schema);
    loadTemplate(parsed);
    setLastSavedSignature(makeTemplateEditSignature({
      name: tplRow.name || '',
      description: tplRow.description || '',
      reportType: tplRow.report_type || '',
      tier: tplRow.tier || '',
      variant: ((tplRow as any).variant as string) || '',
      scope: ((tplRow as any).scope as string) || 'global',
      priority: Number((tplRow as any).priority ?? 0),
      customCss: ((tplRow as any).custom_css as string) || '',
      template: parsed,
    }));
    setLastSavedAt(new Date().toISOString());
    setSaveConflict(null);
    setActivePageId((prev) => parsed.pages.some((p) => p.id === prev) ? prev : parsed.pages[0]?.id ?? null);
  }, [tplRow, loadTemplate]);

  useEffect(() => {
    setGovernanceReadOnly((tplMeta?.approval_status === 'approved' && !tplMeta?.is_draft) || false);
  }, [tplMeta?.approval_status, tplMeta?.is_draft, setGovernanceReadOnly]);

  useEffect(() => {
    if (!template.pages.length) {
      if (activePageId) setActivePageId(null);
      return;
    }
    if (!activePageId || !template.pages.some((p) => p.id === activePageId)) {
      setActivePageId(template.pages[0].id);
      setSelectedOverlayId(null);
      setSelectedBlockId(null);
    }
  }, [template.pages, activePageId]);

  // Open the first-run Phase 7 tour once the editor has at least one page —
  // keeps the empty-state CTAs unobstructed and avoids firing on every blank
  // template load.
  useEffect(() => {
    if (!editorV2) return;
    if (template.pages.length === 0) return;
    if (hasSeenEditorTour()) return;
    const t = setTimeout(() => setShowTour(true), 600);
    return () => clearTimeout(t);
  }, [editorV2, template.pages.length]);

  const reloadTplMeta = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('report_templates' as any)
      .select('parent_template_id,is_draft,approval_status,locked_for_review,is_active,is_default')
      .eq('id', id)
      .single();
    if (data) setTplMeta(data as any);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const loadCommentAnchors = async () => {
      const { data } = await supabase
        .from('template_comments' as any)
        .select('id,page_id,block_id,overlay_id,resolved')
        .eq('template_id', id);
      if (!cancelled) setCommentRows(((data ?? []) as unknown) as TemplateCommentAnchorRow[]);
    };
    void loadCommentAnchors();
    const channel = supabase
      .channel(`tpl-comment-anchors:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'template_comments', filter: `template_id=eq.${id}` }, () => loadCommentAnchors())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [id]);

  const pdfImportMeta = template.meta?.pdfImport;
  const isLegacyPdfImport = pdfImportMeta?.engine === 'legacy';
  const activePage = useMemo<Page | null>(
    () => template.pages.find((p) => p.id === activePageId) ?? null,
    [template, activePageId],
  );
  useEffect(() => { setMultiOverlayIds(new Set()); }, [activePageId]);

  const selectedOverlay = useMemo<Overlay | null>(() => {
    if (!activePage || !selectedOverlayId) return null;
    for (const b of activePage.blocks) {
      const found = b.overlays.find((o) => o.id === selectedOverlayId);
      if (found) return found;
    }
    return null;
  }, [activePage, selectedOverlayId]);

  const selectedBlock = useMemo<Block | null>(() => {
    if (!activePage || !selectedBlockId) return null;
    return activePage.blocks.find((block) => block.id === selectedBlockId) ?? null;
  }, [activePage, selectedBlockId]);

  const selectedOverlayBlockId = useMemo(() => {
    if (!activePage || !selectedOverlayId) return null;
    return activePage.blocks.find((block) => block.overlays.some((overlay) => overlay.id === selectedOverlayId))?.id ?? null;
  }, [activePage, selectedOverlayId]);

  const commentAnchors = useMemo(() => commentRows.map((row) => ({
    id: row.id,
    pageId: row.page_id,
    blockId: row.block_id,
    overlayId: row.overlay_id,
    resolved: row.resolved,
  })), [commentRows]);

  const activePageCommentAnchors = useMemo(() => commentAnchors
    .filter((anchor) => anchor.pageId === activePageId), [activePageId, commentAnchors]);

  const adapterOptions = useMemo(() => listAdapters(), []);
  const reportTypeAdapter = useMemo(() => getAdapter(reportType), [reportType]);
  const isProductionReportType = !!reportTypeAdapter?.supportsProduction;
  const { data: cascadeStructureRows = [] } = useQuery({
    queryKey: ['report-structure-templates', 'activation-cascade', reportType || '', tier || ''],
    enabled: !!reportType,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'report_structure_templates',
        listOptions: {
          select: 'id,name,parsed_content,report_tier,report_category,priority,is_active,template_type',
          orderBy: 'priority',
          orderAsc: false,
          filters: { template_type: 'ai_structure', is_active: true },
        },
      });
      if (error) throw new Error(error.message);
      return (data?.records ?? []) as ReportStructureTemplateLike[];
    },
  });
  const cascadeStructure = useMemo(
    () => selectStructureTemplate(cascadeStructureRows, { tier: tier || null, category: reportType || null }),
    [cascadeStructureRows, tier, reportType],
  );
  const cascadeContract = useMemo(
    () => contractFromStructureTemplate(cascadeStructure, { reportType: reportType || null, tier: tier || null, category: reportType || null }),
    [cascadeStructure, reportType, tier],
  );
  // Placeholder section content keyed by the cascade contract ids, so mapped
  // {{sections.*}} bindings preview with copy before a real report is loaded.
  const sampleData = useMemo(
    () => withSampleSectionData(parsedSampleData.data, cascadeContract),
    [parsedSampleData, cascadeContract],
  );
  const cascadeMap = useMemo(
    () => buildCascadeMap(template, cascadeContract, { data: sampleData, templateId: id }),
    [template, cascadeContract, sampleData, id],
  );
  const cascadeAnchorSuggestions = useMemo(
    () => buildCascadeAnchorSuggestions(template, cascadeContract),
    [template, cascadeContract],
  );
  const cascadeReadiness = useMemo(
    () => buildCascadeActivationReadiness(cascadeMap, cascadeAnchorSuggestions, { requireQaApproved: true }),
    [cascadeMap, cascadeAnchorSuggestions],
  );
  const cascadeSnapshotNote = useMemo(
    () => `Cascade: ${cascadeReadiness.mappedRequiredSections}/${cascadeReadiness.requiredSections} required sections mapped; ${cascadeReadiness.totalAnchors} anchor${cascadeReadiness.totalAnchors === 1 ? '' : 's'}; ${cascadeReadiness.blockerCount} blocker${cascadeReadiness.blockerCount === 1 ? '' : 's'}; ${cascadeReadiness.qaApprovedRequiredSections}/${cascadeReadiness.requiredSections} QA-approved; ${cascadeReadiness.autoMapSuggestionCount} auto-map suggestion${cascadeReadiness.autoMapSuggestionCount === 1 ? '' : 's'}.`,
    [cascadeReadiness],
  );
  const cascadeCompareOptions = useMemo(() => [
    { id: 'working', label: 'Working draft', schema: template },
    ...versions.map((version) => ({ id: version.id, label: `v${version.version}`, schema: parseTemplate(version.schema) })),
  ], [template, versions]);
  useEffect(() => {
    if (!cascadeCompareRightId && versions[0]?.id) setCascadeCompareRightId(versions[0].id);
    if (!cascadeCompareOptions.some((option) => option.id === cascadeCompareLeftId)) setCascadeCompareLeftId('working');
    if (cascadeCompareRightId && !cascadeCompareOptions.some((option) => option.id === cascadeCompareRightId)) setCascadeCompareRightId(versions[0]?.id ?? '');
  }, [cascadeCompareLeftId, cascadeCompareOptions, cascadeCompareRightId, versions]);
  const cascadeVersionCompare = useMemo(() => {
    const left = cascadeCompareOptions.find((option) => option.id === cascadeCompareLeftId);
    const right = cascadeCompareOptions.find((option) => option.id === cascadeCompareRightId);
    if (!left || !right) return null;
    const summarize = (schema: ReportTemplate) => {
      const map = buildCascadeMap(schema, cascadeContract, { data: sampleData, templateId: id });
      const suggestions = buildCascadeAnchorSuggestions(schema, cascadeContract);
      return buildCascadeActivationReadiness(map, suggestions, { requireQaApproved: true });
    };
    const leftReadiness = summarize(left.schema);
    const rightReadiness = summarize(right.schema);
    return { left, right, leftReadiness, rightReadiness };
  }, [cascadeCompareLeftId, cascadeCompareOptions, cascadeCompareRightId, cascadeContract, id, sampleData]);

  const currentSignature = useMemo(() => makeTemplateEditSignature({
    name,
    description,
    reportType,
    tier,
    variant,
    scope,
    priority,
    customCss,
    template,
  }), [name, description, reportType, tier, variant, scope, priority, customCss, template]);
  const isDirty = !!lastSavedSignature && currentSignature !== lastSavedSignature;

  // Warn before losing unsaved edits: tab close / reload (beforeunload),
  // in-app link navigation (capture-phase click), and imperative navigate()
  // calls via confirmLeave(). React Router's useBlocker is unavailable here
  // because the app uses <BrowserRouter> rather than a data router.
  const { confirmLeave } = useUnsavedChangesGuard({ when: isDirty });

  // Track when the editor first became dirty (for the "unsaved since" status).
  useEffect(() => {
    setDirtySince((prev) => (isDirty ? (prev ?? new Date().toISOString()) : null));
  }, [isDirty]);

  // ── Local draft autosave + recovery (Phase 3B) ──────────────────────────────
  const buildDraftSnapshot = useCallback((): Omit<TemplateDraft, 'savedAt'> | null => {
    if (!id || !user?.id) return null;
    return {
      ownerId: user.id,
      templateId: id,
      baseServerVersion: Number(tplRow?.version ?? 1),
      name,
      description,
      reportType,
      tier,
      variant,
      scope,
      priority: Number.isFinite(priority) ? priority : 0,
      customCss,
      sampleDataText,
      schema: template,
    };
  }, [id, user?.id, tplRow?.version, name, description, reportType, tier, variant, scope, priority, customCss, sampleDataText, template]);

  const { lastLocalSaveAt, setLastLocalSaveAt } = useTemplateDraftAutosave({
    templateId: id,
    enabled: Boolean(user?.id) && isDirty && !isLoading && !showDraftRecovery,
    changeKey: currentSignature,
    getDraft: buildDraftSnapshot,
  });

  const applyDraftToEditor = useCallback((draft: TemplateDraft) => {
    setName(draft.name || '');
    setDescription(draft.description || '');
    setReportType(draft.reportType || '');
    setTier(draft.tier || '');
    setVariant(draft.variant || '');
    setScope(draft.scope || 'global');
    setPriority(Number.isFinite(draft.priority) ? draft.priority : 0);
    setCustomCss(draft.customCss || '');
    if (typeof draft.sampleDataText === 'string') setSampleDataText(draft.sampleDataText);
    const parsed = parseTemplate(draft.schema);
    loadTemplate(parsed);
    setActivePageId((prev) => (parsed.pages.some((p) => p.id === prev) ? prev : parsed.pages[0]?.id ?? null));
    setLastLocalSaveAt(draft.savedAt);
  }, [loadTemplate, setLastLocalSaveAt]);

  const handleRestoreDraft = useCallback(() => {
    if (!draftRecovery) return;
    applyDraftToEditor(draftRecovery);
    setShowDraftRecovery(false);
    setDraftRecovery(null);
    toast.success('Draft restored — Save to persist it to the server');
  }, [draftRecovery, applyDraftToEditor]);

  const handleDiscardDraft = useCallback(() => {
    if (user?.id && id) void deleteTemplateDraft(user.id, id);
    setShowDraftRecovery(false);
    setDraftRecovery(null);
    setLastLocalSaveAt(null);
    toast('Local draft discarded');
  }, [user?.id, id, setLastLocalSaveAt]);

  const handleDraftSaveAsBranch = useCallback(() => {
    if (draftRecovery) applyDraftToEditor(draftRecovery);
    setShowDraftRecovery(false);
    setShowBranches(true);
  }, [draftRecovery, applyDraftToEditor]);

  // On load, surface a recoverable local draft if it differs from the server copy.
  useEffect(() => {
    if (!tplRow || !id || !user?.id) return;
    const key = `${user.id}:${tplRow.id}:${tplRow.version ?? 0}`;
    if (draftCheckedKeyRef.current === key) return;
    draftCheckedKeyRef.current = key;
    let cancelled = false;
    void (async () => {
      const draft = await loadTemplateDraft(user.id, id);
      if (cancelled || !draft) return;
      const serverSignature = makeDraftSignature({
        name: tplRow.name || '',
        description: tplRow.description || '',
        reportType: tplRow.report_type || '',
        tier: tplRow.tier || '',
        variant: ((tplRow as any).variant as string) || '',
        scope: ((tplRow as any).scope as string) || 'global',
        priority: Number((tplRow as any).priority ?? 0),
        customCss: ((tplRow as any).custom_css as string) || '',
        schema: parseTemplate(tplRow.schema),
      });
      const decision = evaluateDraftRecovery({
        draft,
        serverSignature,
        currentServerVersion: Number(tplRow.version ?? 1),
      });
      if (decision.recover) {
        setDraftRecovery(draft);
        setStaleDraftBase(decision.staleBase);
        setShowDraftRecovery(true);
      } else {
        // Draft already matches the server — clean it up.
        void deleteTemplateDraft(user.id, id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tplRow, id, user?.id]);

  // ── Mutators + stable selection handlers ────────────────────────────────────
  // Store-backed (rehaul Phase 2 / state refactor): every handler is
  // permanently identity-stable (actions read fresh state via get()), so the
  // memoized editor surfaces never re-render because a handler changed.
  // Only the handlers this page itself still calls — the editor panels
  // (PagesPanel, EditorialCanvas, PropertiesInspector, OutlinePanel,
  // LiveHtmlPreview) now pull their mutators straight from the store.
  const {
    updatePage,
    updateOverlay,
    duplicateOverlay,
    addBlockToActivePage,
    duplicateBlock,
    addPage,
  } = useTemplateMutators();

  // ── Starter page presets / theme presets / sample-data presets ──────────────
  const addStarterPage = (presetId: string) => {
    const preset = getStarterPreset(presetId);
    if (!preset) return;
    const page = preset.build();
    setTemplate((t) => ({ ...t, pages: [...t.pages, page] }));
    setActivePageId(page.id);
    setSelectedBlockId(null);
    setSelectedOverlayId(null);
    toast.success(`Added "${preset.label}"`);
  };
  const applyTheme = (presetId: string) => {
    const preset = getThemePreset(presetId);
    if (!preset) return;
    setTemplate((t) => ({
      ...t,
      tokens: {
        ...t.tokens,
        colors: { ...t.tokens.colors, ...preset.tokens.colors },
        fonts: { ...t.tokens.fonts, ...preset.tokens.fonts },
        spacing: { ...t.tokens.spacing, ...preset.tokens.spacing },
        radii: { ...((t.tokens as any).radii ?? {}), ...((preset.tokens as any).radii ?? {}) },
        shadows: { ...((t.tokens as any).shadows ?? {}), ...((preset.tokens as any).shadows ?? {}) },
        gradients: { ...((t.tokens as any).gradients ?? {}), ...((preset.tokens as any).gradients ?? {}) },
        typeScale: { ...((t.tokens as any).typeScale ?? {}), ...((preset.tokens as any).typeScale ?? {}) },
        fontFaces: [
          ...(((t.tokens as any).fontFaces ?? []) as any[]),
          ...(((preset.tokens as any).fontFaces ?? []) as any[]).filter((face) =>
            !(((t.tokens as any).fontFaces ?? []) as any[]).some((existing) => existing.family === face.family),
          ),
        ],
      } as any,
    }));
    toast.success(`Theme applied: ${preset.label}`);
  };
  const applySampleDataPreset = (presetId: string) => {
    const preset = SAMPLE_DATA_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSampleDataText(JSON.stringify(preset.data, null, 2));
    toast.success(`Sample data: ${preset.label}`);
  };
  const loadSampleFromRealReport = async () => {
    if (!reportTypeAdapter) {
      toast.error('Choose a report type before loading a real report.');
      return;
    }
    if (!reportTypeAdapter.supportsProduction) {
      toast.error(`${reportTypeAdapter.label} is preview-only until a production adapter is configured.`);
      return;
    }
    const input = window.prompt(
      `Load binding context for ${reportTypeAdapter.label}.\n\nPaste a report ID (UUID):`,
    );
    const reportId = (input ?? '').trim();
    if (!reportId) return;
    const toastId = toast.loading(`Loading ${reportTypeAdapter.label} binding context…`);
    try {
      const ctx = await reportTypeAdapter.buildBindingContext({
        reportId,
        brand: {
          tokens: (brand as any)?.tokens ?? (brand as any)?.theme?.tokens ?? {},
          logoUrl: (brand as any)?.logoUrl ?? (brand as any)?.logo?.url ?? null,
        },
      });
      if (!ctx) throw new Error('Report not found, inaccessible, or unsupported by this adapter');
      setSampleDataText(JSON.stringify(ctx.data, null, 2));
      toast.success(
        `Loaded ${reportTypeAdapter.label}${ctx.meta.variant ? ` (${ctx.meta.variant})` : ''}`,
        { id: toastId },
      );
    } catch (e: any) {
      toast.error(`Load failed: ${e?.message ?? e}`, { id: toastId });
    }
  };
  const insertBlockType = (type: string) => {
    if (!activePage) { toast.error('No active page — add one first.'); return; }
    const def = BLOCK_DEFS[type];
    if (!def) return;
    const newBlock: Block = {
      id: crypto.randomUUID(),
      type,
      props: def.defaultProps(),
      overlays: [],
    };
    addBlockToActivePage(newBlock);
    toast.success(`Inserted ${def.label}`);
  };
  const jumpToIssue = useCallback((iss: { pageId?: string; blockId?: string; overlayId?: string }) => {
    if (iss.pageId) setActivePageId(iss.pageId);
    if (iss.overlayId) { setSelectedOverlayId(iss.overlayId); setSelectedBlockId(null); }
    else if (iss.blockId) { setSelectedBlockId(iss.blockId); setSelectedOverlayId(null); }
  }, []);
  const jumpToFirstBindingIssue = () => {
    const iss = bindingIssues[0];
    if (!iss) return;
    jumpToIssue(iss);
  };
  const jumpToFirstLintIssue = () => {
    const iss = lintIssues[0];
    if (!iss) return;
    jumpToIssue(iss);
  };
  const syncTokensFromBrand = () => {
    const themeCfg = (brand as any)?.settings?.themeConfig;
    const primary = themeCfg?.primaryColor || (brand as any)?.settings?.primaryColor;
    const accent = themeCfg?.accentColor || (brand as any)?.settings?.accentColor;
    const incoming: Record<string, string> = {};
    if (primary) incoming.primary = primary;
    if (accent) incoming.accent = accent;
    if (Object.keys(incoming).length === 0) { toast.info('No brand colours configured to sync'); return; }
    setTemplate((t) => ({ ...t, tokens: { ...t.tokens, colors: { ...t.tokens.colors, ...incoming } } }));
    toast.success(`Synced ${Object.keys(incoming).length} brand colour${Object.keys(incoming).length === 1 ? '' : 's'}`);
  };

  // ── Block clipboard ops ─────────────────────────────────────────────────────
  const copyBlock = (bid: string) => {
    if (!activePage) return;
    const b = activePage.blocks.find((x) => x.id === bid);
    if (!b) return;
    clipboardRef.current = JSON.parse(JSON.stringify(b));
    toast.success(`Copied "${b.type}"`);
  };
  const pasteBlock = () => {
    if (!activePage || !clipboardRef.current) return;
    const copy: Block = JSON.parse(JSON.stringify(clipboardRef.current));
    copy.id = crypto.randomUUID();
    copy.overlays = copy.overlays.map((o) => ({ ...o, id: crypto.randomUUID() }));
    updatePage(editorActions.appendBlock(activePage, copy));
    setSelectedBlockId(copy.id);
    toast.success(`Pasted "${copy.type}"`);
  };

  // ── Style copy/paste (overlays) ─────────────────────────────────────────────
  const STYLE_KEYS = [
    'fontFamily','fontSize','fontWeight','fontStyle','color','align','lineHeight',
    'opacity','rotation','fill','stroke','strokeWidth','borderRadius','letterSpacing','textTransform',
  ] as const;
  const extractStyle = (o: Overlay): Partial<Overlay> => {
    const out: any = {};
    for (const k of STYLE_KEYS) if ((o as any)[k] !== undefined) out[k] = (o as any)[k];
    return out;
  };
  const copyOverlayStyle = (o: Overlay | null) => {
    if (!o) { toast.error('Select an overlay first'); return; }
    styleClipboardRef.current = extractStyle(o);
    setHasStyleClipboard(true);
    toast.success('Style copied');
  };
  const pasteOverlayStyleToIds = (ids: string[]) => {
    if (!activePage) return;
    const style = styleClipboardRef.current;
    if (!style) { toast.error('Copy a style first'); return; }
    const idSet = new Set(ids);
    updatePage({
      ...activePage,
      blocks: activePage.blocks.map((b) => ({
        ...b,
        overlays: b.overlays.map((o) => (idSet.has(o.id) ? { ...o, ...style } as Overlay : o)),
      })),
    });
    toast.success(`Pasted style to ${ids.length} overlay${ids.length === 1 ? '' : 's'}`);
  };

  // ── Bulk operations on multi-selected overlays ──────────────────────────────
  const bulkPatchOverlays = (patch: Partial<Overlay>) => {
    if (!activePage || multiOverlayIds.size === 0) return;
    updatePage({
      ...activePage,
      blocks: activePage.blocks.map((b) => ({
        ...b,
        overlays: b.overlays.map((o) => (multiOverlayIds.has(o.id) ? { ...o, ...patch } as Overlay : o)),
      })),
    });
  };
  /** Merge the multi-selected TEXT overlays into one (import cleanup). */
  const bulkMergeText = () => {
    if (!activePage || multiOverlayIds.size < 2) return;
    const { page: merged, mergedId } = editorActions.mergeTextOverlays(activePage, [...multiOverlayIds]);
    if (!mergedId) { toast.info('Select at least two unlocked text overlays to merge.'); return; }
    updatePage(merged);
    clearMultiSelect();
    setSelectedOverlayId(mergedId);
    toast.success('Merged text overlays into one block.');
  };

  const canMergeText = (() => {
    if (!activePage || multiOverlayIds.size < 2) return false;
    let textCount = 0;
    for (const b of activePage.blocks) {
      for (const o of b.overlays) {
        if (multiOverlayIds.has(o.id) && o.type === 'text' && !o.locked && !o.hidden) textCount++;
      }
    }
    return textCount >= 2;
  })();

  const bulkDeleteOverlays = () => {
    if (!activePage || multiOverlayIds.size === 0) return;
    const n = multiOverlayIds.size;
    updatePage({
      ...activePage,
      blocks: activePage.blocks.map((b) => ({
        ...b,
        overlays: b.overlays.filter((o) => !multiOverlayIds.has(o.id)),
      })),
    });
    clearMultiSelect();
    toast.success(`Deleted ${n} overlay${n === 1 ? '' : 's'}`);
  };
  const bulkCopyStyleFromFirst = () => {
    if (!activePage || multiOverlayIds.size === 0) return;
    for (const b of activePage.blocks) {
      for (const o of b.overlays) {
        if (multiOverlayIds.has(o.id)) {
          styleClipboardRef.current = extractStyle(o);
          setHasStyleClipboard(true);
          toast.success('Style copied from first selected');
          return;
        }
      }
    }
  };

  // ── Layout & Structure (Sections 1+2) — multi-select align/distribute/etc.
  const runOnActivePage = useCallback((mutator: (p: Page) => Page) => {
    if (!activePage) return;
    const next = mutator(activePage);
    if (next !== activePage) updatePage(next);
  }, [activePage]);
  const bulkAlign = (op: layoutActions.AlignOp) =>
    runOnActivePage((p) => layoutActions.alignOverlays(p, Array.from(multiOverlayIds), op));
  const bulkDistribute = (op: layoutActions.DistributeOp) =>
    runOnActivePage((p) => layoutActions.distributeSpacing(p, Array.from(multiOverlayIds), op));
  const bulkAlignToPage = (op: layoutActions.PageAlignOp) =>
    runOnActivePage((p) => layoutActions.alignToPage(p, Array.from(multiOverlayIds), op));
  const bulkGroup = () =>
    runOnActivePage((p) => layoutActions.groupOverlays(p, Array.from(multiOverlayIds)));
  const bulkUngroup = () =>
    runOnActivePage((p) => layoutActions.ungroupOverlays(p, Array.from(multiOverlayIds)));
  const bulkZ = (op: 'forward' | 'backward' | 'front' | 'back') =>
    runOnActivePage((p) => Array.from(multiOverlayIds).reduce(
      (acc, id) => layoutActions.reorderOverlayZ(acc, id, op),
      p,
    ));
  const bulkLock = (locked: boolean) =>
    runOnActivePage((p) => Array.from(multiOverlayIds).reduce(
      (acc, id) => layoutActions.setOverlayLocked(acc, id, locked),
      p,
    ));
  const bulkHide = (hidden: boolean) =>
    runOnActivePage((p) => Array.from(multiOverlayIds).reduce(
      (acc, id) => layoutActions.setOverlayHidden(acc, id, hidden),
      p,
    ));
  const multiOverlaysSnap = useMemo(() => {
    if (!activePage) return [] as Overlay[];
    const out: Overlay[] = [];
    for (const b of activePage.blocks) for (const o of b.overlays) if (multiOverlayIds.has(o.id)) out.push(o);
    return out;
  }, [activePage, multiOverlayIds]);
  const anyLocked = multiOverlaysSnap.some((o) => !!o.locked);
  const anyHidden = multiOverlaysSnap.some((o) => !!o.hidden);
  const anyGrouped = multiOverlaysSnap.some((o) => !!o.groupId);

  // ── Find & Replace (Cmd/Ctrl+F) + Asset Library (Shift+I) ─────────────────
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [textStylesOpen, setTextStylesOpen] = useState(false);
  const [tableEditorOpen, setTableEditorOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        if (inEditable) return;
        e.preventDefault();
        setFindReplaceOpen(true);
        return;
      }
      if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'i') {
        if (inEditable) return;
        e.preventDefault();
        setAssetLibraryOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const insertImageFromLibrary = useCallback((asset: { src: string; width: number; height: number }) => {
    if (!activePage) { toast.error('Select a page first'); return; }
    const pageW = activePage.size.width || 595;
    const pageH = activePage.size.height || 842;
    const overlay = {
      id: crypto.randomUUID(),
      type: 'image' as const,
      src: asset.src,
      fit: 'contain' as const,
      x: Math.round((pageW - asset.width) / 2),
      y: Math.round((pageH - asset.height) / 2),
      width: asset.width,
      height: asset.height,
      rotation: 0,
      opacity: 1,
    };
    updatePage(editorActions.addOverlay(activePage, overlay as Overlay));
    setSelectedOverlayId(overlay.id);
    toast.success('Image inserted');
  }, [activePage]);


  const getSelectedOverlayIds = useCallback((): string[] => {
    if (multiOverlayIds.size > 0) return Array.from(multiOverlayIds);
    return selectedOverlayId ? [selectedOverlayId] : [];
  }, [multiOverlayIds, selectedOverlayId]);
  const getOverlayById = useCallback((id: string): Overlay | null => {
    if (!activePage) return null;
    for (const b of activePage.blocks) {
      const f = b.overlays.find((o) => o.id === id);
      if (f) return f;
    }
    return null;
  }, [activePage]);

  const selectAllOverlays = useCallback(() => {
    if (!activePage) return;
    const ids = activePage.blocks.flatMap((b) => b.overlays.map((o) => o.id));
    if (ids.length === 0) return;
    setMultiOverlayIds(new Set(ids));
    setSelectedOverlayId(ids[0]);
    toast(`Selected ${ids.length} element${ids.length === 1 ? '' : 's'}`);
  }, [activePage]);

  const copySelectedOverlays = useCallback(() => {
    const ids = getSelectedOverlayIds();
    if (ids.length === 0) return false;
    const snaps: Overlay[] = [];
    for (const id of ids) {
      const o = getOverlayById(id);
      if (o) snaps.push(JSON.parse(JSON.stringify(o)));
    }
    if (snaps.length === 0) return false;
    overlayClipboardRef.current = snaps;
    toast.success(`Copied ${snaps.length} element${snaps.length === 1 ? '' : 's'}`);
    return true;
  }, [getSelectedOverlayIds, getOverlayById]);

  const cutSelectedOverlays = useCallback(() => {
    if (!copySelectedOverlays()) return;
    const ids = getSelectedOverlayIds();
    if (!activePage) return;
    updatePage({
      ...activePage,
      blocks: activePage.blocks.map((b) => ({
        ...b,
        overlays: b.overlays.filter((o) => !ids.includes(o.id)),
      })),
    });
    setSelectedOverlayId(null);
    clearMultiSelect();
  }, [copySelectedOverlays, getSelectedOverlayIds, activePage, clearMultiSelect]);

  const pasteOverlays = useCallback(() => {
    const buf = overlayClipboardRef.current;
    if (!buf || buf.length === 0 || !activePage) return;
    const newIds: string[] = [];
    const clones: Overlay[] = buf.map((o) => {
      const c = JSON.parse(JSON.stringify(o));
      c.id = crypto.randomUUID();
      c.x = (o.x || 0) + 16;
      c.y = (o.y || 0) + 16;
      newIds.push(c.id);
      return c;
    });
    const blocks = [...activePage.blocks];
    let target = blocks.find((b) => b.type === 'free');
    if (!target) {
      target = { id: crypto.randomUUID(), type: 'free', props: {}, overlays: [] };
      blocks.push(target);
    }
    target.overlays = [...target.overlays, ...clones];
    updatePage({ ...activePage, blocks });
    setSelectedOverlayId(newIds[0] ?? null);
    setMultiOverlayIds(new Set(newIds));
    toast.success(`Pasted ${clones.length} element${clones.length === 1 ? '' : 's'}`);
  }, [activePage]);

  const duplicateSelectedOverlays = useCallback(() => {
    const ids = getSelectedOverlayIds();
    ids.forEach((id) => duplicateOverlay(id));
  }, [getSelectedOverlayIds]);

  // Toggle a text style property (bold / italic / underline) on every selected text overlay.
  const toggleTextStyle = useCallback((prop: 'fontWeight' | 'fontStyle' | 'textDecoration') => {
    const ids = getSelectedOverlayIds();
    if (!activePage || ids.length === 0) return;
    const targets = ids.map(getOverlayById).filter((o): o is Overlay => !!o && o.type === 'text');
    if (targets.length === 0) return;
    const first: any = targets[0];
    const next: any = (() => {
      if (prop === 'fontWeight') return first.fontWeight === 'bold' ? 'normal' : 'bold';
      if (prop === 'fontStyle') return first.fontStyle === 'italic' ? 'normal' : 'italic';
      return first.textDecoration === 'underline' ? 'none' : 'underline';
    })();
    updatePage({
      ...activePage,
      blocks: activePage.blocks.map((b) => ({
        ...b,
        overlays: b.overlays.map((o) =>
          ids.includes(o.id) && o.type === 'text' ? ({ ...o, [prop]: next } as Overlay) : o,
        ),
      })),
    });
  }, [getSelectedOverlayIds, activePage, getOverlayById]);

  // Z-order: shift each selected overlay one step within its block's overlay array.
  const shiftZOrder = useCallback((dir: 'forward' | 'backward' | 'front' | 'back') => {
    const ids = getSelectedOverlayIds();
    if (!activePage || ids.length === 0) return;
    updatePage({
      ...activePage,
      blocks: activePage.blocks.map((b) => {
        const sel = b.overlays.filter((o) => ids.includes(o.id));
        if (sel.length === 0) return b;
        const others = b.overlays.filter((o) => !ids.includes(o.id));
        if (dir === 'front') return { ...b, overlays: [...others, ...sel] };
        if (dir === 'back') return { ...b, overlays: [...sel, ...others] };
        // forward / backward: step by one
        const arr = [...b.overlays];
        const step = dir === 'forward' ? 1 : -1;
        const order = dir === 'forward'
          ? [...arr].map((_, i) => arr.length - 1 - i)
          : arr.map((_, i) => i);
        for (const i of order) {
          if (!ids.includes(arr[i].id)) continue;
          const j = i + step;
          if (j < 0 || j >= arr.length) continue;
          if (ids.includes(arr[j].id)) continue;
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return { ...b, overlays: arr };
      }),
    });
  }, [getSelectedOverlayIds, activePage]);
  const bulkPasteStyle = () => pasteOverlayStyleToIds(Array.from(multiOverlayIds));

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'template'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        const parsed = parseTemplate(json);
        setTemplate(parsed);
        setActivePageId(parsed.pages[0]?.id ?? null);
        setSelectedOverlayId(null);
        setSelectedBlockId(null);
        toast.success('Template imported');
      } catch (e: any) {
        toast.error(`Import failed: ${e?.message ?? 'invalid JSON'}`);
      }
    };
    reader.readAsText(file);
  };

  // ── Command palette (⌘K) ────────────────────────────────────────────────────
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [fixerOpen, setFixerOpen] = useState(false);

  // Insert a snippet (from library / palette) into active page.
  const insertSnippet = useCallback((snippetId: string) => {
    const snip = getSnippet(snippetId);
    if (!snip) return;
    if (!activePage) { toast.error('No active page — add one first.'); return; }
    const block = snip.build();
    setTemplate((t) => ({
      ...t,
      pages: t.pages.map((p) => (p.id === activePage.id ? { ...p, blocks: [...p.blocks, block] } : p)),
    }));
    setSelectedBlockId(block.id);
    setSelectedOverlayId(null);
    toast.success(`Inserted "${snip.label}"`);
  }, [activePage, setTemplate]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  // Extracted to useEditorKeyboardShortcuts (rehaul Phase 2): attaches one
  // window listener and dispatches via the "latest ref" pattern, so the
  // bindings object below can be rebuilt fresh on every render with no
  // stale-closure hazard and no listener re-binding.
  // Latest-ref: the PDF preview hook is declared further down (it needs sample
  // data), but the shortcut bindings are wired here.
  const refreshPdfPreviewRef = useRef<() => Promise<void> | void>(() => {});
  useEditorKeyboardShortcuts({
    selectedOverlayId,
    selectedBlockId,
    selectedOverlay,
    multiOverlayIds,
    hasStyleClipboard,
    // Getter, not value: copying overlays mutates a ref without re-rendering,
    // so this must be evaluated at keydown time.
    hasOverlayClipboard: () => !!overlayClipboardRef.current && overlayClipboardRef.current.length > 0,
    togglePalette: () => setPaletteOpen((o) => !o),
    openShortcuts: () => setShortcutsOpen(true),
    save: () => handleSave(false),
    undo,
    redo,
    selectAllOverlays,
    addPage,
    copyOverlayStyle,
    copyBlock,
    pasteOverlayStyleToIds,
    pasteBlock,
    copySelectedOverlays,
    cutSelectedOverlays,
    pasteOverlays,
    duplicateSelectedOverlays,
    duplicateBlock,
    toggleTextStyle,
    shiftZOrder,
    refreshPreview: () => {
      // PDF tab is render-on-demand (rehaul Phase 3): re-render it in place.
      if (workspaceMode === 'pdf') {
        void refreshPdfPreviewRef.current();
        toast('Rendering PDF…');
        return;
      }
      setActivePageId((prev) => prev);
      toast('Preview refreshed');
    },
  });

  // ── Idle/debounced analysis keeps large templates responsive while typing/dragging.
  // Active-page analysis updates immediately; full-document analysis settles after idle.
  const {
    bindingIssues,
    lintIssues,
    activePageBindingIssues,
    activePageLintIssues,
    isCheckingFullDocument,
  } = useTemplateAnalysis(template, activePage, sampleData);
  const rendererIssues = useMemo(() => lintIssues.filter(isRendererIssue), [lintIssues]);
  const rendererIssueCount = rendererIssues.length;
  const rendererErrorCount = useMemo(() => rendererIssues.filter((i) => i.severity === 'error').length, [rendererIssues]);
  const rendererNoteCount = rendererIssueCount - rendererErrorCount;
  const printErrorCount = useMemo(() => lintIssues.filter((i) => i.severity === 'error' && !isRendererIssue(i)).length, [lintIssues]);
  const rendererIssuesByPage = useMemo(() => {
    const issuesByPage = new Map<string, LintIssue[]>();
    rendererIssues.forEach((issue) => {
      if (!issue.pageId) return;
      const existing = issuesByPage.get(issue.pageId) ?? [];
      existing.push(issue);
      issuesByPage.set(issue.pageId, existing);
    });
    return template.pages
      .map((page, index) => ({ page, index, issues: issuesByPage.get(page.id) ?? [] }))
      .filter((group) => group.issues.length > 0);
  }, [rendererIssues, template.pages]);
  const usedBlockCompatibility = useMemo(() => {
    const counts = new Map<string, number>();
    template.pages.forEach((page) => page.blocks.forEach((block) => counts.set(block.type, (counts.get(block.type) ?? 0) + 1)));
    return Array.from(counts.entries())
      .map(([type, count]) => ({
        type,
        count,
        label: BLOCK_DEFS[type]?.label ?? type,
        capabilities: getBlockRendererCapabilities(type),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [template.pages]);
  const firstRendererBlocker = useMemo(() => rendererIssues.find((issue) => issue.severity === 'error') ?? null, [rendererIssues]);
  const firstRendererNote = useMemo(() => rendererIssues.find((issue) => issue.severity !== 'error') ?? null, [rendererIssues]);
  const activationBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (!isSuperadmin) blockers.push('Superadmin access is required to activate templates.');
    if ((tplMeta?.approval_status ?? 'draft') !== 'approved') blockers.push('Template must be approved.');
    if (!reportType) blockers.push('Report type is required.');
    if (reportType && !isProductionReportType) blockers.push('A production adapter is required for this report type.');
    if (isDirty) blockers.push('Save unsaved changes before activation.');
    if (bindingIssues.length > 0) blockers.push(`Resolve ${bindingIssues.length} binding issue${bindingIssues.length === 1 ? '' : 's'}.`);
    if (rendererErrorCount > 0) blockers.push(`Resolve ${rendererErrorCount} production renderer blocker${rendererErrorCount === 1 ? '' : 's'}.`);
    if (printErrorCount > 0) blockers.push(`Resolve ${printErrorCount} print-safety error${printErrorCount === 1 ? '' : 's'}.`);
    if (reportType && cascadeStructure && cascadeReadiness.blockerCount > 0) blockers.push(`Resolve ${cascadeReadiness.blockerCount} Cascade activation blocker${cascadeReadiness.blockerCount === 1 ? '' : 's'} in the Cascade tab.`);
    return blockers;
  }, [bindingIssues.length, cascadeReadiness.blockerCount, cascadeStructure, isDirty, isProductionReportType, isSuperadmin, printErrorCount, rendererErrorCount, reportType, tplMeta?.approval_status]);
  const canActivateTemplate = activationBlockers.length === 0;
  const onboardingChecklist = useMemo(() => [
    { label: 'Set report type', done: !!reportType },
    { label: 'Use production-ready report adapter', done: isProductionReportType },
    { label: 'Use production engine (HTML/WeasyPrint)', done: true },
    { label: 'Add at least one page', done: template.pages.length > 0 },
    { label: 'Add blocks or overlays', done: template.pages.some((page) => page.blocks.length > 0) },
    { label: 'Resolve binding issues', done: bindingIssues.length === 0 },
    { label: 'Map and QA-approve required report sections', done: !reportType || !cascadeStructure || cascadeReadiness.blockerCount === 0 },
    { label: 'Resolve print/render blockers', done: rendererErrorCount === 0 && printErrorCount === 0 },
    { label: 'Preview final PDF', done: workspaceMode === 'pdf' },
    { label: 'Snapshot a version', done: versions.length > 0 },
    { label: 'Submit/review approval', done: ['in_review', 'approved'].includes(tplMeta?.approval_status ?? '') },
    { label: 'Activate when ready', done: !!tplMeta?.is_active },
  ], [bindingIssues.length, cascadeReadiness.blockerCount, cascadeStructure, isProductionReportType, printErrorCount, rendererErrorCount, reportType, template.pages, tplMeta?.approval_status, tplMeta?.is_active, versions.length, workspaceMode]);
  const onboardingDoneCount = onboardingChecklist.filter((item) => item.done).length;
  const confirmRendererPreflight = useCallback((actionLabel: string): boolean => {
    const currentRendererIssues = lintTemplate(template, sampleData).filter(isRendererIssue);
    const currentRendererErrorCount = currentRendererIssues.filter((issue) => issue.severity === 'error').length;
    const currentRendererNoteCount = currentRendererIssues.length - currentRendererErrorCount;
    if (currentRendererErrorCount > 0) {
      toast.error(`Resolve ${currentRendererErrorCount} production renderer blocker${currentRendererErrorCount === 1 ? '' : 's'} before ${actionLabel}.`);
      return false;
    }
    if (currentRendererNoteCount > 0) {
      return window.confirm(
        `This template has ${currentRendererNoteCount} renderer compatibility note${currentRendererNoteCount === 1 ? '' : 's'} (for example legacy jsPDF placeholders). Production HTML/WeasyPrint output is still supported. Continue to ${actionLabel}?`,
      );
    }
    return true;
  }, [sampleData, template]);

  // ── PDF preview (render-on-demand, rehaul Phase 3) ──────────────────────────
  // Renders once when the Final PDF tab opens; edits flip `pdfStale` and the
  // user re-renders explicitly. The live HTML preview is the realtime surface.
  const [cascadeDebugPdf, setCascadeDebugPdf] = useState(false);
  const {
    previewUrl,
    previewing,
    previewError,
    stale: pdfStale,
    refresh: refreshPdfPreview,
  } = useWeasyPdfPreview({
    enabled: workspaceMode === 'pdf',
    template,
    sampleData,
    customCss: customCss || undefined,
    name,
    templateId: id,
    cascadeMetadata: true,
    cascadeDebug: cascadeDebugPdf,
  });
  refreshPdfPreviewRef.current = refreshPdfPreview;

  // ── Save ────────────────────────────────────────────────────────────────────
  const buildSavePatch = () => ({
    name,
    description,
    report_type: reportType || null,
    tier: tier || null,
    variant: variant || null,
    scope: scope || 'global',
    priority: Number.isFinite(priority) ? priority : 0,
    custom_css: customCss || null,
    schema: template,
  } as any);

  const runSave = (opts: { snapshot?: boolean; expectedVersionOverride?: number } = {}) => {
    if (!id) return;
    if (tplMeta?.locked_for_review) {
      toast.error('Template is locked for review. Unlock from the Review dialog before saving.');
      return;
    }
    if (tplMeta?.approval_status === 'approved' && !tplMeta?.is_draft) {
      toast.error('Approved templates are read-only. Create a branch before saving changes.');
      return;
    }
    const snapshot = !!opts.snapshot;
    const expectedVersion = opts.expectedVersionOverride ?? Number(tplRow?.version ?? 1);
    setSaveConflict(null);
    update.mutate(
      {
        id,
        snapshot,
        note: snapshot ? cascadeSnapshotNote : undefined,
        expectedVersion: Number.isFinite(expectedVersion) ? expectedVersion : undefined,
        patch: buildSavePatch(),
      },
      {
        onSuccess: (record: any) => {
          setLastSavedSignature(currentSignature);
          setLastSavedAt(new Date().toISOString());
          setSaveConflict(null);
          setShowConflict(false);
          setDirtySince(null);
          // The server copy now matches the editor — drop the local autosave draft.
          // Pre-mark the next version as checked so the post-save refetch doesn't
          // momentarily re-offer recovery for content we just persisted.
          draftCheckedKeyRef.current = `${user?.id ?? ''}:${id}:${record?.version ?? Number(tplRow?.version ?? 1) + 1}`;
          if (user?.id) void deleteTemplateDraft(user.id, id);
          setLastLocalSaveAt(null);
          toast.success(snapshot ? 'Saved as new version' : 'Saved');
          // Phase 14 — analytics
          logTemplateEvent({
            templateId: id,
            eventType: snapshot ? 'edit_snapshot' : 'edit_save',
            templateVersion: tplRow?.version,
            pageId: activePage?.id,
            metadata: {
              pages: template.pages.length,
              blocks: template.pages.reduce((n, p: any) => n + (p.blocks?.length || 0), 0),
              cascade: {
                requiredSections: cascadeReadiness.requiredSections,
                mappedRequiredSections: cascadeReadiness.mappedRequiredSections,
                totalAnchors: cascadeReadiness.totalAnchors,
                blockerCount: cascadeReadiness.blockerCount,
                autoMapSuggestionCount: cascadeReadiness.autoMapSuggestionCount,
                qaApprovedRequiredSections: cascadeReadiness.qaApprovedRequiredSections,
                qaApprovalRequiredCount: cascadeReadiness.qaApprovalRequiredCount,
              },
            },
          });
          void logTemplateAudit(id, snapshot ? 'version_created' : 'schema_saved', snapshot ? 'Saved as new version' : 'Schema saved', {
            cascade: {
              note: cascadeSnapshotNote,
              requiredSections: cascadeReadiness.requiredSections,
              mappedRequiredSections: cascadeReadiness.mappedRequiredSections,
              totalAnchors: cascadeReadiness.totalAnchors,
              blockerCount: cascadeReadiness.blockerCount,
              autoMapSuggestionCount: cascadeReadiness.autoMapSuggestionCount,
              qaApprovedRequiredSections: cascadeReadiness.qaApprovedRequiredSections,
              qaApprovalRequiredCount: cascadeReadiness.qaApprovalRequiredCount,
            },
          });
        },
        onError: (error: Error & { code?: string; currentVersion?: number | null }) => {
          if (error.code === 'version_conflict') {
            setSaveConflict({
              message: 'Template changed on the server. Your local edits were kept — choose how to resolve the conflict.',
              serverVersion: error.currentVersion ?? null,
            });
            setShowConflict(true);
          }
        },
      },
    );
  };

  const handleSave = (snapshot = false) => runSave({ snapshot });

  // ── Save-conflict resolution ─────────────────────────────────────────────────
  const handleConflictReviewLatest = () => {
    setShowConflict(false);
    setSaveConflict(null);
    // Discard local edits (including the autosaved draft) and re-hydrate from the
    // freshest server copy.
    hydratedKeyRef.current = null;
    draftCheckedKeyRef.current = null;
    if (user?.id && id) {
      void deleteTemplateDraft(user.id, id);
      setLastLocalSaveAt(null);
      qc.invalidateQueries({ queryKey: ['report-templates', id] });
    }
  };

  const handleConflictOverwrite = () => {
    const serverVersion = saveConflict?.serverVersion;
    setShowConflict(false);
    runSave(
      typeof serverVersion === 'number' && Number.isFinite(serverVersion)
        ? { expectedVersionOverride: serverVersion }
        : {},
    );
  };

  const handleConflictSaveAsBranch = () => {
    setShowConflict(false);
    setShowBranches(true);
  };

  const handleActivationToggle = () => {
    if (!id || !tplMeta) return;
    const nextActive = !tplMeta.is_active;
    if (nextActive && !canActivateTemplate) {
      toast.error(activationBlockers[0] || 'Template is not ready to activate.');
      return;
    }
    if (nextActive && cascadeReadiness.autoMapSuggestionCount > 0) {
      const proceed = window.confirm(
        `Cascade found ${cascadeReadiness.autoMapSuggestionCount} existing report binding${cascadeReadiness.autoMapSuggestionCount === 1 ? '' : 's'} that can still be auto-mapped. Activate anyway?`,
      );
      if (!proceed) {
        setActiveMainTab('cascade');
        return;
      }
    }
    if (nextActive && !confirmRendererPreflight('activate this template')) return;
    const expectedVersion = Number(tplRow?.version ?? 1);
    update.mutate(
      {
        id,
        expectedVersion: Number.isFinite(expectedVersion) ? expectedVersion : undefined,
        patch: nextActive ? { is_active: true } as any : { is_active: false, is_default: false } as any,
      },
      {
        onSuccess: (record: any) => {
          setTplMeta((prev) => prev ? {
            ...prev,
            is_active: !!record?.is_active,
            is_default: !!record?.is_default,
            approval_status: record?.approval_status ?? prev.approval_status,
            locked_for_review: !!record?.locked_for_review,
          } : prev);
          toast.success(nextActive ? 'Template activated' : 'Template deactivated');
          void logTemplateAudit(id, nextActive ? 'activated' : 'deactivated');
        },
        onError: (error: Error & { code?: string }) => {
          toast.error(error.message || (nextActive ? 'Activation failed' : 'Deactivation failed'));
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Skeleton className="h-12 w-64 mb-6" />
        <Skeleton className="h-[80vh] w-full" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        template={template}
        pages={template.pages}
        bindingIssueCount={bindingIssues.length}
        lintIssueCount={lintIssues.length}
        actions={{
          insertBlock: insertBlockType,
          jumpToPage: (pid) => { setActivePageId(pid); setSelectedOverlayId(null); setSelectedBlockId(null); },
          addStarterPage,
          applyTheme,
          applySampleData: applySampleDataPreset,
          jumpToFirstBindingIssue,
          jumpToFirstLintIssue,
          save: () => handleSave(false),
          saveSnapshot: () => handleSave(true),
          undo, redo,
          togglePreview: () => setWorkspaceMode((m) => (m === 'canvas' ? 'preview' : 'canvas')),
          exportJson: handleExport,
          importJson: () => fileInputRef.current?.click(),
          copyJson: async () => {
            try { await navigator.clipboard.writeText(JSON.stringify(template, null, 2)); toast.success('Template JSON copied'); }
            catch { toast.error('Copy failed'); }
          },
          syncBrand: syncTokensFromBrand,
          insertSnippet,
          openSnippetLibrary: () => setSnippetsOpen(true),
          openBindingFixer: () => setFixerOpen(true),
        }}
      />
      <ImportReviewDialog {...importReview.dialogProps} />
      <MountOnFirstOpen open={snippetsOpen}>
        <SnippetLibraryDialog
          open={snippetsOpen}
          onOpenChange={setSnippetsOpen}
          onInsert={(block) => {
            if (!activePage) { toast.error('No active page'); return; }
            setTemplate((t) => ({
              ...t,
              pages: t.pages.map((p) => (p.id === activePage.id ? { ...p, blocks: [...p.blocks, block] } : p)),
            }));
            setSelectedBlockId(block.id);
            setSelectedOverlayId(null);
          }}
        />
      </MountOnFirstOpen>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => { if (confirmLeave()) navigate('/admin/template-builder'); }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-base font-semibold border-0 bg-transparent focus-visible:bg-muted/30 focus-visible:ring-1 max-w-xs"
            placeholder="Template name"
          />
          {pdfImportMeta && (
            <div className="hidden lg:flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs">
              {pdfImportMeta.engine === 'docling' ? <Zap className="h-3.5 w-3.5 text-primary" /> : <Cpu className="h-3.5 w-3.5 text-muted-foreground" />}
              <span>Engine:</span>
              <Badge variant={pdfImportMeta.engine === 'docling' ? 'default' : 'secondary'} className="h-5 px-1.5 text-[10px]">
                {pdfImportMeta.engine === 'docling' ? `Docling · ${pdfImportMeta.engineVersion ?? 'v2.14'}` : 'Legacy pdf.js'}
              </Badge>
              {isSuperadmin && pdfImportMeta.diagnosticsPath && (
                <a className="text-primary underline-offset-2 hover:underline" href="/admin/pdf-import-diagnostics">Diagnostics</a>
              )}
              {isLegacyPdfImport && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px]"
                  onClick={() => { setResyncEngine('docling'); setShowResync(true); }}
                >
                  Re-import with Docling
                </Button>
              )}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaletteOpen(true)}
            className="ml-2 h-8 gap-1.5 text-xs text-muted-foreground"
            title="Open command palette"
          >
            <CommandIcon className="h-3.5 w-3.5" /> Quick actions
            <kbd className="ml-1 px-1 py-px rounded bg-muted text-[10px] font-mono">⌘K</kbd>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSnippetsOpen(true)}
            className="ml-1 h-8 gap-1.5 text-xs"
            title="Open snippet library"
          >
            <Component className="h-3.5 w-3.5" /> Snippets
          </Button>
          {(linkedImport || linkedImportLoading) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => linkedImport?.id && importReview.openPersistedReview(linkedImport.id)}
              disabled={!linkedImport?.id || importReview.reviewLoadingId === linkedImport?.id}
              className="ml-1 h-8 gap-1.5 text-xs"
              title={linkedImport?.source_filename ? `Open Visual QA for ${linkedImport.source_filename}` : 'Loading linked import QA'}
            >
              {importReview.reviewLoadingId === linkedImport?.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
              Visual QA
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1" title="Template onboarding checklist">
                <CheckSquare className="h-4 w-4" /> Checklist {onboardingDoneCount}/{onboardingChecklist.length}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="border-b px-3 py-2">
                <div className="text-xs font-semibold">Template readiness checklist</div>
                <div className="text-[11px] text-muted-foreground">Follow these steps to get from draft to activation.</div>
              </div>
              <div className="p-2 space-y-1">
                {onboardingChecklist.map((item) => (
                  <div key={item.label} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs">
                    {item.done ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />}
                    <span className={item.done ? 'text-muted-foreground line-through' : 'text-foreground'}>{item.label}</span>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <BindingFixerPopover
            template={template}
            issues={bindingIssues}
            sampleData={sampleData}
            open={fixerOpen}
            onOpenChange={setFixerOpen}
            onApply={(next) => setTemplate(next)}
            onJumpTo={(iss) => {
              if (iss.pageId) setActivePageId(iss.pageId);
              if (iss.overlayId) { setSelectedOverlayId(iss.overlayId); setSelectedBlockId(null); }
              else if (iss.blockId) { setSelectedBlockId(iss.blockId); setSelectedOverlayId(null); }
            }}
          />
          {bindingIssues.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/20 transition-colors"
                  title="Click to view binding issues"
                >
                  ⚠ {bindingIssues.length} binding {bindingIssues.length === 1 ? 'issue' : 'issues'}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 p-0">
                <div className="px-3 py-2 border-b text-xs font-semibold flex items-center justify-between">
                  <span>Binding issues ({bindingIssues.length})</span>
                  <span className="text-[10px] text-muted-foreground font-normal">Click to jump</span>
                </div>
                <ScrollArea className="max-h-72">
                  <ul className="divide-y">
                    {bindingIssues.map((iss, idx) => (
                      <li key={idx}>
                        <button
                          type="button"
                          onClick={() => jumpToIssue(iss)}
                          className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors"
                        >
                          <div className="text-[11px] font-medium text-destructive truncate">{iss.message}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{iss.where}</div>
                          {iss.raw && (
                            <code className="text-[10px] font-mono text-muted-foreground/80 truncate block">{iss.raw}</code>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          ) : (
            <span className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded bg-success/10 text-success border border-success/30">
              <CheckCircle2 className="h-2.5 w-2.5" /> Bindings OK
            </span>
          )}
          {/* Print-safety lint */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                  lintIssues.length === 0
                    ? 'bg-success/10 text-success border-success/30 hover:bg-success/20'
                    : lintIssues.some((i) => i.severity === 'error')
                    ? 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20'
                    : 'bg-brand-500/10 text-brand-600 border-brand-500/30 hover:bg-brand-500/20'
                }`}
                title="Print-safety lint"
              >
                <ShieldAlert className="h-2.5 w-2.5" />
                {isCheckingFullDocument ? 'Checking…' : lintIssues.length === 0 ? 'Print safe' : `${lintIssues.length} lint`}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 p-0">
              <div className="px-3 py-2 border-b text-xs font-semibold flex items-center justify-between">
                <span>Print-safety issues ({lintIssues.length})</span>
                <span className="text-[10px] text-muted-foreground font-normal">
                  {isCheckingFullDocument
                    ? `Checking full document… active page has ${activePageLintIssues.length} issue${activePageLintIssues.length === 1 ? '' : 's'}`
                    : 'Click to jump'}
                </span>
              </div>
              {lintIssues.length === 0 ? (
                <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                  No print-safety issues detected.
                </div>
              ) : (
                <ScrollArea className="max-h-72">
                  <ul className="divide-y">
                    {lintIssues.map((iss, idx) => (
                      <li key={idx}>
                        <button
                          type="button"
                          onClick={() => jumpToIssue(iss)}
                          className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors"
                        >
                          <div className={`text-[11px] font-medium truncate ${iss.severity === 'error' ? 'text-destructive' : 'text-brand-600'}`}>
                            <span className="font-mono text-[9px] uppercase tracking-wider mr-1.5 opacity-70">{iss.code}</span>
                            {iss.message}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">{iss.where}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo} title="Undo (⌘Z)">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redo} title="Redo (⌘⇧Z)">
            <Redo2 className="h-4 w-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = '';
            }}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1" title="Import a reference (PDF or image) and reconstruct it in the editor">
                <Upload className="h-4 w-4" /> Import <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Import & reconstruct a reference</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setShowReferenceImport(true)} disabled={!id}>
                <Upload className="h-4 w-4 mr-2" /> Start from a reference…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setShowDesignAgent(true)}>
                <Sparkles className="h-4 w-4 mr-2" /> Reconstruct from image (AI)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setResyncEngine(undefined); setShowResync(true); }}>
                <RefreshCw className="h-4 w-4 mr-2" /> Import / re-sync from PDF
              </DropdownMenuItem>
              {isLegacyPdfImport && (
                <DropdownMenuItem onSelect={() => { setResyncEngine('docling'); setShowResync(true); }}>
                  <Zap className="h-4 w-4 mr-2" /> Re-import with Docling
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setShowAIAuthor(true)}>
                <Wand2 className="h-4 w-4 mr-2" /> Generate a page with AI
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Sparkles className="h-4 w-4" /> Design <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Design tools</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setShowAIAuthor(true)}>
                <Wand2 className="h-4 w-4 mr-2" /> AI Author
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowDesignAgent(true)}>
                <Sparkles className="h-4 w-4 mr-2" /> Design Agent
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowComponentLib(true)}>
                <Component className="h-4 w-4 mr-2" /> Components
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowPageMarket(true)}>
                <LayoutTemplate className="h-4 w-4 mr-2" /> Page Templates
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setActiveMainTab('tokens')}>
                <Palette className="h-4 w-4 mr-2" /> Themes
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setActiveMainTab('brand')}>
                <Palette className="h-4 w-4 mr-2" /> Brand kit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <ShieldAlert className="h-4 w-4" /> Quality <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>Quality checks</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setShowPreviewQA(true)}>
                <Eye className="h-4 w-4 mr-2" /> Preview & QA
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowSpellCheck(true)}>
                <ShieldAlert className="h-4 w-4 mr-2" /> Spell check
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setFixerOpen(true)}>
                <ShieldAlert className="h-4 w-4 mr-2" /> Binding Fixer
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowDiff(true)}>
                <GitCompareArrows className="h-4 w-4 mr-2" /> Fidelity Diff
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!isProductionReportType} onSelect={() => loadSampleFromRealReport()}>
                <Database className="h-4 w-4 mr-2" /> Load real report
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setWorkspaceMode('pdf')}>
                <FileText className="h-4 w-4 mr-2" /> Final PDF preview
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Upload className="h-4 w-4" /> Export <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Export & files</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setShowExportDialog(true)}>
                <Upload className="h-4 w-4 mr-2" /> Export pipeline…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  if (!confirmRendererPreflight('render with WeasyPrint')) return;
                  const toastId = toast.loading('Rendering via WeasyPrint…');
                  try {
                    // Compiles through the shared path so the page rasters are
                    // resolved first. Calling renderTemplateToHtml directly (as
                    // this did) produced a PDF that was blank from page 2 on.
                    const { html, unresolvedRasterPages, droppedAssets } = await compileTemplateHtmlForPdf(template, {
                      data: sampleData,
                      title: name || 'Template Preview',
                      customCss: customCss || undefined,
                      cascadeMetadata: true,
                      cascadeDebug: cascadeDebugPdf,
                    });
                    const url = await renderHtmlToPdfUrl({
                      html,
                      fileName: pdfFileNameFor(name),
                      templateId: id,
                      mode: 'preview',
                    });
                    // Save it rather than `window.open` — the render takes tens
                    // of seconds, so the popup is blocked by then. downloadFile.ts.
                    await downloadUrlAsFile(url, pdfFileNameFor(name));
                    // Both, not whichever is checked first: a render can lose a
                    // page raster AND an image, and reporting one hides the other.
                    const degraded = [
                      describeUnresolvedRasterPages(unresolvedRasterPages),
                      describeDroppedAssets(droppedAssets),
                    ].filter(Boolean).join(' ') || null;
                    const openAction = { label: 'Open', onClick: () => window.open(url, '_blank', 'noopener') };
                    if (degraded) toast.warning(degraded, { id: toastId, action: openAction });
                    else toast.success('WeasyPrint render downloaded', { id: toastId, action: openAction });
                  } catch (e: any) {
                    toast.error(`WeasyPrint failed: ${e?.message ?? e}`, { id: toastId });
                  }
                }}
              >
                <Sparkles className="h-4 w-4 mr-2" /> Render with WeasyPrint
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!previewUrl}
                onSelect={() => {
                  if (!previewUrl) return;
                  // `download` is ignored on a cross-origin href, and the
                  // signed URL is served from *.supabase.co — so this used to
                  // drop the filename and, with a detached anchor, usually do
                  // nothing at all. Fetch the bytes and save a same-origin blob.
                  void downloadUrlAsFile(previewUrl, `${name || 'template'}.pdf`)
                    .catch((e: Error) => toast.error(e.message));
                }}
              >
                <Download className="h-4 w-4 mr-2" /> Download current PDF
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => handleExport()}>
                <Download className="h-4 w-4 mr-2" /> Download JSON
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> Import JSON…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  try {
                    await navigator.clipboard.writeText(JSON.stringify(template, null, 2));
                    toast.success('Template JSON copied');
                  } catch { toast.error('Copy failed'); }
                }}
              >
                <CopyIcon className="h-4 w-4 mr-2" /> Copy JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <ClipboardCheck className="h-4 w-4" /> Governance <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Governance</DropdownMenuLabel>
              {id && (
                <DropdownMenuItem onSelect={() => setShowHistoryDialog(true)}>
                  <History className="h-4 w-4 mr-2" /> Version history
                </DropdownMenuItem>
              )}
              {id && (
                <DropdownMenuItem onSelect={() => setShowBranches(true)}>
                  <GitBranch className="h-4 w-4 mr-2" /> Branches
                </DropdownMenuItem>
              )}
              {id && (
                <DropdownMenuItem onSelect={() => setShowApproval(true)}>
                  {tplMeta?.locked_for_review ? <Lock className="h-4 w-4 mr-2" /> : <ClipboardCheck className="h-4 w-4 mr-2" />}
                  {tplMeta?.approval_status === 'approved' ? 'Approved' : tplMeta?.approval_status === 'in_review' ? 'In review' : 'Review'}
                </DropdownMenuItem>
              )}
              {id && (
                <DropdownMenuItem onSelect={() => setShowAudit(true)}>
                  <History className="h-4 w-4 mr-2" /> Audit trail
                </DropdownMenuItem>
              )}
              {id && (
                <DropdownMenuItem onSelect={() => setShowAnalyticsDialog(true)}>
                  <Sparkles className="h-4 w-4 mr-2" /> Analytics
                </DropdownMenuItem>
              )}
              {id && (
                <DropdownMenuItem onSelect={() => setShowComments(s => !s)}>
                  <Component className="h-4 w-4 mr-2" /> {showComments ? 'Hide comments' : 'Show comments'}
                </DropdownMenuItem>
              )}
              {id && (
                <DropdownMenuItem onSelect={() => setShowShareDialog(true)}>
                  <Sparkles className="h-4 w-4 mr-2" /> Share links
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Advanced tools">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Advanced</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => copyOverlayStyle(selectedOverlay)} disabled={!selectedOverlay}>
                <ClipboardCopy className="h-4 w-4 mr-2" /> Copy overlay style
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!hasStyleClipboard}
                onSelect={() => {
                  const ids = multiOverlayIds.size > 0
                    ? Array.from(multiOverlayIds)
                    : selectedOverlayId ? [selectedOverlayId] : [];
                  if (ids.length === 0) { toast.error('Select an overlay or multi-select first'); return; }
                  pasteOverlayStyleToIds(ids);
                }}
              >
                <ClipboardPaste className="h-4 w-4 mr-2" /> Paste overlay style
              </DropdownMenuItem>
              {id && (
                <DropdownMenuItem onSelect={() => setShowResync(true)}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Re-sync PDF
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setActiveMainTab('json')}>
                <Code2 className="h-4 w-4 mr-2" /> Edit template JSON
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setActiveMainTab('settings')}>
                <Settings2 className="h-4 w-4 mr-2" /> Custom CSS / settings
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAssetLibraryOpen(true)} disabled={!activePage}>
                <ImageIcon className="h-4 w-4 mr-2" /> Asset library… <span className="ml-auto text-[10px] text-muted-foreground">Shift+I</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTextStylesOpen(true)}>
                <Type className="h-4 w-4 mr-2" /> Text styles…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setTableEditorOpen(true)}
                disabled={selectedOverlay?.type !== 'table'}
              >
                <TableIcon className="h-4 w-4 mr-2" /> Edit table…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPaletteOpen(true)}>
                <CommandIcon className="h-4 w-4 mr-2" /> Command palette
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setTemplateEditorV2(!editorV2);
                  toast.success(`Drag & drop ${editorV2 ? 'disabled' : 'enabled'} — reloading…`);
                  setTimeout(() => window.location.reload(), 300);
                }}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {editorV2 ? 'Disable drag & drop (beta)' : 'Enable drag & drop (beta)'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {id && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={tplMeta?.is_active ? 'default' : canActivateTemplate ? 'outline' : 'destructive'}
                  size="sm"
                  title={tplMeta?.is_active ? 'Template is active in production' : 'Activation readiness'}
                >
                  {tplMeta?.is_active ? <CheckCircle2 className="h-4 w-4 mr-1" /> : <ShieldAlert className="h-4 w-4 mr-1" />}
                  {tplMeta?.is_active ? 'Active' : 'Activation'}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 p-0">
                <div className="px-3 py-2 border-b text-xs font-semibold flex items-center justify-between">
                  <span>Activation readiness</span>
                  <span className={tplMeta?.is_active ? 'text-success' : canActivateTemplate ? 'text-success' : 'text-destructive'}>
                    {tplMeta?.is_active ? 'Active' : canActivateTemplate ? 'Ready' : `${activationBlockers.length} blocker${activationBlockers.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className="p-3 space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border p-2"><div className="text-muted-foreground">Status</div><div className="font-medium">{tplMeta?.approval_status ?? 'draft'}</div></div>
                    <div className="rounded border p-2">
                      <div className="text-muted-foreground">Report type</div>
                      <div className="font-medium">{reportTypeAdapter?.label ?? (reportType || 'Missing')}</div>
                      {reportType && (
                        <div className={isProductionReportType ? 'mt-0.5 text-[10px] text-success' : 'mt-0.5 text-[10px] text-brand-600'}>
                          {isProductionReportType ? 'Production enabled' : 'Preview-only'}
                        </div>
                      )}
                    </div>
                    <div className="rounded border p-2"><div className="text-muted-foreground">Lock</div><div className="font-medium">{tplMeta?.locked_for_review ? 'Locked' : 'Unlocked'}</div></div>
                    <div className="rounded border p-2">
                      <div className="text-muted-foreground">Bindings</div>
                      <div className="font-medium">{bindingIssues.length === 0 ? 'OK' : `${bindingIssues.length} issue${bindingIssues.length === 1 ? '' : 's'}`}</div>
                      {isCheckingFullDocument && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground">Active page: {activePageBindingIssues.length}</div>
                      )}
                    </div>
                    <div className="rounded border p-2"><div className="text-muted-foreground">Renderer</div><div className="font-medium">{rendererIssueCount === 0 ? 'OK' : rendererErrorCount > 0 ? `${rendererErrorCount} blocker${rendererErrorCount === 1 ? '' : 's'}` : `${rendererIssueCount} note${rendererIssueCount === 1 ? '' : 's'}`}</div></div>
                    <div className="rounded border p-2"><div className="text-muted-foreground">Cascade</div><div className="font-medium">{cascadeReadiness.blockerCount === 0 ? `${cascadeReadiness.mappedRequiredSections}/${cascadeReadiness.requiredSections} mapped` : `${cascadeReadiness.blockerCount} blocker${cascadeReadiness.blockerCount === 1 ? '' : 's'}`}</div></div>
                    <div className="rounded border p-2"><div className="text-muted-foreground">QA approved</div><div className="font-medium">{cascadeReadiness.qaApprovedRequiredSections}/{cascadeReadiness.requiredSections}</div></div>
                    <div className="rounded border p-2"><div className="text-muted-foreground">Print errors</div><div className="font-medium">{printErrorCount === 0 ? 'OK' : printErrorCount}</div></div>
                  </div>
                  <div className="rounded border p-2 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold flex items-center gap-1"><MapPinned className="h-3.5 w-3.5" /> Cascade activation map</div>
                        <div className="text-[11px] text-muted-foreground">{cascadeStructure?.name || 'Fallback structure contract'}</div>
                      </div>
                      <span className={cascadeReadiness.status === 'ready' ? 'text-success' : 'text-destructive'}>
                        {cascadeReadiness.status === 'ready' ? 'Ready' : `${cascadeReadiness.blockerCount} blocker${cascadeReadiness.blockerCount === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="rounded bg-muted/40 p-1.5"><div className="text-muted-foreground">Required</div><div className="font-medium">{cascadeReadiness.mappedRequiredSections}/{cascadeReadiness.requiredSections}</div></div>
                      <div className="rounded bg-muted/40 p-1.5"><div className="text-muted-foreground">QA approved</div><div className="font-medium">{cascadeReadiness.qaApprovedRequiredSections}/{cascadeReadiness.requiredSections}</div></div>
                      <div className="rounded bg-muted/40 p-1.5"><div className="text-muted-foreground">Anchors</div><div className="font-medium">{cascadeReadiness.totalAnchors}</div></div>
                      <div className="rounded bg-muted/40 p-1.5"><div className="text-muted-foreground">Auto-map</div><div className="font-medium">{cascadeReadiness.autoMapSuggestionCount}</div></div>
                    </div>
                    {cascadeReadiness.blockers.length > 0 && (
                      <ul className="space-y-1 text-destructive">
                        {cascadeReadiness.blockers.slice(0, 4).map((item) => <li key={`${item.code}-${item.sectionId || item.fieldPath || item.message}`}>• {item.message}</li>)}
                        {cascadeReadiness.blockers.length > 4 && <li>• +{cascadeReadiness.blockers.length - 4} more cascade blocker{cascadeReadiness.blockers.length === 5 ? '' : 's'}</li>}
                      </ul>
                    )}
                    {cascadeReadiness.nextActions.length > 0 && (
                      <ul className="space-y-1 text-muted-foreground">
                        {cascadeReadiness.nextActions.slice(0, 3).map((action) => <li key={action}>→ {action}</li>)}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setActiveMainTab('cascade')}>
                        Open Cascade tab
                      </Button>
                      {cascadeReadiness.autoMapSuggestionCount > 0 && (
                        <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setActiveMainTab('cascade')}>
                          <Wand2 className="h-3.5 w-3.5 mr-1" /> Review auto-map
                        </Button>
                      )}
                    </div>
                  </div>

                  {!tplMeta?.is_active && activationBlockers.length > 0 ? (
                    <ul className="space-y-1 text-destructive">
                      {activationBlockers.map((b) => <li key={b}>• {b}</li>)}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">
                      {tplMeta?.is_active ? 'This template is currently active for production routing.' : 'No activation blockers detected.'}
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant={tplMeta?.is_active ? 'outline' : 'default'}
                    className="w-full"
                    disabled={update.isPending || (!tplMeta?.is_active && !canActivateTemplate)}
                    onClick={handleActivationToggle}
                  >
                    {update.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    {tplMeta?.is_active ? 'Deactivate template' : 'Activate template'}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          <div className="flex items-center rounded-md border bg-muted/30 p-0.5">
            <Button variant={workspaceMode === 'canvas' ? 'default' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setWorkspaceMode('canvas')}>
              <Layout className="h-3.5 w-3.5 mr-1" /> Design
            </Button>
            <Button variant={workspaceMode === 'preview' ? 'default' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setWorkspaceMode('preview')}>
              <Eye className="h-3.5 w-3.5 mr-1" /> Interactive Preview
            </Button>
            <Button variant={workspaceMode === 'pdf' ? 'default' : 'ghost'} size="sm" className="h-7 px-2 text-xs" onClick={() => setWorkspaceMode('pdf')}>
              <FileText className="h-3.5 w-3.5 mr-1" /> Final PDF
            </Button>
          </div>
          <div
            className={`text-[11px] px-2 py-1 rounded border ${saveConflict ? 'border-destructive/30 bg-destructive/10 text-destructive' : isDirty ? 'border-brand-500/30 bg-brand-500/10 text-brand-700' : 'border-success/30 bg-success/10 text-success'}`}
            title={[
              saveConflict?.message,
              lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleString('en-AU')}` : null,
              lastLocalSaveAt ? `Autosaved locally ${new Date(lastLocalSaveAt).toLocaleString('en-AU')}` : null,
              isDirty && dirtySince ? `Unsaved since ${new Date(dirtySince).toLocaleString('en-AU')}` : null,
            ].filter(Boolean).join(' · ') || undefined}
          >
            {saveConflict ? 'Save conflict' : update.isPending ? 'Saving…' : isDirty ? 'Unsaved changes' : 'Saved'}
          </div>
          {isDirty && lastLocalSaveAt && !saveConflict && (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap" title="Autosaved to this browser only — Save to persist to the server">
              autosaved {new Date(lastLocalSaveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => handleSave(true)} disabled={update.isPending}>
            <History className="h-4 w-4 mr-1" /> Snapshot version
          </Button>
          <Button size="sm" onClick={() => handleSave(false)} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save
          </Button>
        </div>
      </div>

      <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="self-start mx-3 mt-2">
          <TabsTrigger value="visual"><Layout className="h-3.5 w-3.5 mr-1" /> Visual</TabsTrigger>
          <TabsTrigger value="outline"><Component className="h-3.5 w-3.5 mr-1" /> Outline</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="tokens"><Palette className="h-3.5 w-3.5 mr-1" /> Tokens</TabsTrigger>
          <TabsTrigger value="brand"><Palette className="h-3.5 w-3.5 mr-1" /> Brand kit</TabsTrigger>
          <TabsTrigger value="slots"><Component className="h-3.5 w-3.5 mr-1" /> Slots ({Object.keys(template.slots ?? {}).length})</TabsTrigger>
          <TabsTrigger value="compatibility"><ShieldAlert className="h-3.5 w-3.5 mr-1" /> Compatibility</TabsTrigger>
          <TabsTrigger value="cascade"><MapPinned className="h-3.5 w-3.5 mr-1" /> Cascade</TabsTrigger>
          <TabsTrigger value="data"><Database className="h-3.5 w-3.5 mr-1" /> Sample data</TabsTrigger>
          <TabsTrigger value="json"><Code2 className="h-3.5 w-3.5 mr-1" /> JSON</TabsTrigger>
          <TabsTrigger value="versions">Versions ({versions.length})</TabsTrigger>
        </TabsList>

        {/* Visual editor */}
        <TabsContent value="visual" className="flex-1 min-h-0 mt-2">
          <div
            className="grid h-full gap-0"
            style={{
              gridTemplateColumns: '220px minmax(0, 1fr) 320px',
            }}
          >
            <PagesPanel
              enableCanvasDrag={editorV2}
              commentAnchors={commentAnchors}
            />

            <div className="relative bg-muted/30 min-h-0">
              {workspaceMode === 'preview' ? (
                <LiveHtmlPreview
                  sampleData={sampleData}
                  customCss={customCss || undefined}
                  scope={previewScope}
                  onScopeChange={setPreviewScope}
                />
              ) : workspaceMode === 'pdf' ? (
                <div className="absolute inset-0 flex flex-col bg-background">
                  <div className="px-3 py-2 border-b flex items-center gap-2 text-xs">
                    <Eye className="h-3.5 w-3.5 text-primary" />
                    <span className="font-medium">PDF preview</span>
                    <Button size="sm" variant={cascadeDebugPdf ? 'default' : 'outline'} className="ml-auto h-7 px-2 text-[11px]" onClick={() => setCascadeDebugPdf((v) => !v)}>
                      <MapPinned className="h-3 w-3 mr-1" /> Cascade tags
                    </Button>
                    {previewing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    {pdfStale && !previewing && (
                      <span className="rounded border border-brand-500/40 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
                        Out of date — template changed
                      </span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-6 px-2 text-[11px]"
                      onClick={() => void refreshPdfPreview()}
                      disabled={previewing}
                      title="Re-render the PDF with the current template (Weasyprint round-trip)"
                    >
                      <RefreshCw className={`h-3 w-3 mr-1 ${previewing ? 'animate-spin' : ''}`} />
                      {previewing ? 'Rendering…' : pdfStale ? 'Render latest' : 'Re-render'}
                    </Button>
                  </div>
                  <div className="flex-1 min-h-0 p-3">
                    {previewError ? (
                      <div className="h-full flex items-center justify-center text-xs text-destructive border-2 border-dashed border-destructive/30 rounded-md p-3 text-center">
                        {previewError}
                      </div>
                    ) : previewUrl ? (
                      <iframe
                        key={previewUrl}
                        src={previewUrl}
                        title="PDF preview"
                        className="w-full h-full rounded-md bg-white"
                      />
                    ) : (
                      <Skeleton className="w-full h-full" />
                    )}
                  </div>
                </div>
              ) : activePage ? (
                <>
                  <EditorialCanvas
                    key={activePage.id}
                    page={activePage}
                    sampleData={sampleData}
                    customCss={customCss || undefined}
                    enablePaletteDrop={editorV2}
                    enableTextToolbar={editorV2}
                    commentAnchors={activePageCommentAnchors}
                  />
                  <CanvasChrome
                    page={activePage}
                    canvas={template.canvas ?? { gridSize: 8, showGrid: false, showRulers: true, snapToGrid: false, showBleed: false, showSafeArea: false }}
                    onChangeCanvas={(c) => setTemplate((t) => ({ ...t, canvas: c }))}
                  />
                  <BulkEditBar
                    count={multiOverlayIds.size}
                    onClear={clearMultiSelect}
                    onDelete={bulkDeleteOverlays}
                    onAlign={(a) => bulkPatchOverlays({ align: a } as any)}
                    onSetColor={(c) => bulkPatchOverlays({ color: c } as any)}
                    onSetFontSize={(n) => bulkPatchOverlays({ fontSize: n } as any)}
                    onSetFontFamily={(f) => bulkPatchOverlays({ fontFamily: f } as any)}
                    onSetOpacity={(n) => bulkPatchOverlays({ opacity: n } as any)}
                    onCopyStyle={bulkCopyStyleFromFirst}
                    onPasteStyle={bulkPasteStyle}
                    hasStyleClipboard={hasStyleClipboard}
                    onMergeText={bulkMergeText}
                    canMergeText={canMergeText}
                  />
                  <AlignDistributeBar
                    count={multiOverlayIds.size}
                    onAlign={bulkAlign}
                    onDistribute={bulkDistribute}
                    onAlignToPage={bulkAlignToPage}
                    onGroup={bulkGroup}
                    onUngroup={bulkUngroup}
                    onZ={bulkZ}
                    onLock={bulkLock}
                    onHide={bulkHide}
                    anyLocked={anyLocked}
                    anyHidden={anyHidden}
                    anyGrouped={anyGrouped}
                  />
                </>
              ) : (
                <EditorEmptyState
                  onBlank={() => addPage()}
                  onTemplates={() => setShowPageMarket(true)}
                  onReference={() => setShowReferenceImport(true)}
                  referenceDisabled={!id}
                />
              )}
            </div>


            <div className="border-l bg-background min-h-0">
              <PropertiesInspector templateId={id} />
            </div>

          </div>
        </TabsContent>

        <TabsContent value="cascade" className="flex-1 min-h-0 mt-2">
          <CascadeMapPanel
            template={template}
            templateId={id}
            reportType={reportType || null}
            tier={tier || null}
            sampleData={sampleData}
            selectedBlockId={selectedBlockId}
            selectedOverlayId={selectedOverlayId}
            onUpdateTemplate={setTemplate}
            onSelectTarget={({ pageId, blockId, overlayId }) => {
              setActivePageId(pageId);
              setSelectedBlockId(blockId ?? null);
              setSelectedOverlayId(overlayId ?? null);
              if (overlayId) setSelectedBlockId(null);
              setActiveMainTab('visual');
            }}
          />
        </TabsContent>

        {/* Outline — Phase 2 */}
        <TabsContent value="outline" className="flex-1 min-h-0 mt-2">
          <div className="grid h-full" style={{ gridTemplateColumns: '320px minmax(0, 1fr)' }}>
            <div className="border-r bg-background min-h-0">
              <OutlinePanel />
            </div>
            <div className="border-l bg-background min-h-0">
              <PropertiesInspector templateId={id} />
            </div>
          </div>
        </TabsContent>


        {/* Metadata */}
        <TabsContent value="settings" className="px-6 py-4 max-w-3xl space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground mb-1">Resolver routing</div>
            These four fields decide which generated reports route through this template. The resolver picks the
            most-specific active match: <code>user &gt; agency &gt; global-variant &gt; global-any</code>, ordered by
            priority. Engine must be <code>weasyprint</code> for production routing.
            <div className="mt-2 flex flex-wrap gap-1.5">
              {reportType ? (
                <>
                  <span className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium">
                    {reportType}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded bg-accent/40 text-foreground px-2 py-0.5 text-[10px] font-medium">
                    variant: {variant || 'any'}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded bg-accent/40 text-foreground px-2 py-0.5 text-[10px] font-medium">
                    scope: {scope || 'global'}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded bg-accent/40 text-foreground px-2 py-0.5 text-[10px] font-medium">
                    priority: {priority}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded bg-muted text-muted-foreground px-2 py-0.5 text-[10px]">
                    will route: {variant ? `${reportType} (${variant})` : `any ${reportType}`}
                  </span>
                </>
              ) : (
                <span className="text-[11px] italic">Set a report type to see routing targets.</span>
              )}
            </div>
          </div>
          <div className={`rounded-lg border p-3 text-xs ${isProductionReportType ? 'border-success/40 bg-success/5' : reportType ? 'border-brand-300 bg-brand-50 text-brand-900 dark:bg-brand-950/20 dark:text-brand-200' : 'border-border bg-muted/20 text-muted-foreground'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium text-foreground">Report type production support</div>
                <div className="mt-1">
                  {!reportType
                    ? 'Not configured — choose a report type before activation.'
                    : isProductionReportType
                      ? `${reportTypeAdapter?.label ?? reportType} can route production reports through Template Builder.`
                      : `${reportTypeAdapter?.label ?? reportType} is currently preview-only until an adapter is implemented.`}
                </div>
              </div>
              <span className={isProductionReportType ? 'rounded bg-success/10 px-2 py-1 font-medium text-success' : 'rounded bg-background/70 px-2 py-1 font-medium'}>
                {isProductionReportType ? 'Production enabled' : reportType ? 'Preview only' : 'Not configured'}
              </span>
            </div>
            {reportTypeAdapter?.legacyFallback?.reason && (
              <div className="mt-2 text-[11px]">
                Fallback: {reportTypeAdapter.legacyFallback.label} — {reportTypeAdapter.legacyFallback.reason}
              </div>
            )}
            {reportTypeAdapter?.samplePresetIds?.length ? (
              <div className="mt-2 text-[11px]">Sample presets: {reportTypeAdapter.samplePresetIds.join(', ')}</div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Report type</Label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Choose report type</option>
                {reportType && !adapterOptions.some((adapter) => adapter.reportType === reportType) && (
                  <option value={reportType}>{reportTypeAdapter?.label ?? reportType} · current alias</option>
                )}
                {adapterOptions.map((adapter) => (
                  <option key={adapter.reportType} value={adapter.reportType}>
                    {adapter.label}{adapter.supportsProduction ? ' · production' : ' · preview only'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Tier (legacy label)</Label>
              <Input value={tier} onChange={(e) => setTier(e.target.value)} placeholder="e.g. compass" />
            </div>
            <div>
              <Label className="text-xs">Variant</Label>
              <select
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Any variant (catch-all)</option>
                <option value="composite">Composite</option>
                <option value="financial">Financial Feasibility (FIN)</option>
                <option value="due_diligence">Property Due Diligence (PLDD)</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Scope</Label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="global">Global (all agencies)</option>
                <option value="agency">Agency-specific</option>
                <option value="user">User-specific</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Priority (tiebreaker)</Label>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) || 0)}
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <Label className="text-xs">Custom CSS (advanced)</Label>
            <p className="text-[11px] text-muted-foreground mb-1">Layered on top of the rendered HTML/PDF. Scope to <code>.tpl-page</code> or block ids.</p>
            <Textarea
              value={customCss}
              onChange={(e) => setCustomCss(e.target.value)}
              rows={10}
              spellCheck={false}
              placeholder={`/* e.g. */\n.tpl-page-0 h1 { letter-spacing: -0.02em; }\n.tpl-page { font-feature-settings: "ss01"; }`}
              className="font-mono text-xs"
            />
          </div>
        </TabsContent>

        {/* Brand tokens */}
        <TabsContent value="tokens" className="px-6 py-4 max-w-3xl space-y-6">
          <ThemePresetsGallery
            activeTokens={template.tokens}
            onApply={applyTheme}
          />
          <TokensEditor template={template} onChange={(tokens) => setTemplate((t) => ({ ...t, tokens }))} />
        </TabsContent>

        {/* Brand kit (Phase 1 foundations) */}
        <TabsContent value="brand" className="px-6 py-4 max-w-3xl space-y-6">
          <BrandKitPanel template={template} onChange={setTemplate} />
        </TabsContent>


        {/* Renderer compatibility / pre-flight */}
        <TabsContent value="compatibility" className="flex-1 min-h-0 px-6 py-4">
          <div className="grid h-full gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px' }}>
            <div className="min-h-0 space-y-4">
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4" /> Renderer compatibility
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground max-w-2xl">
                      Reviews every block against the supported renderer pipeline. Production output routes through HTML/WeasyPrint; jsPDF is treated as a legacy preview/export path and may show placeholders for HTML-first blocks.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {isCheckingFullDocument && (
                      <span className="text-[11px] px-2 py-1 rounded border bg-muted text-muted-foreground">Updating analysis…</span>
                    )}
                    {firstRendererBlocker && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => jumpToIssue(firstRendererBlocker)}
                        title="Jump to the first production renderer blocker"
                      >
                        First blocker
                      </Button>
                    )}
                    {!firstRendererBlocker && firstRendererNote && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => jumpToIssue(firstRendererNote)}
                        title="Jump to the first renderer note"
                      >
                        First note
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setWorkspaceMode('preview')}
                      title="Open the production-parity HTML preview"
                    >
                      <Eye className="h-4 w-4 mr-1" /> Preview output
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-muted-foreground">Production blockers</div>
                    <div className={`mt-1 text-lg font-semibold ${rendererErrorCount > 0 ? 'text-destructive' : 'text-success'}`}>{rendererErrorCount}</div>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-muted-foreground">Renderer notes</div>
                    <div className="mt-1 text-lg font-semibold text-brand-600">{rendererNoteCount}</div>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-muted-foreground">Block types used</div>
                    <div className="mt-1 text-lg font-semibold">{usedBlockCompatibility.length}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-background min-h-0">
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Issues by page</h3>
                    <p className="text-xs text-muted-foreground">Click any issue to jump to the affected block or overlay.</p>
                  </div>
                  <span className={`text-[11px] px-2 py-1 rounded border ${rendererErrorCount > 0 ? 'bg-destructive/10 text-destructive border-destructive/30' : rendererIssueCount > 0 ? 'bg-brand-500/10 text-brand-700 border-brand-500/30' : 'bg-success/10 text-success border-success/30'}`}>
                    {rendererIssueCount === 0 ? 'All renderers ready' : `${rendererIssueCount} renderer issue${rendererIssueCount === 1 ? '' : 's'}`}
                  </span>
                </div>
                {rendererIssuesByPage.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
                    No renderer compatibility issues detected in this template.
                  </div>
                ) : (
                  <ScrollArea className="h-[44vh]">
                    <div className="divide-y">
                      {rendererIssuesByPage.map(({ page, index, issues }) => (
                        <div key={page.id} className="p-4 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold">Page {index + 1}: {page.name}</div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => { setActivePageId(page.id); setSelectedOverlayId(null); setSelectedBlockId(null); }}
                            >
                              Open page
                            </Button>
                          </div>
                          <div className="space-y-2">
                            {issues.map((iss, idx) => (
                              <button
                                key={`${iss.blockId ?? 'page'}-${iss.overlayId ?? idx}-${iss.code}`}
                                type="button"
                                onClick={() => jumpToIssue(iss)}
                                className={`w-full text-left rounded-md border px-3 py-2 transition-colors hover:bg-muted/60 ${iss.severity === 'error' ? 'border-destructive/30 bg-destructive/5' : 'border-brand-500/30 bg-brand-500/5'}`}
                              >
                                <div className="flex items-center gap-2 text-[11px] font-semibold">
                                  <span className={`rounded px-1.5 py-0.5 uppercase tracking-wider ${iss.severity === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-brand-500/10 text-brand-700'}`}>{iss.severity}</span>
                                  <span className="font-mono text-[10px] text-muted-foreground">{iss.code}</span>
                                </div>
                                <div className={`mt-1 text-xs ${iss.severity === 'error' ? 'text-destructive' : 'text-foreground'}`}>{iss.message}</div>
                                <div className="mt-1 text-[10px] text-muted-foreground">{iss.where}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </div>

            <div className="rounded-lg border bg-background min-h-0 flex flex-col">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold">Block capability matrix</h3>
                <p className="text-xs text-muted-foreground">Support for block types currently used in this template.</p>
              </div>
              <ScrollArea className="flex-1">
                <div className="divide-y">
                  {usedBlockCompatibility.length === 0 ? (
                    <div className="p-4 text-xs text-muted-foreground">No blocks in the template yet.</div>
                  ) : usedBlockCompatibility.map(({ type, label, count, capabilities }) => (
                    <div key={type} className="p-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{label}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{type} · {count} used</div>
                        </div>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] border ${capabilities.productionSafe ? 'bg-success/10 text-success border-success/30' : 'bg-destructive/10 text-destructive border-destructive/30'}`}>
                          {capabilities.productionSafe ? 'Production safe' : 'Blocked'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 mt-2 text-[10px]">
                        <div className="rounded border p-1.5"><div className="text-muted-foreground">HTML</div><div className="font-medium capitalize">{capabilities.html}</div></div>
                        <div className="rounded border p-1.5"><div className="text-muted-foreground">Weasy</div><div className="font-medium capitalize">{capabilities.weasyprint}</div></div>
                        <div className="rounded border p-1.5"><div className="text-muted-foreground">jsPDF</div><div className="font-medium capitalize">{capabilities.jspdf}</div></div>
                      </div>
                      {capabilities.notes && (
                        <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">{capabilities.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="slots" className="px-6 py-4 max-w-3xl space-y-4">
          <SlotsEditor
            template={template}
            onChange={(slots) => setTemplate((t) => ({ ...t, slots }))}
          />
        </TabsContent>

        {/* Sample data */}
        <TabsContent value="data" className="px-6 py-4 max-w-3xl space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Preview sample data</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Edit the JSON used to render the live preview. Bindings like <code>{'{{property.address}}'}</code> resolve against this object.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <BindingPathsPopover template={template} sampleData={sampleData} />
              <ComputedFieldsDialog template={template} sampleData={sampleData} onChange={setTemplate} />
              <PageMastersDialog template={template} onChange={setTemplate} />
              <ThemesDialog template={template} onChange={setTemplate} />



              <span
                className={`text-[11px] px-2 py-0.5 rounded ${sampleDataValid ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}
                title={sampleDataError ?? undefined}
              >
                {sampleDataValid ? 'Valid JSON' : 'Invalid JSON'}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!sampleDataValid}
                onClick={() => setSampleDataText(JSON.stringify(sampleData, null, 2))}
              >
                Format
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={loadSampleFromRealReport}
                disabled={!isProductionReportType}
                title={isProductionReportType
                  ? `Load binding context from a real ${reportTypeAdapter?.label ?? reportType} report`
                  : 'Choose a production-enabled report type before loading real data'}
              >
                Load real report…
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSampleDataText(JSON.stringify(DEFAULT_SAMPLE_DATA, null, 2))}
              >
                Reset
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap pb-1">
            <Label className="text-[11px] text-muted-foreground mr-1">Presets:</Label>
            {SAMPLE_DATA_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applySampleDataPreset(p.id)}
                className="text-[11px] px-2 py-1 rounded border border-border hover:border-primary hover:bg-primary/5 transition-colors"
                title={p.description}
              >
                {p.label}
              </button>
            ))}
          </div>
          {!sampleDataValid && sampleDataError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {sampleDataError}
            </div>
          )}
          <Textarea
            value={sampleDataText}
            onChange={(e) => setSampleDataText(e.target.value)}
            spellCheck={false}
            className="font-mono text-xs h-[55vh] resize-none"
            placeholder={`{
  "property": {
    "address": "..."
  }
}`}
          />
        </TabsContent>

        {/* Raw JSON fallback (still editable) */}
        <TabsContent value="json" className="flex-1 min-h-0 px-3 pb-3 space-y-2">
          <div className="flex items-center justify-between gap-2 py-2">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Template JSON</Label>
              <p className="text-[11px] text-muted-foreground">Advanced editor with safe parse feedback. Invalid JSON stays in the editor until fixed.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[11px] px-2 py-0.5 rounded ${templateJsonError ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}`}>
                {templateJsonError ? 'Invalid JSON' : 'Valid JSON'}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!!templateJsonError}
                onClick={() => {
                  const formatted = JSON.stringify(JSON.parse(templateJsonText || '{}'), null, 2);
                  setTemplateJsonText(formatted);
                  applyTemplateJsonText(formatted);
                }}
              >
                Format
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (applyTemplateJsonText(templateJsonText)) toast.success('Template JSON applied');
                }}
              >
                Apply JSON
              </Button>
            </div>
          </div>
          {templateJsonError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {templateJsonError}
            </div>
          )}
          <Textarea
            value={templateJsonText}
            onFocus={() => setTemplateJsonFocused(true)}
            onBlur={() => setTemplateJsonFocused(false)}
            onChange={(e) => {
              const next = e.target.value;
              setTemplateJsonText(next);
              applyTemplateJsonText(next);
            }}
            spellCheck={false}
            className="font-mono text-xs h-[72vh] resize-none"
          />
        </TabsContent>

        {/* Version history */}
        <TabsContent value="versions" className="px-4 py-4 max-w-2xl space-y-3">
          {versions.length > 0 && cascadeVersionCompare && (
            <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold flex items-center gap-1"><MapPinned className="h-3.5 w-3.5 text-primary" /> Cascade version compare</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">Compare required mapping, QA approval, blockers, and auto-map opportunities across saved schemas.</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Left</span>
                  <select className="h-8 w-full rounded border bg-background px-2 text-xs" value={cascadeCompareLeftId} onChange={(event) => setCascadeCompareLeftId(event.currentTarget.value)}>
                    {cascadeCompareOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Right</span>
                  <select className="h-8 w-full rounded border bg-background px-2 text-xs" value={cascadeCompareRightId} onChange={(event) => setCascadeCompareRightId(event.currentTarget.value)}>
                    {cascadeCompareOptions.filter((option) => option.id !== 'working').map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded border bg-background p-2">
                  <div className="font-medium">{cascadeVersionCompare.left.label}</div>
                  <div className="mt-1 text-muted-foreground">Required: {cascadeVersionCompare.leftReadiness.mappedRequiredSections}/{cascadeVersionCompare.leftReadiness.requiredSections}</div>
                  <div className="text-muted-foreground">QA: {cascadeVersionCompare.leftReadiness.qaApprovedRequiredSections}/{cascadeVersionCompare.leftReadiness.requiredSections}</div>
                  <div className="text-muted-foreground">Blockers: {cascadeVersionCompare.leftReadiness.blockerCount}</div>
                </div>
                <div className="rounded border bg-background p-2">
                  <div className="font-medium">Δ left vs right</div>
                  <div className={(cascadeVersionCompare.leftReadiness.mappedRequiredSections - cascadeVersionCompare.rightReadiness.mappedRequiredSections) >= 0 ? 'mt-1 text-success' : 'mt-1 text-destructive'}>
                    Required {cascadeVersionCompare.leftReadiness.mappedRequiredSections - cascadeVersionCompare.rightReadiness.mappedRequiredSections >= 0 ? '+' : ''}{cascadeVersionCompare.leftReadiness.mappedRequiredSections - cascadeVersionCompare.rightReadiness.mappedRequiredSections}
                  </div>
                  <div className={(cascadeVersionCompare.leftReadiness.qaApprovedRequiredSections - cascadeVersionCompare.rightReadiness.qaApprovedRequiredSections) >= 0 ? 'text-success' : 'text-destructive'}>
                    QA {cascadeVersionCompare.leftReadiness.qaApprovedRequiredSections - cascadeVersionCompare.rightReadiness.qaApprovedRequiredSections >= 0 ? '+' : ''}{cascadeVersionCompare.leftReadiness.qaApprovedRequiredSections - cascadeVersionCompare.rightReadiness.qaApprovedRequiredSections}
                  </div>
                  <div className={(cascadeVersionCompare.leftReadiness.blockerCount - cascadeVersionCompare.rightReadiness.blockerCount) <= 0 ? 'text-success' : 'text-destructive'}>
                    Blockers {cascadeVersionCompare.leftReadiness.blockerCount - cascadeVersionCompare.rightReadiness.blockerCount >= 0 ? '+' : ''}{cascadeVersionCompare.leftReadiness.blockerCount - cascadeVersionCompare.rightReadiness.blockerCount}
                  </div>
                </div>
                <div className="rounded border bg-background p-2">
                  <div className="font-medium">{cascadeVersionCompare.right.label}</div>
                  <div className="mt-1 text-muted-foreground">Required: {cascadeVersionCompare.rightReadiness.mappedRequiredSections}/{cascadeVersionCompare.rightReadiness.requiredSections}</div>
                  <div className="text-muted-foreground">QA: {cascadeVersionCompare.rightReadiness.qaApprovedRequiredSections}/{cascadeVersionCompare.rightReadiness.requiredSections}</div>
                  <div className="text-muted-foreground">Blockers: {cascadeVersionCompare.rightReadiness.blockerCount}</div>
                </div>
              </div>
            </div>
          )}
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No saved versions yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v, i) => {
                const parsed = parseTemplate(v.schema);
                const pageCount = parsed.pages.length;
                const blockCount = parsed.pages.reduce((a, p) => a + p.blocks.length, 0);
                const overlayCount = parsed.pages.reduce(
                  (a, p) => a + p.blocks.reduce((b, x) => b + x.overlays.length, 0), 0);
                const prev = versions[i + 1] ? parseTemplate(versions[i + 1].schema) : null;
                const prevBlocks = prev ? prev.pages.reduce((a, p) => a + p.blocks.length, 0) : null;
                const blockDiff = prevBlocks != null ? blockCount - prevBlocks : null;
                const versionCascadeMap = buildCascadeMap(parsed, cascadeContract, { data: sampleData, templateId: id });
                const versionCascadeSuggestions = buildCascadeAnchorSuggestions(parsed, cascadeContract);
                const versionCascadeReadiness = buildCascadeActivationReadiness(versionCascadeMap, versionCascadeSuggestions, { requireQaApproved: true });
                return (
                <li key={v.id} className="flex items-center justify-between border rounded-md px-3 py-2 text-sm gap-2">
                  <div className="min-w-0">
                    <div className="font-medium flex items-center gap-2">
                      v{v.version}
                      {blockDiff != null && blockDiff !== 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${blockDiff > 0 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                          {blockDiff > 0 ? '+' : ''}{blockDiff} blocks
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleString('en-AU')}
                      {v.note && ` — ${v.note}`}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {pageCount} page{pageCount === 1 ? '' : 's'} · {blockCount} block{blockCount === 1 ? '' : 's'} · {overlayCount} overlay{overlayCount === 1 ? '' : 's'}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                      <span className={`rounded px-1.5 py-0.5 ${versionCascadeReadiness.status === 'ready' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}`}>
                        Cascade {versionCascadeReadiness.mappedRequiredSections}/{versionCascadeReadiness.requiredSections} required
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                        QA {versionCascadeReadiness.qaApprovedRequiredSections}/{versionCascadeReadiness.requiredSections}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {versionCascadeReadiness.totalAnchors} anchor{versionCascadeReadiness.totalAnchors === 1 ? '' : 's'}
                      </span>
                      {versionCascadeReadiness.autoMapSuggestionCount > 0 && (
                        <span className="rounded bg-brand-100 px-1.5 py-0.5 text-brand-700 dark:bg-brand-950/30 dark:text-brand-200">
                          {versionCascadeReadiness.autoMapSuggestionCount} auto-map
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTemplate(parseTemplate(v.schema));
                        toast.info(`Loaded v${v.version} into editor. Click Save to apply.`);
                      }}
                    >
                      Load
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!id || update.isPending}
                      onClick={() => {
                        if (!id) return;
                        if (!confirm(`Restore v${v.version}? This will overwrite the current template (a snapshot of the current version is saved first).`)) return;
                        const restored = parseTemplate(v.schema);
                        setTemplate(restored);
                        update.mutate(
                          { id, snapshot: true, note: `Restored from v${v.version}`, patch: { schema: restored } as any },
                          { onSuccess: () => toast.success(`Restored v${v.version}`) },
                        );
                      }}
                    >
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={create.isPending}
                      onClick={() => {
                        const cloned = parseTemplate(v.schema);
                        create.mutate(
                          {
                            name: `${name || 'Template'} — v${v.version} clone`,
                            description: `Cloned from v${v.version}`,
                            report_type: reportType || null,
                            tier: tier || null,
                            schema: cloned,
                          } as any,
                          {
                            onSuccess: (row: any) => {
                              if (row?.id && confirmLeave()) navigate(`/admin/template-builder/${row.id}`);
                            },
                          },
                        );
                      }}
                    >
                      Clone as new
                    </Button>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      <MountOnFirstOpen open={showExportDialog}>
        <ExportPipelineDialog
          open={showExportDialog}
          onOpenChange={setShowExportDialog}
          template={template}
          templateId={id}
          templateName={name}
          sampleData={sampleData}
          customCss={customCss || undefined}
          onTemplateChange={(next) => setTemplate(next)}
        />
      </MountOnFirstOpen>
      {id && (
        <MountOnFirstOpen open={showShareDialog}>
          <ShareLinksDialog
            open={showShareDialog}
            onOpenChange={setShowShareDialog}
            templateId={id}
            template={template}
            currentUserId={user?.id ?? null}
          />
        </MountOnFirstOpen>
      )}
      {id && (
        <MountOnFirstOpen open={showHistoryDialog}>
          <VersionHistoryDialog
            open={showHistoryDialog}
            onOpenChange={setShowHistoryDialog}
            templateId={id}
            currentTemplate={template}
            onLoad={(schema) => setTemplate(schema)}
            onRestore={(v) => {
              const restored = parseTemplate(v.schema);
              setTemplate(restored);
              update.mutate(
                { id, snapshot: true, note: `Restored from v${v.version}`, patch: { schema: restored } as any },
                { onSuccess: () => {
                  toast.success(`Restored v${v.version}`);
                  setShowHistoryDialog(false);
                  logTemplateEvent({ templateId: id, eventType: 'edit_restore', metadata: { fromVersion: v.version } });
                } },
              );
            }}
          />
        </MountOnFirstOpen>
      )}
      <TemplateShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <EditorOnboardingTour
        open={showTour}
        onOpenChange={setShowTour}
        onComplete={markEditorTourSeen}
      />
      {showV2Hint && (
        <div className="fixed bottom-4 left-1/2 z-50 flex max-w-[640px] -translate-x-1/2 items-center gap-3 rounded-lg border bg-popover px-4 py-2.5 text-sm shadow-lg">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1">
            <strong>New:</strong> drag any element from the Insert panel straight onto the canvas, and select a text
            element for the floating quick-style toolbar.
          </span>
          <Button size="sm" variant="ghost" className="h-7" onClick={dismissV2Hint}>Got it</Button>
        </div>
      )}
      <SaveConflictDialog
        open={showConflict}
        onOpenChange={setShowConflict}
        serverVersion={saveConflict?.serverVersion ?? null}
        canOverwrite={isSuperadmin}
        pending={update.isPending}
        onReviewLatest={handleConflictReviewLatest}
        onSaveAsBranch={handleConflictSaveAsBranch}
        onOverwrite={handleConflictOverwrite}
        onKeepDraft={() => setShowConflict(false)}
      />
      <DraftRecoveryDialog
        open={showDraftRecovery}
        onOpenChange={setShowDraftRecovery}
        draft={draftRecovery}
        serverSchema={showDraftRecovery && tplRow ? parseTemplate(tplRow.schema) : null}
        currentServerVersion={Number(tplRow?.version ?? 1)}
        staleBase={staleDraftBase}
        onRestore={handleRestoreDraft}
        onDiscard={handleDiscardDraft}
        onSaveAsBranch={handleDraftSaveAsBranch}
      />
      {id && (
        <MountOnFirstOpen open={showAnalyticsDialog}>
          <TemplateAnalyticsDialog
            open={showAnalyticsDialog}
            onOpenChange={setShowAnalyticsDialog}
            templateId={id}
            template={template}
          />
        </MountOnFirstOpen>
      )}
      <MountOnFirstOpen open={showAIAuthor}>
        <TemplateAIAuthorDialog
          open={showAIAuthor}
          onOpenChange={setShowAIAuthor}
          template={template}
          activePage={activePage ?? null}
          tier={tier}
          onAddPage={(page, rationale) => {
            setTemplate((t) => ({ ...t, pages: [...t.pages, page] }));
            setActivePageId(page.id);
            toast.success(`Added "${page.name}"${rationale ? '' : ''}`);
          }}
          onUpdateOverlayText={(pageId, overlayId, nextText) => {
            setTemplate((t) => ({
              ...t,
              pages: t.pages.map((p) => p.id !== pageId ? p : ({
                ...p,
                blocks: p.blocks.map((b) => ({
                  ...b,
                  overlays: b.overlays.map((o) => o.id === overlayId && o.type === 'text' ? ({ ...o, content: nextText } as any) : o),
                })),
              })),
            }));
          }}
          onApplyName={(n, d) => { setName(n); setDescription(d); }}
        />
      </MountOnFirstOpen>
      <MountOnFirstOpen open={showDesignAgent}>
        <TemplateDesignAgentPanel
          open={showDesignAgent}
          onOpenChange={setShowDesignAgent}
          template={template}
          setTemplate={(next) => setTemplate(next)}
          activePageId={activePageId}
          selectedBlockId={selectedBlockId}
          selectedOverlayId={selectedOverlayId}
          templateId={id}
          sampleData={sampleData}
        />
      </MountOnFirstOpen>
      <MountOnFirstOpen open={showPageMarket}>
        <PageTemplatesMarketplaceDialog
          open={showPageMarket}
          onOpenChange={setShowPageMarket}
          onInsert={(presetId) => { addStarterPage(presetId); }}
        />
      </MountOnFirstOpen>
      <MountOnFirstOpen open={showPreviewQA}>
        <PreviewQADialog
          open={showPreviewQA}
          onOpenChange={setShowPreviewQA}
          template={template}
          sampleData={sampleData}
          customCss={customCss || undefined}
        />
      </MountOnFirstOpen>
      <MountOnFirstOpen open={showSpellCheck}>
        <SpellCheckDialog
          open={showSpellCheck}
          onOpenChange={setShowSpellCheck}
          template={template}
          onJumpTo={(pageId, blockId, overlayId) => {
            setActivePageId(pageId);
            setSelectedBlockId(blockId);
            setSelectedOverlayId(overlayId);
          }}
        />
      </MountOnFirstOpen>
      <MountOnFirstOpen open={showComponentLib}>
        <ComponentLibraryDialog
          open={showComponentLib}
          onOpenChange={setShowComponentLib}
          template={template}
          activePage={activePage ?? null}
          selectedBlockId={selectedBlockId}
          onInsertBlocks={(blocks) => {
            if (!activePage) return;
            setTemplate((t) => ({
              ...t,
              pages: t.pages.map((p) => p.id !== activePage.id ? p : ({ ...p, blocks: [...p.blocks, ...blocks] })),
            }));
          }}
        />
      </MountOnFirstOpen>
      {id && showComments && (
        <aside className="fixed right-0 top-0 bottom-0 z-40 w-[360px] bg-card border-l shadow-lg flex flex-col">
          <MountOnFirstOpen open={showComments}>
            <TemplateCommentsPanel
              templateId={id}
              activePage={activePage}
              selectedBlock={selectedBlock}
              selectedOverlay={selectedOverlay}
              selectedOverlayBlockId={selectedOverlayBlockId}
              currentUserId={user?.id ?? null}
              currentUserName={user?.username ?? null}
              onRowsChange={(rows) => setCommentRows(rows)}
              onJumpToAnchor={({ pageId, blockId, overlayId }) => {
                if (pageId) setActivePageId(pageId);
                if (overlayId) { setSelectedOverlayId(overlayId); setSelectedBlockId(null); }
                else if (blockId) { setSelectedBlockId(blockId); setSelectedOverlayId(null); }
              }}
            />
          </MountOnFirstOpen>
        </aside>
      )}
      {id && (
        <MountOnFirstOpen open={showResync}>
          <ResyncPdfDialog
            open={showResync}
            onOpenChange={setShowResync}
            templateId={id}
            templateName={name}
            engine={resyncEngine}
            onResynced={() => {
              // Force the editor to reload the freshly resynced template.
              window.location.reload();
            }}
          />
        </MountOnFirstOpen>
      )}
      {id && (
        <MountOnFirstOpen open={showReferenceImport}>
          <ReferenceImportDialog
            open={showReferenceImport}
            onOpenChange={setShowReferenceImport}
            templateId={id}
            templateName={name}
            schema={template}
            activePageId={activePageId}
            sampleData={sampleData}
            onResynced={() => window.location.reload()}
            onApplySchema={(s) => { setTemplate(s); toast.success('Reconstruction applied — review and Save'); }}
            onOpenCascade={() => setActiveMainTab('cascade')}
          />
        </MountOnFirstOpen>
      )}
      <MountOnFirstOpen open={showDiff}>
        <PdfFidelityDiffDialog
          open={showDiff}
          onOpenChange={setShowDiff}
          template={template}
          sampleData={sampleData}
          customCss={customCss || undefined}
          onApplySchema={(s) => { setTemplate(s); toast.success('Fidelity repair applied — review and Save'); }}
        />
      </MountOnFirstOpen>
      <MountOnFirstOpen open={findReplaceOpen}>
        <FindReplaceDialog
          open={findReplaceOpen}
          onOpenChange={setFindReplaceOpen}
          template={template}
          activePageId={activePageId}
          onApplyTemplate={(next) => setTemplate(next)}
          onGoTo={(pid, oid) => {
            setActivePageId(pid);
            setSelectedOverlayId(oid);
            setSelectedBlockId(null);
            clearMultiSelect();
          }}
        />
      </MountOnFirstOpen>
      <MountOnFirstOpen open={assetLibraryOpen}>
        <AssetLibraryDialog
          open={assetLibraryOpen}
          onOpenChange={setAssetLibraryOpen}
          templateId={id}
          pageWidth={activePage?.size.width ?? 595}
          pageHeight={activePage?.size.height ?? 842}
          onInsert={insertImageFromLibrary}
        />
      </MountOnFirstOpen>
      <MountOnFirstOpen open={textStylesOpen}>
        <TextStylesDialog
          open={textStylesOpen}
          onOpenChange={setTextStylesOpen}
          template={template}
          onChange={(next) => setTemplate(next)}
        />
      </MountOnFirstOpen>
      <MountOnFirstOpen open={tableEditorOpen}>
        <TableEditorDialog
          open={tableEditorOpen}
          onOpenChange={setTableEditorOpen}
          overlay={selectedOverlay?.type === 'table' ? (selectedOverlay as any) : null}
          onChange={(next) => {
            if (!activePage) return;
            updatePage(editorActions.updateOverlay(activePage, next as Overlay));
          }}
        />
      </MountOnFirstOpen>
      {id && (
        <>
          <MountOnFirstOpen open={showBranches}>
            <TemplateBranchingDialog
              open={showBranches}
              onOpenChange={setShowBranches}
              templateId={id}
              templateName={name}
              parentTemplateId={tplMeta?.parent_template_id ?? null}
              isDraft={tplMeta?.is_draft ?? false}
              onMerged={reloadTplMeta}
            />
          </MountOnFirstOpen>
          <MountOnFirstOpen open={showApproval}>
            <TemplateApprovalDialog
              open={showApproval}
              onOpenChange={setShowApproval}
              templateId={id}
              templateName={name}
              approvalStatus={tplMeta?.approval_status ?? null}
              locked={tplMeta?.locked_for_review ?? false}
              onChanged={reloadTplMeta}
            />
          </MountOnFirstOpen>
          <MountOnFirstOpen open={showAudit}>
            <TemplateAuditLogDialog
              open={showAudit}
              onOpenChange={setShowAudit}
              templateId={id}
              templateName={name}
            />
          </MountOnFirstOpen>
        </>
      )}
    </div>
  );
}
