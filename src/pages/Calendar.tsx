import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, Users, Filter, RefreshCw, GripVertical, LayoutList, Flame, BarChart3, TrendingUp, AlertTriangle, Sparkles, Plus, Layers, Repeat, Bell, X, PanelLeftClose, PanelLeft, Menu, Mail, Pin, PinOff } from 'lucide-react';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { planBookingNotifications } from '@/lib/calendar/bookingNotifications.pure';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GHLExportDialog } from '@/components/shared/GHLExportDialog';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useGHLCalendar, GHLEvent } from '@/hooks/useGHLCalendar';
import { useCalendarKeyboard } from '@/hooks/useCalendarKeyboard';
import { EventDetailsModal } from '@/components/calendar/EventDetailsModal';
import { CalendarSearchDropdown } from '@/components/calendar/CalendarSearchDropdown';
import { TimelineView } from '@/components/calendar/TimelineView';
import { DraggableEvent } from '@/components/calendar/DraggableEvent';
import { eventColourSource, statusBadgeClass } from '@/lib/calendar/eventColour.pure';
import { byStartTimeAscending } from '@/lib/calendar/eventOrder.pure';
import { FALLBACK_CALENDAR_COLOR } from '@/lib/calendarColors';
import { DropZone } from '@/components/calendar/DropZone';
import { AvailabilitySlots } from '@/components/calendar/AvailabilitySlots';
import { CalendarHeatmap } from '@/components/calendar/CalendarHeatmap';
import { TimeAllocationDashboard } from '@/components/calendar/TimeAllocationDashboard';
import { WeeklySummaryCards } from '@/components/calendar/WeeklySummaryCards';
import { ConflictDetection } from '@/components/calendar/ConflictDetection';
import { ResourceOptimization } from '@/components/calendar/ResourceOptimization';
import { QuickAddAppointmentModal } from '@/components/calendar/QuickAddAppointmentModal';
import { MultiCalendarOverlay } from '@/components/calendar/MultiCalendarOverlay';
import {
  allVisibleCalendarIds,
  isEventVisible,
  knownCalendarIds,
} from '@/lib/calendar/calendarVisibility.pure';
import { RecurringPatterns } from '@/components/calendar/RecurringPatterns';
import { SmartReminders } from '@/components/calendar/SmartReminders';
import { CalendarPeriodPicker } from '@/components/calendar/CalendarPeriodPicker';
import { EnhancedEventPreview } from '@/components/calendar/EnhancedEventPreview';
import { KeyboardShortcutsHint } from '@/components/calendar/KeyboardShortcutsHint';
import { CalendarLoadingSkeleton, StatsLoadingSkeleton, SidebarLoadingSkeleton } from '@/components/calendar/CalendarLoadingSkeleton';
import { BatchActions } from '@/components/calendar/BatchActions';
import { OutlookCalendarPanel } from '@/components/calendar/OutlookCalendarPanel';
import { useOutlookCalendar } from '@/hooks/useOutlookCalendar';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, addMonths, subMonths, startOfWeek, endOfWeek, isSameMonth, addWeeks, subWeeks, getHours, addHours, differenceInMilliseconds, addMinutes, setHours, setMinutes } from 'date-fns';
import { cn } from '@/lib/utils';
import { toTimezoneISO } from '@/lib/sydneyTime';
import { formatInSydney } from '@/lib/timezoneUtils';
import { getBookingTimezone } from '@/lib/bookingTimezone';
import { useAuth } from '@/hooks/useAuth';
import { loadCalendarToolsPreference, orderCalendarTools, saveCalendarToolsPreference } from '@/lib/calendarTools';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuTrigger } from '@/components/ui/context-menu';

// Sidebar tab type
type SidebarTab = 'events' | 'availability' | 'heatmap' | 'analytics' | 'summary' | 'conflicts' | 'optimize' | 'overlay' | 'outlook' | 'patterns' | 'reminders';

// Module-level helper functions for date parsing/formatting
const safeParseISO = (value: string | undefined | null): Date | null => {
  try {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;

    // Handle numeric timestamps that arrive as strings
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      const ms = n < 1_000_000_000_000 ? n * 1000 : n;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const d = parseISO(trimmed);
    if (!Number.isNaN(d.getTime())) return d;

    const fallbackMs = Date.parse(trimmed);
    if (!Number.isNaN(fallbackMs)) return new Date(fallbackMs);

    return null;
  } catch {
    return null;
  }
};

const safeFormatISO = (value: string | undefined | null, fmt: string): string => {
  const d = value ? safeParseISO(value) : null;
  return d ? format(d, fmt) : '—';
};

// Tab configurations with icons and shortcuts
const SIDEBAR_TABS: { id: SidebarTab; icon: React.ReactNode; label: string; shortcut: string; defaultOrder: number }[] = [
  { id: 'events', icon: <CalendarIcon className="h-4 w-4" />, label: 'Events', shortcut: '1', defaultOrder: 0 },
  { id: 'availability', icon: <Clock className="h-4 w-4" />, label: 'Availability', shortcut: '2', defaultOrder: 1 },
  { id: 'heatmap', icon: <Flame className="h-4 w-4" />, label: 'Heatmap', shortcut: '4', defaultOrder: 2 },
  { id: 'analytics', icon: <BarChart3 className="h-4 w-4" />, label: 'Analytics', shortcut: '5', defaultOrder: 3 },
  { id: 'summary', icon: <TrendingUp className="h-4 w-4" />, label: 'Summary', shortcut: '6', defaultOrder: 4 },
  { id: 'conflicts', icon: <AlertTriangle className="h-4 w-4" />, label: 'Conflicts', shortcut: '7', defaultOrder: 5 },
  { id: 'optimize', icon: <Sparkles className="h-4 w-4" />, label: 'Optimize', shortcut: '8', defaultOrder: 6 },
  { id: 'overlay', icon: <Layers className="h-4 w-4" />, label: 'Overlay', shortcut: '9', defaultOrder: 7 },
  { id: 'outlook', icon: <Mail className="h-4 w-4" />, label: 'Outlook', shortcut: '', defaultOrder: 8 },
  { id: 'patterns', icon: <Repeat className="h-4 w-4" />, label: 'Patterns', shortcut: '', defaultOrder: 9 },
  { id: 'reminders', icon: <Bell className="h-4 w-4" />, label: 'Reminders', shortcut: '', defaultOrder: 10 },
];
const DEFAULT_PINNED_TABS: SidebarTab[] = ['events', 'conflicts'];

const CALENDAR_PAGE_SHELL = 'relative -m-4 space-y-6 bg-background p-4 font-sans text-foreground md:-m-6 md:p-6';
const PREMIUM_CARD = 'dashboard-theme-premium-card border-border/70 bg-card/90 text-card-foreground shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl transition-all duration-200 ease-out dark:border-white/10 dark:bg-background/80 dark:shadow-black/30';
const PREMIUM_PANEL = 'dashboard-theme-section border-border/60 bg-card/80 text-card-foreground shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur-xl transition-all duration-200 ease-out dark:border-white/10 dark:bg-background/70 dark:shadow-black/30';
const PREMIUM_BUTTON = 'border-border/70 bg-card/85 text-foreground transition-all duration-200 ease-out hover:border-primary/40 hover:bg-primary/10 hover:text-primary hover:shadow-[0_10px_28px_hsl(var(--primary)/0.12)] dark:border-white/10 dark:bg-background/55';

export default function Calendar() {
  const calendarPageRef = useRef<HTMLElement | null>(null);
  const { canEdit: canEditCalendar } = useModulePermissions('calendar');
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { calendars, failedCalendars, events, calendarGroups, contactCache, isLoading, isUpdating, error, fetchCalendarData, fetchCalendarGroups, fetchContact, getCalendarColor, rescheduleEvent, updateEvent, deleteEvent, createAppointment, searchContacts, blockSlot, fetchFreeSlots } = useGHLCalendar();
  const {
    outlookEvents, outlookTruncated, teamAvailability, isLoading: outlookLoading, isCreating: outlookCreating,
    outlookEnabled, microsoftEmail, fetchOutlookEvents, createOutlookEvent, updateOutlookEvent,
    deleteOutlookEvent, fetchTeamAvailability, getMicrosoftEmail, setMicrosoftEmail, createPrepBlock,
  } = useOutlookCalendar();
  const [outlookVisible, setOutlookVisible] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('events');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pinnedTabs, setPinnedTabs] = useState<SidebarTab[]>(DEFAULT_PINNED_TABS);
  const [contextMenuTab, setContextMenuTab] = useState<SidebarTab | null>(null);
  const [quickAddModalOpen, setQuickAddModalOpen] = useState(false);
  const [quickAddDefaultHour, setQuickAddDefaultHour] = useState<number | undefined>(undefined);
  const [visibleCalendars, setVisibleCalendars] = useState<Set<string>>(new Set());
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('all');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [view, setView] = useState<'month' | 'week' | 'timeline'>('month');
  const [selectedEvent, setSelectedEvent] = useState<GHLEvent | null>(null);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggingEvent, setDraggingEvent] = useState<GHLEvent | null>(null);
  const [viewTransition, setViewTransition] = useState<'enter' | 'exit' | null>(null);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const { toast } = useToast();

  const orderedSidebarTabs = useMemo(
    () => orderCalendarTools(SIDEBAR_TABS, pinnedTabs),
    [pinnedTabs],
  );

  useEffect(() => {
    if (!user?.id) {
      setPinnedTabs(DEFAULT_PINNED_TABS);
      return;
    }

    const savedTabs = loadCalendarToolsPreference(user.id, new Set(SIDEBAR_TABS.map((tab) => tab.id)));
    setPinnedTabs((savedTabs ?? DEFAULT_PINNED_TABS) as SidebarTab[]);
  }, [user?.id]);

  useEffect(() => {
    const bodyClass = 'calendar-page-active';
    const styleId = 'calendar-page-scrollbar-fix-style';
    document.body.classList.add(bodyClass);

    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
        body.${bodyClass} .dashboard-main,
        body.${bodyClass} .dashboard-content,
        body.${bodyClass} .dashboard-page-shell,
        body.${bodyClass} .dashboard-sidebar-content,
        body.${bodyClass} .calendar-page-scrollbar-fix {
          scrollbar-width: none;
          -ms-overflow-style: none;
          scrollbar-gutter: auto;
        }

        body.${bodyClass} .dashboard-main::-webkit-scrollbar,
        body.${bodyClass} .dashboard-content::-webkit-scrollbar,
        body.${bodyClass} .dashboard-page-shell::-webkit-scrollbar,
        body.${bodyClass} .dashboard-sidebar-content::-webkit-scrollbar,
        body.${bodyClass} .calendar-page-scrollbar-fix::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }

        body.${bodyClass} .dashboard-main,
        body.${bodyClass} .dashboard-content,
        body.${bodyClass} .dashboard-page-shell {
          touch-action: pan-y;
        }
      `;
      document.head.appendChild(styleEl);
    }

    // Radix modal primitives temporarily lock pointer input on <body>. When a
    // tooltip, context menu and select close in the same frame, an old lock can
    // survive their unmount and make wheel/touch scrolling appear frozen.
    // A popper wrapper alone is not evidence of an open modal: tooltip wrappers
    // can remain mounted during their closing animation. Only state-aware modal
    // content keeps the lock; otherwise release it after Radix has completed its
    // own close-frame cleanup.
    const releaseStuckOverlayLocks = () => {
      const hasPointerLock = document.body.style.pointerEvents === 'none';
      const hasScrollLock = document.body.hasAttribute('data-scroll-locked');
      if (!hasPointerLock && !hasScrollLock) return;

      const blockingOverlayOpen = document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"], [data-vaul-drawer][data-state="open"]',
      );
      if (blockingOverlayOpen) return;

      if (hasPointerLock) document.body.style.removeProperty('pointer-events');
      if (hasScrollLock) document.body.removeAttribute('data-scroll-locked');
    };

    let pointerLockFrame: number | null = null;
    let pointerLockSettleFrame: number | null = null;
    const schedulePointerLockCheck = () => {
      if (pointerLockFrame !== null) return;
      pointerLockFrame = window.requestAnimationFrame(() => {
        pointerLockFrame = null;
        pointerLockSettleFrame = window.requestAnimationFrame(() => {
          pointerLockSettleFrame = null;
          releaseStuckOverlayLocks();
        });
      });
    };

    const observer = new MutationObserver(schedulePointerLockCheck);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style'],
      childList: true,
      subtree: true,
    });
    window.addEventListener('focus', schedulePointerLockCheck);
    document.addEventListener('pointerup', schedulePointerLockCheck, true);
    document.addEventListener('keyup', schedulePointerLockCheck, true);

    return () => {
      observer.disconnect();
      if (pointerLockFrame !== null) window.cancelAnimationFrame(pointerLockFrame);
      if (pointerLockSettleFrame !== null) window.cancelAnimationFrame(pointerLockSettleFrame);
      window.removeEventListener('focus', schedulePointerLockCheck);
      document.removeEventListener('pointerup', schedulePointerLockCheck, true);
      document.removeEventListener('keyup', schedulePointerLockCheck, true);
      releaseStuckOverlayLocks();
      document.body.classList.remove(bodyClass);
      document.getElementById(styleId)?.remove();
    };
  }, []);

  useEffect(() => {
    const calendarPage = calendarPageRef.current;
    if (!calendarPage) return;

    // The dashboard has two different scroll owners: `.dashboard-main` on
    // mobile/tablet and the document viewport on desktop. Interactive calendar
    // descendants (native draggable events, drop zones and Radix triggers) can
    // consume a wheel gesture before it reaches either owner. That is why the
    // same wheel scrolls over the empty gutter but appears frozen over the
    // calendar and registry below it.
    //
    // Bridge vertical wheel input from this page to the actual owner. Genuine
    // nested vertical scrollers retain control, as do horizontal gestures and
    // Ctrl/Meta+wheel browser zoom.
    const handleCalendarWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.deltaY === 0) return;

      let nestedScroller = event.target instanceof Element ? event.target : null;
      while (nestedScroller && nestedScroller !== calendarPage) {
        const style = window.getComputedStyle(nestedScroller);
        const canScrollVertically = /^(auto|scroll)$/.test(style.overflowY)
          && nestedScroller.scrollHeight > nestedScroller.clientHeight;
        const hasRoom = event.deltaY < 0
          ? nestedScroller.scrollTop > 0
          : nestedScroller.scrollTop + nestedScroller.clientHeight < nestedScroller.scrollHeight - 1;
        if (canScrollVertically && hasRoom) return;
        nestedScroller = nestedScroller.parentElement;
      }

      const dashboardMain = calendarPage.closest('.dashboard-main');
      const mainStyle = dashboardMain instanceof HTMLElement
        ? window.getComputedStyle(dashboardMain)
        : null;
      const mainOwnsScroll = dashboardMain instanceof HTMLElement
        && /^(auto|scroll)$/.test(mainStyle?.overflowY ?? '')
        && dashboardMain.scrollHeight > dashboardMain.clientHeight;

      const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1;
      const deltaY = event.deltaY * multiplier;

      event.preventDefault();
      if (mainOwnsScroll) {
        dashboardMain.scrollBy({ top: deltaY, behavior: 'auto' });
      } else {
        window.scrollBy({ top: deltaY, behavior: 'auto' });
      }
    };

    calendarPage.addEventListener('wheel', handleCalendarWheel, { passive: false, capture: true });
    return () => calendarPage.removeEventListener('wheel', handleCalendarWheel, { capture: true });
  }, []);


  // Keyboard navigation hook
  const { TAB_SHORTCUTS } = useCalendarKeyboard({
    view,
    selectedDate,
    setSelectedDate,
    currentMonth,
    setCurrentMonth,
    currentWeek,
    setCurrentWeek,
    sidebarTab,
    setSidebarTab,
    setQuickAddModalOpen,
  });

  // Smart tab ordering based on context
  const smartOrderedTabs = useMemo(() => {
    const order: SidebarTab[] = [];

    // If selected date has conflicts, prioritize conflicts tab
    if (selectedDate) {
      const dayEvents = events.filter(e => {
        const d = safeParseISO(e.startTime);
        return d ? isSameDay(d, selectedDate) : false;
      });

      // Check for overlapping events (conflicts)
      const hasConflicts = dayEvents.some((event, i) => {
        const start1 = safeParseISO(event.startTime);
        const end1 = safeParseISO(event.endTime);
        if (!start1 || !end1) return false;

        return dayEvents.slice(i + 1).some(other => {
          const start2 = safeParseISO(other.startTime);
          const end2 = safeParseISO(other.endTime);
          if (!start2 || !end2) return false;
          return start1 < end2 && start2 < end1;
        });
      });

      if (hasConflicts) {
        order.push('conflicts');
      }

      if (dayEvents.length > 5) {
        order.push('analytics');
      }
    }

    return order;
  }, [selectedDate, events]);

  // Pin state is ID-based and the source definitions stay canonical. The grid
  // order is derived from this ordered collection, never mutated in place.
  const handleTogglePin = useCallback((tab: SidebarTab) => {
    const previousTabs = pinnedTabs;
    const isPinned = previousTabs.includes(tab);
    const nextTabs = isPinned
      ? previousTabs.filter((id) => id !== tab)
      : [tab, ...previousTabs.filter((id) => id !== tab)];
    const tabLabel = SIDEBAR_TABS.find((item) => item.id === tab)?.label ?? 'Tool';

    setPinnedTabs(nextTabs);
    setContextMenuTab(null);

    try {
      if (user?.id) saveCalendarToolsPreference(user.id, nextTabs);
      toast({
        title: isPinned ? `${tabLabel} unpinned.` : `${tabLabel} pinned to the front.`,
      });
    } catch {
      setPinnedTabs(previousTabs);
      toast({
        variant: 'destructive',
        title: 'Unable to save your Calendar tool order.',
        description: 'Your previous layout has been restored.',
      });
    }
  }, [pinnedTabs, toast, user?.id]);

  // Handle view transitions with animation
  const handleViewChange = useCallback((newView: 'month' | 'week' | 'timeline') => {
    if (newView === view) return;
    setViewTransition('exit');
    setTimeout(() => {
      setView(newView);
      setViewTransition('enter');
      setTimeout(() => setViewTransition(null), 300);
    }, 150);
  }, [view]);

  const getVisibleRange = () => {
    if (view === 'month') {
      const start = startOfWeek(startOfMonth(currentMonth));
      const end = endOfWeek(endOfMonth(currentMonth));
      return { start, end };
    }

    const start = startOfWeek(currentWeek);
    const end = endOfWeek(currentWeek);
    return { start, end };
  };

  const handleRefresh = useCallback(() => {
    const { start, end } = getVisibleRange();
    fetchCalendarData(start.toISOString(), end.toISOString());
    fetchOutlookEvents(start.toISOString(), end.toISOString());
  }, [view, currentMonth, currentWeek]);

  useEffect(() => {
    handleRefresh();
  }, [fetchCalendarData, view, currentMonth, currentWeek]);

  // Initialize visible calendars once, when calendars first load.
  //
  // Guarded by a ref rather than by `size === 0`: the old guard re-ran
  // whenever a background refresh replaced the calendar list, so "Hide all"
  // (an empty set) was undone by the next sync tick — one more way audit item
  // 26's toggles appeared to do nothing. The set includes the Other row, so
  // appointments on no listed calendar start visible like everything else.
  const overlayInitialisedRef = useRef(false);
  useEffect(() => {
    if (calendars.length > 0 && !overlayInitialisedRef.current) {
      overlayInitialisedRef.current = true;
      setVisibleCalendars(allVisibleCalendarIds(calendars));
    }
  }, [calendars]);

  // Calendar overlay handlers
  const handleToggleCalendar = useCallback((calendarId: string) => {
    setVisibleCalendars(prev => {
      const next = new Set(prev);
      if (next.has(calendarId)) {
        next.delete(calendarId);
      } else {
        next.add(calendarId);
      }
      return next;
    });
  }, []);

  const handleShowAllCalendars = useCallback(() => {
    setVisibleCalendars(allVisibleCalendarIds(calendars));
  }, [calendars]);

  const handleHideAllCalendars = useCallback(() => {
    setVisibleCalendars(new Set());
  }, []);

  // Batch actions handlers
  const handleToggleEventSelect = useCallback((eventId: string) => {
    setSelectedEventIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  const handleSelectAllEvents = useCallback(() => {
    const dayEvents = selectedDate
      ? events.filter(e => {
          const d = safeParseISO(e.startTime);
          return d ? isSameDay(d, selectedDate) : false;
        })
      : events;
    setSelectedEventIds(new Set(dayEvents.map(e => e.id)));
  }, [selectedDate, events]);

  const handleClearEventSelection = useCallback(() => {
    setSelectedEventIds(new Set());
  }, []);

  const handleBatchDelete = useCallback(async (eventIds: string[]) => {
    // Delete events one by one (could be optimized with batch API if available)
    for (const id of eventIds) {
      await deleteEvent(id);
    }
    toast({
      title: 'Events deleted',
      description: `${eventIds.length} event(s) have been deleted`,
    });
  }, [deleteEvent, toast]);

  const handleBatchReschedule = useCallback((eventIds: string[]) => {
    toast({
      title: 'Batch reschedule',
      description: `Select a new date to reschedule ${eventIds.length} event(s)`,
    });
    // TODO: Implement batch reschedule modal
  }, [toast]);

  // Handle drag-and-drop rescheduling
  const handleEventDrop = useCallback(async (event: GHLEvent, targetDate: Date, targetHour?: number) => {
    const originalStart = safeParseISO(event.startTime);
    const originalEnd = safeParseISO(event.endTime);

    if (!originalStart || !originalEnd) {
      toast({
        title: 'Cannot reschedule',
        description: 'Event has invalid time data.',
        variant: 'destructive',
      });
      return;
    }

    // Calculate duration
    const duration = differenceInMilliseconds(originalEnd, originalStart);

    // Build new start time - interpret in configured booking timezone
    // Using static imports from top of file
    const bookingTz = getBookingTimezone();

    let newStartDate: Date;
    if (targetHour !== undefined) {
      newStartDate = new Date(targetDate);
      newStartDate.setHours(targetHour, 0, 0, 0);
    } else {
      newStartDate = new Date(targetDate);
      newStartDate.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);
    }

    // Convert the visual date/time to booking-timezone-anchored UTC
    const dateStr = `${newStartDate.getFullYear()}-${String(newStartDate.getMonth() + 1).padStart(2, '0')}-${String(newStartDate.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(newStartDate.getHours()).padStart(2, '0')}:${String(newStartDate.getMinutes()).padStart(2, '0')}`;
    const newStartISO = toTimezoneISO(dateStr, timeStr, bookingTz);

    // Calculate end from duration
    const endTotalMs = new Date(newStartISO).getTime() + duration;
    const newEndISO = new Date(endTotalMs).toISOString();

    // Check if actually moved
    if (newStartISO === event.startTime) {
      return; // No change
    }

    const result = await rescheduleEvent(
      event.id,
      newStartISO,
      newEndISO,
      event.startTime,
      event.endTime
    );

    if (result.success) {
      toast({
        title: 'Event rescheduled',
        description: `Moved to ${formatInSydney(newStartISO)}`,
        action: result.undo ? (
          <Button variant="outline" size="sm" onClick={() => result.undo?.()}>
            Undo
          </Button>
        ) : undefined,
      });
    }
  }, [rescheduleEvent, toast]);

  const toSearchable = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '');

  const filteredEvents = useMemo(() => {
    let filtered = events;

    // Filter by visible calendars (multi-calendar overlay).
    //
    // Membership, always, once the overlay has initialised — through the same
    // rule the panel counts by (`calendarVisibility.pure.ts`). The old guard
    // only filtered between the extremes (`0 < visible < all`), which meant
    // "Hide all" bypassed the filter and showed EVERYTHING; and it tested raw
    // membership, so an appointment on no listed calendar — which is most of
    // this tenant's real bookings — vanished the moment any single unrelated
    // calendar was switched off. Those appointments belong to the panel's
    // "Other appointments" row now, and follow its toggle.
    if (overlayInitialisedRef.current) {
      const knownIds = knownCalendarIds(calendars);
      filtered = filtered.filter((event) => isEventVisible(event.calendarId, visibleCalendars, knownIds));
    }

    if (selectedCalendarId !== 'all') {
      filtered = filtered.filter((event) => event.calendarId === selectedCalendarId);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (event) =>
          toSearchable(event.title).includes(query) ||
          toSearchable(event.notes).includes(query) ||
          toSearchable(event.address).includes(query)
      );
    }

    // Merge Outlook events as GHLEvent-compatible objects when visible
    if (outlookVisible && outlookEvents.length > 0) {
      const outlookAsGHL: GHLEvent[] = outlookEvents
        .filter(oe => oe.startTime && oe.endTime)
        .map(oe => ({
          id: oe.id,
          title: oe.title,
          startTime: oe.startTime!,
          endTime: oe.endTime!,
          calendarId: oe.calendarId,
          calendarName: oe.calendarName,
          calendarColor: oe.calendarColor,
          status: oe.status,
          appointmentStatus: undefined,
          contactId: undefined,
          notes: oe.bodyPreview || undefined,
          address: oe.location || undefined,
        }));

      // Apply search filter to Outlook events too
      let filteredOutlook = outlookAsGHL;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filteredOutlook = filteredOutlook.filter(
          (event) =>
            toSearchable(event.title).includes(query) ||
            toSearchable(event.notes).includes(query) ||
            toSearchable(event.address).includes(query)
        );
      }

      filtered = [...filtered, ...filteredOutlook];
    }

    return filtered;
    // `visibleCalendars` and `calendars` are READ above (the overlay filter)
    // and were missing here, so toggling a calendar in the overlay changed the
    // state and this never recomputed — the grid, the events list, conflicts,
    // the heatmap and analytics all kept the old set. That is audit item 26:
    // "toggling on and off the calendar overlay but nothing happens". The
    // Outlook toggle worked only because `outlookVisible` was already listed.
  }, [events, calendars, visibleCalendars, selectedCalendarId, searchQuery, outlookVisible, outlookEvents]);

  const ghlExportFields = [
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'tags', label: 'Tags' },
    { key: 'source', label: 'Source' },
    { key: 'appointment_id', label: 'Appointment ID' },
    { key: 'appointment_title', label: 'Appointment Title' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'status', label: 'Status' },
    { key: 'start_date', label: 'Start Date' },
    { key: 'end_date', label: 'End Date' },
    { key: 'notes', label: 'Notes' },
    { key: 'address', label: 'Address' },
    { key: 'contact_id', label: 'Contact ID' },
  ];

  const ghlExportRecords = filteredEvents.map((event) => ({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    tags: 'Appointment Export',
    source: 'GHL Calendar',
    appointment_id: event.id || '',
    appointment_title: event.title || '',
    calendar: event.calendarName || '',
    status: event.appointmentStatus || event.status || '',
    start_date: safeFormatISO(event.startTime, 'yyyy-MM-dd HH:mm:ss'),
    end_date: safeFormatISO(event.endTime, 'yyyy-MM-dd HH:mm:ss'),
    notes: event.notes || '',
    address: event.address || '',
    contact_id: event.contactId || '',
  }));

  const selectedDateEvents = useMemo(() => {
    if (!selectedDate) return [];
    return filteredEvents
      .filter((event) => {
        const d = safeParseISO(event.startTime);
        return d ? isSameDay(d, selectedDate) : false;
      })
      .sort(byStartTimeAscending(safeParseISO));
  }, [filteredEvents, selectedDate]);

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return filteredEvents
      .map((e) => ({ e, d: safeParseISO(e.startTime) }))
      .filter((x) => x.d && x.d >= now)
      .sort((a, b) => a.d!.getTime() - b.d!.getTime())
      .slice(0, 10)
      .map((x) => x.e);
  }, [filteredEvents]);




  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(currentWeek);
    const weekEnd = endOfWeek(currentWeek);
    return eachDayOfInterval({ start: weekStart, end: weekEnd });
  }, [currentWeek]);

  const weekHours = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => i);
  }, []);

  // Earliest first. This only filtered before, so a day's pills came out in
  // whatever order the provider happened to return — which is why the 28th read
  // 16:00 above 13:00 while the 29th read 14:00 above 16:00 on the same screen.
  // An unparseable start sorts last rather than throwing the order away.
  const getEventsForDay = (day: Date) => {
    return filteredEvents
      .filter((event) => {
        const d = safeParseISO(event.startTime);
        return d ? isSameDay(d, day) : false;
      })
      .sort(byStartTimeAscending(safeParseISO));
  };

  const getEventsForDayAndHour = (day: Date, hour: number) => {
    return filteredEvents.filter((event) => {
      const eventStart = safeParseISO(event.startTime);
      return eventStart ? isSameDay(eventStart, day) && getHours(eventStart) === hour : false;
    });
  };

  // Delegates, so the chip here and the analytics breakdown cannot drift into
  // two status vocabularies — which is how "Confirmed" came to wear a calendar's
  // green dot on one panel and a badge on another.
  const getStatusColor = (status: string, appointmentStatus?: string) =>
    statusBadgeClass(appointmentStatus || status);

  const handleEventClick = (event: GHLEvent) => {
    setSelectedEvent(event);
    setEventModalOpen(true);
  };

  const getEventStyle = (event: GHLEvent) => {
    const status = (event.appointmentStatus || event.status || '').toLowerCase();

    // Outlook events - Microsoft blue styling
    if (event.calendarId?.startsWith('outlook_')) {
      return {
        backgroundColor: 'hsl(207 89% 41% / 0.15)',
        borderLeft: '3px solid hsl(207 89% 41%)',
        color: 'hsl(207 89% 41%)',
      };
    }

    // Only an EXCEPTIONAL state may take the pill's colour away from the
    // calendar it belongs to. `confirmed` is not exceptional — it is how a live
    // booking looks — and giving it a branch here painted every event on the
    // grid the same green, so which calendar a booking belonged to (the one
    // thing a month view is scanned for) never reached the pill. The events
    // list beside it colours by calendar, which is why the two disagreed on
    // screen. `eventColourSource` is the one place that rule is written.
    if (eventColourSource(status) === 'status') {
      // Cancelled - destructive, struck through.
      if (status === 'cancelled' || status === 'canceled') {
        return {
          backgroundColor: 'hsl(var(--destructive) / 0.15)',
          borderLeft: '3px solid hsl(var(--destructive))',
          color: 'hsl(var(--destructive))',
          textDecoration: 'line-through',
          opacity: 0.8,
        };
      }

      // Rescheduled - this slot is not the one.
      if (status === 'rescheduled') {
        return {
          backgroundColor: 'hsl(var(--warning) / 0.15)',
          borderLeft: '3px solid hsl(var(--warning))',
          color: 'hsl(var(--warning))',
        };
      }

      // No-show - destructive, dimmed.
      return {
        backgroundColor: 'hsl(var(--destructive) / 0.1)',
        borderLeft: '3px solid hsl(var(--destructive) / 0.6)',
        color: 'hsl(var(--destructive) / 0.7)',
        opacity: 0.7,
      };
    }

    const color = event.calendarColor || getCalendarColor(event.calendarId);
    return {
      backgroundColor: `${color}20`,
      borderLeft: `3px solid ${color}`,
      color: color,
    };
  };

  /**
   * Cancel an appointment and tell the people who were invited to it.
   *
   * Audit item 33: only the client heard about a cancellation. The command
   * centre set `appointmentStatus: 'cancelled'` on GHL and stopped there — GHL
   * emails the client, and the additional contact and finance partner, who were
   * invited by `send-appointment-notification`, were never told.
   *
   * The recipient list is resolved SERVER-side from what was actually invited,
   * because this page has never held it: the cancel path knows an event id and
   * nothing else.
   *
   * The notice is best-effort and deliberately after the fact. A cancellation
   * that succeeded must not be reported as failed because an email did not go,
   * and it must not be attempted twice.
   */
  const cancelEventAndNotify = useCallback(async (event: GHLEvent) => {
    const result = await updateEvent(event.id, { appointmentStatus: 'cancelled' });
    if (!result?.success) return result;

    try {
      await invokeSecureFunction('send-appointment-notification', {
        kind: 'cancelled',
        appointmentGhlId: event.id,
        appointmentTitle: event.title || 'Appointment',
        appointmentStart: event.startTime,
        appointmentEnd: event.endTime,
        // Deliberately not sent: the ledger recorded what kind of meeting this
        // is when it was booked. Hardcoding 'call' here cancelled every Zoom
        // meeting as a "Phone Call".
        appointmentNotes: event.notes || undefined,
        // The Zoom link, for a Zoom booking. GHL keeps it on `address`, and
        // nothing used to pass it here — audit item 33.
        appointmentLocation: event.address || undefined,
        calendarName: event.calendarName,
        // Omitted on purpose — the server reads who was invited.
        recipients: [],
      });
    } catch (err) {
      console.error('[Calendar] Cancellation notice failed to send', err);
    }

    return result;
  }, [updateEvent]);

  // Go to today
  const goToToday = useCallback(() => {
    const today = new Date();
    setCurrentMonth(today);
    setCurrentWeek(today);
    setSelectedDate(today);
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedDate(null);
  }, []);

  // Swipe gestures for mobile calendar navigation
  const calendarSwipeHandlers = useSwipeGesture(
    useCallback(() => {
      // Swipe left = navigate forward (only in month view to avoid conflict with week horizontal scroll)
      if (view === 'month') setCurrentMonth(addMonths(currentMonth, 1));
    }, [view, currentMonth]),
    useCallback(() => {
      // Swipe right = navigate backward (only in month view)
      if (view === 'month') setCurrentMonth(subMonths(currentMonth, 1));
    }, [view, currentMonth]),
    { threshold: 60 }
  );

  if (error) {
    return (
      <DashboardThemeFrame variant="page" className={cn(CALENDAR_PAGE_SHELL, "max-w-none")}>
        <DashboardThemeFrame variant="hero" className="p-5 md:p-7">
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground md:text-5xl">Calendar</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground/90 md:text-base">GoHighLevel Calendar Integration</p>
        </DashboardThemeFrame>
        <Card className={cn(PREMIUM_CARD, "overflow-hidden rounded-2xl border-destructive/25 bg-destructive/5")}>
          <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <p className="mb-2 text-sm font-semibold text-destructive">Calendar sync error</p>
            <p className="mb-5 max-w-xl text-sm text-destructive-foreground/75">{error}</p>
            <Button
              onClick={() => {
                const { start, end } = getVisibleRange();
                fetchCalendarData(start.toISOString(), end.toISOString());
              }}
              variant="outline"
              className="rounded-xl border-destructive/25 bg-destructive/10 text-destructive transition-all hover:border-destructive/40 hover:bg-destructive/15 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/40"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </DashboardThemeFrame>
    );
  }

  return (
    <DashboardThemeFrame ref={calendarPageRef} variant="page" className={cn(CALENDAR_PAGE_SHELL, "calendar-page-scrollbar-fix max-w-none [scrollbar-gutter:auto]")}>
      <GHLExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        title="Export calendar for GHL"
        description="Map appointment fields to GHL import headers and export the current calendar view as CSV or XLSX."
        fields={ghlExportFields}
        records={ghlExportRecords}
        fileBaseName={`ghl-calendar-export-${format(new Date(), 'yyyy-MM-dd')}`}
        sheetName="Calendar Export"
        onExported={(exportFormat, count) => toast({ title: 'Exported', description: `Saved ${count} calendar items as ${exportFormat.toUpperCase()}` })}
      />

      {/* Event Details Modal with Edit/Delete */}
      <EventDetailsModal
        event={selectedEvent}
        open={eventModalOpen}
        onOpenChange={setEventModalOpen}
        getStatusColor={getStatusColor}
        fetchContact={fetchContact}
        onUpdateEvent={updateEvent}
        onDeleteEvent={deleteEvent}
        calendars={calendars}
        onRescheduleEvent={async (eventId, data) => {
          const selectedCal = calendars.find(c => c.id === selectedEvent?.calendarId);
          const assignedUserId = data.assignedUserId || selectedCal?.teamMembers?.[0]?.userId || undefined;

          // Call the GHL reschedule (update action)
          const result = await rescheduleEvent(
            eventId,
            data.newStartTime,
            data.newEndTime,
            data.originalStartTime,
            data.originalEndTime,
            { overrideAvailability: data.overrideAvailability, assignedUserId, notes: data.notes }
          );

          if (result.success) {
            /**
             * Tell everyone who was invited, whether or not the operator
             * re-typed them.
             *
             * This used to send only to whoever was re-selected on the
             * reschedule form, and to skip the call entirely when nobody was —
             * so the additional contact and the finance partner from the
             * original booking heard nothing unless somebody remembered to add
             * them again by hand. `send-appointment-notification` already
             * resolves the invited list from the booking when it is handed
             * none, which is how cancellation works; a reschedule just never
             * reached that path.
             *
             * An empty list is therefore sent deliberately, and means "whoever
             * was invited" rather than "nobody".
             */
            const reselected = [
              ...(data.secondaryRecipients || []),
              ...(data.bookingRecipients || []).map(br => ({
                // No fabricated id. `finance_contact_id` is nullable now, and
                // a made-up one is not a finance partner — it wrote a row the
                // ledger could not interpret, when the column let it through.
                financeContactId: null,
                role: 'additional_contact' as const,
                name: br.name,
                email: br.email,
              })),
            ];

            try {
              const calendarName = selectedCal?.name;
              const { data: notifyResult } = await invokeSecureFunction('send-appointment-notification', {
                kind: 'rescheduled',
                appointmentGhlId: eventId,
                appointmentTitle: selectedEvent?.title || 'Appointment',
                appointmentStart: data.newStartTime,
                appointmentEnd: data.newEndTime,
                // Not sent for the same reason: 'reschedule' is the kind
                // of notice, not a kind of meeting, and it printed verbatim.
                appointmentNotes: selectedEvent?.notes,
                appointmentLocation: selectedEvent?.address || undefined,
                calendarName,
                recipients: reselected,
              });
              const notified = Array.isArray(notifyResult?.results)
                ? notifyResult.results.length
                : reselected.length;
              if (notified > 0) {
                toast({
                  title: 'Notifications sent',
                  description: `${notified} recipient(s) notified of reschedule.`,
                });
              }
            } catch (err: any) {
              console.error('Failed to send reschedule notifications:', err);
              toast({
                title: 'Rescheduled, but notifications failed',
                description: err.message || 'Could not send email notifications.',
                variant: 'destructive',
              });
            }
          }

          return result;
        }}
      />

      {/* Batch Actions Bar */}
      <BatchActions
        events={selectedDate ? selectedDateEvents : filteredEvents}
        selectedEventIds={selectedEventIds}
        onToggleSelect={handleToggleEventSelect}
        onSelectAll={handleSelectAllEvents}
        onClearSelection={handleClearEventSelection}
        onBatchDelete={handleBatchDelete}
        onBatchReschedule={handleBatchReschedule}
        isLoading={isUpdating}
      />

      {/* Header */}
      <DashboardThemeFrame as="section" variant="hero" className="overflow-visible rounded-2xl p-4 md:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="hidden rounded-2xl border border-primary/25 bg-primary/10 p-3 text-primary shadow-[0_12px_35px_hsl(var(--primary)/0.12)] sm:block">
                <CalendarIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  Scheduling command centre
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">Calendar</h1>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  GoHighLevel Appointments
                  {isUpdating && <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary shadow-sm shadow-primary/10 animate-pulse">Updating...</span>}
                </p>
                {/*
                  A calendar cut short reads exactly like a quiet one. Outlook
                  used to return one page of 200 events ordered by start time,
                  so a busy period lost its END and the grid simply stopped
                  drawing partway through the month with nothing said. The walk
                  follows every page now; this is what it looks like when even
                  the page ceiling binds.
                */}
                {outlookVisible && outlookTruncated && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-warning">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Outlook returned more events than this view can hold — narrow the date range to see them all.
                  </p>
                )}
                {/*
                  Same rule on the GoHighLevel side: one calendar failing does
                  not blank the page, and used to say nothing at all, so an
                  unread calendar and an empty one were the same column.
                */}
                {failedCalendars.length > 0 && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-warning">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Could not load {failedCalendars.length === 1 ? 'one calendar' : `${failedCalendars.length} calendars`}
                    {' '}({failedCalendars.join(', ')}) — appointments on {failedCalendars.length === 1 ? 'it' : 'them'} are not shown.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-10 rounded-xl border-border bg-card/85 px-3 font-semibold text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 active:translate-y-0 active:scale-[0.98]">
                    <Mail className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setShowExportDialog(true)}>
                    Export current view
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Mobile sidebar trigger */}
              {isMobile && (
              <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
                <SheetTrigger asChild>
                  <Button aria-label="Open calendar tools" variant="outline" size="icon" className={cn(PREMIUM_BUTTON, "h-10 w-10 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/45 active:scale-95")}>
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="flex h-full w-full flex-col border-border bg-popover p-0 shadow-[0_22px_70px_hsl(0_0%_0%/0.45)] backdrop-blur-xl sm:w-[340px]">
                  <SheetHeader className="shrink-0 border-b border-border bg-background/55 p-4">
                    <SheetTitle className="text-foreground">Calendar Tools</SheetTitle>
                  </SheetHeader>
                  <div className="flex flex-col flex-1 overflow-hidden">
                    {/* Tab triggers - scrollable horizontally */}
                    <div className="shrink-0 overflow-x-auto border-b border-border px-4 py-3">
                      <div className="inline-flex flex-wrap gap-2">
                        {orderedSidebarTabs.map(tab => (
                          <ContextMenu key={tab.id} modal={false} onOpenChange={(open) => setContextMenuTab(open ? tab.id : null)}>
                          <ContextMenuTrigger asChild>
                          <button
                            aria-pressed={sidebarTab === tab.id}
                            aria-label={`${tab.label}${pinnedTabs.includes(tab.id) ? ', pinned' : ''}`}
                            aria-haspopup="menu"
                            aria-expanded={contextMenuTab === tab.id}
                            onClick={() => setSidebarTab(tab.id)}
                            className={cn(
                              "relative inline-flex min-h-[40px] touch-manipulation items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45",
                              sidebarTab === tab.id
                                ? "border border-primary/50 bg-primary/20 text-primary shadow-[0_10px_24px_hsl(var(--primary)/0.14)]"
                                : "border border-border bg-background/55 text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                            )}
                          >
                            {tab.icon}
                            <span>{tab.label}</span>
                            {pinnedTabs.includes(tab.id) && <Pin aria-hidden="true" className="absolute right-1 top-1 h-3 w-3 text-primary" />}
                          </button>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuLabel>{tab.label} {pinnedTabs.includes(tab.id) ? '(pinned)' : ''}</ContextMenuLabel>
                            <ContextMenuItem onSelect={() => handleTogglePin(tab.id)}>
                              {pinnedTabs.includes(tab.id) ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
                              {pinnedTabs.includes(tab.id) ? 'Unpin' : 'Pin to front'}
                            </ContextMenuItem>
                          </ContextMenuContent>
                          </ContextMenu>
                        ))}
                      </div>
                    </div>
                    {/* Tab content */}
                    <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 scrollbar-hide">



                      {sidebarTab === 'events' && (
                        <div>
                          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Clock className="h-4 w-4 text-primary" />
                            {selectedDate ? format(selectedDate, 'EEEE, MMM d') : 'Upcoming'}
                          </h4>
                          {isLoading ? (
                            <SidebarLoadingSkeleton />
                          ) : (selectedDate ? selectedDateEvents : upcomingEvents).length === 0 ? (
                            <div className="rounded-2xl border border-border bg-background/55 px-4 py-8 text-center text-muted-foreground shadow-inner shadow-sm dark:shadow-black/20">
                              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary/80">
                                <CalendarIcon className="h-5 w-5" />
                              </div>
                              <p className="text-sm font-medium text-muted-foreground">No events {selectedDate ? 'on this day' : 'upcoming'}</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {(selectedDate ? selectedDateEvents : upcomingEvents).map(event => (
                                <EventCard key={event.id} event={event} getStatusColor={getStatusColor} onClick={() => { handleEventClick(event); setMobileSidebarOpen(false); }} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {sidebarTab === 'availability' && selectedDate && (
                        <AvailabilitySlots selectedDate={selectedDate} events={filteredEvents} onSlotClick={(startTime) => {
                          setQuickAddDefaultHour(startTime.getHours());
                          setQuickAddModalOpen(true);
                          setMobileSidebarOpen(false);
                        }} />
                      )}
                      {sidebarTab === 'heatmap' && (
                        <CalendarHeatmap events={filteredEvents} currentMonth={currentMonth} selectedDate={selectedDate} onDateSelect={(date) => { setSelectedDate(date); setSidebarTab('events'); }} />
                      )}
                      {sidebarTab === 'analytics' && (
                        <TimeAllocationDashboard events={filteredEvents} calendars={calendars} currentWeek={currentWeek} selectedDate={selectedDate} />
                      )}
                      {sidebarTab === 'summary' && (
                        <WeeklySummaryCards events={filteredEvents} currentWeek={currentWeek} selectedDate={selectedDate} />
                      )}
                      {sidebarTab === 'conflicts' && (
                        <ConflictDetection events={filteredEvents} onEventClick={(event) => { handleEventClick(event); setMobileSidebarOpen(false); }} selectedDate={selectedDate} />
                      )}
                      {sidebarTab === 'optimize' && (
                        <ResourceOptimization
                          events={filteredEvents}
                          currentWeek={currentWeek}
                          selectedDate={selectedDate}
                          onSlotSelect={(date, hour) => {
                            setSelectedDate(date);
                            setQuickAddDefaultHour(hour);
                            setQuickAddModalOpen(true);
                            setMobileSidebarOpen(false);
                          }}
                        />
                      )}
                      {sidebarTab === 'overlay' && (
                        <MultiCalendarOverlay
                          calendars={calendars}
                          events={events}
                          visibleCalendars={visibleCalendars}
                          onToggleCalendar={handleToggleCalendar}
                          onShowAll={handleShowAllCalendars}
                          onHideAll={handleHideAllCalendars}
                          outlookEnabled={outlookEnabled}
                          outlookVisible={outlookVisible}
                          onToggleOutlook={() => setOutlookVisible(v => !v)}
                          outlookEventCount={outlookEvents.length}
                          microsoftEmail={microsoftEmail}
                        />
                      )}
                      {sidebarTab === 'outlook' && (
                        <OutlookCalendarPanel
                          outlookEvents={outlookEvents}
                          teamAvailability={teamAvailability}
                          isLoading={outlookLoading}
                          isCreating={outlookCreating}
                          outlookEnabled={outlookEnabled}
                          microsoftEmail={microsoftEmail}
                          onRefresh={() => { const { start, end } = getVisibleRange(); fetchOutlookEvents(start.toISOString(), end.toISOString()); }}
                          onFetchTeam={() => { const { start, end } = getVisibleRange(); fetchTeamAvailability(start.toISOString(), end.toISOString()); }}
                          onCreateEvent={createOutlookEvent}
                          onDeleteEvent={deleteOutlookEvent}
                          onSetMicrosoftEmail={setMicrosoftEmail}
                          onGetMicrosoftEmail={getMicrosoftEmail}
                          outlookVisible={outlookVisible}
                          onToggleOutlookVisible={() => setOutlookVisible(v => !v)}
                          selectedDate={selectedDate}
                          onCreatePrepBlock={createPrepBlock}
                        />
                      )}
                      {sidebarTab === 'patterns' && (
                        <RecurringPatterns events={events} onPatternClick={(pattern) => toast({ title: 'Pattern detected', description: pattern.title })} />
                      )}
                      {sidebarTab === 'reminders' && (
                        <SmartReminders calendars={calendars} />
                      )}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
              )}
              <Button
                aria-label="Refresh calendar"
                variant="outline"
                size="icon"
                className={cn(PREMIUM_BUTTON, "h-10 w-10 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/45 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60")}
                onClick={handleRefresh}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Controls row - scrollable on mobile */}
          <DashboardThemeFrame variant="toolbar" className="p-2.5">
            {!isMobile && <KeyboardShortcutsHint />}
            <CalendarSearchDropdown
              events={events}
              contactCache={contactCache}
              fetchContact={fetchContact}
              onSelectEvent={(event) => {
                setSelectedEvent(event);
                setEventModalOpen(true);
              }}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
            />
            <Tabs value={view} onValueChange={(v) => handleViewChange(v as 'month' | 'week' | 'timeline')}>
              <TabsList className="h-10 w-full rounded-xl border border-border bg-card/80 p-1 shadow-inner shadow-sm dark:shadow-black/20 sm:w-auto">
                <TabsTrigger value="month" className="h-8 rounded-lg px-3 text-xs text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:hover:bg-muted/50 data-[state=inactive]:hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40">Month</TabsTrigger>
                <TabsTrigger value="week" className="h-8 rounded-lg px-3 text-xs text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:hover:bg-muted/50 data-[state=inactive]:hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40">Week</TabsTrigger>
                {!isMobile && (
                  <TabsTrigger value="timeline" className="flex h-8 items-center gap-1 rounded-lg px-3 text-xs text-muted-foreground transition-all data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=inactive]:hover:bg-muted/50 data-[state=inactive]:hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40">
                    <LayoutList className="h-3 w-3" />
                    Timeline
                  </TabsTrigger>
                )}
              </TabsList>
            </Tabs>
            <Select value={selectedCalendarId} onValueChange={setSelectedCalendarId}>
              <SelectTrigger className="h-10 w-full min-w-[200px] flex-1 shrink-0 rounded-xl border-border bg-card/80 px-3 text-sm shadow-inner shadow-sm dark:shadow-black/20 transition-all hover:border-primary/30 hover:bg-primary/10 focus:ring-2 focus:ring-primary/40 sm:w-[220px] sm:flex-none">
                <Filter className="mr-2 h-4 w-4 text-primary/80" />
                <SelectValue placeholder="All Calendars" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border bg-popover shadow-[0_18px_60px_hsl(0_0%_0%/0.4)] backdrop-blur-xl">
                <SelectItem value="all">All Calendars</SelectItem>
                {calendars.map(cal => (
                  <SelectItem key={cal.id} value={cal.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full shrink-0 ring-2 ring-black/30 shadow-sm"
                        style={{ backgroundColor: getCalendarColor(cal.id) }}
                      />
                      <span className="truncate max-w-[120px]">{cal.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </DashboardThemeFrame>
        </div>
      </DashboardThemeFrame>

      {/* Stats Row */}
      {isLoading ? (
        <StatsLoadingSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className={cn(PREMIUM_CARD, "group py-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card/85 hover:shadow-[0_22px_70px_hsl(0_0%_0%/0.42)]")}>
            <CardContent className="flex items-start justify-between gap-4 px-5 py-4">
              <div>
                <div className="text-3xl font-bold leading-none tracking-tight text-foreground">{calendars.length}</div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Calendars</p>
              </div>
              <div className="rounded-2xl border border-border bg-card/85 p-3 text-muted-foreground transition-all group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary">
                <CalendarIcon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card className={cn(PREMIUM_CARD, "group py-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card/85 hover:shadow-[0_22px_70px_hsl(0_0%_0%/0.42)]")}>
            <CardContent className="flex items-start justify-between gap-4 px-5 py-4">
              <div>
                <div className="text-3xl font-bold leading-none tracking-tight text-foreground">{filteredEvents.length}</div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Total Events</p>
              </div>
              <div className="rounded-2xl border border-border bg-card/85 p-3 text-muted-foreground transition-all group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary">
                <LayoutList className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card className={cn(PREMIUM_CARD, "group py-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-success/35 hover:bg-success/10 hover:shadow-[0_22px_70px_hsl(160_84%_20%/0.16)]")}>
            <CardContent className="flex items-start justify-between gap-4 px-5 py-4">
              <div>
                <div className="text-3xl font-bold leading-none tracking-tight text-success">
                  {filteredEvents.filter(e => e.appointmentStatus === 'confirmed' || e.appointmentStatus === 'showed').length}
                </div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-success/70">Confirmed</p>
              </div>
              <div className="rounded-2xl border border-success/20 bg-success/10 p-3 text-success transition-all group-hover:border-success/40 group-hover:bg-success/15">
                <Users className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card className={cn(PREMIUM_CARD, "group py-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:shadow-[0_22px_70px_hsl(var(--primary)/0.16)]")}>
            <CardContent className="flex items-start justify-between gap-4 px-5 py-4">
              <div>
                <div className="text-3xl font-bold leading-none tracking-tight text-primary">{upcomingEvents.length}</div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary/75">Upcoming</p>
              </div>
              <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3 text-primary transition-all group-hover:border-primary/40 group-hover:bg-primary/15">
                <Clock className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className={cn(
        "grid gap-4 md:gap-6 transition-all duration-300",
        isMobile ? "grid-cols-1" : sidebarCollapsed ? "grid-cols-[1fr_auto]" : "lg:grid-cols-3"
      )}>
        {/* Calendar View */}
        <Card className={cn(PREMIUM_PANEL, "overflow-hidden rounded-2xl border-primary/10", isMobile ? '' : sidebarCollapsed ? '' : 'lg:col-span-2')}>
          <CardHeader className="border-b border-border bg-muted/25 pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-3 text-xl font-semibold tracking-tight text-foreground">
                <span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
                  <CalendarIcon className="h-5 w-5" />
                </span>
                <CalendarPeriodPicker
                  label={
                    view === 'month'
                      ? format(currentMonth, 'MMMM yyyy')
                      : view === 'week'
                        ? `${format(weekDays[0], 'MMM d')} - ${format(weekDays[6], 'MMM d, yyyy')}`
                        : selectedDate ? format(selectedDate, 'MMMM d, yyyy') : 'Timeline'
                  }
                  anchorDate={view === 'month' ? currentMonth : view === 'week' ? currentWeek : (selectedDate ?? currentMonth)}
                  showWeek={view !== 'month'}
                  onNavigate={(date) => {
                    setCurrentMonth(date);
                    setCurrentWeek(date);
                    if (view === 'timeline') setSelectedDate(date);
                  }}
                />
              </CardTitle>

              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  aria-label={view === 'month' ? 'Previous month' : 'Previous week'}
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-xl border border-border text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 active:translate-y-0 active:scale-95"
                  onClick={() => view === 'month'
                    ? setCurrentMonth(subMonths(currentMonth, 1))
                    : setCurrentWeek(subWeeks(currentWeek, 1))
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={goToToday}
                  className="h-10 rounded-xl bg-primary px-4 font-semibold text-primary-foreground shadow-sm shadow-primary/20 transition-all hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-[0_12px_28px_hsl(var(--primary)/0.22)] focus-visible:ring-2 focus-visible:ring-primary/45 active:translate-y-0 active:scale-[0.98]"
                >
                  Today
                </Button>
                {selectedDate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                    className="h-10 rounded-xl border border-border text-muted-foreground transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 active:scale-[0.98]"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                )}
                <Button
                  aria-label={view === 'month' ? 'Next month' : 'Next week'}
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-xl border border-border text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 active:translate-y-0 active:scale-95"
                  onClick={() => view === 'month'
                    ? setCurrentMonth(addMonths(currentMonth, 1))
                    : setCurrentWeek(addWeeks(currentWeek, 1))
                  }
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            {/* Animation wrapper with swipe support */}
            <div
              {...(isMobile ? calendarSwipeHandlers : {})}
              className={cn(
                'transition-all duration-300 ease-out',
                viewTransition === 'exit' && 'opacity-0 scale-95 translate-y-2',
                viewTransition === 'enter' && 'animate-fade-in',
                !viewTransition && 'opacity-100'
              )}
            >
              {isLoading ? (
                <CalendarLoadingSkeleton view={view} />
              ) : view === 'month' ? (
                <>
                  {/* Day headers - Sticky */}
                  <div className="sticky top-0 z-10 mb-2 grid grid-cols-7 gap-1.5 rounded-2xl border border-border bg-card/90 p-1.5 shadow-inner shadow-sm dark:shadow-black/30 backdrop-blur">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                      <div key={day} className="rounded-xl py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground md:text-xs">
                        {isMobile ? day.charAt(0) : day}
                      </div>
                    ))}
                  </div>
                  {/* Calendar grid with DropZones */}
                  <div className="grid grid-cols-7 gap-1.5 rounded-2xl border border-border bg-muted/40 p-1.5 shadow-inner shadow-sm dark:shadow-black/20 md:gap-2 md:p-2">
                    {calendarDays.map(day => {
                      const dayEvents = getEventsForDay(day);
                      const isSelected = selectedDate && isSameDay(day, selectedDate);
                      const isCurrentMonth = isSameMonth(day, currentMonth);

                      return (
                        <DropZone
                          key={day.toISOString()}
                          date={day}
                          onDrop={handleEventDrop}
                          disabled={isUpdating}
                          className={cn(
                            'min-h-[76px] rounded-xl border p-1 text-left transition-all duration-200 ease-out cursor-pointer bg-muted/25 focus-within:ring-2 focus-within:ring-primary/40 md:min-h-[116px] md:p-2',
                            isSelected ? 'border-primary bg-primary/15 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35),0_14px_36px_hsl(var(--primary)/0.12)]' : 'border-border/50 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-card/90 hover:shadow-[0_10px_26px_hsl(var(--primary)/0.08)]',
                            !isCurrentMonth && 'bg-muted/40 opacity-50',
                            isToday(day) && 'ring-1 ring-primary/70'
                          )}
                        >
                          <div
                            role="button"
                            tabIndex={0}
                            aria-label={`Select ${format(day, 'EEEE, MMMM d, yyyy')}${dayEvents.length > 0 ? `, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : ', no events'}`}
                            onClick={() => setSelectedDate(day)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedDate(day);
                              }
                            }}
                            className="h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                          >
                            <div className={cn(
                              'mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                              isSelected ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20' : isToday(day) ? 'border border-primary/50 bg-primary/10 text-primary' : isCurrentMonth ? 'text-foreground' : 'text-muted-foreground'
                            )}>
                              {format(day, 'd')}
                            </div>
                            <div className="space-y-1">
                              {dayEvents.slice(0, isMobile ? 2 : 3).map(event => (
                                <EnhancedEventPreview
                                  key={event.id}
                                  event={event}
                                  getStatusColor={getStatusColor}
                                  fetchContact={fetchContact}
                                  contactCache={contactCache}
                                  onViewDetails={() => handleEventClick(event)}
                                  onConfirm={async () => {
                                    await updateEvent(event.id, { appointmentStatus: 'confirmed' });
                                    toast({ title: 'Event confirmed' });
                                  }}
                                  onCancel={async () => {
                                    await cancelEventAndNotify(event);
                                    toast({ title: 'Event cancelled' });
                                  }}
                                >
                                  <DraggableEvent
                                    event={event}
                                    disabled={isUpdating}
                                    onDragStart={setDraggingEvent}
                                    onDragEnd={() => setDraggingEvent(null)}
                                  >
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      aria-label={`Open ${event.title || 'Event'} at ${safeFormatISO(event.startTime, 'HH:mm')}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleEventClick(event);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          handleEventClick(event);
                                        }
                                      }}
                                      style={getEventStyle(event)}
                                      className="flex min-h-[20px] items-center gap-1.5 overflow-hidden rounded-lg px-1.5 py-1 text-[10px] font-semibold leading-none shadow-sm ring-1 ring-border dark:ring-white/10 transition-all duration-150 ease-out cursor-pointer hover:translate-x-0.5 hover:opacity-95 hover:ring-white/20 hover:shadow-[0_6px_18px_hsl(0_0%_0%/0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 md:px-2"
                                    >
                                      <span className="shrink-0 tabular-nums">{safeFormatISO(event.startTime, 'HH:mm')}</span>
                                      {!isMobile && (
                                        <span className="min-w-0 truncate opacity-90">{event.title || 'Event'}</span>
                                      )}
                                    </div>
                                  </DraggableEvent>
                                </EnhancedEventPreview>
                              ))}
                              {dayEvents.length > (isMobile ? 2 : 3) && (
                                <div className="rounded-lg border border-border/50 bg-card/85 px-1.5 py-1 text-[9px] font-semibold text-muted-foreground md:text-[10px]">
                                  +{dayEvents.length - (isMobile ? 2 : 3)} more
                                </div>
                              )}
                            </div>
                          </div>
                        </DropZone>
                      );
                    })}
                  </div>
                </>
              ) : view === 'week' ? (
                /* Week View with Drag and Drop */
                <div className={cn("rounded-2xl border border-border bg-muted/40 shadow-inner shadow-sm dark:shadow-black/20", isMobile ? "overflow-x-auto" : "overflow-x-hidden")}>
                  <div className="min-w-[700px]">
                    {/* Week day headers - Sticky */}
                    <div className="sticky top-0 z-10 mb-1 grid grid-cols-8 gap-1 border-b border-border bg-popover p-2 shadow-sm backdrop-blur-xl">
                      <div className="w-16 py-2 text-xs font-medium text-muted-foreground"></div>
                      {weekDays.map(day => (
                        <div
                          key={day.toISOString()}
                          className={`rounded-xl py-2 text-center text-xs font-semibold ${isToday(day) ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                        >
                          <div className="uppercase tracking-[0.16em]">{format(day, 'EEE')}</div>
                          <div className={`mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold ${isToday(day) ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20' : 'text-foreground'}`}>
                            {format(day, 'd')}
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Time grid with DropZones */}
                    <div className="relative">
                      {weekHours.map(hour => (
                        <div key={hour} className="grid grid-cols-8 gap-1 border-t border-border">
                          <div className="sticky left-0 w-16 bg-popover/90 py-1 pr-2 text-right text-[10px] font-medium text-muted-foreground backdrop-blur">
                            {format(new Date().setHours(hour, 0), 'h a')}
                          </div>
                          {weekDays.map(day => {
                            const hourEvents = getEventsForDayAndHour(day, hour);
                            return (
                              <DropZone
                                key={`${day.toISOString()}-${hour}`}
                                date={day}
                                hour={hour}
                                onDrop={handleEventDrop}
                                disabled={isUpdating}
                                className="min-h-[52px] border-l border-border px-1.5 py-1 transition-colors hover:bg-background/55"
                              >
                                {hourEvents.map(event => (
                                  <DraggableEvent
                                    key={event.id}
                                    event={event}
                                    disabled={isUpdating}
                                    onDragStart={setDraggingEvent}
                                    onDragEnd={() => setDraggingEvent(null)}
                                  >
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      aria-label={`Open ${event.title || 'Event'} at ${safeFormatISO(event.startTime, 'h:mm a')}`}
                                      onClick={() => handleEventClick(event)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          handleEventClick(event);
                                        }
                                      }}
                                      style={getEventStyle(event)}
                                      className="mb-1 w-full cursor-pointer truncate rounded-lg px-1.5 py-1 text-left text-[10px] shadow-sm ring-1 ring-border dark:ring-white/10 transition-all hover:translate-x-0.5 hover:opacity-90 hover:ring-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                                    >
                                      <div className="font-medium truncate">
                                        {event.title || 'Event'}
                                      </div>
                                      <div className="opacity-75">{safeFormatISO(event.startTime, 'h:mm a')}</div>
                                    </div>
                                  </DraggableEvent>
                                ))}
                              </DropZone>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Timeline View */
                <TimelineView
                  selectedDate={selectedDate || new Date()}
                  events={filteredEvents}
                  onEventClick={handleEventClick}
                  onEventDrop={handleEventDrop}
                  getEventStyle={getEventStyle}
                  isUpdating={isUpdating}
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sidebar Panel with Tabs - Hidden on mobile (accessible via Sheet) */}
        {!isMobile && (
        <Card className={cn(
          PREMIUM_PANEL, "rounded-2xl transition-all duration-300 overflow-hidden border-primary/10",
          sidebarCollapsed ? "w-[52px] min-w-[52px]" : "min-w-0"
        )}>
          {sidebarCollapsed ? (
            // Collapsed: compact vertical icon strip
            <div className="flex flex-col items-center gap-2 py-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Expand calendar tools sidebar"
                    variant="ghost"
                    size="icon"
                    className="mb-1 h-9 w-9 rounded-xl border border-border text-muted-foreground hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45"
                    onClick={() => setSidebarCollapsed(false)}
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Expand sidebar</TooltipContent>
              </Tooltip>

              <TooltipProvider delayDuration={100}>
                {orderedSidebarTabs.map((tab) => {
                  const isPinned = pinnedTabs.includes(tab.id);
                  return (
                    <ContextMenu key={tab.id} modal={false} onOpenChange={(open) => setContextMenuTab(open ? tab.id : null)}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <ContextMenuTrigger asChild>
                        <button
                          aria-label={`${tab.label}${isPinned ? ', pinned' : ''}`}
                          aria-pressed={sidebarTab === tab.id}
                          aria-haspopup="menu"
                          aria-expanded={contextMenuTab === tab.id}
                          // Same as the expanded rail: the Radix tooltip names
                          // this tool, so the browser's own would be a second
                          // box beside it.

                          onClick={() => {
                            setSidebarTab(tab.id);
                            setSidebarCollapsed(false);
                          }}
                          className={cn(
                            'relative flex h-10 w-10 flex-col items-center justify-center gap-0.5 rounded-xl border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45',
                            sidebarTab === tab.id
                              ? 'border-primary/60 bg-primary/20 text-primary shadow-[0_10px_24px_hsl(var(--primary)/0.14)]'
                              : 'border-border bg-background/55 text-muted-foreground hover:border-primary/35 hover:bg-primary/10 hover:text-primary',
                            isPinned && 'ring-1 ring-primary/30'
                          )}
                        >
                          {tab.icon}
                          {isPinned && <Pin aria-hidden="true" className="absolute right-1 top-1 h-3 w-3 text-primary" />}
                          <span className="text-[8px] leading-none">{tab.label}</span>
                        </button>
                        </ContextMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <div className="flex items-center gap-2">
                          {tab.label}
                          {tab.shortcut && (
                            <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded">{tab.shortcut}</kbd>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                    <ContextMenuContent>
                      <ContextMenuLabel>{tab.label} {isPinned ? '(pinned)' : ''}</ContextMenuLabel>
                      <ContextMenuItem onSelect={() => handleTogglePin(tab.id)}>
                        {isPinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
                        {isPinned ? 'Unpin' : 'Pin to front'}
                      </ContextMenuItem>
                    </ContextMenuContent>
                    </ContextMenu>
                    );
                  })}
              </TooltipProvider>
            </div>
          ) : (
            // Expanded: full sidebar with header and content
            <>
              <CardHeader className="border-b border-border bg-muted/25 pb-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-sm font-semibold text-foreground">Tools</span>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Calendar command sidebar</p>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    <Button size="sm" variant="outline" className="h-10 rounded-xl border-primary/40 bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/20 transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:bg-primary/90 hover:text-primary-foreground hover:shadow-[0_12px_28px_hsl(var(--primary)/0.22)] focus-visible:ring-2 focus-visible:ring-primary/45 active:translate-y-0 active:scale-[0.98]" onClick={() => setQuickAddModalOpen(true)}>
                      <Plus className="h-3 w-3 mr-1" />
                      Quick Add
                    </Button>
                    <div className="flex items-center gap-1.5 rounded-xl border border-border bg-background/55 p-1 shadow-inner shadow-sm dark:shadow-black/20">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label="Refresh calendar"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-muted-foreground transition-all hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={handleRefresh}
                            disabled={isLoading}
                          >
                            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Refresh calendar</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label="Collapse calendar tools sidebar"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-muted-foreground transition-all hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 active:scale-95"
                            onClick={() => setSidebarCollapsed(true)}
                          >
                            <PanelLeftClose className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Collapse sidebar</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>

                <TooltipProvider delayDuration={100}>
                  <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as any)}>
                    <TabsList className="grid h-auto w-full grid-cols-4 gap-2 rounded-2xl border border-border bg-card/80 p-2 shadow-inner shadow-sm dark:shadow-black/20">
                      {orderedSidebarTabs.map((tab) => {
                        const isPinned = pinnedTabs.includes(tab.id);
                        const isActiveTab = sidebarTab === tab.id;
                        return (
                          <ContextMenu key={tab.id} modal={false} onOpenChange={(open) => setContextMenuTab(open ? tab.id : null)}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <ContextMenuTrigger asChild>
                              <TabsTrigger
                                aria-label={`${tab.label}${isPinned ? ', pinned' : ''}`}
                                // No `title`. The Radix tooltip below already
                                // names this tool and adds its shortcut and the
                                // right-click hint; the browser's own tooltip
                                // drew a second, smaller box beside it saying
                                // only the label (audit item 32).
                                value={tab.id}
                                aria-haspopup="menu"
                                aria-expanded={contextMenuTab === tab.id}
                                aria-current={isActiveTab ? 'true' : undefined}
                                data-active={isActiveTab ? 'true' : 'false'}
                                className={cn(
                                  "group relative flex h-[4.25rem] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl border p-0 shadow-sm transition-all duration-200 ease-out bg-gradient-to-br",
                                  "focus-visible:ring-2 focus-visible:ring-primary/45 active:translate-y-0 active:scale-[0.97]",
                                  isActiveTab
                                    ? "border-primary/60 from-primary/25 via-primary/12 to-primary/5 text-primary ring-1 ring-primary/40 shadow-[0_16px_38px_hsl(var(--primary)/0.24)]"
                                    : "border-border from-card/95 via-card/70 to-muted/40 text-muted-foreground hover:-translate-y-0.5 hover:border-primary/40 hover:from-primary/12 hover:via-card/70 hover:to-primary/5 hover:text-primary hover:shadow-[0_14px_32px_hsl(var(--primary)/0.16)]",
                                  isPinned && !isActiveTab && "ring-1 ring-primary/25"
                                )}
                              >
                                <span
                                  aria-hidden="true"
                                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-data-[active=true]:opacity-100"
                                />
                                <span className={cn(
                                  "flex h-7 w-7 items-center justify-center rounded-xl border text-current transition-all duration-200",
                                  isActiveTab
                                    ? "border-primary/45 bg-primary/15"
                                    : "border-border/70 bg-background/70 group-hover:border-primary/35 group-hover:bg-primary/10"
                                )}>
                                  {tab.icon}
                                </span>
                                <span className="max-w-full truncate px-1 text-[10px] font-semibold uppercase tracking-[0.12em]">
                                  {tab.label}
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="pointer-events-none absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-primary/70 opacity-0 transition-opacity duration-200 group-data-[active=true]:opacity-100"
                                />

                                {isPinned && <Pin aria-hidden="true" className="absolute right-1 top-1 h-3 w-3 text-primary" />}
                              </TabsTrigger>

                              </ContextMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                {tab.label}
                                {tab.shortcut && (
                                  <kbd className="px-1.5 py-0.5 text-[10px] bg-background/50 rounded border">{tab.shortcut}</kbd>
                                )}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                Right-click to {isPinned ? 'unpin' : 'pin'}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                          <ContextMenuContent>
                            <ContextMenuLabel>{tab.label} {isPinned ? '(pinned)' : ''}</ContextMenuLabel>
                            <ContextMenuItem onSelect={() => handleTogglePin(tab.id)}>
                              {isPinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
                              {isPinned ? 'Unpin' : 'Pin to front'}
                            </ContextMenuItem>
                          </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}
                    </TabsList>
                  </Tabs>
                </TooltipProvider>
              </CardHeader>

              <CardContent className="p-3">



              {sidebarTab === 'events' && (
                <div>
                  <div className="mb-3 flex items-center gap-2 rounded-2xl border border-border bg-background/55 px-3 py-2">
                    <span className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
                      <Clock className="h-4 w-4" />
                    </span>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">
                        {selectedDate ? format(selectedDate, 'EEEE, MMM d') : 'Upcoming'}
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        {selectedDate ? 'Selected day agenda' : 'Next scheduled appointments'}
                      </p>
                    </div>
                  </div>
                  <div>
                    {isLoading ? (
                      <SidebarLoadingSkeleton />
                    ) : (selectedDate ? selectedDateEvents : upcomingEvents).length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border bg-background/55 px-4 py-8 text-center text-muted-foreground">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                          <CalendarIcon className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-medium text-muted-foreground">No events {selectedDate ? 'on this day' : 'upcoming'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Use Quick Add to schedule from this panel.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(selectedDate ? selectedDateEvents : upcomingEvents).map(event => (
                          <EventCard key={event.id} event={event} getStatusColor={getStatusColor} onClick={() => handleEventClick(event)} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {sidebarTab === 'availability' && selectedDate && (
                <AvailabilitySlots selectedDate={selectedDate} events={filteredEvents} onSlotClick={(startTime) => {
                  setQuickAddDefaultHour(startTime.getHours());
                  setQuickAddModalOpen(true);
                }} />
              )}
              {sidebarTab === 'heatmap' && (
                <div>
                  <CalendarHeatmap events={filteredEvents} currentMonth={currentMonth} selectedDate={selectedDate} onDateSelect={(date) => { setSelectedDate(date); setSidebarTab('events'); }} />
                </div>
              )}
              {sidebarTab === 'analytics' && (
                <div>
                  <TimeAllocationDashboard events={filteredEvents} calendars={calendars} currentWeek={currentWeek} selectedDate={selectedDate} />
                </div>
              )}
              {sidebarTab === 'summary' && (
                <div>
                  <WeeklySummaryCards events={filteredEvents} currentWeek={currentWeek} selectedDate={selectedDate} />
                </div>
              )}
              {sidebarTab === 'conflicts' && (
                <ConflictDetection events={filteredEvents} onEventClick={handleEventClick} selectedDate={selectedDate} />
              )}
              {sidebarTab === 'optimize' && (
                <ResourceOptimization
                  events={filteredEvents}
                  currentWeek={currentWeek}
                  selectedDate={selectedDate}
                  onSlotSelect={(date, hour) => {
                    setSelectedDate(date);
                    setQuickAddDefaultHour(hour);
                    setQuickAddModalOpen(true);
                  }}
                />
              )}
              {sidebarTab === 'overlay' && (
                <MultiCalendarOverlay
                  calendars={calendars}
                  events={events}
                  visibleCalendars={visibleCalendars}
                  onToggleCalendar={handleToggleCalendar}
                  onShowAll={handleShowAllCalendars}
                  onHideAll={handleHideAllCalendars}
                  outlookEnabled={outlookEnabled}
                  outlookVisible={outlookVisible}
                  onToggleOutlook={() => setOutlookVisible(v => !v)}
                  outlookEventCount={outlookEvents.length}
                  microsoftEmail={microsoftEmail}
                />
              )}
              {sidebarTab === 'outlook' && (
                <OutlookCalendarPanel
                  outlookEvents={outlookEvents}
                  teamAvailability={teamAvailability}
                  isLoading={outlookLoading}
                  isCreating={outlookCreating}
                  outlookEnabled={outlookEnabled}
                  microsoftEmail={microsoftEmail}
                  onRefresh={() => { const { start, end } = getVisibleRange(); fetchOutlookEvents(start.toISOString(), end.toISOString()); }}
                  onFetchTeam={() => { const { start, end } = getVisibleRange(); fetchTeamAvailability(start.toISOString(), end.toISOString()); }}
                  onCreateEvent={createOutlookEvent}
                  onDeleteEvent={deleteOutlookEvent}
                  onSetMicrosoftEmail={setMicrosoftEmail}
                  onGetMicrosoftEmail={getMicrosoftEmail}
                  outlookVisible={outlookVisible}
                  onToggleOutlookVisible={() => setOutlookVisible(v => !v)}
                  selectedDate={selectedDate}
                  onCreatePrepBlock={createPrepBlock}
                />
              )}
              {sidebarTab === 'patterns' && (
                <RecurringPatterns events={events} onPatternClick={(pattern) => toast({ title: 'Pattern detected', description: pattern.title })} />
              )}
              {sidebarTab === 'reminders' && (
                <SmartReminders calendars={calendars} />
              )}
             </CardContent>
            </>
          )}
        </Card>
        )}
      </div>

      {/* Quick Add Modal */}
      <QuickAddAppointmentModal
        open={quickAddModalOpen}
        onOpenChange={setQuickAddModalOpen}
        calendars={calendars}
        defaultDate={selectedDate || undefined}
        defaultHour={quickAddDefaultHour}
        isLoading={isUpdating}
        onSubmit={async (data) => {
          const { secondaryRecipients, bookingRecipients, overrideAvailability, assignedUserId: manualAssignedUserId, ...appointmentData } = data;

          // Use manually selected team member, or auto-assign first member as fallback
          const selectedCal = calendars.find(c => c.id === data.calendarId);
          const assignedUserId = (manualAssignedUserId && manualAssignedUserId !== 'auto')
            ? manualAssignedUserId
            : selectedCal?.teamMembers?.[0]?.userId || undefined;

          const result = await createAppointment({ ...appointmentData, overrideAvailability, assignedUserId });

          if (result.success) {
            logActivityDirect({
              actionType: 'appointment_created',
              entityType: 'appointment',
              entityName: data.title,
              metadata: { calendar: calendars.find(c => c.id === data.calendarId)?.name }
            });
            const calendarName = calendars.find(c => c.id === data.calendarId)?.name;
            const appointmentId = result.event?.id || `temp-${Date.now()}`;

            // One sender for everyone invited, the client included.
            //
            // The client used to be emailed by the CRM and by nothing here, so
            // they alone received no notes, no call type and no Zoom link.
            // Planning the recipients in one place also means a booking with
            // no CRM behind it is announced exactly like one that has a CRM:
            // the address is what matters, not where the contact came from.
            const notificationPlan = planBookingNotifications({
              parties: [
                ...(data.client?.email
                  ? [{ role: 'client' as const, name: data.client.name, email: data.client.email }]
                  : []),
                ...(bookingRecipients || []).map(br => ({
                  role: 'additional_contact' as const, name: br.name, email: br.email,
                })),
                ...(secondaryRecipients || []).map(fc => ({
                  role: 'finance_partner' as const,
                  name: fc.name,
                  email: fc.email,
                  financeContactId: fc.financeContactId,
                })),
              ],
              crm: { linked: !!data.contactId, sendsClientConfirmation: false },
            });
            const allNotificationRecipients = notificationPlan.recipients.map(r => ({
              financeContactId: r.financeContactId ?? null,
              // Recorded on the invitation ledger, so a later reschedule or
              // cancellation can tell a client from an additional contact from
              // a finance partner without inferring it from a missing id.
              role: r.role,
              name: r.name,
              email: r.email,
            }));
            for (const warning of notificationPlan.warnings) {
              toast({ title: 'Not everyone will be emailed', description: warning });
            }

            if (allNotificationRecipients.length > 0) {
              try {
                await invokeSecureFunction('send-appointment-notification', {
                  appointmentGhlId: appointmentId,
                  appointmentTitle: data.title,
                  appointmentStart: data.startTime,
                  appointmentEnd: data.endTime,
                  // What the operator actually chose. This was hardcoded to
                  // 'call', so every notice said "Phone Call" however the
                  // meeting was booked — including a Zoom one.
                  appointmentType: data.appointmentType || 'call',
                  appointmentNotes: data.notes,
                  // The join link, read back from GoHighLevel after it
                  // provisioned the meeting. `result.location` carries it even
                  // when the create response was too thin to normalise into an
                  // event — which is exactly when it used to be lost, leaving
                  // the participants an invitation to a Zoom they cannot join.
                  appointmentLocation: result.event?.address || result.location || undefined,
                  calendarName,
                  recipients: allNotificationRecipients,
                });
                toast({
                  title: 'Notifications sent',
                  description: `${allNotificationRecipients.length} recipient(s) notified with calendar invite.`,
                });
              } catch (err: any) {
                console.error('Failed to send appointment notifications:', err);
                toast({
                  title: 'Appointment created, but notifications failed',
                  description: err.message || 'Could not send email notifications.',
                  variant: 'destructive',
                });
              }
            }

            // Auto-create Outlook prep block if user has Outlook configured
            if (microsoftEmail && outlookEnabled) {
              try {
                await createPrepBlock({
                  appointmentTitle: data.title,
                  appointmentStartTime: data.startTime,
                  clientName: data.title,
                  prepMinutes: 15,
                  notes: data.notes,
                });
              } catch (err) {
                console.log('[Calendar] Prep block creation failed (non-critical):', err);
              }
            }
          }

          return result.success;
        }}
        onSearchContacts={searchContacts}
      />

      {/* Calendars List — split into Frequently Used and Other */}
      <Card className={cn(PREMIUM_PANEL, "overflow-hidden rounded-2xl border-primary/10")}>
        <CardHeader className="border-b border-border bg-muted/25">
          <CardTitle className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-3 text-xl font-semibold tracking-tight text-foreground">
              <span className="rounded-2xl border border-primary/25 bg-primary/10 p-2 text-primary">
                <Users className="h-5 w-5" />
              </span>
              Available Calendars ({calendars.length})
            </span>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Calendar registry</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-5">
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-2xl" />
              ))}
            </div>
          ) : (() => {
            // Rank active calendars by how many events they have (descending), then alphabetically
            const eventCountByCalendar: Record<string, number> = {};
            events.forEach(e => {
              if (e.calendarId) {
                eventCountByCalendar[e.calendarId] = (eventCountByCalendar[e.calendarId] || 0) + 1;
              }
            });

            const activeCalendars = calendars.filter(c => c.isActive);
            const inactiveCalendars = calendars.filter(c => !c.isActive);

            // Sort active calendars by event count (most used first), then by name
            const rankedActive = [...activeCalendars].sort((a, b) => {
              const countDiff = (eventCountByCalendar[b.id] || 0) - (eventCountByCalendar[a.id] || 0);
              if (countDiff !== 0) return countDiff;
              return a.name.localeCompare(b.name);
            });

            // Top 4 with at least 1 event are "Most Frequently Used"
            const withEvents = rankedActive.filter(c => (eventCountByCalendar[c.id] || 0) > 0);
            const frequentlyUsed = withEvents.slice(0, 4);
            const frequentlyUsedIds = new Set(frequentlyUsed.map(c => c.id));
            const otherCalendars = [...rankedActive.filter(c => !frequentlyUsedIds.has(c.id)), ...inactiveCalendars];

            const renderCalendarCard = (calendar: typeof calendars[0]) => {
              const calEventCount = eventCountByCalendar[calendar.id] || 0;
              return (
              <button
                key={calendar.id}
                title={calendar.name}
                aria-pressed={selectedCalendarId === calendar.id}
                onClick={() => setSelectedCalendarId(calendar.id === selectedCalendarId ? 'all' : calendar.id)}
                className={cn(
                  'group rounded-2xl border p-4 text-left shadow-sm transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 active:scale-[0.99]',
                  selectedCalendarId === calendar.id
                    ? 'border-primary/60 bg-gradient-to-br from-primary/18 via-primary/10 to-muted/30 shadow-[0_16px_42px_hsl(var(--primary)/0.14)]'
                    : 'border-border bg-gradient-to-br from-card/90 to-muted/30 hover:-translate-y-1 hover:border-primary/35 hover:bg-primary/10 hover:shadow-[0_18px_46px_hsl(0_0%_0%/0.28)]'
                )}
              >
                <div className="flex h-full items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3.5 w-3.5 rounded-full shrink-0 ring-2 ring-black/30 shadow-sm"
                        style={{ backgroundColor: getCalendarColor(calendar.id) }}
                      />
                      <span className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-foreground">{calendar.name}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-full border-border bg-card/85 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {calendar.calendarType.replace('_', ' ')}
                      </Badge>
                      {calendar.isActive && (
                        <Badge className="rounded-full border-success/25 bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                          Active
                        </Badge>
                      )}
                      {calEventCount > 0 && (
                        <Badge variant="secondary" className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          {calEventCount} event{calEventCount !== 1 ? 's' : ''}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {calendar.teamMembers && calendar.teamMembers.length > 0 && (
                    <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      <Users className="h-3 w-3 text-primary/80" />
                      {calendar.teamMembers.length} member{calendar.teamMembers.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </button>
            );
            };

            return (
              <div className="space-y-7">
                {frequentlyUsed.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Most Frequently Used</h4>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {frequentlyUsed.map(renderCalendarCard)}
                    </div>
                  </div>
                )}
                {otherCalendars.length > 0 && (
                  <div>
                    <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Other Calendars</h4>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {otherCalendars.map(renderCalendarCard)}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </DashboardThemeFrame>
  );
}

function EventCard({
  event,
  getStatusColor,
  onClick
}: {
  event: GHLEvent;
  getStatusColor: (status: string, appointmentStatus?: string) => string;
  onClick: () => void;
}) {
  // The deterministic palette's first colour, not a literal blue: a card
  // whose calendar colour has not resolved yet must not invent a hue that
  // belongs to some other calendar.
  const color = event.calendarColor || FALLBACK_CALENDAR_COLOR;

  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border border-border bg-gradient-to-br from-white/[0.05] to-white/[0.025] p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/10 hover:shadow-[0_12px_30px_hsl(0_0%_0%/0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
      style={{ borderLeftWidth: '4px', borderLeftColor: color }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{event.title || 'Untitled Event'}</p>
          {event.calendarName && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-black/30"
                style={{ backgroundColor: color }}
              />
              {event.calendarName}
            </p>
          )}
        </div>
        <Badge className={`shrink-0 px-2 py-0.5 text-[10px] font-semibold ${getStatusColor(event.status, event.appointmentStatus)}`}>
          {event.appointmentStatus || event.status}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {safeFormatISO(event.startTime, 'MMM d, HH:mm')} - {safeFormatISO(event.endTime, 'HH:mm')}
        </div>
        {event.contactId && (
          <div className="flex items-center gap-1 text-primary">
            <Users className="h-3 w-3" />
            <span>Contact linked</span>
          </div>
        )}
      </div>
      {event.notes && (
        <p className="text-xs text-muted-foreground mt-2">{event.notes}</p>
      )}
    </button>
  );
}
