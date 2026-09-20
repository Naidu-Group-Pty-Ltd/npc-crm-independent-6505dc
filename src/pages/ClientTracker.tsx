import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GHLExportDialog } from '@/components/shared/GHLExportDialog';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { format } from 'date-fns';
import { 
  Search, 
  Filter, 
  Calendar as CalendarIcon, 
  Phone, 
  Mail, 
  Edit2, 
  Save,
  ChevronRight,
  Users,
  TrendingUp,
  Clock,
  AlertCircle,
  DollarSign,
  RefreshCw,
  Loader2,
  Download,
  Layers,
  ChevronDown,
  GripVertical,
  FileText,
  UserCheck,
  ChevronLeft,
  Zap,
  Video,
  User,
  MoreHorizontal,
  SlidersHorizontal,
  Target,
  X,
  Star
} from 'lucide-react';
import { ActiveClientCard } from '@/components/clients/ActiveClientCard';
// Pagination imports removed - using infinite scroll now
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useGHLCalendar, GHLEvent } from '@/hooks/useGHLCalendar';
import { EventDetailsModal } from '@/components/calendar/EventDetailsModal';
import { toast } from 'sonner';
import { formatFullName } from '@/utils/nameFormatting';
import { useIsMobile } from '@/hooks/use-mobile';
import { invalidateClientQueries } from '@/lib/clients/invalidateClientQueries';

// Types for GHL pipeline data
interface GHLPipeline {
  id: string;
  ghl_id: string;
  name: string;
  position: number;
  is_active: boolean;
  synced_at: string;
}

interface GHLPipelineStage {
  id: string;
  ghl_id: string;
  pipeline_id: string;
  name: string;
  position: number;
  color: string;
  synced_at: string;
}

interface TrackedClient {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  primary_email: string | null;
  primary_mobile: string | null;
  pipeline_status: string | null;
  follow_up_date: string | null;
  borrowing_capacity: number | null;
  proposed_rental_income: number | null;
  equity_release: number | null;
  pipeline_notes: string | null;
  pipeline_updated_at: string | null;
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
  current_pipeline_id: string | null;
  current_stage_id: string | null;
  opportunity_status: string | null;
  is_favorite?: boolean;
  last_note_at?: string | null;
  deal_status?: string;
  first_deal_closed_at?: string | null;
}

interface ClientOpportunity {
  id: string;
  client_id: string;
  ghl_opportunity_id: string;
  pipeline_id: string | null;
  stage_id: string | null;
  pipeline_name: string | null;
  stage_name: string | null;
  opportunity_status: string | null;
  monetary_value: number | null;
  opportunity_name: string | null;
  follow_up_date: string | null;
  notes: string | null;
  synced_at: string | null;
}

interface ClientNote {
  id: string;
  client_id: string;
  content: string;
  note_type: string;
  created_at: string;
}

// Fallback stages for when no pipelines are synced
const FALLBACK_STAGES = [
  { value: 'New Lead', label: 'New Lead', color: '#6B7280' },
  { value: 'In Progress', label: 'In Progress', color: '#3B82F6' },
  { value: 'Qualified', label: 'Qualified', color: '#8B5CF6' },
  { value: 'Won', label: 'Won', color: '#22C55E' },
  { value: 'Lost', label: 'Lost', color: '#EF4444' },
];

const badgeBaseClass = "inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5 shadow-sm";
const compactBadgeBaseClass = "inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 shadow-sm";
const actionIconButtonClass = "client-tracker-gold-interaction rounded-xl border border-border/60 bg-background/75 text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary hover:shadow-md hover:shadow-primary/10 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-0";
const actionMenuContentClass = "z-50 min-w-[12rem] rounded-xl border-border/70 bg-popover/95 p-1.5 shadow-xl shadow-sm dark:shadow-black/20 backdrop-blur-xl";
const actionMenuItemClass = "cursor-pointer rounded-lg px-2.5 py-2 text-sm focus:bg-primary/10 focus:text-primary";

const getStageBadgeStyle = (color: string) => ({
  backgroundColor: `${color}20`,
  borderColor: `${color}80`,
  color,
});

const getOpportunityStatusBadgeClass = (status?: string | null, compact = false) => {
  const base = compact ? compactBadgeBaseClass : badgeBaseClass;
  const normalizedStatus = status?.toLowerCase();

  return cn(
    base,
    "border shadow-inner",
    normalizedStatus === 'won' && 'border-success/35 bg-success/10 text-success',
    normalizedStatus === 'lost' && 'border-destructive/35 bg-destructive/10 text-destructive',
    normalizedStatus === 'abandoned' && 'border-destructive/35 bg-destructive/10 text-destructive',
    normalizedStatus === 'open' && 'border-info/35 bg-info/10 text-info',
    normalizedStatus && !['won', 'lost', 'abandoned', 'open'].includes(normalizedStatus) && 'border-border/70 bg-background/70 text-muted-foreground'
  );
};

/**
 * How many passes one "Sync" is allowed to make.
 *
 * Twelve passes at the function's 95s budget is about nineteen minutes of
 * work, comfortably past what this account needs and short of a loop that
 * could run all day if the server ever stopped advancing its cursor.
 */
const MAX_PIPELINE_SYNC_PASSES = 12;

interface PipelineSyncOutcome {
  ok: boolean;
  error?: string;
  /** The passes ran out before the walk did. What was written still stands. */
  incomplete?: boolean;
  passes: number;
  pipelinesFound: number;
  opportunitiesStored: number;
  clientsUpdated: number;
}

/**
 * Run `sync-ghl-pipelines` to completion, rather than once.
 *
 * That function stops at a wall-clock budget and hands back a cursor — it has
 * to, because one pass over this account did not fit inside the 120 seconds
 * it declares. The pass that was cut off had already stored every opportunity
 * and had not yet reached the step that writes `clients.pipeline_status`,
 * `current_pipeline_id`, `current_stage_id` and `ghl_opportunity_id`, so a
 * caller that made one call and reported success is how five hundred client
 * rows came to sit on their column defaults — every card badge reading
 * "New Lead" — while the board beside them placed those same clients into
 * named stages from the opportunities that HAD been written.
 *
 * Both call sites go through here, because two copies of a resume loop is how
 * one screen syncs further than the other.
 */
async function runPipelineSyncToCompletion(): Promise<PipelineSyncOutcome> {
  let runStartedAt: string | null = null;
  let passes = 0;
  let pipelinesFound = 0;
  let opportunitiesStored = 0;
  let clientsUpdated = 0;

  while (passes < MAX_PIPELINE_SYNC_PASSES) {
    passes++;
    /*
     * `runStartedAt` is the whole resume.
     *
     * There used to be a contact-id cursor beside it. The server re-derives
     * the position now, by ordering contacts on how long ago their
     * opportunities were last stamped and taking those not yet stamped in
     * this run — which is what lets the hourly cron make progress too, since
     * a static cron body has nowhere to put a cursor.
     */
    const payload: Record<string, unknown> = {};
    if (runStartedAt) payload.runStartedAt = runStartedAt;

    const { data, error } = await invokeSecureFunction<any>('sync-ghl-pipelines', payload);
    if (error) return { ok: false, error: error.message, passes, pipelinesFound, opportunitiesStored, clientsUpdated };
    if (!data?.success) return { ok: false, error: data?.error || 'Sync failed', passes, pipelinesFound, opportunitiesStored, clientsUpdated };

    // Pipelines and stages are re-read every pass, so this is a reading rather
    // than a running total. Opportunities and clients are per-pass work.
    pipelinesFound = data.stats?.pipelinesFound ?? pipelinesFound;
    opportunitiesStored += data.stats?.opportunitiesStored ?? 0;
    clientsUpdated += data.stats?.clientsUpdated ?? 0;

    if (!data.hasMore) return { ok: true, passes, pipelinesFound, opportunitiesStored, clientsUpdated };

    /*
     * A pass that moved nothing ends the loop.
     *
     * With the cursor gone, progress is measured rather than inferred: a pass
     * that processed no contacts will process none on the next attempt
     * either, and looping on it is a spin against GHL. This also covers a
     * deployment running the PREVIOUS version of the function, which answers
     * without `stats.contactsProcessed` at all.
     */
    const moved = typeof data.stats?.contactsProcessed === 'number' ? data.stats.contactsProcessed : 0;
    const nextRunStartedAt = typeof data.runStartedAt === 'string' ? data.runStartedAt : null;
    if (moved <= 0 || !nextRunStartedAt) {
      return { ok: true, incomplete: true, passes, pipelinesFound, opportunitiesStored, clientsUpdated };
    }
    runStartedAt = nextRunStartedAt;
  }

  return { ok: true, incomplete: true, passes, pipelinesFound, opportunitiesStored, clientsUpdated };
}

export default function ClientTracker() {
  const queryClient = useQueryClient();
  const { canEdit: canEditTracker } = useModulePermissions('client_tracker');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('all');
  const [editingClient, setEditingClient] = useState<TrackedClient | null>(null);
  const [activeTab, setActiveTab] = useState('kanban');
  const [activeDealFilter, setActiveDealFilter] = useState<'all' | 'closed' | 'prospects'>('all');
  const [isSyncingPipelines, setIsSyncingPipelines] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  // Infinite scroll for active clients
  const [displayedActiveCount, setDisplayedActiveCount] = useState(12);
  const LOAD_MORE_COUNT = 12;
  
  // Event details modal state
  const [selectedEvent, setSelectedEvent] = useState<GHLEvent | null>(null);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  
  // Auto-sync state
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const AUTO_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
  
  // GHL Calendar integration
  const { 
    events: ghlEvents, 
    isLoading: calendarLoading, 
    fetchEvents: fetchCalendarEvents,
    updateEvent,
    deleteEvent,
    rescheduleEvent,
    fetchContact
  } = useGHLCalendar();

  // Fetch pipelines from database via edge function
  const { data: pipelines = [], isLoading: pipelinesLoading } = useQuery({
    queryKey: ['ghl-pipelines'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-automation-settings', {
        operation: 'getPipelines'
      });
      
      if (error || !data?.success) throw new Error(data?.error || error?.message);
      return data.pipelines as GHLPipeline[];
    },
  });

  // Fetch pipeline stages from database via edge function
  const { data: allStages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ['ghl-pipeline-stages'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-automation-settings', {
        operation: 'getStages'
      });
      
      if (error || !data?.success) throw new Error(data?.error || error?.message);
      return data.stages as GHLPipelineStage[];
    },
  });

  // Fetch clients with pipeline data via secure edge function
  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ['client-tracker'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        mode: 'list',
        listOptions: {
          select: 'id, primary_first_name, primary_surname, primary_email, primary_mobile, pipeline_status, follow_up_date, borrowing_capacity, proposed_rental_income, equity_release, pipeline_notes, pipeline_updated_at, ghl_contact_id, ghl_opportunity_id, current_pipeline_id, current_stage_id, opportunity_status, is_favorite, last_note_at, deal_status, first_deal_closed_at',
          orderBy: 'follow_up_date',
          orderAsc: true
        }
      });
      
      if (error || !data?.success) throw new Error(data?.error || error?.message);
      return (data.clients || []) as TrackedClient[];
    },
  });

  // Fetch ALL opportunities from the new table
  const { data: opportunities = [] } = useQuery({
    queryKey: ['ghl-client-opportunities'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'ghl_client_opportunities',
          select: 'id, client_id, ghl_opportunity_id, pipeline_id, stage_id, pipeline_name, stage_name, opportunity_status, monetary_value, opportunity_name, follow_up_date, notes, synced_at',
          orderBy: 'synced_at',
          orderAsc: false,
        }
      });
      
      if (error || !data?.success) return [];
      return (data.records || []) as ClientOpportunity[];
    },
  });

  // Fetch active clients (marked as favorite) and sort by most recent note activity
  const activeClients = useMemo(() => {
    return clients
      .filter(c => c.is_favorite)
      .sort((a, b) => {
        // Sort by last_note_at descending (most recent first), nulls last
        const aTime = a.last_note_at ? new Date(a.last_note_at).getTime() : 0;
        const bTime = b.last_note_at ? new Date(b.last_note_at).getTime() : 0;
        return bTime - aTime;
      });
  }, [clients]);
  // Filter active clients by search query and deal status
  const filteredActiveClients = useMemo(() => {
    let filtered = activeClients;
    
    // Apply deal status filter
    if (activeDealFilter === 'closed') {
      filtered = filtered.filter(c => c.deal_status === 'closed');
    } else if (activeDealFilter === 'prospects') {
      filtered = filtered.filter(c => c.deal_status !== 'closed');
    }
    
    // Apply search
    if (activeTab === 'active' && searchQuery !== '') {
      filtered = filtered.filter(client => {
        const matchesSearch = 
          `${client.primary_first_name} ${client.primary_surname}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
          client.primary_email?.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesSearch;
      });
    }
    
    return filtered;
  }, [activeClients, searchQuery, activeTab, activeDealFilter]);

  // Count deals closed among active clients
  const dealsClosedCount = useMemo(() => 
    activeClients.filter(c => c.deal_status === 'closed').length
  , [activeClients]);

  // Reset displayed count when search changes
  useEffect(() => {
    setDisplayedActiveCount(12);
  }, [searchQuery]);

  // Auto-sync from GHL periodically
  useEffect(() => {
    if (!autoSyncEnabled) return;

    const performAutoSync = async () => {
      if (isSyncingPipelines || isAutoSyncing) return;
      
      setIsAutoSyncing(true);
      try {
        const outcome = await runPipelineSyncToCompletion();

        if (outcome.ok) {
          setLastSyncTime(new Date());
          queryClient.invalidateQueries({ queryKey: ['ghl-pipelines'] });
          queryClient.invalidateQueries({ queryKey: ['ghl-pipeline-stages'] });
          queryClient.invalidateQueries({ queryKey: ['ghl-client-opportunities'] });
          invalidateClientQueries(queryClient, null);
          
          // Also refresh calendar events
          const now = new Date();
          const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          fetchCalendarEvents(now.toISOString(), weekFromNow.toISOString());
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
  }, [autoSyncEnabled, isSyncingPipelines, queryClient, fetchCalendarEvents]);

  // Initial calendar events fetch
  useEffect(() => {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    fetchCalendarEvents(now.toISOString(), weekFromNow.toISOString());
  }, []);

  // Filter upcoming appointments (next 7 days)
  const upcomingAppointments = useMemo(() => {
    const now = new Date();
    return ghlEvents
      .filter(event => new Date(event.startTime) >= now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 10); // Show top 10
  }, [ghlEvents]);

  // Build a map of client name -> next upcoming appointment
  const clientAppointmentMap = useMemo(() => {
    const map: Record<string, GHLEvent> = {};
    const now = new Date();
    const futureEvents = ghlEvents
      .filter(event => new Date(event.startTime) >= now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    // Match events to clients by contactId or name in title
    for (const client of clients) {
      const clientName = `${client.primary_first_name} ${client.primary_surname}`.toLowerCase();
      
      const matchedEvent = futureEvents.find(event => {
        // Match by GHL contact ID
        if (client.ghl_contact_id && event.contactId === client.ghl_contact_id) return true;
        // Fallback: match by name in title
        const eventTitle = (event.title || '').toLowerCase();
        return eventTitle.includes(clientName);
      });
      
      if (matchedEvent) {
        map[client.id] = matchedEvent;
      }
    }
    return map;
  }, [ghlEvents, clients]);

  // Notes are now fetched directly within each ActiveClientCard using infinite scroll

  // State for drag and drop
  const [draggedClient, setDraggedClient] = useState<TrackedClient | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  // Update client mutation
  const updateClientMutation = useMutation({
    mutationFn: async (client: Partial<TrackedClient> & { id: string }) => {
      // First update locally via edge function
      const { data, error } = await invokeSecureFunction('manage-automation-settings', {
        operation: 'updateClientPipeline',
        clientId: client.id,
        data: {
          pipeline_status: client.pipeline_status,
          follow_up_date: client.follow_up_date,
          borrowing_capacity: client.borrowing_capacity,
          proposed_rental_income: client.proposed_rental_income,
          equity_release: client.equity_release,
          pipeline_notes: client.pipeline_notes,
          current_stage_id: client.current_stage_id,
        }
      });
      
      if (error || !data?.success) throw new Error(data?.error || error?.message);

      // Sync stage change to GHL if a stage is set
      if (client.current_stage_id) {
        const { data: ghlData, error: ghlError } = await invokeSecureFunction('update-ghl-opportunity-stage', {
          clientId: client.id,
          newStageId: client.current_stage_id
        });

        if (ghlError) {
          console.error('GHL sync failed:', ghlError);
          // Don't throw - local update succeeded, just log GHL failure
        } else if (!ghlData?.success) {
          // If GHL sync fails with a specific error (like no opportunity linked), just log it
          if (ghlData?.error?.includes('No GHL opportunity linked') || ghlData?.error?.includes('No GHL contact linked')) {
            console.log('Client has no GHL opportunity/contact, local update only');
          } else {
            console.error('GHL sync error:', ghlData?.error);
          }
        } else {
          console.log('GHL stage sync successful');
        }
      }
    },
    onSuccess: (_result, variables: Partial<TrackedClient> & { id: string }) => {
      // A pipeline save writes the client's own record, so the open client
      // card has to hear about it too — this list named neither of its keys.
      invalidateClientQueries(queryClient, variables.id);
      setEditingClient(null);
      toast.success('Pipeline data saved successfully');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // Move client to different stage mutation with two-way GHL sync
  const moveClientMutation = useMutation({
    mutationFn: async ({ clientId, stageId, stageName }: { clientId: string; stageId: string | null; stageName: string }) => {
      // First update locally via edge function for instant UI feedback
      const { data: updateData, error: localError } = await invokeSecureFunction('manage-automation-settings', {
        operation: 'updateClientPipeline',
        clientId,
        data: {
          current_stage_id: stageId,
          pipeline_status: stageName,
        }
      });
      
      if (localError || !updateData?.success) throw new Error(updateData?.error || localError?.message);

      // Then sync to GHL (non-blocking, but show toast on result)
      if (stageId) {
        const { data, error } = await invokeSecureFunction('update-ghl-opportunity-stage', {
          clientId, newStageId: stageId
        });

        if (error) {
          console.error('GHL sync failed:', error);
          throw new Error(`GHL sync failed: ${error.message}`);
        }

        if (!data?.success) {
          // If GHL sync fails but has a specific error (like no opportunity linked), don't throw
          if (data?.error?.includes('No GHL opportunity linked')) {
            console.log('Client has no GHL opportunity, local update only');
            return { localOnly: true };
          }
          throw new Error(data?.error || 'GHL sync failed');
        }

        return { ghlSynced: true, stage: data.newStage };
      }

      return { localOnly: true };
    },
    // Optimistic move: the card's column comes from the cached
    // ghl_client_opportunities rows (not clients.current_stage_id), so both
    // caches are patched before the server round-trip or the card sits in the
    // old column until the next 5-minute pipeline sync.
    onMutate: async ({ clientId, stageId, stageName }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['ghl-client-opportunities'] }),
        queryClient.cancelQueries({ queryKey: ['client-tracker'] }),
      ]);
      const previousOpportunities = queryClient.getQueryData<ClientOpportunity[]>(['ghl-client-opportunities']);
      const previousClients = queryClient.getQueryData<TrackedClient[]>(['client-tracker']);
      queryClient.setQueryData<ClientOpportunity[]>(['ghl-client-opportunities'], (old) =>
        (old ?? []).map((opp) =>
          opp.client_id === clientId ? { ...opp, stage_id: stageId, stage_name: stageName } : opp
        )
      );
      queryClient.setQueryData<TrackedClient[]>(['client-tracker'], (old) =>
        (old ?? []).map((client) =>
          client.id === clientId
            ? { ...client, current_stage_id: stageId, pipeline_status: stageName }
            : client
        )
      );
      return { previousOpportunities, previousClients };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['client-tracker'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['ghl-client-opportunities'] });
      if (result?.ghlSynced) {
        toast.success(`Moved to ${result.stage} (synced to GHL)`);
      }
    },
    onError: (error, _variables, context) => {
      // Restore the pre-move snapshots, then refetch the truth
      if (context?.previousOpportunities) {
        queryClient.setQueryData(['ghl-client-opportunities'], context.previousOpportunities);
      }
      if (context?.previousClients) {
        queryClient.setQueryData(['client-tracker'], context.previousClients);
      }
      queryClient.invalidateQueries({ queryKey: ['client-tracker'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['ghl-client-opportunities'] });
      toast.error(`Failed to move client: ${error.message}`);
    },
  });

  // Star a client as active/favorite straight from the board — the same
  // write ActiveClientCard performs, optimistic so the star answers the click.
  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ clientId, isFavorite }: { clientId: string; isFavorite: boolean }) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'clients',
        clientId,
        data: { is_favorite: isFavorite },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Failed to update client');
      return { isFavorite };
    },
    onMutate: async ({ clientId, isFavorite }) => {
      await queryClient.cancelQueries({ queryKey: ['client-tracker'] });
      const previousClients = queryClient.getQueryData<TrackedClient[]>(['client-tracker']);
      queryClient.setQueryData<TrackedClient[]>(['client-tracker'], (old) =>
        (old ?? []).map((client) =>
          client.id === clientId ? { ...client, is_favorite: isFavorite } : client
        )
      );
      return { previousClients };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['client-tracker'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success(result.isFavorite ? 'Added to active clients' : 'Removed from active clients');
    },
    onError: (error, _variables, context) => {
      if (context?.previousClients) {
        queryClient.setQueryData(['client-tracker'], context.previousClients);
      }
      toast.error(`Failed to update active clients: ${error.message}`);
    },
  });

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, client: TrackedClient) => {
    setDraggedClient(client);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', client.id);
    // Add a slight delay to show the dragging state
    setTimeout(() => {
      const element = e.target as HTMLElement;
      element.style.opacity = '0.5';
    }, 0);
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedClient(null);
    setDragOverStageId(null);
    const element = e.target as HTMLElement;
    element.style.opacity = '1';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStageId(stageId);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the drop zone entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverStageId(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, stageId: string | null, stageName: string) => {
    e.preventDefault();
    setDragOverStageId(null);
    
    if (!draggedClient) return;
    
    // Don't do anything if dropping on same stage
    if (draggedClient.current_stage_id === stageId) {
      setDraggedClient(null);
      return;
    }
    
    moveClientMutation.mutate({
      clientId: draggedClient.id,
      stageId,
      stageName,
    });
    
    setDraggedClient(null);
  }, [draggedClient, moveClientMutation]);

  // Check if drag and drop should be enabled (only for specific pipeline, not "All Pipelines")
  const isDragDropEnabled = selectedPipelineId !== 'all';

  // Get stages for selected pipeline
  const stagesForPipeline = useMemo(() => {
    if (selectedPipelineId === 'all') {
      // Return all unique stages across all pipelines
      return allStages;
    }
    return allStages.filter(s => s.pipeline_id === selectedPipelineId);
  }, [allStages, selectedPipelineId]);

  // Build a map of client_id -> opportunities for fast lookups
  const clientOpportunitiesMap = useMemo(() => {
    const map: Record<string, ClientOpportunity[]> = {};
    for (const opp of opportunities) {
      if (!map[opp.client_id]) map[opp.client_id] = [];
      map[opp.client_id].push(opp);
    }
    return map;
  }, [opportunities]);

  // Filter clients - now considers opportunities for pipeline matching
  const filteredClients = useMemo(() => {
    return clients.filter(client => {
      const matchesSearch = searchQuery === '' || 
        `${client.primary_first_name} ${client.primary_surname}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        client.primary_email?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || client.pipeline_status === statusFilter;
      
      // When filtering by pipeline, check opportunities table too
      let matchesPipeline = selectedPipelineId === 'all';
      if (!matchesPipeline) {
        // Check legacy field
        if (client.current_pipeline_id === selectedPipelineId) {
          matchesPipeline = true;
        }
        // Check opportunities table
        const clientOpps = clientOpportunitiesMap[client.id] || [];
        if (clientOpps.some(o => o.pipeline_id === selectedPipelineId)) {
          matchesPipeline = true;
        }
      }
      
      return matchesSearch && matchesStatus && matchesPipeline;
    });
  }, [clients, searchQuery, statusFilter, selectedPipelineId, clientOpportunitiesMap]);

  // Calculate stats - now using opportunities count
  const stats = useMemo(() => ({
    total: clients.length,
    withFollowUp: clients.filter(c => c.follow_up_date).length,
    overdue: clients.filter(c => c.follow_up_date && new Date(c.follow_up_date) < new Date()).length,
    financeStage: clients.filter(c => c.pipeline_status?.includes('FA -') || c.pipeline_status?.includes('Finance')).length,
    totalOpportunities: opportunities.length,
  }), [clients, opportunities]);

  // Group clients by stage for Kanban view - using opportunities table
  const groupedByStage = useMemo(() => {
    const grouped: Record<string, TrackedClient[]> = {};
    
    for (const stage of stagesForPipeline) {
      grouped[stage.id] = [];
    }

    // Track which clients have been placed in at least one stage
    const placedClientIds = new Set<string>();

    // Use opportunities to place clients in stages
    for (const client of filteredClients) {
      const clientOpps = clientOpportunitiesMap[client.id] || [];
      
      for (const opp of clientOpps) {
        if (opp.stage_id && grouped[opp.stage_id]) {
          // Check if client already in this stage (avoid duplicates)
          if (!grouped[opp.stage_id].find(c => c.id === client.id)) {
            grouped[opp.stage_id].push(client);
          }
          placedClientIds.add(client.id);
        }
      }

      // Fallback: if client has no opportunities but has legacy stage_id
      if (!placedClientIds.has(client.id) && client.current_stage_id) {
        const stageExists = stagesForPipeline.find(s => s.id === client.current_stage_id);
        if (stageExists) {
          if (!grouped[client.current_stage_id]) grouped[client.current_stage_id] = [];
          grouped[client.current_stage_id].push(client);
          placedClientIds.add(client.id);
        }
      }
    }
    
    // Add "Unassigned" group for clients without any stage placement
    const unassigned = filteredClients.filter(c => !placedClientIds.has(c.id));
    if (unassigned.length > 0) {
      grouped['unassigned'] = unassigned;
    }
    
    return grouped;
  }, [filteredClients, stagesForPipeline, clientOpportunitiesMap]);

  const formatCurrency = (value: number | null) => {
    if (!value) return '-';
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getStageInfo = (stageId: string | null, status: string | null) => {
    const stage = allStages.find(s => s.id === stageId);
    if (stage) {
      return { name: stage.name, color: stage.color };
    }
    // Fallback to status string
    return { name: status || 'Unassigned', color: '#6B7280' };
  };

  // Sync pipelines from GHL
  const handleSyncPipelines = async () => {
    setIsSyncingPipelines(true);
    try {
      const outcome = await runPipelineSyncToCompletion();

      if (outcome.ok) {
        setLastSyncTime(new Date());
        queryClient.invalidateQueries({ queryKey: ['ghl-pipelines'] });
        queryClient.invalidateQueries({ queryKey: ['ghl-pipeline-stages'] });
        queryClient.invalidateQueries({ queryKey: ['ghl-client-opportunities'] });
        queryClient.invalidateQueries({ queryKey: ['client-tracker'] });
        queryClient.invalidateQueries({ queryKey: ['clients'] });
        const summary = `Synced ${outcome.pipelinesFound} pipelines, ${outcome.opportunitiesStored} opportunities, ${outcome.clientsUpdated} clients`;
        // An unfinished walk is said out loud. Reporting it as a clean sync is
        // what let a partial run look identical to a complete one.
        if (outcome.incomplete) {
          toast.warning(`${summary} — still more to sync. Run it again to continue.`);
        } else {
          toast.success(summary);
        }
      } else {
        throw new Error(outcome.error || 'Sync failed');
      }
    } catch (err: any) {
      console.error('Pipeline sync error:', err);
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncingPipelines(false);
    }
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

  const ghlExportFields = [
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'tags', label: 'Tags' },
    { key: 'source', label: 'Source' },
    { key: 'opportunity_name', label: 'Opportunity Name' },
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'stage', label: 'Stage' },
    { key: 'opportunity_status', label: 'Opportunity Status' },
    { key: 'monetary_value', label: 'Monetary Value' },
    { key: 'follow_up_date', label: 'Follow Up Date' },
    { key: 'borrowing_capacity', label: 'Borrowing Capacity' },
    { key: 'proposed_rental_income', label: 'Proposed Rental Income' },
    { key: 'equity_release', label: 'Equity Release' },
    { key: 'pipeline_notes', label: 'Pipeline Notes' },
    { key: 'ghl_contact_id', label: 'GHL Contact ID' },
    { key: 'ghl_opportunity_id', label: 'GHL Opportunity ID' },
  ];
  const ghlExportRecords = filteredClients.map((client) => {
    const stageInfo = getStageInfo(client.current_stage_id, client.pipeline_status);
    const pipeline = pipelines.find((item) => item.id === client.current_pipeline_id);
    const fullName = [client.primary_first_name, client.primary_surname].filter(Boolean).join(' ').trim();
    const opp = opportunities.find((o: any) => o.client_id === client.id) as any;
    return {
      first_name: client.primary_first_name || '',
      last_name: client.primary_surname || '',
      email: client.primary_email || '',
      phone: client.primary_mobile || '',
      tags: 'Tracker Export',
      source: 'Client Tracker',
      opportunity_name: opp?.opportunity_name || (fullName ? `${fullName}${pipeline?.name ? ` — ${pipeline.name}` : ''}` : ''),
      pipeline: pipeline?.name || opp?.pipeline_name || '',
      stage: stageInfo.name || opp?.stage_name || '',
      opportunity_status: client.opportunity_status || opp?.opportunity_status || '',
      monetary_value: opp?.monetary_value?.toString() || '',
      follow_up_date: client.follow_up_date ? format(new Date(client.follow_up_date), 'yyyy-MM-dd') : '',
      borrowing_capacity: client.borrowing_capacity?.toString() || '',
      proposed_rental_income: client.proposed_rental_income?.toString() || '',
      equity_release: client.equity_release?.toString() || '',
      pipeline_notes: client.pipeline_notes || opp?.notes || '',
      ghl_contact_id: client.ghl_contact_id || '',
      ghl_opportunity_id: client.ghl_opportunity_id || opp?.ghl_opportunity_id || '',
    };
  });

  // Helper for event status colors
  const getEventStatusColor = (status: string, appointmentStatus?: string) => {
    const effectiveStatus = appointmentStatus || status;
    switch (effectiveStatus?.toLowerCase()) {
      case 'confirmed':
        return 'bg-success/10 text-success border-success/20';
      case 'showed':
        return 'bg-info/10 text-info border-info/20';
      case 'noshow':
        return 'bg-destructive/10 text-destructive border-destructive/20';
      case 'cancelled':
        return 'bg-muted text-muted-foreground border-muted';
      case 'pending':
        return 'bg-brand-500/10 text-brand-600 border-brand-500/20';
      default:
        return 'bg-secondary text-secondary-foreground border-secondary';
    }
  };

  // Handle appointment card click
  const handleEventClick = (event: GHLEvent) => {
    setSelectedEvent(event);
    setEventModalOpen(true);
  };

  const isLoading = pipelinesLoading || stagesLoading || clientsLoading;

  const isMobile = useIsMobile();

  return (
    <DashboardThemeFrame as="main" variant="page" className="min-h-screen max-w-none space-y-5 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_34%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background))_42%,hsl(var(--muted)/0.18))] p-3 pb-20 md:space-y-6 md:p-6 md:pb-8">
      {/* Header */}
      <DashboardThemeFrame as="header" variant="hero" className="client-tracker-gold-interaction border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.92),hsl(var(--background)/0.82))] p-4 shadow-2xl shadow-sm dark:shadow-black/25 md:p-5">
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary shadow-inner">
            <Target className="h-3.5 w-3.5" /> CRM Workspace
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">Client Tracker</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-[15px]">
            Track clients through your GHL pipelines
            {pipelines.length > 0 && (
              <span className="ml-2 text-xs md:text-sm">
                • {pipelines.length} pipeline{pipelines.length !== 1 ? 's' : ''} synced
              </span>
            )}
          </p>
        </div>
        
        {/* Mobile: Compact action bar */}
        {isMobile ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-background/70 p-2 shadow-inner">
            <div className="client-tracker-gold-interaction flex min-h-10 items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-2.5 py-1.5 shadow-sm transition-colors hover:border-primary/35 hover:bg-primary/15">
              {isAutoSyncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <Zap className={`h-3.5 w-3.5 ${autoSyncEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
              )}
              <Switch
                checked={autoSyncEnabled}
                onCheckedChange={setAutoSyncEnabled}
                className="scale-75"
              />
            </div>
            <Button
              onClick={handleSyncPipelines}
              disabled={isSyncingPipelines}
              variant="default"
              size="sm"
              className="h-10 rounded-xl px-3 text-xs font-semibold shadow-md shadow-primary/20 focus-visible:ring-primary/35"
            >
              {isSyncingPipelines ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button 
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['client-tracker'] });
                queryClient.invalidateQueries({ queryKey: ['ghl-pipelines'] });
                queryClient.invalidateQueries({ queryKey: ['ghl-pipeline-stages'] });
              }} 
              variant="outline" 
              size="sm"
              className="h-10 rounded-xl border-border/70 bg-background/80 shadow-sm transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/35"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Export client tracker" className="h-9 rounded-xl border-border/70 bg-background/80 text-xs text-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/35">
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={actionMenuContentClass}>
                <DropdownMenuItem className={actionMenuItemClass} onClick={() => setShowExportDialog(true)}>
                  <FileText className="mr-2 h-4 w-4 text-primary" />
                  Export current view
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-background/65 p-2 shadow-inner lg:justify-end">
            {/* Auto-sync toggle */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="client-tracker-gold-interaction flex min-h-10 items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 shadow-sm transition-colors hover:border-primary/35 hover:bg-primary/15">
                    {isAutoSyncing ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : (
                      <Zap className={`h-4 w-4 ${autoSyncEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                    )}
                    <span className="text-sm font-medium">Auto-sync</span>
                    <Switch
                      checked={autoSyncEnabled}
                      onCheckedChange={setAutoSyncEnabled}
                      className="scale-90"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Auto-sync every 5 minutes from GHL</p>
                  {lastSyncTime && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3" />
                      Last sync: {formatLastSync(lastSyncTime)}
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            {lastSyncTime && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last sync: {formatLastSync(lastSyncTime)}
              </span>
            )}
            <Button
              onClick={handleSyncPipelines}
              disabled={isSyncingPipelines}
              variant="default"
              size="sm"
              className="h-10 rounded-xl px-4 font-semibold shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/25 focus-visible:ring-primary/35"
            >
              {isSyncingPipelines ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {isSyncingPipelines ? 'Syncing...' : 'Sync from GHL'}
            </Button>
            <Button 
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['client-tracker'] });
                queryClient.invalidateQueries({ queryKey: ['ghl-pipelines'] });
                queryClient.invalidateQueries({ queryKey: ['ghl-pipeline-stages'] });
              }} 
              variant="outline" 
              size="sm"
              className="h-10 rounded-xl border-border/70 bg-background/80 shadow-sm transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/35"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Export client tracker" className="rounded-xl border-border/70 bg-background/80 text-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/35">
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={actionMenuContentClass}>
                <DropdownMenuItem className={actionMenuItemClass} onClick={() => setShowExportDialog(true)}>
                  <FileText className="mr-2 h-4 w-4 text-primary" />
                  Export current view
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        </div>
      </DashboardThemeFrame>

      {/* Stats Cards */}
      <div className="client-tracker-kpi-row grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="client-tracker-kpi-card client-tracker-gold-interaction group relative min-h-[100px] overflow-hidden rounded-[1.15rem] border-primary/20 bg-[linear-gradient(145deg,hsl(var(--card)/0.92),hsl(var(--background)/0.76))] shadow-lg shadow-sm dark:shadow-black/12 transition-all duration-200 before:absolute before:inset-y-4 before:left-0 before:w-0.5 before:rounded-r-full before:bg-primary/70 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/[0.035] hover:shadow-xl hover:shadow-primary/15">
          <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-primary/10 blur-3xl opacity-70 transition-opacity duration-200 group-hover:opacity-100" />
          <CardContent className="relative px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Total Clients</p>
                <p className="mt-2 text-[clamp(2rem,2.4vw,2.625rem)] font-bold leading-none tracking-tight text-foreground">{stats.total}</p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 shadow-inner transition-all duration-200 group-hover:border-primary/45 group-hover:bg-primary/15">
                <Users className="h-4.5 w-4.5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="client-tracker-kpi-card client-tracker-gold-interaction group relative min-h-[100px] overflow-hidden rounded-[1.15rem] border-brand-400/20 bg-[linear-gradient(145deg,hsl(var(--card)/0.92),hsl(var(--background)/0.76))] shadow-lg shadow-sm dark:shadow-black/12 transition-all duration-200 before:absolute before:inset-y-4 before:left-0 before:w-0.5 before:rounded-r-full before:bg-brand-400/75 hover:-translate-y-0.5 hover:border-brand-400/40 hover:bg-brand-400/[0.035] hover:shadow-xl hover:shadow-brand-500/15">
          <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-brand-400/10 blur-3xl opacity-70 transition-opacity duration-200 group-hover:opacity-100" />
          <CardContent className="relative px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">With Follow-ups</p>
                <p className="mt-2 text-[clamp(2rem,2.4vw,2.625rem)] font-bold leading-none tracking-tight text-brand-100">{stats.withFollowUp}</p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-400/25 bg-brand-400/10 shadow-inner transition-all duration-200 group-hover:border-brand-400/45 group-hover:bg-brand-400/15">
                <Clock className="h-4.5 w-4.5 text-brand-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="client-tracker-kpi-card client-tracker-gold-interaction group relative min-h-[100px] overflow-hidden rounded-[1.15rem] border-destructive/20 bg-[linear-gradient(145deg,hsl(var(--card)/0.92),hsl(var(--background)/0.76))] shadow-lg shadow-sm dark:shadow-black/12 transition-all duration-200 before:absolute before:inset-y-4 before:left-0 before:w-0.5 before:rounded-r-full before:bg-destructive/75 hover:-translate-y-0.5 hover:border-destructive/40 hover:bg-destructive/[0.035] hover:shadow-xl hover:shadow-destructive/15">
          <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-destructive/10 blur-3xl opacity-70 transition-opacity duration-200 group-hover:opacity-100" />
          <CardContent className="relative px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Overdue</p>
                <p className="mt-2 text-[clamp(2rem,2.4vw,2.625rem)] font-bold leading-none tracking-tight text-destructive">{stats.overdue}</p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-destructive/25 bg-destructive/10 shadow-inner transition-all duration-200 group-hover:border-destructive/45 group-hover:bg-destructive/15">
                <AlertCircle className="h-4.5 w-4.5 text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="client-tracker-kpi-card client-tracker-gold-interaction group relative min-h-[100px] overflow-hidden rounded-[1.15rem] border-success/20 bg-[linear-gradient(145deg,hsl(var(--card)/0.92),hsl(var(--background)/0.76))] shadow-lg shadow-sm dark:shadow-black/12 transition-all duration-200 before:absolute before:inset-y-4 before:left-0 before:w-0.5 before:rounded-r-full before:bg-success/75 hover:-translate-y-0.5 hover:border-success/40 hover:bg-success/[0.035] hover:shadow-xl hover:shadow-success/15">
          <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-success/10 blur-3xl opacity-70 transition-opacity duration-200 group-hover:opacity-100" />
          <CardContent className="relative px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">In Finance</p>
                <p className="mt-2 text-[clamp(2rem,2.4vw,2.625rem)] font-bold leading-none tracking-tight text-success">{stats.financeStage}</p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-success/25 bg-success/10 shadow-inner transition-all duration-200 group-hover:border-success/45 group-hover:bg-success/15">
                <TrendingUp className="h-4.5 w-4.5 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Appointments from GHL Calendar */}
      {upcomingAppointments.length > 0 && (
        <Card className="border-border/70 bg-card/80 shadow-lg shadow-sm dark:shadow-black/10">
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Video className="h-4 w-4 text-primary" />
                Upcoming Appointments
                <Badge variant="secondary" className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-bold tabular-nums text-primary shadow-inner">
                  {upcomingAppointments.length}
                </Badge>
              </CardTitle>
              {calendarLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ScrollArea horizontal className="w-full">
              <div className="flex gap-3 pb-2">
                {upcomingAppointments.map(event => (
                  <Card 
                    key={event.id} 
                    className="w-72 flex-shrink-0 cursor-pointer border-border/70 bg-background/70 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/5 hover:shadow-lg hover:shadow-primary/10"
                    onClick={() => handleEventClick(event)}
                  >
                    <CardContent className="p-4">
                      {/* Client Name - Full display with icon */}
                      <div className="flex items-start gap-2 mb-2">
                        <User className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-foreground leading-tight">
                            {event.title || 'Untitled Appointment'}
                          </p>
                        </div>
                      </div>
                      
                      {/* Date and Time */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                        <CalendarIcon className="h-3.5 w-3.5" />
                        <span>{format(new Date(event.startTime), 'EEE, MMM d')}</span>
                        <span className="text-muted-foreground/50">•</span>
                        <Clock className="h-3.5 w-3.5" />
                        <span>{format(new Date(event.startTime), 'h:mm a')}</span>
                      </div>
                      
                      {/* Badges row */}
                      <div className="flex flex-wrap gap-1.5">
                        {event.calendarName && (
                          <Badge 
                            variant="outline" 
                            className="max-w-full rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 shadow-sm"
                            style={{ 
                              borderColor: event.calendarColor || 'hsl(var(--border))',
                              color: event.calendarColor || 'hsl(var(--muted-foreground))'
                            }}
                          >
                            {event.calendarName}
                          </Badge>
                        )}
                        {(event.appointmentStatus || event.status) && (
                          <Badge 
                            variant="outline"
                            className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold leading-4 shadow-sm", getEventStatusColor(event.status, event.appointmentStatus))}
                          >
                            {event.appointmentStatus || event.status}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Event Details Modal */}
      <EventDetailsModal
        event={selectedEvent}
        open={eventModalOpen}
        onOpenChange={setEventModalOpen}
        getStatusColor={getEventStatusColor}
        fetchContact={fetchContact}
        onUpdateEvent={updateEvent}
        onDeleteEvent={deleteEvent}
        onRescheduleEvent={async (eventId, data) => {
          const result = await rescheduleEvent(
            eventId,
            data.newStartTime,
            data.newEndTime,
            data.originalStartTime,
            data.originalEndTime,
            { overrideAvailability: data.overrideAvailability, assignedUserId: data.assignedUserId }
          );
          return result;
        }}
      />

      {/* Filters */}
      <DashboardThemeFrame as="section" variant="section" className="client-tracker-gold-interaction relative overflow-hidden rounded-[1.35rem] border-border/70 bg-[linear-gradient(135deg,hsl(var(--card)/0.86),hsl(var(--background)/0.74))] p-3 shadow-xl shadow-sm dark:shadow-black/15">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />
        <div className="relative flex flex-col gap-3 md:flex-row md:items-center">
          <div className="group relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <Input
              placeholder="Search clients..."
              aria-label="Search clients"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="client-tracker-gold-interaction h-11 rounded-xl border-border/70 bg-background/85 pl-10 pr-10 text-sm shadow-inner transition-all placeholder:text-muted-foreground/70 hover:border-primary/30 hover:bg-background/95 focus-visible:border-primary/55 focus-visible:ring-2 focus-visible:ring-primary/30"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear client search"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          
          {/* Mobile: Filters in Sheet */}
          {isMobile ? (
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Open client filters" className="h-11 shrink-0 rounded-xl border-border/70 bg-background/85 px-3 shadow-inner hover:border-primary/30 hover:bg-primary/5 focus-visible:ring-primary/25">
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="h-[60vh] rounded-t-3xl border-border/70 bg-card/95">
                <SheetHeader>
                  <SheetTitle>Filters</SheetTitle>
                </SheetHeader>
                <div className="space-y-4 mt-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Pipeline</label>
                    <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}>
                      <SelectTrigger aria-label="Filter by pipeline" className={cn("client-tracker-gold-interaction h-11 rounded-xl border-border/70 bg-background/85 shadow-inner transition-all hover:border-primary/35 focus:ring-primary/30", selectedPipelineId !== 'all' && "border-primary/45 bg-primary/5")}>
                        <Layers className="mr-2 h-4 w-4 text-primary" />
                        <SelectValue placeholder="Select Pipeline" />
                      </SelectTrigger>
                      <SelectContent className="border-border/70 bg-popover/95 shadow-xl shadow-sm dark:shadow-black/20 backdrop-blur-xl">
                        <SelectItem value="all" className="font-medium text-muted-foreground focus:bg-primary/10 focus:text-foreground">All Pipelines</SelectItem>
                        {pipelines.map(pipeline => (
                          <SelectItem key={pipeline.id} value={pipeline.id} className="focus:bg-primary/10 focus:text-foreground">
                            {pipeline.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Stage</label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger aria-label="Filter by stage" className={cn("client-tracker-gold-interaction h-11 rounded-xl border-border/70 bg-background/85 shadow-inner transition-all hover:border-primary/35 focus:ring-primary/30", statusFilter !== 'all' && "border-primary/45 bg-primary/5")}>
                        <Filter className="mr-2 h-4 w-4 text-primary" />
                        <SelectValue placeholder="Filter by stage" />
                      </SelectTrigger>
                      <SelectContent className="border-border/70 bg-popover/95 shadow-xl shadow-sm dark:shadow-black/20 backdrop-blur-xl">
                        <SelectItem value="all" className="font-medium text-muted-foreground focus:bg-primary/10 focus:text-foreground">All Stages</SelectItem>
                        {stagesForPipeline.map(stage => (
                          <SelectItem key={stage.id} value={stage.name} className="focus:bg-primary/10 focus:text-foreground">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                              {stage.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <>
              {/* Desktop: Inline filters */}
              <Select value={selectedPipelineId} onValueChange={setSelectedPipelineId}>
                <SelectTrigger aria-label="Filter by pipeline" className={cn("client-tracker-gold-interaction h-11 w-full rounded-xl border-border/70 bg-background/85 shadow-inner transition-all hover:border-primary/35 hover:bg-background/95 focus:ring-primary/30 md:w-[230px]", selectedPipelineId !== 'all' && "border-primary/45 bg-primary/5 text-primary")}>
                  <Layers className="mr-2 h-4 w-4 text-primary" />
                  <SelectValue placeholder="Select Pipeline" />
                </SelectTrigger>
                <SelectContent className="border-border/70 bg-popover/95 shadow-xl shadow-sm dark:shadow-black/20 backdrop-blur-xl">
                  <SelectItem value="all" className="font-medium text-muted-foreground focus:bg-primary/10 focus:text-foreground">All Pipelines</SelectItem>
                  {pipelines.map(pipeline => (
                    <SelectItem key={pipeline.id} value={pipeline.id} className="focus:bg-primary/10 focus:text-foreground">
                      {pipeline.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger aria-label="Filter by stage" className={cn("client-tracker-gold-interaction h-11 w-full rounded-xl border-border/70 bg-background/85 shadow-inner transition-all hover:border-primary/35 hover:bg-background/95 focus:ring-primary/30 md:w-[215px]", statusFilter !== 'all' && "border-primary/45 bg-primary/5 text-primary")}>
                  <Filter className="mr-2 h-4 w-4 text-primary" />
                  <SelectValue placeholder="Filter by stage" />
                </SelectTrigger>
                <SelectContent className="border-border/70 bg-popover/95 shadow-xl shadow-sm dark:shadow-black/20 backdrop-blur-xl">
                  <SelectItem value="all" className="font-medium text-muted-foreground focus:bg-primary/10 focus:text-foreground">All Stages</SelectItem>
                  {stagesForPipeline.map(stage => (
                    <SelectItem key={stage.id} value={stage.name} className="focus:bg-primary/10 focus:text-foreground">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                        {stage.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      </DashboardThemeFrame>

      {/* No pipelines synced message */}
      {!isLoading && pipelines.length === 0 && (
        <Card className="overflow-hidden rounded-2xl border-dashed border-primary/25 bg-[linear-gradient(135deg,hsl(var(--card)/0.82),hsl(var(--background)/0.66))] shadow-xl shadow-sm dark:shadow-black/15">
          <CardContent className="py-10 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-inner">
              <Layers className="h-7 w-7" />
            </div>
            <h3 className="mb-2 text-lg font-semibold tracking-tight">No Pipelines Synced</h3>
            <p className="mx-auto mb-5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Click "Sync from GHL" to fetch your GoHighLevel pipelines and opportunities.
            </p>
            <Button onClick={handleSyncPipelines} disabled={isSyncingPipelines} className="rounded-xl font-semibold shadow-md shadow-primary/20">
              {isSyncingPipelines ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Sync from GHL
            </Button>
          </CardContent>
        </Card>
      )}

      <GHLExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        title="Export client tracker for GHL"
        description="Map the current tracker view into GHL-ready headers and export as CSV or XLSX."
        fields={ghlExportFields}
        records={ghlExportRecords}
        fileBaseName={`client-tracker-ghl-export-${format(new Date(), 'yyyy-MM-dd')}`}
        sheetName="Client Tracker"
        onExported={(exportFormat, count) => toast.success(`Exported ${count} tracker records to ${exportFormat.toUpperCase()}`)}
      />

      {/* Tabs for different views */}
      {(pipelines.length > 0 || clients.length > 0) && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="rounded-2xl border border-border/70 bg-card/55 p-3 shadow-xl shadow-sm dark:shadow-black/15 backdrop-blur md:p-4">
          <div className="-mx-3 overflow-x-auto px-3 md:mx-0 md:px-0" aria-label="Client tracker view tabs">
            <TabsList className="inline-flex h-12 w-auto min-w-max gap-1 rounded-2xl border border-border/70 bg-background/80 p-1.5 shadow-inner">
              {!isMobile && (
                <TabsTrigger
                  value="kanban"
                  className="client-tracker-gold-interaction rounded-xl px-4 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:bg-primary/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/25"
                >
                  Kanban Board
                </TabsTrigger>
              )}
              <TabsTrigger
                value="pipeline"
                className="client-tracker-gold-interaction rounded-xl px-4 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:bg-primary/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/25"
              >
                {isMobile ? 'Cards' : 'Pipeline View'}
              </TabsTrigger>
              <TabsTrigger
                value="table"
                className="client-tracker-gold-interaction rounded-xl px-4 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:bg-primary/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/25"
              >
                Table
              </TabsTrigger>
              <TabsTrigger
                value="active"
                className="client-tracker-gold-interaction group rounded-xl px-4 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:bg-primary/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/25"
              >
                <span className="flex items-center gap-2">
                  <UserCheck className="h-3.5 w-3.5" />
                  <span>Active</span>
                  <span className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground transition-colors group-data-[state=active]:border-primary-foreground/35 group-data-[state=active]:bg-primary-foreground/15 group-data-[state=active]:text-primary-foreground">
                    {activeClients.length}
                  </span>
                </span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Kanban Board View */}
          <TabsContent value="kanban" className="mt-5">
            {/* Drag and drop hint */}
            {isDragDropEnabled && (
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-inner">
                <GripVertical className="h-3.5 w-3.5 text-primary" />
                Drag cards to move opportunities between stages
              </div>
            )}
            {!isDragDropEnabled && stagesForPipeline.length > 0 && (
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-inner">
                <Layers className="h-3.5 w-3.5 text-primary" />
                Select a specific pipeline to enable drag-and-drop between stages
              </div>
            )}
            
            <div className="rounded-[1.5rem] border border-border/70 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_24rem),linear-gradient(135deg,hsl(var(--background)/0.72),hsl(var(--card)/0.62))] p-3 shadow-inner shadow-sm dark:shadow-black/20">
              <ScrollArea horizontal className="client-tracker-kanban-scroll w-full whitespace-nowrap rounded-[1.15rem]" aria-label="Kanban board stages">
                <div className="flex gap-4 pb-5 pr-3 sm:gap-5">
                {/* Render stages in order */}
                {stagesForPipeline.map(stage => {
                  const stageClients = groupedByStage[stage.id] || [];
                  const isDragOver = dragOverStageId === stage.id;
                  
                  return (
                    <div 
                      key={stage.id} 
                      className="w-[18.5rem] flex-shrink-0 sm:w-[21rem]"
                      onDragOver={isDragDropEnabled ? (e) => handleDragOver(e, stage.id) : undefined}
                      onDragLeave={isDragDropEnabled ? handleDragLeave : undefined}
                      onDrop={isDragDropEnabled ? (e) => handleDrop(e, stage.id, stage.name) : undefined}
                    >
                      <Card className={cn(
                        "client-tracker-gold-interaction flex h-full min-h-[620px] flex-col overflow-hidden rounded-2xl border-border/70 bg-background/75 shadow-xl shadow-sm dark:shadow-black/15 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-primary/10",
                        draggedClient && isDragDropEnabled && !isDragOver && "border-primary/20 bg-primary/[0.03]",
                        isDragOver && isDragDropEnabled && "client-tracker-drop-glow scale-[1.01] border-primary/70 bg-primary/12 ring-2 ring-primary/45 shadow-2xl shadow-primary/25"
                      )}>
                        <CardHeader className={cn(
                          "border-b border-border/60 bg-[linear-gradient(135deg,hsl(var(--card)/0.58),hsl(var(--background)/0.42))] px-4 py-3.5 transition-colors",
                          isDragOver && isDragDropEnabled && "border-primary/40 bg-primary/10"
                        )}>
                          <div className="flex items-center justify-between gap-3">
                            <CardTitle className="flex min-w-0 items-center gap-2.5 text-sm font-semibold tracking-tight text-foreground">
                              <span className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/80 shadow-inner">
                                <span
                                  className="h-2.5 w-2.5 rounded-full shadow-[0_0_14px_currentColor]"
                                  style={{ backgroundColor: stage.color, color: stage.color }}
                                />
                              </span>
                              <span className="truncate">{stage.name}</span>
                            </CardTitle>
                            <Badge variant="secondary" className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-bold leading-5 tabular-nums text-primary shadow-inner">
                              {stageClients.length}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="flex-1 px-3 pb-3 pt-3">
                          <div className={cn(
                            "client-tracker-kanban-scroll min-h-[500px] max-h-[58vh] space-y-2 overflow-y-auto rounded-xl pr-1",
                            draggedClient && isDragDropEnabled && !isDragOver && "ring-1 ring-primary/10",
                            isDragOver && isDragDropEnabled && "bg-primary/10 ring-2 ring-primary/30"
                          )}>
                            {stageClients.length === 0 ? (
                              <div className={cn(
                                "flex min-h-[9rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-[linear-gradient(135deg,hsl(var(--card)/0.42),hsl(var(--background)/0.28))] px-4 py-10 text-center text-sm font-medium text-muted-foreground",
                                isDragOver && isDragDropEnabled && "border-primary/35 bg-primary/10 text-primary"
                              )}>
                                <Users className="h-5 w-5 text-muted-foreground/70" />
                                <span>{isDragOver && isDragDropEnabled ? 'Drop here' : 'No clients'}</span>
                                {!isDragOver && <span className="text-xs font-normal text-muted-foreground/70">This stage is ready for the next opportunity.</span>}
                              </div>
                            ) : (
                              stageClients.map(client => (
                                <KanbanCard 
                                  key={client.id} 
                                  client={client} 
                                  formatCurrency={formatCurrency}
                                  onEdit={() => setEditingClient(client)}
                                  isDraggable={isDragDropEnabled}
                                  onDragStart={(e) => handleDragStart(e, client)}
                                  onDragEnd={handleDragEnd}
                                  isDragging={draggedClient?.id === client.id}
                                  upcomingAppointment={clientAppointmentMap[client.id]}
                                  opportunities={clientOpportunitiesMap[client.id]}
                                  onToggleFavorite={canEditTracker ? () => toggleFavoriteMutation.mutate({ clientId: client.id, isFavorite: !client.is_favorite }) : undefined}
                                />
                              ))
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  );
                })}

                {/* Unassigned column */}
                {(groupedByStage['unassigned']?.length > 0 || isDragDropEnabled) && (
                  <div 
                    className="w-[18.5rem] flex-shrink-0 sm:w-[21rem]"
                    onDragOver={isDragDropEnabled ? (e) => handleDragOver(e, 'unassigned') : undefined}
                    onDragLeave={isDragDropEnabled ? handleDragLeave : undefined}
                    onDrop={isDragDropEnabled ? (e) => handleDrop(e, null, 'Unassigned') : undefined}
                  >
                    <Card className={cn(
                      "client-tracker-gold-interaction flex h-full min-h-[620px] flex-col overflow-hidden rounded-2xl border-dashed border-border/70 bg-background/60 shadow-xl shadow-sm dark:shadow-black/15 transition-all duration-300 hover:border-primary/35",
                      draggedClient && isDragDropEnabled && dragOverStageId !== 'unassigned' && "border-primary/20 bg-primary/[0.03]",
                      dragOverStageId === 'unassigned' && isDragDropEnabled && "client-tracker-drop-glow scale-[1.01] border-primary/70 bg-primary/12 ring-2 ring-primary/45 shadow-2xl shadow-primary/25"
                    )}>
                      <CardHeader className={cn(
                        "border-b border-border/60 bg-[linear-gradient(135deg,hsl(var(--card)/0.48),hsl(var(--background)/0.34))] px-4 py-3.5 transition-colors",
                        dragOverStageId === 'unassigned' && isDragDropEnabled && "border-primary/40 bg-primary/10"
                      )}>
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="flex min-w-0 items-center gap-2.5 text-sm font-semibold tracking-tight text-muted-foreground">
                            <span className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/80 shadow-inner">
                              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground shadow-[0_0_14px_rgba(156,163,175,0.55)]" />
                            </span>
                            <span className="truncate">Unassigned</span>
                          </CardTitle>
                          <Badge variant="secondary" className="shrink-0 rounded-full border border-border/70 bg-background/80 px-2.5 py-0.5 text-xs font-bold leading-5 tabular-nums text-muted-foreground shadow-inner">
                            {groupedByStage['unassigned']?.length || 0}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1 px-3 pb-3 pt-3">
                        <div className={cn(
                          "client-tracker-kanban-scroll min-h-[500px] max-h-[58vh] space-y-2 overflow-y-auto rounded-xl pr-1",
                          draggedClient && isDragDropEnabled && dragOverStageId !== 'unassigned' && "ring-1 ring-primary/10",
                          dragOverStageId === 'unassigned' && isDragDropEnabled && "bg-primary/10 ring-2 ring-primary/30"
                        )}>
                          {!groupedByStage['unassigned']?.length ? (
                            <div className={cn(
                              "flex min-h-[9rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-[linear-gradient(135deg,hsl(var(--card)/0.42),hsl(var(--background)/0.28))] px-4 py-10 text-center text-sm font-medium text-muted-foreground",
                              dragOverStageId === 'unassigned' && isDragDropEnabled && "border-primary/35 bg-primary/10 text-primary"
                            )}>
                              <Users className="h-5 w-5 text-muted-foreground/70" />
                              <span>{dragOverStageId === 'unassigned' && isDragDropEnabled ? 'Drop here' : 'No clients'}</span>
                              {dragOverStageId !== 'unassigned' && <span className="text-xs font-normal text-muted-foreground/70">Unassigned opportunities will appear here.</span>}
                            </div>
                          ) : (
                            groupedByStage['unassigned'].map(client => (
                              <KanbanCard 
                                key={client.id} 
                                client={client} 
                                formatCurrency={formatCurrency}
                                onEdit={() => setEditingClient(client)}
                                isDraggable={isDragDropEnabled}
                                onDragStart={(e) => handleDragStart(e, client)}
                                onDragEnd={handleDragEnd}
                                isDragging={draggedClient?.id === client.id}
                                upcomingAppointment={clientAppointmentMap[client.id]}
                                opportunities={clientOpportunitiesMap[client.id]}
                                onToggleFavorite={canEditTracker ? () => toggleFavoriteMutation.mutate({ clientId: client.id, isFavorite: !client.is_favorite }) : undefined}
                              />
                            ))
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
                </div>
                <ScrollBar orientation="horizontal" className="h-3" />
              </ScrollArea>
            </div>
          </TabsContent>

          {/* Pipeline List View */}
          <TabsContent value="pipeline" className="mt-4">
            <Card className="overflow-hidden rounded-2xl border-border/70 bg-[linear-gradient(135deg,hsl(var(--background)/0.76),hsl(var(--card)/0.58))] shadow-xl shadow-sm dark:shadow-black/15">
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center gap-3 p-10 text-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Loading clients...</p>
                      <p className="mt-1 text-xs text-muted-foreground">Preparing your pipeline register.</p>
                    </div>
                  </div>
                ) : filteredClients.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 p-10 text-center text-muted-foreground">
                    <Users className="h-7 w-7 text-primary/70" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">No clients found</p>
                      <p className="mt-1 text-xs text-muted-foreground">Adjust search, pipeline or stage filters to broaden the view.</p>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {filteredClients.map(client => {
                      const stageInfo = getStageInfo(client.current_stage_id, client.pipeline_status);
                      const isOverdue = client.follow_up_date && new Date(client.follow_up_date) < new Date();
                      const pipeline = pipelines.find(p => p.id === client.current_pipeline_id);
                      
                      return (
                        <div key={client.id} className="client-tracker-gold-interaction group relative p-4 transition-all duration-200 before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-r-full before:bg-primary/0 before:transition-colors hover:bg-primary/5 hover:shadow-[inset_3px_0_0_hsl(var(--primary)/0.75)] hover:before:bg-primary md:p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2.5">
                                <h3
                                  className="min-w-0 max-w-full truncate text-base font-semibold text-foreground transition-colors group-hover:text-primary"
                                  title={formatFullName(client.primary_first_name, client.primary_surname)}
                                >
                                  {formatFullName(client.primary_first_name, client.primary_surname)}
                                </h3>
                                {pipeline && (
                                  <Badge variant="outline" className={cn(badgeBaseClass, "min-w-0 truncate border-primary/25 bg-primary/5 text-primary")}>
                                    {pipeline.name}
                                  </Badge>
                                )}
                                <Badge 
                                  variant="outline"
                                  className={cn(badgeBaseClass, "min-w-0 truncate border")}
                                  style={getStageBadgeStyle(stageInfo.color)}
                                >
                                  {stageInfo.name}
                                </Badge>
                                {isOverdue && (
                                  <Badge variant="destructive" className={cn(badgeBaseClass, "bg-destructive/15 text-destructive shadow-destructive/15")}>Overdue</Badge>
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                                {client.primary_email && (
                                  <span className="flex min-w-0 items-center gap-1.5" title={client.primary_email}>
                                    <Mail className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                                    <span className="max-w-[18rem] truncate">{client.primary_email}</span>
                                  </span>
                                )}
                                {client.primary_mobile && (
                                  <span className="flex min-w-0 items-center gap-1.5" title={client.primary_mobile}>
                                    <Phone className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                                    <span className="truncate">{client.primary_mobile}</span>
                                  </span>
                                )}
                              </div>
                              {client.follow_up_date && (
                                <div className="mt-2 flex items-center gap-1.5 text-sm">
                                  <CalendarIcon className="h-3 w-3 shrink-0" />
                                  <span className={isOverdue ? 'text-destructive' : 'text-muted-foreground'}>
                                    Follow-up: {format(new Date(client.follow_up_date), 'MMM d, yyyy')}
                                  </span>
                                </div>
                              )}
                              {(client.borrowing_capacity || client.equity_release) && (
                                <div className="flex items-center gap-4 mt-2 text-sm">
                                  {client.borrowing_capacity && (
                                    <span className="flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 font-semibold text-success">
                                      <DollarSign className="h-3 w-3" />
                                      BC: {formatCurrency(client.borrowing_capacity)}
                                    </span>
                                  )}
                                  {client.equity_release && (
                                    <span className="rounded-full border border-info/20 bg-info/10 px-2 py-0.5 font-semibold text-info">
                                      Equity: {formatCurrency(client.equity_release)}
                                    </span>
                                  )}
                                </div>
                              )}
                              {client.pipeline_notes && (
                                <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                                  {client.pipeline_notes}
                                </p>
                              )}
                            </div>
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  aria-label={`Edit ${formatFullName(client.primary_first_name, client.primary_surname)}`}
                                  onClick={() => setEditingClient(client)}
                                  className={cn("h-10 w-10 opacity-85 group-hover:opacity-100", actionIconButtonClass)}
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-lg">
                                <DialogHeader>
                                  <DialogTitle>
                                    Edit Pipeline: {formatFullName(client.primary_first_name, client.primary_surname)}
                                  </DialogTitle>
                                </DialogHeader>
                                <ClientEditForm 
                                  client={client}
                                  stages={allStages}
                                  pipelines={pipelines}
                                  onSave={(data) => updateClientMutation.mutate({ id: client.id, ...data })}
                                  isLoading={updateClientMutation.isPending}
                                />
                              </DialogContent>
                            </Dialog>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Table View */}
          <TabsContent value="table" className="mt-4">
            <Card className="overflow-hidden rounded-2xl border-border/70 bg-[linear-gradient(135deg,hsl(var(--background)/0.76),hsl(var(--card)/0.58))] shadow-xl shadow-sm dark:shadow-black/15">
              <CardContent className="client-tracker-kanban-scroll overflow-x-auto p-0" role="region" aria-label="Client tracker table" tabIndex={0}>
                <Table className="min-w-[1120px]" aria-label="Client tracker client table">
                  <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-xl">
                    <TableRow className="border-border/70 hover:bg-transparent">
                      <TableHead className="h-12 whitespace-nowrap text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Client Name</TableHead>
                      <TableHead className="h-12 whitespace-nowrap text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Pipeline</TableHead>
                      <TableHead className="h-12 whitespace-nowrap text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Stage</TableHead>
                      <TableHead className="h-12 whitespace-nowrap text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Status</TableHead>
                      <TableHead className="h-12 whitespace-nowrap text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Follow-up Date</TableHead>
                      <TableHead className="h-12 whitespace-nowrap text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Last Updated</TableHead>
                      <TableHead className="h-12 whitespace-nowrap text-right text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Borrowing Capacity</TableHead>
                      <TableHead className="h-12 whitespace-nowrap text-right text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Rental Income</TableHead>
                      <TableHead className="h-12 whitespace-nowrap text-right text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Equity Release</TableHead>
                      <TableHead className="h-12 whitespace-nowrap text-right text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={10} className="py-12 text-center">
                          <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                            <div>
                              <p className="text-sm font-semibold text-foreground">Loading clients...</p>
                              <p className="mt-1 text-xs text-muted-foreground">Building your client tracker table.</p>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : filteredClients.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="py-12 text-center">
                          <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
                            <Users className="h-7 w-7 text-primary/70" />
                            <div>
                              <p className="text-sm font-semibold text-foreground">No clients found</p>
                              <p className="mt-1 text-xs text-muted-foreground">No rows match the current search and filters.</p>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : filteredClients.map(client => {
                      const stageInfo = getStageInfo(client.current_stage_id, client.pipeline_status);
                      const pipeline = pipelines.find(p => p.id === client.current_pipeline_id);
                      return (
                        <TableRow key={client.id} className="client-tracker-gold-interaction border-border/55 transition-colors hover:bg-primary/5">
                          <TableCell className="max-w-[220px] font-semibold text-foreground">
                            <span className="block truncate" title={formatFullName(client.primary_first_name, client.primary_surname)}>
                              {formatFullName(client.primary_first_name, client.primary_surname)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {pipeline ? (
                              <Badge variant="outline" className={cn(badgeBaseClass, "max-w-[12rem] truncate border-primary/25 bg-primary/5 text-primary")}>
                                {pipeline.name}
                              </Badge>
                            ) : <span className="text-muted-foreground/55">-</span>}
                          </TableCell>
                          <TableCell>
                            <Badge 
                              variant="outline"
                              className={cn(badgeBaseClass, "max-w-[12rem] truncate border")}
                              style={getStageBadgeStyle(stageInfo.color)}
                            >
                              {stageInfo.name}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {client.opportunity_status ? (
                              <Badge variant="outline" className={getOpportunityStatusBadgeClass(client.opportunity_status)}>
                                {client.opportunity_status.charAt(0).toUpperCase() + client.opportunity_status.slice(1)}
                              </Badge>
                            ) : <span className="text-muted-foreground/55">-</span>}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm tabular-nums">
                            {client.follow_up_date 
                              ? format(new Date(client.follow_up_date), 'MMM d, yyyy')
                              : <span className="text-muted-foreground/55">-</span>
                            }
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                            {client.pipeline_updated_at
                              ? format(new Date(client.pipeline_updated_at), 'MMM d, yyyy')
                              : <span className="text-muted-foreground/55">-</span>
                            }
                          </TableCell>
                          <TableCell className={cn("whitespace-nowrap text-right text-sm font-semibold tabular-nums", client.borrowing_capacity ? "text-success" : "text-muted-foreground/55")}>{formatCurrency(client.borrowing_capacity)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                            {client.proposed_rental_income 
                              ? <span className="font-semibold text-success">${client.proposed_rental_income}/wk</span>
                              : <span className="text-muted-foreground/55">-</span>
                            }
                          </TableCell>
                          <TableCell className={cn("whitespace-nowrap text-right text-sm font-semibold tabular-nums", client.equity_release ? "text-success" : "text-muted-foreground/55")}>{formatCurrency(client.equity_release)}</TableCell>
                          <TableCell className="text-right">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm" aria-label={`Edit ${formatFullName(client.primary_first_name, client.primary_surname)}`} className={cn("h-10 w-10 p-0", actionIconButtonClass)}>
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-lg">
                                <DialogHeader>
                                  <DialogTitle>
                                    Edit: {formatFullName(client.primary_first_name, client.primary_surname)}
                                  </DialogTitle>
                                </DialogHeader>
                                <ClientEditForm 
                                  client={client}
                                  stages={allStages}
                                  pipelines={pipelines}
                                  onSave={(data) => updateClientMutation.mutate({ id: client.id, ...data })}
                                  isLoading={updateClientMutation.isPending}
                                />
                              </DialogContent>
                            </Dialog>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Active Clients View */}
          <TabsContent value="active" className="mt-4">
            <div className="grid gap-4">
              <Card className="overflow-hidden rounded-2xl border-border/70 bg-[linear-gradient(135deg,hsl(var(--background)/0.78),hsl(var(--card)/0.6))] shadow-xl shadow-sm dark:shadow-black/15">
                <CardHeader className="border-b border-border/60 bg-card/35">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                        <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-sm shadow-primary/10">
                          <UserCheck className="h-5 w-5" />
                        </span>
                        Active Clients Notes
                      </CardTitle>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {searchQuery 
                          ? `Showing ${filteredActiveClients.length} of ${activeClients.length} active clients`
                          : `View notes for ${activeClients.length} active clients`
                        }
                      </p>
                    </div>
                    {/* Deal Status Sub-Filters */}
                    <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-border/70 bg-background/70 p-1.5 shadow-inner shadow-sm dark:shadow-black/10">
                      <Button
                        variant={activeDealFilter === 'all' ? 'secondary' : 'ghost'}
                        size="sm"
                        className={cn("h-8 rounded-xl px-3 text-xs font-semibold transition-all", activeDealFilter === 'all' ? "border border-primary/35 bg-primary/15 text-primary shadow-sm shadow-primary/10" : "text-muted-foreground hover:bg-primary/8 hover:text-primary")}
                        onClick={() => setActiveDealFilter('all')}
                      >
                        All ({activeClients.length})
                      </Button>
                      <Button
                        variant={activeDealFilter === 'closed' ? 'secondary' : 'ghost'}
                        size="sm"
                        className={cn("h-8 rounded-xl px-3 text-xs font-semibold transition-all", activeDealFilter === 'closed' ? "border border-primary/35 bg-primary/15 text-primary shadow-sm shadow-primary/10" : "text-muted-foreground hover:bg-primary/8 hover:text-primary")}
                        onClick={() => setActiveDealFilter('closed')}
                      >
                        🏆 Deals Closed ({dealsClosedCount})
                      </Button>
                      <Button
                        variant={activeDealFilter === 'prospects' ? 'secondary' : 'ghost'}
                        size="sm"
                        className={cn("h-8 rounded-xl px-3 text-xs font-semibold transition-all", activeDealFilter === 'prospects' ? "border border-primary/35 bg-primary/15 text-primary shadow-sm shadow-primary/10" : "text-muted-foreground hover:bg-primary/8 hover:text-primary")}
                        onClick={() => setActiveDealFilter('prospects')}
                      >
                        Prospects ({activeClients.length - dealsClosedCount})
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 sm:p-5">
                  {filteredActiveClients.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/35 px-4 py-10 text-center text-sm text-muted-foreground">
                      <UserCheck className="h-7 w-7 text-primary/70" />
                      <div>
                        <p className="font-semibold text-foreground">
                          {searchQuery ? 'No matching active clients found' : 'No active clients found'}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {searchQuery ? 'Try clearing search terms or active-client filters.' : 'Favourite clients will appear here for note follow-up.'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Grid of client cards with infinite scroll */}
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {filteredActiveClients
                          .slice(0, displayedActiveCount)
                          .map(client => {
                            const stageInfo = getStageInfo(client.current_stage_id, client.pipeline_status);
                            
                            return (
                              <ActiveClientCard
                                key={client.id}
                                client={client}
                                stageInfo={stageInfo}
                              />
                            );
                          })}
                      </div>

                      {/* Load More Button */}
                      {filteredActiveClients.length > displayedActiveCount && (
                        <div className="mt-6 flex justify-center">
                          <Button
                            variant="outline"
                            onClick={() => setDisplayedActiveCount(prev => prev + LOAD_MORE_COUNT)}
                            className="gap-2 rounded-xl border-primary/25 bg-primary/5 text-primary transition-all hover:border-primary/45 hover:bg-primary/10"
                          >
                            <Loader2 className="h-4 w-4" />
                            Load More ({filteredActiveClients.length - displayedActiveCount} remaining)
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Edit Dialog (for Kanban cards) - Sheet on mobile, Dialog on desktop */}
      {editingClient && (
        isMobile ? (
          <Sheet open={!!editingClient} onOpenChange={() => setEditingClient(null)}>
            <SheetContent side="bottom" className="h-[90vh] overflow-y-auto rounded-t-xl">
              <SheetHeader>
                <SheetTitle>
                  Edit: {formatFullName(editingClient.primary_first_name, editingClient.primary_surname)}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4">
                <ClientEditForm 
                  client={editingClient}
                  stages={allStages}
                  pipelines={pipelines}
                  onSave={(data) => updateClientMutation.mutate({ id: editingClient.id, ...data })}
                  isLoading={updateClientMutation.isPending}
                />
              </div>
            </SheetContent>
          </Sheet>
        ) : (
          <Dialog open={!!editingClient} onOpenChange={() => setEditingClient(null)}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  Edit: {formatFullName(editingClient.primary_first_name, editingClient.primary_surname)}
                </DialogTitle>
              </DialogHeader>
              <ClientEditForm 
                client={editingClient}
                stages={allStages}
                pipelines={pipelines}
                onSave={(data) => updateClientMutation.mutate({ id: editingClient.id, ...data })}
                isLoading={updateClientMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        )
      )}
    </DashboardThemeFrame>
  );
}

// Kanban Card Component
interface KanbanCardProps {
  client: TrackedClient;
  formatCurrency: (value: number | null) => string;
  onEdit: () => void;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragging?: boolean;
  upcomingAppointment?: GHLEvent | null;
  opportunities?: ClientOpportunity[];
  onToggleFavorite?: () => void;
}

function KanbanCard({
  client,
  formatCurrency,
  onEdit,
  isDraggable = false,
  onDragStart,
  onDragEnd,
  isDragging = false,
  upcomingAppointment,
  opportunities = [],
  onToggleFavorite,
}: KanbanCardProps) {
  const isOverdue = client.follow_up_date && new Date(client.follow_up_date) < new Date();
  const otherPipelines = opportunities.filter(o => o.pipeline_name).map(o => o.pipeline_name);
  const uniquePipelines = [...new Set(otherPipelines)];
  
  return (
    <Card 
      className={cn(
        "client-tracker-gold-interaction group relative overflow-hidden rounded-2xl border-border/70 bg-[linear-gradient(145deg,hsl(var(--card)/0.96),hsl(var(--background)/0.72))] p-3.5 shadow-md shadow-sm dark:shadow-black/15 transition-all duration-300 before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-r-full before:bg-primary/0 before:transition-colors hover:-translate-y-1 hover:border-primary/40 hover:bg-primary/5 hover:shadow-xl hover:shadow-primary/15 hover:before:bg-primary/80",
        isDraggable && "cursor-grab active:cursor-grabbing",
        isDragging && "client-tracker-drop-glow z-20 -rotate-1 scale-[1.02] cursor-grabbing border-primary/80 bg-primary/12 opacity-90 shadow-2xl shadow-primary/30 ring-2 ring-primary/60 before:bg-primary"
      )}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Edit ${formatFullName(client.primary_first_name, client.primary_surname)}`}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {isDraggable && (
            <GripVertical className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
          )}
          <h4
            className="line-clamp-2 text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-primary"
            title={formatFullName(client.primary_first_name, client.primary_surname)}
          >
            {formatFullName(client.primary_first_name, client.primary_surname)}
          </h4>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isOverdue && (
            <Badge variant="destructive" className={cn(compactBadgeBaseClass, "bg-destructive/15 text-destructive shadow-destructive/15")}>
              Overdue
            </Badge>
          )}
          {client.deal_status === 'closed' && (
            <Badge variant="default" className={cn(compactBadgeBaseClass, "bg-success/15 text-success shadow-success/15")}>
              🏆
            </Badge>
          )}
          {onToggleFavorite && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              onKeyDown={(e) => e.stopPropagation()}
              draggable={false}
              aria-label={client.is_favorite ? 'Remove from active clients' : 'Add to active clients'}
              aria-pressed={!!client.is_favorite}
              title={client.is_favorite ? 'Remove from active clients' : 'Add to active clients'}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                client.is_favorite
                  ? 'text-primary hover:bg-primary/10'
                  : 'text-muted-foreground/60 hover:bg-primary/10 hover:text-primary'
              )}
            >
              <Star className={cn('h-3.5 w-3.5', client.is_favorite && 'fill-current')} />
            </button>
          )}
        </div>
      </div>
      
      {client.primary_email && (
        <p
          className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
          title={client.primary_email}
        >
          <Mail className="h-3.5 w-3.5 shrink-0 text-primary/70" />
          <span className="truncate">{client.primary_email}</span>
        </p>
      )}
      
      {client.primary_mobile && (
        <p
          className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
          title={client.primary_mobile}
        >
          <Phone className="h-3.5 w-3.5 shrink-0 text-primary/70" />
          <span className="truncate">{client.primary_mobile}</span>
        </p>
      )}
      
      {/* Status & Timestamp metadata */}
      {(client.opportunity_status || client.pipeline_updated_at) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {client.opportunity_status && (
            <Badge 
              variant="outline" 
              className={getOpportunityStatusBadgeClass(client.opportunity_status, true)}
            >
              {client.opportunity_status.charAt(0).toUpperCase() + client.opportunity_status.slice(1)}
            </Badge>
          )}
          {client.pipeline_updated_at && (
            <span className="flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Clock className="h-2.5 w-2.5 text-primary/70" />
              {format(new Date(client.pipeline_updated_at), 'MMM d')}
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        {client.follow_up_date && (
          <p className={cn(
            "flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-xs font-medium",
            isOverdue ? 'text-destructive' : 'text-muted-foreground'
          )}>
            <CalendarIcon className="h-3 w-3 shrink-0" />
            {format(new Date(client.follow_up_date), 'MMM d')}
          </p>
        )}
        {client.borrowing_capacity && (
          <p className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-xs font-bold leading-5 text-success shadow-inner">
            {formatCurrency(client.borrowing_capacity)}
          </p>
        )}
      </div>

      {/* Upcoming appointment */}
      {upcomingAppointment && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-border/70 pt-2.5 text-xs">
          <Video className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
          <span className="truncate text-muted-foreground">
            {format(new Date(upcomingAppointment.startTime), 'MMM d, h:mm a')}
          </span>
        </div>
      )}

      {/* Other pipeline memberships */}
      {uniquePipelines.length > 1 && (
        <div className="mt-3 border-t border-border/70 pt-2.5">
          <div className="flex flex-wrap gap-1.5">
            {uniquePipelines.slice(0, 2).map(name => (
              <Badge key={name} variant="outline" className="max-w-full rounded-full border-border/70 bg-background/70 px-1.5 py-0 text-[9px] font-medium leading-4 text-muted-foreground">
                {name && name.length > 15 ? name.substring(0, 13) + '...' : name}
              </Badge>
            ))}
            {uniquePipelines.length > 2 && (
              <Badge variant="outline" className="rounded-full border-border/70 bg-background/70 px-1.5 py-0 text-[9px] font-medium leading-4 text-muted-foreground">
                +{uniquePipelines.length - 2}
              </Badge>
            )}
          </div>
        </div>
      )}
      
      {client.pipeline_notes && (
        <p className="mt-3 line-clamp-2 border-t border-border/70 pt-2.5 text-xs leading-relaxed text-muted-foreground">
          {client.pipeline_notes}
        </p>
      )}
    </Card>
  );
}

// Client Edit Form Component
interface ClientEditFormProps {
  client: TrackedClient;
  stages: GHLPipelineStage[];
  pipelines: GHLPipeline[];
  onSave: (data: Partial<TrackedClient>) => void;
  isLoading: boolean;
}

function ClientEditForm({ client, stages, pipelines, onSave, isLoading }: ClientEditFormProps) {
  const [formData, setFormData] = useState({
    current_stage_id: client.current_stage_id || '',
    pipeline_status: client.pipeline_status || '',
    follow_up_date: client.follow_up_date || '',
    borrowing_capacity: client.borrowing_capacity?.toString() || '',
    proposed_rental_income: client.proposed_rental_income?.toString() || '',
    equity_release: client.equity_release?.toString() || '',
    pipeline_notes: client.pipeline_notes || '',
  });

  // Get stages for the client's current pipeline
  const pipelineStages = client.current_pipeline_id 
    ? stages.filter(s => s.pipeline_id === client.current_pipeline_id)
    : stages;

  const handleStageChange = (stageId: string) => {
    const stage = stages.find(s => s.id === stageId);
    setFormData(prev => ({ 
      ...prev, 
      current_stage_id: stageId,
      pipeline_status: stage?.name || prev.pipeline_status
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      current_stage_id: formData.current_stage_id || null,
      pipeline_status: formData.pipeline_status,
      follow_up_date: formData.follow_up_date || null,
      borrowing_capacity: formData.borrowing_capacity ? parseFloat(formData.borrowing_capacity) : null,
      proposed_rental_income: formData.proposed_rental_income ? parseFloat(formData.proposed_rental_income) : null,
      equity_release: formData.equity_release ? parseFloat(formData.equity_release) : null,
      pipeline_notes: formData.pipeline_notes || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium">Pipeline Stage</label>
        <Select 
          value={formData.current_stage_id} 
          onValueChange={handleStageChange}
        >
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Select a stage" />
          </SelectTrigger>
          <SelectContent>
            {pipelineStages.map(stage => (
              <SelectItem key={stage.id} value={stage.id}>
                <div className="flex items-center gap-2">
                  <span 
                    className="w-2 h-2 rounded-full" 
                    style={{ backgroundColor: stage.color }}
                  />
                  {stage.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="text-sm font-medium">Follow-up Date</label>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full justify-start text-left font-normal mt-1">
              <CalendarIcon className="mr-2 h-4 w-4" />
              {formData.follow_up_date 
                ? format(new Date(formData.follow_up_date), 'PPP')
                : 'Pick a date'
              }
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={formData.follow_up_date ? new Date(formData.follow_up_date) : undefined}
              onSelect={(date) => setFormData(prev => ({ 
                ...prev, 
                follow_up_date: date ? format(date, 'yyyy-MM-dd') : '' 
              }))}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-sm font-medium">Borrowing Capacity</label>
          <Input
            type="number"
            placeholder="$0"
            value={formData.borrowing_capacity}
            onChange={(e) => setFormData(prev => ({ ...prev, borrowing_capacity: e.target.value }))}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Rental (weekly)</label>
          <Input
            type="number"
            placeholder="$0"
            value={formData.proposed_rental_income}
            onChange={(e) => setFormData(prev => ({ ...prev, proposed_rental_income: e.target.value }))}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Equity Release</label>
          <Input
            type="number"
            placeholder="$0"
            value={formData.equity_release}
            onChange={(e) => setFormData(prev => ({ ...prev, equity_release: e.target.value }))}
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium">Notes</label>
        <Textarea
          placeholder="Add pipeline notes..."
          value={formData.pipeline_notes}
          onChange={(e) => setFormData(prev => ({ ...prev, pipeline_notes: e.target.value }))}
          className="mt-1 min-h-[100px]"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading}>
          <Save className="h-4 w-4 mr-2" />
          {isLoading ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
}
