import { useState, useEffect } from 'react';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { cn } from '@/lib/utils';
import {
  Users,
  Upload,
  Search,
  Building2,
  DollarSign,
  TrendingUp,
  RefreshCw,
  Loader2,
  Download,
  Trash2,
  Zap,
  Star,
  ExternalLink,
  Target,
  UserPlus,
  MoreHorizontal
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { SearchInput } from '@/components/ui/search-input';
import { ExcelDropzone } from '@/components/clients/ExcelDropzone';
import { ResetClientJourneyDialog } from '@/components/aml/ResetClientJourneyDialog';
import { amlCasesApi } from '@/lib/aml/amlCasesApi';
import { ClientCard } from '@/components/clients/ClientCard';
import { ClientDetailsModal } from '@/components/clients/ClientDetailsModal';
import { ClientFilters, ClientFiltersState, defaultFilters } from '@/components/clients/ClientFilters';
import { ClientBulkActions } from '@/components/clients/ClientBulkActions';
import { ClientAnalyticsDashboard } from '@/components/clients/ClientAnalyticsDashboard';
import { ClientComparison } from '@/components/clients/ClientComparison';
import { PortfolioAnalysisReportsList } from '@/components/clients/PortfolioAnalysisReportsList';
import { AddClientModal } from '@/components/clients/AddClientModal';
import { GHLExportDialog } from '@/components/shared/GHLExportDialog';
import { toast } from 'sonner';
import { invalidateClientQueries } from '@/lib/clients/invalidateClientQueries';
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

interface Client {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  primary_email: string | null;
  primary_mobile: string | null;
  secondary_first_name: string | null;
  secondary_surname: string | null;
  ghl_contact_id: string | null;
  ghl_sync_status: string | null;
  total_portfolio_value: number;
  total_debt: number;
  net_monthly_cash_flow: number;
  created_at: string;
  /** Real active status (clients.is_active) — set via AML/CTF activation. */
  is_active?: boolean | null;
  /** Starred/favourite flag — a separate concept from active status. */
  is_favorite?: boolean;
  client_properties?: { id: string }[];
  pipeline_status?: string | null;
  follow_up_date?: string | null;
  next_review_due?: string | null;
  review_frequency?: string | null;
  last_review_date?: string | null;
}

const AUTO_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * KPI tones.
 *
 * Semantic tokens only — the dashboard is white-labelled, so a tile has to
 * re-colour with the brand rather than carry a palette of its own.
 */
const KPI_TONE = {
  accent: {
    icon: 'border-primary/25 bg-primary/10 text-primary',
    bar: 'from-primary/70 via-primary/25 to-transparent',
    value: 'text-foreground',
  },
  info: {
    icon: 'border-info/25 bg-info/10 text-info',
    bar: 'from-info/70 via-info/25 to-transparent',
    value: 'text-foreground',
  },
  success: {
    icon: 'border-success/25 bg-success/10 text-success',
    bar: 'from-success/70 via-success/25 to-transparent',
    value: 'text-foreground',
  },
  warning: {
    icon: 'border-warning/30 bg-warning/10 text-warning',
    bar: 'from-warning/70 via-warning/25 to-transparent',
    value: 'text-warning',
  },
  neutral: {
    icon: 'border-border/70 bg-muted/50 text-muted-foreground',
    bar: 'from-muted-foreground/30 via-muted-foreground/10 to-transparent',
    value: 'text-foreground',
  },
} as const;

// Smart capitalization for names from GHL (often lowercase)
function smartCapitalize(name: string | null | undefined): string {
  if (!name) return '';
  
  // Handle already properly capitalized names
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) {
    return name;
  }
  
  return name
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((part, index, arr) => {
      // Keep separators as-is
      if (/^(\s+|-|')$/.test(part)) return part;
      
      // Handle special prefixes like Mc, Mac, O'
      if (part.startsWith('mc') && part.length > 2) {
        return 'Mc' + part.charAt(2).toUpperCase() + part.slice(3);
      }
      if (part.startsWith('mac') && part.length > 3) {
        return 'Mac' + part.charAt(3).toUpperCase() + part.slice(4);
      }
      
      // Standard capitalization
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

export default function ClientManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [deepLinkTab, setDeepLinkTab] = useState<string | undefined>(undefined);
  const [deepLinkDealId, setDeepLinkDealId] = useState<string | undefined>(undefined);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [clientToReset, setClientToReset] = useState<Client | null>(null);
  const [filters, setFilters] = useState<ClientFiltersState>(defaultFilters);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [isImportingFromGHL, setIsImportingFromGHL] = useState(false);
  const [importProgress, setImportProgress] = useState<{ imported: number; hasMore: boolean; totalFromApi?: number } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [hasAutoSynced, setHasAutoSynced] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const queryClient = useQueryClient();
  const { canEdit: canEditClients, canDelete: canDeleteClients } = useModulePermissions('clients');

  // Fetch clients with property count via secure Edge Function (HttpOnly cookies)
  const { data: clients = [], isLoading, refetch } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction<{ success: boolean; clients: Client[] }>('get-client-data', {
        listMode: true,
        listOptions: {
          select: '*',
          orderBy: 'created_at',
          orderAsc: false,
          includePropertyCount: true,
        },
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error('Failed to fetch clients');
      return data.clients as Client[];
    }
  });

  // Deep-link: auto-open client modal or apply filter from query params
  useEffect(() => {
    const clientId = searchParams.get('clientId');
    const tab = searchParams.get('tab');
    const dealId = searchParams.get('dealId');
    const filterParam = searchParams.get('filter');

    // Handle reviews_due filter deep-link from Overview widget
    if (filterParam === 'reviews_due' && !isLoading) {
      // Show all clients with any review due (overdue + upcoming within 30 days)
      setFilters(prev => ({ ...prev, reviewStatus: 'upcoming' as const }));
      setTimeout(() => setSearchParams({}, { replace: true }), 100);
      return;
    }

    if (!clientId || isLoading || clients.length === 0) return;

    const target = clients.find(c => c.id === clientId);
    if (target) {
      setSelectedClient(target);
      setDeepLinkTab(tab || undefined);
      setDeepLinkDealId(dealId || undefined);
      setShowDetailsModal(true);
    }
    // Clean URL
    setSearchParams({}, { replace: true });
  }, [clients, isLoading, searchParams]);

  // Fetch GHL Location ID via edge function
  const { data: ghlLocationId } = useQuery({
    queryKey: ['ghl-location-id'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('check-integration-secrets', {
        integrationId: 'gohighlevel'
      });
      
      if (error || !data?.configured) {
        console.error('GHL not configured:', error);
        return null;
      }
      // The location ID is stored as GOHIGHLEVEL_LOCATION_ID env var
      // We need to get it from a different source - check if it was returned
      return data?.locationId || null;
    },
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });

  // Auto-sync from GHL on first load if no clients exist
  useEffect(() => {
    if (!isLoading && clients.length === 0 && !hasAutoSynced && !isImportingFromGHL) {
      setHasAutoSynced(true);
      handleImportFromGHL();
    }
  }, [isLoading, clients.length, hasAutoSynced, isImportingFromGHL]);

  // Periodic auto-sync from GHL
  useEffect(() => {
    if (!autoSyncEnabled) return;

    const performAutoSync = async () => {
      if (isImportingFromGHL || isAutoSyncing) return;
      
      setIsAutoSyncing(true);
      try {
        /*
         * NO `maxPages` HERE ANY MORE.
         *
         * It used to ask for five, and GHL's page is a hundred — so this asked
         * for exactly 500 contacts, from the start of the list, every five
         * minutes, for ever. It carries no cursor, so it was not even a
         * freshness nudge: it re-walked the SAME first 500 each time.
         *
         * Measured 13 Sep 2026: the NPC Client Dashboard held exactly 500
         * clients against 776 in the same GHL location on the prime, and
         * nothing else on that deployment ever imported a contact. The
         * conversation sync follows contacts, so the same 276 were ~960
         * missing conversations too.
         *
         * The function's own wall-clock budget is the stop now, and it reports
         * an unfinished walk rather than presenting one as complete. A
         * scheduled full walk runs independently of whether anybody has this
         * page open.
         */
        const { data, error } = await invokeSecureFunction<any>('import-clients-from-ghl', {
          clearExisting: false,
        });

        if (!error && data?.success) {
          setLastSyncTime(new Date());
          refetch();
          if (data.stats?.imported > 0) {
            toast.success(`Auto-sync: ${data.stats.imported} clients updated`, { duration: 3000 });
          }
          if (data.hasMore) {
            console.warn(
              `[ClientManagement] auto-sync stopped with more to fetch ` +
                `(pages=${data.stats?.pagesProcessed}, budget=${data.stoppedOnBudget === true}); ` +
                'the scheduled import continues from here.',
            );
          }
        }
      } catch (err) {
        console.error('Auto-sync error:', err);
      } finally {
        setIsAutoSyncing(false);
      }
    };

    // Initial sync on mount
    performAutoSync();

    // Set up interval
    const intervalId = setInterval(performAutoSync, AUTO_SYNC_INTERVAL);

    return () => clearInterval(intervalId);
  }, [autoSyncEnabled, isImportingFromGHL]);

  // Import clients from GHL with auto-resume for large datasets
  const handleImportFromGHL = async (
    clearExisting = false,
    resumeFromId: string | null = null,
    resumeFrom: number | null = null,
  ) => {
    setIsImportingFromGHL(true);

    if (!resumeFromId && resumeFrom === null) {
      setImportProgress({ imported: 0, hasMore: true });
    }

    try {
      let totalImported = importProgress?.imported || 0;
      let nextResumeId: string | null = resumeFromId;
      let nextResume: number | null = resumeFrom;
      let isFirstBatch = !resumeFromId && resumeFrom === null;

      // Loop to fetch all batches automatically
      do {
        const { data, error } = await invokeSecureFunction('import-clients-from-ghl', {
          clearExisting: isFirstBatch ? clearExisting : false,
          resumeFromId: nextResumeId,
          resumeFrom: nextResume,
          maxPages: 10, // Process 10 pages (1000 contacts) per batch to avoid timeouts
        });

        if (error) throw error;

        if (data?.success) {
          const importedThisBatch = data.stats?.imported || 0;
          totalImported += importedThisBatch;

          setImportProgress((prev) => ({
            imported: totalImported,
            hasMore: !!data.hasMore,
            totalFromApi: prev?.totalFromApi ?? data.stats?.totalFromApi,
          }));

          if (data.hasMore) {
            nextResumeId = data.nextResumeId ?? null;
            nextResume = typeof data.nextResume === 'number' ? data.nextResume : null;
            isFirstBatch = false;

            // If the API isn't providing a cursor, stop (prevents UI from looping forever)
            if (!nextResumeId && nextResume === null) {
              console.warn('Import indicated hasMore=true but no resume cursor was provided; stopping.');
              break;
            }
          } else {
            nextResumeId = null;
            nextResume = null;
            toast.success(`Import complete! ${totalImported} clients imported from GHL.`);
          }

          // Refresh the client list after each batch
          refetch();
        } else {
          throw new Error(data?.error || 'Import failed');
        }
      } while (nextResumeId || nextResume !== null);
    } catch (err: any) {
      console.error('GHL import error:', err);
      toast.error('Failed to import from GHL: ' + (err.message || 'Unknown error'));
    } finally {
      setIsImportingFromGHL(false);
      setImportProgress(null);
      setShowClearConfirm(false);
    }
  };

  // Clear all clients and reimport
  const handleClearAndReimport = () => {
    setShowClearConfirm(true);
  };

  const confirmClearAndReimport = () => {
    handleImportFromGHL(true);
  };

  /*
   * Which clients carry an AML/CTF case.
   *
   * Read from the AML API rather than inferred from anything on the client
   * row — there is no flag on `clients` that means "has a case", and adding
   * one would be a second source of truth for something the case table
   * already answers.
   *
   * Fails SOFT to an empty set. A user without AML permissions gets a 403
   * here, and that must leave the ordinary delete working rather than
   * blocking the page; the server refuses an orphaning delete on its own
   * regardless of what this set says.
   */
  const { data: amlClientIds = new Set<string>() } = useQuery({
    queryKey: ['aml-case-client-ids'],
    queryFn: async () => {
      try {
        const r = await amlCasesApi.list({ limit: 500 });
        return new Set((r.cases ?? []).map((c) => c.client_id).filter((id): id is string => !!id));
      } catch {
        return new Set<string>();
      }
    },
    staleTime: 60_000,
  });

  // Delete client mutation via secure Edge Function (HttpOnly cookies)
  const deleteClientMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'clients',
        clientId,
      });
      
      if (error) throw new Error(error.message);
      // Surface the server's reason (e.g. a record still referencing this client)
      // rather than a generic failure the user cannot act on.
      if (!data?.success) {
        const detail = (data as any)?.details;
        throw new Error([data?.error || 'Failed to delete client', detail].filter(Boolean).join(' — '));
      }
    },
    onSuccess: () => {
      // A deleted client has no record left to refresh; the lists that showed
      // it do. `invalidateClientQueries` with no id invalidates exactly those.
      invalidateClientQueries(queryClient, null);
      toast.success('Client deleted successfully');
      setClientToDelete(null);
    },
    onError: (error) => {
      toast.error('Failed to delete client: ' + error.message);
    }
  });

  // Apply filters
  const filteredClients = clients.filter(client => {
    // Starred filter — is_favorite is the star flag only; it is NOT the
    // client's active status (that is clients.is_active, set via AML/CTF
    // activation and shown on the client record).
    if (showStarredOnly && !client.is_favorite) return false;

    // Search filter
    const searchLower = searchQuery.toLowerCase();
    const fullName = `${client.primary_first_name} ${client.primary_surname}`.toLowerCase();
    const email = client.primary_email?.toLowerCase() || '';
    const matchesSearch = fullName.includes(searchLower) || email.includes(searchLower);
    if (!matchesSearch) return false;

    // Portfolio value filter
    const portfolioValue = Number(client.total_portfolio_value) || 0;
    if (filters.portfolioMin !== null && portfolioValue < filters.portfolioMin) return false;
    if (filters.portfolioMax !== null && portfolioValue > filters.portfolioMax) return false;

    // Cash flow status filter
    const cashFlow = Number(client.net_monthly_cash_flow) || 0;
    if (filters.cashFlowStatus === 'positive' && cashFlow < 0) return false;
    if (filters.cashFlowStatus === 'negative' && cashFlow >= 0) return false;

    // Sync status filter
    const syncStatus = client.ghl_sync_status || 'not_synced';
    if (filters.syncStatus !== 'all' && syncStatus !== filters.syncStatus) return false;

    // Follow-up status filter
    if (filters.followUpStatus !== 'all') {
      const now = new Date();
      const followUp = client.follow_up_date ? new Date(client.follow_up_date) : null;
      if (filters.followUpStatus === 'flagged' && !followUp) return false;
      if (filters.followUpStatus === 'overdue' && (!followUp || followUp >= now)) return false;
      if (filters.followUpStatus === 'upcoming') {
        if (!followUp) return false;
        const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (followUp < now || followUp > weekFromNow) return false;
      }
      if (filters.followUpStatus === 'none' && followUp) return false;
    }

    // Review status filter
    if (filters.reviewStatus !== 'all') {
      const now = new Date();
      const nextReview = client.next_review_due ? new Date(client.next_review_due) : null;
      if (filters.reviewStatus === 'overdue' && (!nextReview || nextReview >= now)) return false;
      if (filters.reviewStatus === 'due_soon') {
        if (!nextReview) return false;
        const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (nextReview < now || nextReview > weekFromNow) return false;
      }
      if (filters.reviewStatus === 'upcoming') {
        if (!nextReview) return false;
        const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        // Include overdue AND upcoming within 30 days — this is the "all reviews due" view
        if (nextReview > monthFromNow) return false;
      }
      if (filters.reviewStatus === 'no_review' && nextReview) return false;
    }

    // Review frequency filter
    if (filters.reviewFrequency !== 'all') {
      const freq = client.review_frequency || '';
      if (filters.reviewFrequency === 'quarterly' && freq !== 'quarterly') return false;
      if (filters.reviewFrequency === 'bi_annual' && freq !== 'bi_annual') return false;
      if (filters.reviewFrequency === 'annual' && freq !== 'annual') return false;
    }

    return true;
  });

  // Apply smart capitalization to client names for display
  const displayClients = filteredClients.map(client => ({
    ...client,
    primary_first_name: smartCapitalize(client.primary_first_name),
    primary_surname: smartCapitalize(client.primary_surname),
    secondary_first_name: smartCapitalize(client.secondary_first_name),
    secondary_surname: smartCapitalize(client.secondary_surname),
  }));

  // Count starred clients for the button badge (is_favorite — not is_active)
  const starredClientCount = clients.filter(c => c.is_favorite).length;

  // Calculate summary stats
  const totalClients = clients.length;
  const totalProperties = clients.reduce((acc, c) => acc + (c.client_properties?.length || 0), 0);
  const totalPortfolioValue = clients.reduce((acc, c) => acc + (Number(c.total_portfolio_value) || 0), 0);
  const pendingSyncCount = clients.filter(c => c.ghl_sync_status === 'pending').length;

  const handleViewClient = (client: Client) => {
    setSelectedClient(client);
    setShowDetailsModal(true);
  };

  /*
   * Deleting a client who has an AML/CTF case is not a client delete.
   *
   * `aml.cases.client_id` is ON DELETE SET NULL, so the generic path here
   * neither fails nor cascades — it ORPHANS the case. The customer vanishes
   * from the register while the case, its screening subjects, its
   * determinations and its event chain remain, attached to nobody. Measured
   * in production: one case in six is already in that state.
   *
   * So a client with a case is routed to the AML reset instead, which knows
   * what it is holding and refuses on its own. Clients with no case keep the
   * existing path exactly as it was.
   */
  const handleDeleteClient = (client: Client) => {
    if (amlClientIds.has(client.id)) setClientToReset(client);
    else setClientToDelete(client);
  };

  const handleSelectClient = (clientId: string, selected: boolean) => {
    if (selected) {
      setSelectedClients(prev => [...prev, clientId]);
    } else {
      setSelectedClients(prev => prev.filter(id => id !== clientId));
    }
  };

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      setSelectedClients(filteredClients.map(c => c.id));
    } else {
      setSelectedClients([]);
    }
  };

  const handleSyncAllPending = async () => {
    const pendingClients = clients.filter(c => c.ghl_sync_status === 'pending' || !c.ghl_sync_status);
    if (pendingClients.length === 0) {
      toast.info('No clients to sync');
      return;
    }

    setIsSyncingAll(true);
    let successCount = 0;
    let errorCount = 0;

    for (const client of pendingClients) {
      try {
        const { data, error } = await invokeSecureFunction('sync-client-to-ghl', {
          clientId: client.id
        });
        if (error || !data?.success) {
          errorCount++;
        } else {
          successCount++;
        }
      } catch {
        errorCount++;
      }
    }

    setIsSyncingAll(false);
    toast.success(`Synced ${successCount} clients${errorCount > 0 ? `, ${errorCount} failed` : ''}`);
    refetch();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatLastSync = (date: Date | null) => {
    if (!date) return 'Never';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ago`;
  };

  const allSelected = filteredClients.length > 0 && selectedClients.length === filteredClients.length;
  const someSelected = selectedClients.length > 0 && selectedClients.length < filteredClients.length;
  const ghlExportFields = [
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'tags', label: 'Tags' },
    { key: 'source', label: 'Source' },
    { key: 'secondary_first_name', label: 'Secondary First Name' },
    { key: 'secondary_last_name', label: 'Secondary Last Name' },
    { key: 'portfolio_value', label: 'Portfolio Value' },
    { key: 'total_debt', label: 'Total Debt' },
    { key: 'net_cash_flow', label: 'Net Cash Flow' },
    { key: 'properties', label: 'Properties' },
    { key: 'pipeline_status', label: 'Pipeline Status' },
    { key: 'follow_up_date', label: 'Follow Up Date' },
    { key: 'next_review_due', label: 'Next Review Due' },
    { key: 'review_frequency', label: 'Review Frequency' },
    { key: 'ghl_contact_id', label: 'GHL Contact ID' },
    { key: 'ghl_status', label: 'GHL Status' },
  ];
  const ghlExportRecords = displayClients.map((client) => ({
    first_name: client.primary_first_name || '',
    last_name: client.primary_surname || '',
    email: client.primary_email || '',
    phone: client.primary_mobile || '',
    tags: 'Dashboard Export',
    source: 'Client Management Export',
    secondary_first_name: client.secondary_first_name || '',
    secondary_last_name: client.secondary_surname || '',
    portfolio_value: client.total_portfolio_value?.toString() || '0',
    total_debt: client.total_debt?.toString() || '0',
    net_cash_flow: client.net_monthly_cash_flow?.toString() || '0',
    properties: (client.client_properties?.length || 0).toString(),
    pipeline_status: client.pipeline_status || '',
    follow_up_date: client.follow_up_date || '',
    next_review_due: client.next_review_due || '',
    review_frequency: client.review_frequency || '',
    ghl_contact_id: client.ghl_contact_id || '',
    ghl_status: client.ghl_sync_status || 'not_synced',
  }));

  const kpiCards = [
    {
      label: 'Total Clients',
      value: totalClients.toLocaleString('en-AU'),
      hint: `${starredClientCount.toLocaleString('en-AU')} starred`,
      icon: Users,
      tone: 'accent' as const,
    },
    {
      label: 'Total Properties',
      value: totalProperties.toLocaleString('en-AU'),
      hint: 'Across all client portfolios',
      icon: Building2,
      tone: 'info' as const,
    },
    {
      label: 'Portfolio Value',
      value: formatCurrency(totalPortfolioValue),
      hint: 'Combined value under management',
      icon: DollarSign,
      tone: 'success' as const,
    },
    {
      label: 'Pending GHL Sync',
      value: pendingSyncCount.toLocaleString('en-AU'),
      hint: pendingSyncCount > 0 ? 'Awaiting push to GoHighLevel' : 'Everything is up to date',
      icon: TrendingUp,
      tone: pendingSyncCount > 0 ? ('warning' as const) : ('neutral' as const),
    },
  ];

  return (
    <DashboardThemeFrame as="main" variant="page" className="client-management-page space-y-5 pb-20 md:pb-0">
      <GHLExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        title="Export clients for GHL"
        description="Map the current filtered client view into GHL-compatible headers before exporting as CSV or XLSX."
        fields={ghlExportFields}
        records={ghlExportRecords}
        fileBaseName={`client-management-export-${new Date().toISOString().split('T')[0]}`}
        sheetName="Client Management"
        onExported={(exportFormat, count) => toast.success(`Exported ${count} clients to ${exportFormat.toUpperCase()}`)}
      />

      {/* Header */}
      <DashboardThemeFrame as="header" variant="hero">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="dashboard-eyebrow">Client workspace</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Client Management</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Manage clients, properties, and sync with GoHighLevel.
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
              {isAutoSyncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
              ) : (
                <Zap className={cn('h-3.5 w-3.5', autoSyncEnabled ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
              )}
              {isAutoSyncing ? 'Auto-sync running…' : `Last auto-sync: ${formatLastSync(lastSyncTime)}`}
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            <label className="dashboard-input-control flex h-10 w-full items-center justify-between gap-2 px-3 text-xs font-semibold text-muted-foreground sm:w-auto sm:justify-start">
              <span>Auto-sync</span>
              <Switch
                checked={autoSyncEnabled}
                onCheckedChange={setAutoSyncEnabled}
                aria-label="Automatically sync clients from GoHighLevel"
              />
            </label>

            <Button
              onClick={() => handleImportFromGHL(false)}
              variant="outline"
              disabled={isImportingFromGHL}
              className="h-10 flex-1 basis-[9rem] rounded-xl px-4 sm:basis-auto sm:flex-none"
            >
              {isImportingFromGHL ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {isImportingFromGHL && importProgress
                  ? `Importing… (${importProgress.imported.toLocaleString('en-AU')})`
                  : 'Import from GHL'}
              </span>
              <span className="sm:hidden">Import</span>
            </Button>

            <Button
              onClick={() => setShowExportDialog(true)}
              variant="outline"
              className="h-10 flex-1 basis-[9rem] rounded-xl px-4 sm:basis-auto sm:flex-none"
              disabled={displayClients.length === 0}
            >
              <Download className="mr-1.5 h-4 w-4" />
              Export
            </Button>

            {canEditClients && (
              <Button
                onClick={() => setShowAddClientModal(true)}
                className="h-10 flex-1 basis-[9rem] rounded-xl px-4 sm:basis-auto sm:flex-none"
              >
                <UserPlus className="mr-1.5 h-4 w-4" />
                <span className="hidden sm:inline">Add Client</span>
                <span className="sm:hidden">Add</span>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl" aria-label="More client actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56 rounded-xl p-1.5">
                <DropdownMenuItem onClick={() => refetch()} className="rounded-lg">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </DropdownMenuItem>
                {pendingSyncCount > 0 && (
                  <DropdownMenuItem onClick={handleSyncAllPending} disabled={isSyncingAll} className="rounded-lg">
                    <RefreshCw className={cn('mr-2 h-4 w-4', isSyncingAll && 'animate-spin')} />
                    Sync all ({pendingSyncCount})
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => window.location.href = '/client-tracker'} className="rounded-lg">
                  <Target className="mr-2 h-4 w-4" />
                  Client Tracker
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleClearAndReimport}
                  disabled={isImportingFromGHL}
                  className="rounded-lg text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear &amp; reimport
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </DashboardThemeFrame>

      {/* Summary Stats */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map(({ label, value, hint, icon: Icon, tone }) => {
          const t = KPI_TONE[tone];
          return (
            <Card key={label} className="dashboard-kpi-card group min-w-0">
              <div className={cn('pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r', t.bar)} aria-hidden="true" />
              <CardHeader className="relative flex flex-row items-start justify-between space-y-0 pb-2">
                {/* Utilities, not `.dashboard-kpi-title`: CardTitle's own `text-2xl`
                    is a utility and would out-rank the components layer. */}
                <CardTitle className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</CardTitle>
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border', t.icon)}>
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
              </CardHeader>
              <CardContent className="relative space-y-1 pt-0">
                <p className={cn('truncate text-[28px] font-semibold leading-none tracking-tight tabular-nums md:text-[32px]', t.value)} title={String(value)}>
                  {value}
                </p>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Main Content */}
      <Tabs defaultValue="clients" className="space-y-4">
        <div className="-mx-3 overflow-x-auto px-3 pb-1 md:mx-0 md:px-0">
          <TabsList aria-label="Client management sections" className="inline-flex w-auto min-w-max gap-1 rounded-xl p-1">
            <TabsTrigger value="clients" className="rounded-lg px-4 text-[13px] font-semibold">Clients</TabsTrigger>
            <TabsTrigger value="portfolio-reports" className="rounded-lg px-4 text-[13px] font-semibold">Portfolio</TabsTrigger>
            <TabsTrigger value="analytics" className="rounded-lg px-4 text-[13px] font-semibold">Analytics</TabsTrigger>
            <TabsTrigger value="compare" className="rounded-lg px-4 text-[13px] font-semibold">Compare</TabsTrigger>
            <TabsTrigger value="import" className="rounded-lg px-4 text-[13px] font-semibold">Import</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="clients" className="space-y-4">
          {/* Bulk Actions Bar */}
          <ClientBulkActions
            selectedClients={selectedClients}
            clients={filteredClients}
            onClearSelection={() => setSelectedClients([])}
            onActionComplete={() => refetch()}
          />

          {/* Search & Filters */}
          <DashboardThemeFrame variant="toolbar" className="gap-2 p-2">
            <SearchInput
              value={searchQuery}
              onValueChange={setSearchQuery}
              placeholder="Search clients…"
              aria-label="Search clients"
              autoComplete="off"
              spellCheck={false}
              containerClassName="min-w-full flex-1 sm:min-w-[240px] md:max-w-md"
              className="h-10 rounded-xl pr-4 text-sm"
              iconClassName="left-3.5"
            />
            <Button
              variant={showStarredOnly ? 'default' : 'outline'}
              onClick={() => setShowStarredOnly(!showStarredOnly)}
              aria-pressed={showStarredOnly}
              className="h-10 gap-2 rounded-xl px-4"
            >
              <Star className={cn('h-4 w-4', showStarredOnly && 'fill-current')} />
              Starred
              {starredClientCount > 0 && (
                <Badge variant="secondary" className="ml-1 rounded-full px-2 tabular-nums">
                  {starredClientCount}
                </Badge>
              )}
            </Button>
            <ClientFilters filters={filters} onFiltersChange={setFilters} />
            {filteredClients.length > 0 && (
              <label className="dashboard-input-control flex h-10 cursor-pointer items-center gap-2 px-3 text-sm text-muted-foreground">
                <Checkbox
                  checked={allSelected}
                  ref={(ref) => {
                    if (ref) {
                      (ref as any).indeterminate = someSelected;
                    }
                  }}
                  onCheckedChange={handleSelectAll}
                  aria-label={`Select all ${filteredClients.length} clients`}
                />
                <span className="font-medium">Select all ({filteredClients.length})</span>
              </label>
            )}
          </DashboardThemeFrame>

          <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
            {isLoading
              ? 'Loading clients…'
              : `Showing ${displayClients.length.toLocaleString('en-AU')} of ${totalClients.toLocaleString('en-AU')} clients`}
          </p>

          {/* Client List */}
          {isLoading ? (
            <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="dashboard-theme-premium-card min-w-0 rounded-2xl border">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-11 w-11 rounded-xl" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                    <Skeleton className="h-14 w-full rounded-xl" />
                    <div className="grid grid-cols-3 gap-2">
                      <Skeleton className="h-16 rounded-xl" />
                      <Skeleton className="h-16 rounded-xl" />
                      <Skeleton className="h-16 rounded-xl" />
                    </div>
                    <Skeleton className="h-6 w-full rounded-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : displayClients.length === 0 ? (
            <div className="dashboard-empty-state">
              <span className="dashboard-empty-icon">
                {searchQuery || filters !== defaultFilters || showStarredOnly ? (
                  <Search className="h-6 w-6" aria-hidden="true" />
                ) : (
                  <Users className="h-6 w-6" aria-hidden="true" />
                )}
              </span>
              <div className="space-y-1.5">
                <h3 className="text-lg font-semibold tracking-tight text-foreground">
                  {showStarredOnly
                    ? 'No starred clients found'
                    : searchQuery || filters !== defaultFilters
                      ? 'No clients match your filters'
                      : 'No clients found'
                  }
                </h3>
                <p className="mx-auto max-w-md text-sm leading-6 text-muted-foreground">
                  {searchQuery || filters !== defaultFilters || showStarredOnly
                    ? 'Try adjusting your search or filters.'
                    : 'Import clients using the Import tab.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
              {displayClients.map((client) => (
                <ClientCard
                  key={client.id}
                  client={client}
                  ghlLocationId={ghlLocationId}
                  onView={() => handleViewClient(client)}
                  onDelete={canDeleteClients ? () => handleDeleteClient(client) : undefined}
                  onSyncComplete={() => refetch()}
                  isSelected={selectedClients.includes(client.id)}
                  onSelect={(checked) => handleSelectClient(client.id, !!checked)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <ClientAnalyticsDashboard clients={clients} />
        </TabsContent>

        <TabsContent value="compare" className="space-y-4">
          <ClientComparison clients={clients} />
        </TabsContent>

        <TabsContent value="portfolio-reports" className="space-y-4">
          <DashboardThemeFrame variant="sectionAccent">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-3xl space-y-1.5">
                <p className="dashboard-eyebrow">Portfolio intelligence</p>
                <h2 className="text-xl font-semibold tracking-tight text-foreground">Portfolio Performance Reports</h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  Quick view of recent portfolio analysis reports — open the full page for search, stats, and bulk actions.
                </p>
              </div>
              <Button
                onClick={() => window.location.href = '/portfolio-reports'}
                className="h-10 shrink-0 rounded-xl px-4"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Full Reports Page
              </Button>
            </div>
          </DashboardThemeFrame>
          <PortfolioAnalysisReportsList showHeader={false} />
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          <Card className="dashboard-theme-premium-card min-w-0 overflow-hidden rounded-2xl border">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                  <Upload className="h-5 w-5" aria-hidden="true" />
                </span>
                Import Clients from Excel
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Drag and drop your client intake form Excel file to import clients and their properties into the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 sm:pt-0">
              <ExcelDropzone onImportComplete={() => refetch()} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Client Details Modal */}
      {selectedClient && (
        <ClientDetailsModal
          client={selectedClient}
          open={showDetailsModal}
          onOpenChange={(open) => {
            setShowDetailsModal(open);
            if (!open) {
              setDeepLinkTab(undefined);
              setDeepLinkDealId(undefined);
            }
          }}
          initialTab={deepLinkTab}
          initialDealId={deepLinkDealId}
        />
      )}

      {/*
        A client with an AML/CTF case is reset here rather than deleted, so
        the case cannot be left attached to nobody. The dialog shows the
        server's own decision, including which record refuses a deletion.
      */}
      {clientToReset && (
        <ResetClientJourneyDialog
          open
          onOpenChange={(o) => { if (!o) setClientToReset(null); }}
          clientId={clientToReset.id}
          clientName={[clientToReset.primary_first_name, clientToReset.primary_surname]
            .filter(Boolean).join(' ').trim()}
          onReset={() => setClientToReset(null)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!clientToDelete} onOpenChange={() => setClientToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {clientToDelete?.primary_first_name} {clientToDelete?.primary_surname}? 
              This will also delete all their properties, income, assets, and liabilities. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clientToDelete && deleteClientMutation.mutate(clientToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Clear & Reimport Confirmation Dialog */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Clients & Reimport</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete ALL existing client data and reimport fresh from GoHighLevel. 
              This action cannot be undone. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClearAndReimport}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isImportingFromGHL ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing…
                </>
              ) : (
                'Clear & Reimport'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Client Modal */}
      <AddClientModal
        open={showAddClientModal}
        onOpenChange={setShowAddClientModal}
      />
    </DashboardThemeFrame>
  );
}
