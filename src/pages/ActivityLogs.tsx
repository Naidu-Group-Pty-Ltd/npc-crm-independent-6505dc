import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SearchInput } from '@/components/ui/search-input';
import { cn } from '@/lib/utils';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { useSecureActivityLogs, ActivityLog, ActivityStats } from '@/hooks/useSecureActivityLogs';
import { SearchableMultiSelect, MSOption } from '@/components/shared/SearchableMultiSelect';
import { format, formatDistanceToNow, startOfDay, endOfDay, subDays, isToday, isYesterday } from 'date-fns';
import { toast } from 'sonner';
import {
  Activity, RefreshCw, User, FileText, LogIn,
  GitCompare, Mail, Phone, MessageSquare, Settings, Zap, Palette,
  Download, Filter, X, Users, Handshake, FileUp, StickyNote,
  CalendarIcon, ClipboardCheck, DatabaseIcon, ChevronLeft, ChevronRight,
  ExternalLink, Copy, Bookmark, BookmarkPlus, Trash2, AlertTriangle,
  Sparkles, Rows3, Rows2, ChevronDown, Radio, Info,
} from 'lucide-react';

type ActionTone = 'success' | 'warning' | 'destructive' | 'info' | 'accent' | 'neutral';

const TONE_CLASSES: Record<ActionTone, string> = {
  success: 'dashboard-status-chip dashboard-status-chip-success max-w-full whitespace-nowrap shadow-sm shadow-success/5',
  warning: 'dashboard-status-chip dashboard-status-chip-warning max-w-full whitespace-nowrap shadow-sm shadow-warning/5',
  destructive: 'dashboard-status-chip dashboard-status-chip-destructive max-w-full whitespace-nowrap shadow-sm shadow-destructive/5',
  info: 'dashboard-status-chip dashboard-status-chip-info max-w-full whitespace-nowrap shadow-sm shadow-primary/5',
  accent: 'dashboard-status-chip dashboard-status-chip-accent max-w-full whitespace-nowrap shadow-sm shadow-primary/5',
  neutral: 'dashboard-status-chip dashboard-status-chip-neutral max-w-full whitespace-nowrap',
};

const SEVERITY_BAR: Record<ActionTone, string> = {
  success: 'bg-gradient-to-b from-success/90 via-success/70 to-success/40',
  warning: 'bg-gradient-to-b from-warning/90 via-warning/70 to-warning/40',
  destructive: 'bg-gradient-to-b from-destructive via-destructive/80 to-destructive/50 shadow-[0_0_10px_hsl(var(--destructive)/0.45)]',
  info: 'bg-gradient-to-b from-primary/80 via-primary/60 to-primary/30',
  accent: 'bg-gradient-to-b from-accent/90 via-accent/70 to-accent/40',
  neutral: 'bg-gradient-to-b from-muted-foreground/50 to-muted-foreground/20',
};

const TONE_DESCRIPTION: Record<ActionTone, string> = {
  success: 'Successful creation, completion, or activation',
  info: 'Informational update or edit',
  warning: 'Caution — config change, archive, deactivation',
  destructive: 'Deletion, removal, or revocation',
  accent: 'Branding, tagging, or visual change',
  neutral: 'Read, view, or low-signal event',
};

const ACTION_TYPE_LABELS: Record<string, { label: string; tone: ActionTone; group?: string }> = {
  // Auth
  login: { label: 'Login', tone: 'success', group: 'Auth' },
  logout: { label: 'Logout', tone: 'neutral', group: 'Auth' },
  password_reset_initiated: { label: 'Password Reset', tone: 'destructive', group: 'Auth' },
  // Reports
  report_generated: { label: 'Report Generated', tone: 'success', group: 'Reports' },
  report_regenerated: { label: 'Report Regenerated', tone: 'info', group: 'Reports' },
  report_viewed: { label: 'Report Viewed', tone: 'neutral', group: 'Reports' },
  report_edited: { label: 'Report Edited', tone: 'info', group: 'Reports' },
  report_archived: { label: 'Report Archived', tone: 'warning', group: 'Reports' },
  report_deleted: { label: 'Report Deleted', tone: 'destructive', group: 'Reports' },
  report_pdf_downloaded: { label: 'PDF Downloaded', tone: 'accent', group: 'Reports' },
  report_shared: { label: 'Report Shared', tone: 'info', group: 'Reports' },
  manual_override_applied: { label: 'Override Applied', tone: 'warning', group: 'Reports' },
  portfolio_report_generated: { label: 'Portfolio Report', tone: 'success', group: 'Reports' },
  comparison_pdf_downloaded: { label: 'Comparison PDF', tone: 'accent', group: 'Reports' },
  // Comparisons
  comparison_created: { label: 'Comparison Created', tone: 'success', group: 'Comparisons' },
  comparison_viewed: { label: 'Comparison Viewed', tone: 'neutral', group: 'Comparisons' },
  comparison_deleted: { label: 'Comparison Deleted', tone: 'destructive', group: 'Comparisons' },
  // Cash flow
  cash_flow_created: { label: 'Cash Flow Created', tone: 'success', group: 'Cash Flow' },
  cash_flow_updated: { label: 'Cash Flow Updated', tone: 'info', group: 'Cash Flow' },
  cash_flow_deleted: { label: 'Cash Flow Deleted', tone: 'destructive', group: 'Cash Flow' },
  // Email
  email_read: { label: 'Email Read', tone: 'neutral', group: 'Email' },
  email_reply_generated: { label: 'Reply Generated', tone: 'info', group: 'Email' },
  email_reply_sent: { label: 'Reply Sent', tone: 'success', group: 'Email' },
  email_linked_to_report: { label: 'Email Linked', tone: 'info', group: 'Email' },
  // Cross-portal messages
  portal_message_sent: { label: 'Portal Message Sent', tone: 'info', group: 'Messages' },
  portal_message_received: { label: 'Portal Message Received', tone: 'accent', group: 'Messages' },
  // Calls
  call_tagged: { label: 'Call Tagged', tone: 'accent', group: 'Calls' },
  alert_rule_created: { label: 'Alert Created', tone: 'info', group: 'Calls' },
  alert_rule_updated: { label: 'Alert Updated', tone: 'info', group: 'Calls' },
  alert_rule_deleted: { label: 'Alert Deleted', tone: 'destructive', group: 'Calls' },
  weekly_report_config_changed: { label: 'Config Changed', tone: 'neutral', group: 'Calls' },
  // QA
  qa_conversation_created: { label: 'QA Started', tone: 'info', group: 'QA' },
  qa_question_asked: { label: 'Question Asked', tone: 'neutral', group: 'QA' },
  qa_conversation_deleted: { label: 'QA Deleted', tone: 'destructive', group: 'QA' },
  // Automation
  automation_switch_created: { label: 'Switch Created', tone: 'success', group: 'Automation' },
  automation_switch_enabled: { label: 'Switch Enabled', tone: 'success', group: 'Automation' },
  automation_switch_disabled: { label: 'Switch Disabled', tone: 'warning', group: 'Automation' },
  automation_switch_deleted: { label: 'Switch Deleted', tone: 'destructive', group: 'Automation' },
  automation_master_toggle_changed: { label: 'Master Toggle', tone: 'warning', group: 'Automation' },
  // Templates
  template_uploaded: { label: 'Template Uploaded', tone: 'info', group: 'Templates' },
  template_activated: { label: 'Template Activated', tone: 'success', group: 'Templates' },
  template_deactivated: { label: 'Template Deactivated', tone: 'warning', group: 'Templates' },
  template_deleted: { label: 'Template Deleted', tone: 'destructive', group: 'Templates' },
  // Branding
  branding_profile_created: { label: 'Branding Created', tone: 'accent', group: 'Branding' },
  branding_profile_updated: { label: 'Branding Updated', tone: 'accent', group: 'Branding' },
  branding_profile_deleted: { label: 'Branding Deleted', tone: 'destructive', group: 'Branding' },
  // User management
  user_invited: { label: 'User Invited', tone: 'info', group: 'Users' },
  user_permissions_changed: { label: 'Permissions Changed', tone: 'warning', group: 'Users' },
  user_deactivated: { label: 'User Deactivated', tone: 'destructive', group: 'Users' },
  user_activated: { label: 'User Activated', tone: 'success', group: 'Users' },
  // Legacy white-label activity keys shown as Branding in the UI
  whitelabel_settings_updated: { label: 'Branding Updated', tone: 'accent', group: 'Branding' },
  whitelabel_logo_changed: { label: 'Logo Changed', tone: 'accent', group: 'Branding' },
  whitelabel_logo_uploaded: { label: 'Logo Uploaded', tone: 'accent', group: 'Branding' },
  whitelabel_logo_removed: { label: 'Logo Removed', tone: 'warning', group: 'Branding' },
  whitelabel_theme_changed: { label: 'Theme Changed', tone: 'accent', group: 'Branding' },
  // Bulk
  bulk_generation_started: { label: 'Bulk Started', tone: 'info', group: 'Bulk' },
  bulk_generation_completed: { label: 'Bulk Completed', tone: 'success', group: 'Bulk' },
  // General
  settings_updated: { label: 'Settings Updated', tone: 'warning', group: 'General' },
  data_exported: { label: 'Data Exported', tone: 'info', group: 'General' },
  data_imported: { label: 'Data Imported', tone: 'success', group: 'General' },
  // Clients
  client_created: { label: 'Client Created', tone: 'success', group: 'Clients' },
  client_updated: { label: 'Client Updated', tone: 'info', group: 'Clients' },
  client_deleted: { label: 'Client Deleted', tone: 'destructive', group: 'Clients' },
  client_exported: { label: 'Client Exported', tone: 'info', group: 'Clients' },
  client_file_uploaded: { label: 'File Uploaded', tone: 'info', group: 'Clients' },
  client_file_deleted: { label: 'File Deleted', tone: 'destructive', group: 'Clients' },
  client_note_added: { label: 'Note Added', tone: 'info', group: 'Clients' },
  client_tag_added: { label: 'Tag Added', tone: 'accent', group: 'Clients' },
  client_tag_removed: { label: 'Tag Removed', tone: 'neutral', group: 'Clients' },
  // Deal pipeline
  deal_created: { label: 'Deal Created', tone: 'success', group: 'Deals' },
  deal_updated: { label: 'Deal Updated', tone: 'info', group: 'Deals' },
  deal_stage_changed: { label: 'Stage Changed', tone: 'accent', group: 'Deals' },
  deal_deleted: { label: 'Deal Deleted', tone: 'destructive', group: 'Deals' },
  build_payment_updated: { label: 'Payment Updated', tone: 'info', group: 'Deals' },
  // Calendar
  appointment_created: { label: 'Appointment Created', tone: 'success', group: 'Calendar' },
  appointment_updated: { label: 'Appointment Updated', tone: 'info', group: 'Calendar' },
  appointment_deleted: { label: 'Appointment Deleted', tone: 'destructive', group: 'Calendar' },
  appointment_rescheduled: { label: 'Appointment Rescheduled', tone: 'warning', group: 'Calendar' },
  // Checklists
  checklist_generated: { label: 'Checklist Generated', tone: 'info', group: 'Checklists' },
  checklist_item_checked: { label: 'Item Checked', tone: 'success', group: 'Checklists' },
  checklist_completed: { label: 'Checklist Completed', tone: 'success', group: 'Checklists' },
  checklist_deleted: { label: 'Checklist Deleted', tone: 'destructive', group: 'Checklists' },
};

const ENTITY_TYPE_ICONS: Record<string, React.ReactNode> = {
  investment_report: <FileText className="h-4 w-4" />,
  property_comparison: <GitCompare className="h-4 w-4" />,
  cash_flow_analysis: <Activity className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  call_log: <Phone className="h-4 w-4" />,
  call_alert_rule: <Zap className="h-4 w-4" />,
  qa_conversation: <MessageSquare className="h-4 w-4" />,
  portal_message: <MessageSquare className="h-4 w-4" />,
  automation_switch: <Settings className="h-4 w-4" />,
  template: <FileText className="h-4 w-4" />,
  branding_profile: <Palette className="h-4 w-4" />,
  user: <User className="h-4 w-4" />,
  whitelabel_settings: <Settings className="h-4 w-4" />,
  bulk_generation_job: <FileText className="h-4 w-4" />,
  session: <LogIn className="h-4 w-4" />,
  system: <Settings className="h-4 w-4" />,
  client: <Users className="h-4 w-4" />,
  deal: <Handshake className="h-4 w-4" />,
  client_file: <FileUp className="h-4 w-4" />,
  client_note: <StickyNote className="h-4 w-4" />,
  appointment: <CalendarIcon className="h-4 w-4" />,
  checklist: <ClipboardCheck className="h-4 w-4" />,
  data_import: <DatabaseIcon className="h-4 w-4" />,
  portfolio_report: <FileText className="h-4 w-4" />,
};

const ENTITY_OPTIONS: MSOption[] = [
  { value: 'investment_report', label: 'Reports', group: 'Content' },
  { value: 'property_comparison', label: 'Comparisons', group: 'Content' },
  { value: 'cash_flow_analysis', label: 'Cash Flow', group: 'Content' },
  { value: 'portfolio_report', label: 'Portfolio Reports', group: 'Content' },
  { value: 'template', label: 'Templates', group: 'Content' },
  { value: 'branding_profile', label: 'Branding', group: 'Content' },
  { value: 'email', label: 'Email', group: 'Comms' },
  { value: 'call_log', label: 'Call Logs', group: 'Comms' },
  { value: 'call_alert_rule', label: 'Call Alerts', group: 'Comms' },
  { value: 'qa_conversation', label: 'QA', group: 'Comms' },
  { value: 'client', label: 'Clients', group: 'CRM' },
  { value: 'client_file', label: 'Client Files', group: 'CRM' },
  { value: 'client_note', label: 'Client Notes', group: 'CRM' },
  { value: 'deal', label: 'Deals', group: 'CRM' },
  { value: 'appointment', label: 'Appointments', group: 'CRM' },
  { value: 'checklist', label: 'Checklists', group: 'CRM' },
  { value: 'automation_switch', label: 'Automation', group: 'System' },
  { value: 'user', label: 'Users', group: 'System' },
  { value: 'session', label: 'Sessions', group: 'System' },
  { value: 'whitelabel_settings', label: 'Branding', group: 'System' },
  { value: 'data_import', label: 'Data Imports', group: 'System' },
  { value: 'bulk_generation_job', label: 'Bulk Jobs', group: 'System' },
];

const ACTION_OPTIONS: MSOption[] = Object.entries(ACTION_TYPE_LABELS).map(([value, v]) => ({
  value, label: v.label, group: v.group,
}));

// Deep-link resolver
function entityHref(entityType: string, entityId: string | null): string | null {
  if (!entityType) return null;
  switch (entityType) {
    case 'investment_report': return entityId ? `/investment-report/${entityId}` : '/reports/analytics';
    case 'property_comparison': return '/reports/analytics';
    // The workspace has an address of its own now, so a logged analysis
    // links to the property it was run against rather than to the list.
    case 'cash_flow_analysis': return entityId ? `/cash-flow-analysis/${entityId}` : '/cash-flow-analysis';
    case 'email': return '/email-copilot';
    case 'call_log':
    case 'call_alert_rule': return '/call-logs';
    case 'qa_conversation': return '/report-qa';
    case 'automation_switch': return '/automation';
    case 'template': return '/templates';
    case 'branding_profile':
    case 'whitelabel_settings': return '/white-label';
    case 'user': return '/admin/users';
    case 'client':
    case 'client_file':
    case 'client_note': return '/clients';
    case 'deal': return '/deal-pipeline';
    case 'appointment': return '/calendar';
    case 'checklist': return '/checklists';
    case 'data_import': return '/data-import';
    case 'portfolio_report': return '/portfolio-reports';
    default: return null;
  }
}

type DateRangeKey = 'all' | '24h' | '7d' | '30d' | 'custom';
type Density = 'compact' | 'comfortable';
type ExportState = 'idle' | 'working' | 'success' | 'error';
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const PRESETS_KEY = 'activityLogs.presets.v1';
const DENSITY_KEY = 'activityLogs.density.v1';
const TOOLBAR_BUTTON_CLASS = 'min-h-[44px] max-w-full rounded-xl border-border/70 bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:min-h-0';
const FILTER_CONTROL_CLASS = 'dashboard-input-control h-11 max-w-full rounded-xl border-border/70 bg-card/80 text-sm shadow-sm transition-all placeholder:text-muted-foreground/70 hover:border-primary/35 focus-visible:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 motion-reduce:transition-none';
const MENU_SURFACE_CLASS = 'max-w-[calc(100vw-2rem)] rounded-2xl border-border/70 bg-popover/95 p-2 shadow-[0_22px_60px_hsl(var(--foreground)/0.16)] backdrop-blur-xl dark:border-white/10';
const PAGINATION_BUTTON_CLASS = 'h-9 rounded-xl border-border/70 bg-card/80 px-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:hover:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0';
const LEDGER_GRID_CLASS = 'grid-cols-[180px_minmax(120px,150px)_minmax(150px,190px)_minmax(0,1fr)_minmax(110px,140px)]';

// Developer note (Phase 1 scope lock): Activity Logs UI polish only.
// Files touched: src/pages/ActivityLogs.tsx and activity-log-only TokenBalanceBanner styling.
// Data fetching, audit log filters, export, live-tail, pagination, permissions, routing,
// top-up behaviour, and backend contracts are preserved without behavioural changes.

interface FilterPreset {
  id: string;
  name: string;
  actions: string[];
  entities: string[];
  users: string[];
  dateRange: DateRangeKey;
}

function loadPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}
function savePresets(p: FilterPreset[]) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(p)); } catch {}
}

function dayLabel(d: Date): string {
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, MMM d, yyyy');
}

export default function ActivityLogs() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string[]>([]);
  const [entityFilter, setEntityFilter] = useState<string[]>([]);
  const [userFilter, setUserFilter] = useState<string[]>([]);
  const [uniqueUsers, setUniqueUsers] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<ActivityStats | null>(null);

  const [dateRange, setDateRange] = useState<DateRangeKey>('30d');
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [density, setDensity] = useState<Density>(() => {
    try { return (localStorage.getItem(DENSITY_KEY) as Density) || 'comfortable'; }
    catch { return 'comfortable'; }
  });

  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [presets, setPresets] = useState<FilterPreset[]>(() => loadPresets());
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liveTailError, setLiveTailError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ExportState>('idle');

  // Live tail
  const [liveTail, setLiveTail] = useState(false);
  const [lastTickAt, setLastTickAt] = useState<Date | null>(null);
  const [newSinceMount, setNewSinceMount] = useState(0);
  const prevTopIdRef = useRef<string | null>(null);

  const { fetchLogs: secureFetchLogs, loading } = useSecureActivityLogs();

  useEffect(() => {
    try { localStorage.setItem(DENSITY_KEY, density); } catch {}
  }, [density]);

  const { startDateISO, endDateISO } = useMemo(() => {
    const now = new Date();
    if (dateRange === 'all') return { startDateISO: undefined, endDateISO: undefined };
    if (dateRange === '24h') return { startDateISO: subDays(now, 1).toISOString(), endDateISO: undefined };
    if (dateRange === '7d') return { startDateISO: subDays(now, 7).toISOString(), endDateISO: undefined };
    if (dateRange === '30d') return { startDateISO: subDays(now, 30).toISOString(), endDateISO: undefined };
    return {
      startDateISO: customStart ? startOfDay(customStart).toISOString() : undefined,
      endDateISO: customEnd ? endOfDay(customEnd).toISOString() : undefined,
    };
  }, [dateRange, customStart, customEnd]);

  const loadLogs = useCallback(async (silent = false) => {
    const result = await secureFetchLogs({
      actionFilter: actionFilter.length ? actionFilter : undefined,
      entityFilter: entityFilter.length ? entityFilter : undefined,
      userFilter: userFilter.length ? userFilter : undefined,
      startDate: startDateISO,
      endDate: endDateISO,
      page,
      pageSize,
      includeStats: true,
    });

    if (result.error) {
      if (silent) setLiveTailError(result.error);
      if (!silent) {
        setLoadError(result.error);
        toast.error(result.error);
        setLogs([]); setUniqueUsers([]); setTotal(0); setStats(null);
      }
    } else {
      setLoadError(null);
      setLiveTailError(null);
      // Detect new events for live tail badge
      const newTopId = result.logs[0]?.id ?? null;
      if (silent && prevTopIdRef.current && newTopId && newTopId !== prevTopIdRef.current) {
        const idx = result.logs.findIndex(l => l.id === prevTopIdRef.current);
        const delta = idx === -1 ? result.logs.length : idx;
        if (delta > 0) setNewSinceMount(n => n + delta);
      }
      prevTopIdRef.current = newTopId;
      setLogs(result.logs);
      setUniqueUsers(result.uniqueUsers);
      setTotal(result.total);
      setStats(result.stats);
      setLastTickAt(new Date());
    }
  }, [secureFetchLogs, actionFilter, entityFilter, userFilter, startDateISO, endDateISO, page, pageSize]);

  useEffect(() => { setPage(1); }, [actionFilter, entityFilter, userFilter, startDateISO, endDateISO, pageSize]);
  useEffect(() => { setNewSinceMount(0); prevTopIdRef.current = null; loadLogs(); }, [loadLogs]);

  // Live tail polling — only when on page 1, no drawer open, tab visible
  useEffect(() => {
    if (!liveTail) return;
    if (page !== 1) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      if (selectedLog) return;
      loadLogs(true);
    }, 10000);
    return () => window.clearInterval(id);
  }, [liveTail, page, selectedLog, loadLogs]);

  // Client-side text search on current page
  const filteredLogs = useMemo(() => {
    if (!searchTerm) return logs;
    const q = searchTerm.toLowerCase();
    return logs.filter(log =>
      log.username?.toLowerCase().includes(q) ||
      log.entity_name?.toLowerCase().includes(q) ||
      log.action_type.toLowerCase().includes(q) ||
      log.entity_type.toLowerCase().includes(q) ||
      log.entity_id?.toLowerCase().includes(q)
    );
  }, [logs, searchTerm]);

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; rows: ActivityLog[] }>();
    for (const log of filteredLogs) {
      const d = new Date(log.created_at);
      const key = format(d, 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, { label: dayLabel(d), rows: [] });
      map.get(key)!.rows.push(log);
    }
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
  }, [filteredLogs]);

  // FlatItem defined at file scope below

  const flatItems = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = [];
    for (const g of grouped) {
      out.push({ kind: 'header', key: `h-${g.key}`, label: g.label, count: g.rows.length });
      for (const log of g.rows) out.push({ kind: 'row', key: log.id, log });
    }
    return out;
  }, [grouped]);

  const clearFilters = () => {
    setSearchTerm('');
    setActionFilter([]);
    setEntityFilter([]);
    setUserFilter([]);
    setDateRange('30d');
    setCustomStart(undefined);
    setCustomEnd(undefined);
  };

  const hasActiveFilters =
    !!searchTerm ||
    actionFilter.length > 0 ||
    entityFilter.length > 0 ||
    userFilter.length > 0 ||
    dateRange !== '30d';

  const getActionConfig = (a: string) =>
    ACTION_TYPE_LABELS[a] || { label: a.replace(/_/g, ' '), tone: 'neutral' as ActionTone };

  const getActionBadge = (a: string) => {
    const cfg = getActionConfig(a);
    return <span className={cn(TONE_CLASSES[cfg.tone], 'truncate')} title={cfg.label}>{cfg.label}</span>;
  };

  const getEntityIcon = (entityType: string) =>
    ENTITY_TYPE_ICONS[entityType] || <Activity className="h-4 w-4" />;

  const userOptions: MSOption[] = useMemo(
    () => uniqueUsers.map(u => ({ value: u, label: u })), [uniqueUsers]
  );

  // Exporters
  const downloadBlob = (content: string, mime: string, filename: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const markExportState = (state: ExportState) => {
    setExportState(state);
    if (state !== 'working') window.setTimeout(() => setExportState('idle'), 2200);
  };

  const exportCSV = () => {
    markExportState('working');
    try {
      const csv = [
        ['Timestamp', 'User', 'Action', 'Entity Type', 'Entity Name', 'Entity ID', 'IP Address'].join(','),
        ...filteredLogs.map(log => [
          log.created_at,
          log.username || 'Unknown',
          log.action_type,
          log.entity_type,
          log.entity_name || '',
          log.entity_id || '',
          log.ip_address || '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');
      downloadBlob(csv, 'text/csv', `activity-logs-page-${page}-${format(new Date(), 'yyyy-MM-dd')}.csv`);
      markExportState('success');
      toast.success(`Exported ${filteredLogs.length} rows to CSV`);
    } catch (error) {
      markExportState('error');
      toast.error(error instanceof Error ? error.message : 'Failed to export CSV');
    }
  };

  const exportJSON = () => {
    markExportState('working');
    try {
      const json = JSON.stringify(filteredLogs, null, 2);
      downloadBlob(json, 'application/json', `activity-logs-page-${page}-${format(new Date(), 'yyyy-MM-dd')}.json`);
      markExportState('success');
      toast.success(`Exported ${filteredLogs.length} rows to JSON`);
    } catch (error) {
      markExportState('error');
      toast.error(error instanceof Error ? error.message : 'Failed to export JSON');
    }
  };

  // Presets
  const applyPreset = (p: FilterPreset) => {
    setActionFilter(p.actions);
    setEntityFilter(p.entities);
    setUserFilter(p.users);
    setDateRange(p.dateRange);
    toast.success(`Applied "${p.name}"`);
  };
  const savePreset = () => {
    if (!newPresetName.trim()) return;
    const next: FilterPreset = {
      id: crypto.randomUUID(),
      name: newPresetName.trim(),
      actions: actionFilter,
      entities: entityFilter,
      users: userFilter,
      dateRange,
    };
    const updated = [...presets, next];
    setPresets(updated);
    savePresets(updated);
    setNewPresetName('');
    setPresetDialogOpen(false);
    toast.success(`Saved preset "${next.name}"`);
  };
  const deletePreset = (id: string) => {
    const updated = presets.filter(p => p.id !== id);
    setPresets(updated);
    savePresets(updated);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  const handleRowClick = (log: ActivityLog) => setSelectedLog(log);

  const copy = async (text: string, label = 'Copied') => {
    try { await navigator.clipboard.writeText(text); toast.success(label); }
    catch { toast.error('Failed to copy'); }
  };

  const compact = density === 'compact';

  const topActionLabel = stats?.topAction
    ? (ACTION_TYPE_LABELS[stats.topAction.type]?.label || stats.topAction.type.replace(/_/g, ' '))
    : null;
  const exportStatusLabel =
    exportState === 'working' ? 'Exporting' :
      exportState === 'success' ? 'Exported' :
        exportState === 'error' ? 'Export failed' :
          'Export';

  return (
    <TooltipProvider delayDuration={200}>
    <DashboardThemeFrame variant="page" className="max-w-full space-y-5 overflow-x-hidden px-0 py-0 sm:space-y-6">
      {/* Header */}
      <DashboardThemeFrame variant="hero" as="header" className="min-h-[148px] max-w-full flex flex-col gap-5 border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_32%),linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--dashboard-surface-elevated)/0.92))] sm:flex-row sm:items-center sm:justify-between dark:border-primary/20 dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.14),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.88),hsl(var(--background)/0.78))]">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Activity Logs</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Track all user actions and system events</p>
        </div>
        <DashboardThemeFrame variant="toolbar" className="w-full max-w-full shrink-0 justify-start overflow-visible border-primary/15 bg-background/80 shadow-[0_18px_48px_hsl(var(--foreground)/0.08)] sm:w-auto sm:justify-end dark:bg-background/55">
          {/* Presets */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={TOOLBAR_BUTTON_CLASS} aria-label="Open saved activity log presets">
                <Bookmark className="h-4 w-4 mr-2" />
                Presets
                {presets.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">({presets.length})</span>
                )}
                <ChevronDown className="h-3.5 w-3.5 ml-1.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} collisionPadding={16} className={cn(MENU_SURFACE_CLASS, "w-[min(20rem,calc(100vw-2rem))]")}>
              <DropdownMenuLabel className="px-2.5 py-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">Saved filter presets</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {presets.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">No saved presets yet.</div>
              ) : (
                presets.map(p => (
                  <div key={p.id} className="group flex items-center justify-between rounded-xl px-2.5 py-2 transition-colors hover:bg-primary/10 focus-within:bg-primary/10">
                    <button onClick={() => applyPreset(p)} className="min-w-0 flex-1 rounded-lg text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                      <span className="block truncate" title={p.name}>
                      {p.name}
                      </span>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {p.actions.length + p.entities.length + p.users.length} filters · {p.dateRange}
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deletePreset(p.id); }}
                      className="rounded-lg p-1 text-muted-foreground opacity-100 transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/25 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      aria-label="Delete preset"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
              <DropdownMenuSeparator className="my-2" />
              <DropdownMenuItem className="rounded-xl focus:bg-primary/10"
                onSelect={(e) => { e.preventDefault(); setPresetDialogOpen(true); }}
                disabled={!hasActiveFilters}
              >
                <BookmarkPlus className="h-4 w-4 mr-2" />
                Save current filters…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Density toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline" size="sm"
                onClick={() => setDensity(d => d === 'compact' ? 'comfortable' : 'compact')}
                className={TOOLBAR_BUTTON_CLASS}
                aria-label="Toggle density"
              >
                {compact ? <Rows3 className="h-4 w-4" /> : <Rows2 className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{compact ? 'Comfortable view' : 'Compact view'}</TooltipContent>
          </Tooltip>

          {/* Export dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={TOOLBAR_BUTTON_CLASS}
                aria-label={`Open export menu. Current export status: ${exportStatusLabel}`}
                aria-busy={exportState === 'working'}
              >
                <Download className={cn('h-4 w-4 mr-2', exportState === 'working' && 'animate-pulse')} />
                {exportStatusLabel}
                <ChevronDown className="h-3.5 w-3.5 ml-1.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} collisionPadding={16} className={cn(MENU_SURFACE_CLASS, "w-[min(18rem,calc(100vw-2rem))]")}>
              <DropdownMenuItem className="rounded-xl focus:bg-primary/10" onClick={exportCSV}>Export as CSV</DropdownMenuItem>
              <DropdownMenuItem className="rounded-xl focus:bg-primary/10" onClick={exportJSON}>Export as JSON (with metadata)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Severity legend */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={TOOLBAR_BUTTON_CLASS} aria-label="Severity legend">
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} collisionPadding={16} className={cn(MENU_SURFACE_CLASS, "w-[min(18rem,calc(100vw-2rem))] p-3")}>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Severity legend
              </div>
              <div className="space-y-2">
                {(['destructive','warning','info','success','accent','neutral'] as ActionTone[]).map(t => (
                  <div key={t} className="flex items-start gap-2.5">
                    <span className={cn('mt-0.5 w-1 h-5 rounded-full shrink-0', SEVERITY_BAR[t])} />
                    <div className="min-w-0">
                      <div className={cn('text-xs', TONE_CLASSES[t], 'inline-flex')}>{t}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{TONE_DESCRIPTION[t]}</div>
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {/* Live tail toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={liveTail ? 'default' : 'outline'} size="sm"
                onClick={() => { setLiveTail(v => !v); setNewSinceMount(0); }}
                className={cn(TOOLBAR_BUTTON_CLASS, 'relative', liveTail && 'border-success/45 bg-primary text-primary-foreground ring-2 ring-success/20 shadow-[0_16px_36px_hsl(var(--success)/0.18)] hover:bg-primary-hover hover:text-primary-foreground')}
                aria-pressed={liveTail}
                aria-label={liveTail ? 'Disable live tail polling' : 'Enable live tail polling'}
              >
                <Radio className={cn('h-4 w-4 mr-2', liveTail && !liveTailError && 'animate-pulse text-success', liveTailError && 'text-destructive')} />
                {liveTailError ? 'Live issue' : liveTail ? 'Live' : 'Live tail'}
                {liveTailError && (
                  <span className="ml-1.5 text-[10px] rounded-full bg-destructive/10 text-destructive px-1.5 py-0.5">
                    !
                  </span>
                )}
                {liveTail && !liveTailError && newSinceMount > 0 && (
                  <span className="ml-1.5 text-[10px] rounded-full bg-success/20 text-success px-1.5 py-0.5">
                    +{newSinceMount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {liveTail
                ? liveTailError
                  ? `Live tail refresh failed: ${liveTailError}`
                  : `Polling every 10s${lastTickAt ? ` · last @ ${format(lastTickAt, 'HH:mm:ss')}` : ''}${page > 1 ? ' (paused — not page 1)' : ''}`
                : 'Auto-refresh page 1 every 10s'}
            </TooltipContent>
          </Tooltip>

          <Button variant="outline" size="sm" onClick={() => loadLogs(false)} className={TOOLBAR_BUTTON_CLASS} aria-label="Refresh activity logs">
            <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
        </DashboardThemeFrame>
      </DashboardThemeFrame>

      {/* Quick Stats Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:gap-4">
        <StatTile
          label="Events today"
          value={stats?.eventsToday ?? '—'}
          icon={<Sparkles className="h-4 w-4" />}
          tone="info"
        />
        <StatTile
          label="Active users"
          value={stats?.uniqueUsers ?? '—'}
          icon={<Users className="h-4 w-4" />}
          tone="success"
          hint={stats?.sampleCapped ? 'Within sampled window' : undefined}
        />
        <StatTile
          label="Top action"
          value={topActionLabel || '—'}
          subValue={stats?.topAction ? `${stats.topAction.count} events` : undefined}
          icon={<Activity className="h-4 w-4" />}
          tone="accent"
          truncate
        />
        <StatTile
          label="Destructive actions"
          value={stats?.failures ?? '—'}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={stats && stats.failures > 0 ? 'destructive' : 'neutral'}
        />
      </div>

      {/* Filters */}
      <Card className="dashboard-panel overflow-visible border-primary/10 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--dashboard-surface-elevated)/0.88))]">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
              <Filter className="h-4 w-4" />
            </span>
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <SearchInput
              value={searchTerm}
              onValueChange={setSearchTerm}
              aria-label="Search activity logs on this page"
              placeholder="Search this page..."
              containerClassName="lg:col-span-2"
              className={cn(FILTER_CONTROL_CLASS, "pl-10")}
            />

            <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRangeKey)}>
              <SelectTrigger className={FILTER_CONTROL_CLASS} aria-label="Activity log date range"><SelectValue placeholder="Date range" /></SelectTrigger>
              <SelectContent collisionPadding={16} className={MENU_SURFACE_CLASS}>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>

            <SearchableMultiSelect
              label="Actions"
              placeholder="All actions"
              searchPlaceholder="Search 60+ actions…"
              options={ACTION_OPTIONS}
              selected={actionFilter}
              onChange={setActionFilter}
              icon={<Zap className="h-4 w-4 text-muted-foreground" />}
              className={FILTER_CONTROL_CLASS}
              width="w-[min(300px,calc(100vw-2rem))]"
            />

            <SearchableMultiSelect
              label="Entities"
              placeholder="All entities"
              options={ENTITY_OPTIONS}
              selected={entityFilter}
              onChange={setEntityFilter}
              icon={<DatabaseIcon className="h-4 w-4 text-muted-foreground" />}
              className={FILTER_CONTROL_CLASS}
              width="w-[min(280px,calc(100vw-2rem))]"
            />

            <SearchableMultiSelect
              label="Users"
              placeholder="All users"
              options={userOptions}
              selected={userFilter}
              onChange={setUserFilter}
              icon={<User className="h-4 w-4 text-muted-foreground" />}
              className={FILTER_CONTROL_CLASS}
              width="w-[min(280px,calc(100vw-2rem))]"
            />
          </div>

          {dateRange === 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn(FILTER_CONTROL_CLASS, "justify-start")} aria-label="Choose activity log start date">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {customStart ? format(customStart, 'PP') : 'Start date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className={cn(MENU_SURFACE_CLASS, "w-auto p-0")} align="start" sideOffset={8} collisionPadding={16}>
                  <Calendar mode="single" selected={customStart} onSelect={setCustomStart}
                    initialFocus className={cn('p-3 pointer-events-auto')} />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground text-sm">to</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn(FILTER_CONTROL_CLASS, "justify-start")} aria-label="Choose activity log end date">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {customEnd ? format(customEnd, 'PP') : 'End date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className={cn(MENU_SURFACE_CLASS, "w-auto p-0")} align="start" sideOffset={8} collisionPadding={16}>
                  <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd}
                    initialFocus className={cn('p-3 pointer-events-auto')} />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {hasActiveFilters && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-3 py-2">
              <span className="text-sm text-muted-foreground">
                Showing {filteredLogs.length} of {total} matching events
              </span>
              <Button variant="ghost" size="sm" onClick={clearFilters} className="rounded-xl hover:bg-primary/10">
                <X className="h-4 w-4 mr-1" />
                Clear filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity */}
      <Card className="dashboard-panel overflow-hidden border-primary/10" aria-busy={loading}>
        <CardHeader className="border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--card)/0.95),hsl(var(--muted)/0.20))]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>
                {loading
                  ? 'Loading...'
                  : total === 0
                    ? 'No activities'
                    : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
              </CardDescription>
            </div>
            {!loading && total > 0 && (
              <span className="w-fit rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm" aria-live="polite">
                {rangeStart}–{rangeEnd} / {total}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-4">
          {loading ? (
            <div className="h-[640px] space-y-3 rounded-2xl border border-border/50 bg-card/35 p-4" role="status" aria-label="Loading activity logs">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-2xl" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-full max-w-[260px]" />
                    <Skeleton className="h-3 w-full max-w-[180px]" />
                  </div>
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="flex h-[640px] flex-col items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/5 px-6 py-12 text-center">
              <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-destructive" />
              <p className="font-semibold text-destructive">Unable to load activity logs</p>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => loadLogs(false)} className="mt-4 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive">
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                Retry
              </Button>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground h-[640px] flex flex-col items-center justify-center rounded-2xl border border-border/50 bg-card/35 px-6">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium text-foreground">{searchTerm ? 'No results match this page search' : 'No activity logs found'}</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {searchTerm
                  ? 'Try a different search term or clear filters to review the current audit page.'
                  : hasActiveFilters
                    ? 'No activity logs match the selected filters.'
                    : 'Activity will appear here when audit events are available.'}
              </p>
              {hasActiveFilters && (
                <Button variant="link" size="sm" onClick={clearFilters} className="mt-2">
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Mobile — virtualized */}
              <div className="sm:hidden">
                <VirtualLogList
                  items={flatItems}
                  variant="mobile"
                  compact={compact}
                  onRowClick={handleRowClick}
                  getActionConfig={getActionConfig}
                  getActionBadge={getActionBadge}
                  getEntityIcon={getEntityIcon}
                />
              </div>

              {/* Desktop — virtualized */}
              <div className="hidden overflow-x-auto sm:block [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin]">
                {/* Sticky column header */}
                <div className={cn("sticky top-0 z-10 grid min-w-[760px] gap-3 rounded-t-2xl border border-border/70 bg-card/95 px-4 h-12 items-center text-xs font-semibold text-muted-foreground uppercase tracking-[0.14em] shadow-sm backdrop-blur", LEDGER_GRID_CLASS)}>
                  <div>Timestamp</div>
                  <div>User</div>
                  <div>Action</div>
                  <div>Entity</div>
                  <div>IP Address</div>
                </div>
                <VirtualLogList
                  items={flatItems}
                  variant="desktop"
                  compact={compact}
                  onRowClick={handleRowClick}
                  getActionConfig={getActionConfig}
                  getActionBadge={getActionBadge}
                  getEntityIcon={getEntityIcon}
                />
              </div>
            </>
          )}

          {/* Pagination */}
          {!loading && total > 0 && (
            <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/55 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Rows per page</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className={cn(FILTER_CONTROL_CLASS, "h-9 w-[84px]")} aria-label="Rows per page"><SelectValue /></SelectTrigger>
                  <SelectContent collisionPadding={16} className={MENU_SURFACE_CLASS}>
                    {PAGE_SIZE_OPTIONS.map(n => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs font-medium text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button variant="outline" size="sm" className={PAGINATION_BUTTON_CLASS} disabled={page <= 1} onClick={() => setPage(1)} aria-label="First activity log page">First</Button>
                <Button variant="outline" size="sm" className={cn(PAGINATION_BUTTON_CLASS, "w-9 px-0")} disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label="Previous activity log page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className={cn(PAGINATION_BUTTON_CLASS, "w-9 px-0")} disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} aria-label="Next activity log page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" className={PAGINATION_BUTTON_CLASS} disabled={page >= totalPages} onClick={() => setPage(totalPages)} aria-label="Last activity log page">Last</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Preset Dialog (lightweight popover) */}
      {presetDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm dark:bg-background/80"
          onClick={() => setPresetDialogOpen(false)}
        >
          <Card className="dashboard-panel w-full max-w-sm max-h-[calc(100vh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BookmarkPlus className="h-4 w-4" /> Save filter preset
              </CardTitle>
              <CardDescription>
                Captures current actions, entities, users, and date range.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                autoFocus
                placeholder="e.g. Today's failures"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
                className={FILTER_CONTROL_CLASS}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPresetDialogOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={savePreset} disabled={!newPresetName.trim()}>Save</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Detail Drawer */}
      <Sheet open={!!selectedLog} onOpenChange={(o) => !o && setSelectedLog(null)}>
        <SheetContent className="w-full max-w-[calc(100vw-1rem)] overflow-y-auto border-border bg-card text-card-foreground sm:max-w-lg">
          {selectedLog && (() => {
            const cfg = getActionConfig(selectedLog.action_type);
            const href = entityHref(selectedLog.entity_type, selectedLog.entity_id);
            return (
              <>
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <span className="text-muted-foreground">{getEntityIcon(selectedLog.entity_type)}</span>
                    <span className="truncate" title={selectedLog.entity_name || selectedLog.entity_type.replace(/_/g, ' ')}>{selectedLog.entity_name || selectedLog.entity_type.replace(/_/g, ' ')}</span>
                  </SheetTitle>
                  <SheetDescription className="flex flex-wrap items-center gap-2">
                    <span className={TONE_CLASSES[cfg.tone]} title={cfg.label}>{cfg.label}</span>
                    <span className="text-xs">{format(new Date(selectedLog.created_at), 'PPpp')}</span>
                  </SheetDescription>
                </SheetHeader>

                <div className="mt-6 space-y-5 text-sm">
                  <DetailRow label="When">
                    <div>{format(new Date(selectedLog.created_at), 'EEE, MMM d, yyyy · HH:mm:ss')}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(selectedLog.created_at), { addSuffix: true })}
                    </div>
                  </DetailRow>

                  <DetailRow label="User">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate" title={selectedLog.username || 'Unknown'}>{selectedLog.username || 'Unknown'}</span>
                    </div>
                    {selectedLog.user_id && (
                      <CopyableMono value={selectedLog.user_id} onCopy={copy} />
                    )}
                  </DetailRow>

                  <DetailRow label="Entity">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{getEntityIcon(selectedLog.entity_type)}</span>
                        <span className="font-medium truncate" title={selectedLog.entity_name || selectedLog.entity_type.replace(/_/g, ' ')}>
                          {selectedLog.entity_name || selectedLog.entity_type.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {selectedLog.entity_type.replace(/_/g, ' ')}
                      </div>
                      {selectedLog.entity_id && (
                        <CopyableMono value={selectedLog.entity_id} onCopy={copy} />
                      )}
                      {href && (
                        <Button
                          size="sm" variant="outline" className="mt-2 rounded-xl border-primary/25 text-primary hover:bg-primary/10 hover:text-primary"
                          onClick={() => { navigate(href); setSelectedLog(null); }}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          Open {selectedLog.entity_type.replace(/_/g, ' ')}
                        </Button>
                      )}
                    </div>
                  </DetailRow>

                  {(selectedLog.ip_address || selectedLog.user_agent) && (
                    <DetailRow label="Session">
                      {selectedLog.ip_address && (
                        <div className="inline-flex max-w-full rounded-lg border border-border/60 bg-muted/35 px-2 py-1 text-xs font-mono text-muted-foreground" title={selectedLog.ip_address}>IP {selectedLog.ip_address}</div>
                      )}
                      {selectedLog.user_agent && (
                        <div className="text-xs text-muted-foreground break-words">
                          {selectedLog.user_agent}
                        </div>
                      )}
                    </DetailRow>
                  )}

                  {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                    <DetailRow label="Metadata">
                      <pre className="text-[11px] bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words border border-border/50">
                        {JSON.stringify(selectedLog.metadata, null, 2)}
                      </pre>
                      <Button
                        size="sm" variant="ghost" className="mt-2"
                        onClick={() => copy(JSON.stringify(selectedLog.metadata, null, 2), 'Metadata copied')}
                      >
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        Copy JSON
                      </Button>
                    </DetailRow>
                  )}
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </DashboardThemeFrame>
    </TooltipProvider>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function CopyableMono({ value, onCopy }: { value: string; onCopy: (v: string, l?: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(value, 'ID copied')}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/60 bg-muted/35 px-2 py-1 text-xs font-mono text-muted-foreground transition-colors hover:border-primary/25 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
    >
      <span className="truncate max-w-[280px]">{value}</span>
      <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

const STAT_TONE: Record<string, { ring: string; icon: string; value: string; glow: string; bar: string }> = {
  info: {
    ring: 'ring-primary/20 border-primary/20',
    icon: 'text-primary bg-primary/10 border-primary/20 shadow-primary/10',
    value: 'text-foreground',
    glow: 'bg-primary/12',
    bar: 'from-primary/70 via-primary/40 to-transparent',
  },
  success: {
    ring: 'ring-success/25 border-success/25',
    icon: 'text-success bg-success/10 border-success/25 shadow-success/10',
    value: 'text-foreground',
    glow: 'bg-success/12',
    bar: 'from-success/75 via-success/40 to-transparent',
  },
  accent: {
    ring: 'ring-primary/25 border-primary/25',
    icon: 'text-primary bg-primary/10 border-primary/25 shadow-primary/10',
    value: 'text-foreground',
    glow: 'bg-primary/12',
    bar: 'from-primary/75 via-primary/40 to-transparent',
  },
  destructive: {
    ring: 'ring-destructive/25 border-destructive/30',
    icon: 'text-destructive bg-destructive/10 border-destructive/25 shadow-destructive/10',
    value: 'text-destructive',
    glow: 'bg-destructive/10',
    bar: 'from-destructive/75 via-destructive/40 to-transparent',
  },
  neutral: {
    ring: 'ring-border border-border/70',
    icon: 'text-muted-foreground bg-muted/45 border-border/70 shadow-muted/10',
    value: 'text-foreground',
    glow: 'bg-muted/35',
    bar: 'from-muted-foreground/35 via-muted-foreground/15 to-transparent',
  },
};

function StatTile({
  label, value, subValue, icon, tone = 'neutral', hint, truncate,
}: {
  label: string;
  value: React.ReactNode;
  subValue?: string;
  icon: React.ReactNode;
  tone?: 'info' | 'success' | 'accent' | 'destructive' | 'neutral';
  hint?: string;
  truncate?: boolean;
}) {
  const t = STAT_TONE[tone];
  return (
    <Card className={cn('dashboard-kpi-card group min-h-[138px] ring-1 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_54px_-34px_hsl(var(--primary)/0.48)] motion-reduce:transition-none motion-reduce:hover:translate-y-0', t.ring)}>
      <div className={cn('pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r', t.bar)} />
      <div className={cn('pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full blur-3xl transition-opacity duration-300 group-hover:opacity-90 motion-reduce:transition-none', t.glow)} />
      <CardContent className="relative flex h-full min-h-[138px] flex-col justify-between p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
            <div className={cn(
              'font-bold text-3xl leading-none tracking-tight sm:text-[2rem]',
              t.value,
              truncate && 'truncate'
            )}>
              {value}
            </div>
          </div>
          <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-sm transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100', t.icon)}>{icon}</div>
        </div>
        <div className="min-h-5 pt-3">
          {subValue && <div className="text-xs font-medium text-muted-foreground">{subValue}</div>}
          {hint && <div className="text-[10px] text-muted-foreground/70 italic">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

type FlatItem =
  | { kind: 'header'; key: string; label: string; count: number }
  | { kind: 'row'; key: string; log: ActivityLog };

interface VirtualLogListProps {
  items: FlatItem[];
  variant: 'desktop' | 'mobile';
  compact: boolean;
  onRowClick: (log: ActivityLog) => void;
  getActionConfig: (a: string) => { label: string; tone: ActionTone };
  getActionBadge: (a: string) => React.ReactNode;
  getEntityIcon: (e: string) => React.ReactNode;
}

function VirtualLogList({
  items, variant, compact, onRowClick, getActionConfig, getActionBadge, getEntityIcon,
}: VirtualLogListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const estimate = (idx: number) => {
    const it = items[idx];
    if (!it) return 56;
    if (it.kind === 'header') return 40;
    if (variant === 'mobile') return compact ? 64 : 76;
    return compact ? 52 : 72;
  };

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimate,
    overscan: 12,
    getItemKey: (i) => items[i]?.key ?? i,
  });

  return (
    <div
      ref={parentRef}
      role="region"
      aria-label={variant === 'desktop' ? 'Activity log table results' : 'Activity log mobile results'}
      tabIndex={0}
      className={cn(
        'overflow-auto contain-strict focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin]',
        variant === 'desktop'
          ? 'h-[640px] min-w-[760px] rounded-b-2xl border border-t-0 border-border/70 bg-card/35'
          : 'h-[640px] rounded-2xl border border-border/60 bg-card/35'
      )}
    >
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}
      >
        {virtualizer.getVirtualItems().map(v => {
          const item = items[v.index];
          if (!item) return null;
          return (
            <div
              key={v.key}
              data-index={v.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%',
                transform: `translateY(${v.start}px)`,
              }}
            >
              {item.kind === 'header' ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border/50 bg-muted/35 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span className="truncate">{item.label}</span>
                  <span className="rounded-full border border-border/50 bg-card/60 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground/80">
                    {item.count} {item.count === 1 ? 'event' : 'events'}
                  </span>
                </div>
              ) : variant === 'desktop' ? (
                <DesktopRow
                  log={item.log}
                  compact={compact}
                  cfg={getActionConfig(item.log.action_type)}
                  badge={getActionBadge(item.log.action_type)}
                  entityIcon={getEntityIcon(item.log.entity_type)}
                  onClick={() => onRowClick(item.log)}
                />
              ) : (
                <MobileRow
                  log={item.log}
                  compact={compact}
                  cfg={getActionConfig(item.log.action_type)}
                  badge={getActionBadge(item.log.action_type)}
                  entityIcon={getEntityIcon(item.log.entity_type)}
                  onClick={() => onRowClick(item.log)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DesktopRow({
  log, compact, cfg, badge, entityIcon, onClick,
}: {
  log: ActivityLog;
  compact: boolean;
  cfg: { label: string; tone: ActionTone };
  badge: React.ReactNode;
  entityIcon: React.ReactNode;
  onClick: () => void;
}) {
  const href = entityHref(log.entity_type, log.entity_id);
  const userLabel = log.username || 'Unknown';
  const entityLabel = log.entity_name || log.entity_type.replace(/_/g, ' ');
  const timestampTitle = format(new Date(log.created_at), 'PPpp');

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View activity details for ${cfg.label} by ${userLabel} on ${entityLabel}`}
      className={cn(
        'group/row w-full text-left grid gap-3 px-4 items-center',
        LEDGER_GRID_CLASS,
        'relative border-b border-border/40 bg-card/20 transition-colors hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 motion-reduce:transition-none',
        compact ? 'py-2' : 'py-3'
      )}
    >
      <span className={cn('absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r', SEVERITY_BAR[cfg.tone])} />
      <div className="pl-2 font-mono text-xs min-w-0" title={timestampTitle}>
        <div className="font-semibold text-foreground">{format(new Date(log.created_at), 'HH:mm:ss')}</div>
        {!compact && (
          <div className="text-muted-foreground truncate">
            {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <User className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium text-sm truncate" title={userLabel}>{userLabel}</span>
      </div>
      <div className="min-w-0 overflow-hidden">{badge}</div>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-muted-foreground shrink-0 transition-colors group-hover/row:text-primary">{entityIcon}</span>
        <div className="min-w-0 overflow-hidden">
          <div className="text-sm font-medium truncate flex items-center gap-1.5 transition-colors group-hover/row:text-primary" title={entityLabel}>
            {entityLabel}
            {href && <ExternalLink className="h-3 w-3 shrink-0 text-primary/70" />}
          </div>
          {!compact && log.entity_id && (
            <div className="mt-1 inline-flex max-w-full rounded-md bg-muted/35 px-1.5 py-0.5 text-xs font-mono text-muted-foreground" title={log.entity_id}>
              <span className="truncate">{log.entity_id.slice(0, 8)}…</span>
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <span className="inline-flex max-w-full rounded-md bg-muted/35 px-1.5 py-0.5 text-xs font-mono text-muted-foreground" title={log.ip_address || undefined}>
          <span className="truncate">{log.ip_address || '-'}</span>
        </span>
      </div>
    </button>
  );
}

function MobileRow({
  log, compact, cfg, badge, entityIcon, onClick,
}: {
  log: ActivityLog;
  compact: boolean;
  cfg: { label: string; tone: ActionTone };
  badge: React.ReactNode;
  entityIcon: React.ReactNode;
  onClick: () => void;
}) {
  const userLabel = log.username || 'Unknown';
  const entityLabel = log.entity_name || log.entity_type.replace(/_/g, ' ');

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View activity details for ${cfg.label} by ${userLabel} on ${entityLabel}`}
      className={cn(
        'group/row w-full text-left flex gap-3 items-start hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 transition-colors motion-reduce:transition-none px-3 border-b border-border/40 bg-card/20',
        compact ? 'py-2' : 'py-3'
      )}
    >
      <span className={cn('mt-1 w-1 self-stretch rounded-full', SEVERITY_BAR[cfg.tone])} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground shrink-0 transition-colors group-hover/row:text-primary">{entityIcon}</span>
            <span className="font-medium text-sm truncate transition-colors group-hover/row:text-primary" title={entityLabel}>
              {entityLabel}
            </span>
          </div>
          <span className="min-w-0 max-w-[46%] overflow-hidden">{badge}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5 truncate" title={userLabel}><User className="h-3 w-3 shrink-0" />{userLabel}</span>
          <span className="shrink-0 font-mono">{format(new Date(log.created_at), 'HH:mm:ss')}</span>
        </div>
        {(log.entity_id || log.ip_address) && (
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 rounded-md bg-muted/35 px-1.5 py-0.5 font-mono" title={log.entity_id || undefined}><span className="block truncate">{log.entity_id ? `${log.entity_id.slice(0, 8)}…` : '—'}</span></span>
            <span className="max-w-[48%] shrink-0 truncate rounded-md bg-muted/35 px-1.5 py-0.5 font-mono" title={log.ip_address || undefined}>{log.ip_address || '-'}</span>
          </div>
        )}
      </div>
    </button>
  );
}
