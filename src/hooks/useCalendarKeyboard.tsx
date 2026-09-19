import { useEffect, useCallback } from 'react';
import { addDays, subDays, addWeeks, subWeeks, addMonths, subMonths } from 'date-fns';

type SidebarTab = 'events' | 'availability' | 'heatmap' | 'analytics' | 'summary' | 'conflicts' | 'optimize' | 'overlay' | 'outlook' | 'patterns' | 'reminders';

interface UseCalendarKeyboardProps {
  view: 'month' | 'week' | 'timeline';
  selectedDate: Date | null;
  setSelectedDate: (date: Date | null) => void;
  currentMonth: Date;
  setCurrentMonth: (date: Date) => void;
  currentWeek: Date;
  setCurrentWeek: (date: Date) => void;
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
  setQuickAddModalOpen: (open: boolean) => void;
  onSelectEvent?: () => void;
}

const TAB_SHORTCUTS: Record<string, SidebarTab> = {
  '1': 'events',
  '2': 'availability',
  '4': 'heatmap',
  '5': 'analytics',
  '6': 'summary',
  '7': 'conflicts',
  '8': 'optimize',
  '9': 'overlay',
};

export function useCalendarKeyboard({
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
  onSelectEvent,
}: UseCalendarKeyboardProps) {
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't handle if typing in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target as HTMLElement).isContentEditable
    ) {
      return;
    }

    // Tab switching with number keys (1-9)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && TAB_SHORTCUTS[e.key]) {
      e.preventDefault();
      setSidebarTab(TAB_SHORTCUTS[e.key]);
      return;
    }

    // Quick add with 'n' or 'a'
    if ((e.key === 'n' || e.key === 'a') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setQuickAddModalOpen(true);
      return;
    }

    // Today with 't'
    if (e.key === 't' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const today = new Date();
      setSelectedDate(today);
      setCurrentMonth(today);
      setCurrentWeek(today);
      return;
    }

    // Clear selection with Escape
    if (e.key === 'Escape') {
      e.preventDefault();
      setSelectedDate(null);
      return;
    }

    // Arrow key navigation
    const baseDate = selectedDate || new Date();
    
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey) {
        // Navigate month/week
        if (view === 'month') {
          setCurrentMonth(subMonths(currentMonth, 1));
        } else {
          setCurrentWeek(subWeeks(currentWeek, 1));
        }
      } else {
        // Navigate day
        setSelectedDate(subDays(baseDate, 1));
      }
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey) {
        // Navigate month/week
        if (view === 'month') {
          setCurrentMonth(addMonths(currentMonth, 1));
        } else {
          setCurrentWeek(addWeeks(currentWeek, 1));
        }
      } else {
        // Navigate day
        setSelectedDate(addDays(baseDate, 1));
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedDate(subWeeks(baseDate, 1));
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedDate(addWeeks(baseDate, 1));
      return;
    }

    // Enter to view events for selected date
    if (e.key === 'Enter' && selectedDate) {
      e.preventDefault();
      setSidebarTab('events');
      onSelectEvent?.();
      return;
    }
  }, [
    view,
    selectedDate,
    setSelectedDate,
    currentMonth,
    setCurrentMonth,
    currentWeek,
    setCurrentWeek,
    setSidebarTab,
    setQuickAddModalOpen,
    onSelectEvent,
  ]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { TAB_SHORTCUTS };
}
