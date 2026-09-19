import { useMemo } from 'react';
import { format, startOfWeek, endOfWeek, differenceInMinutes, isSameDay, subWeeks, subDays, startOfDay, endOfDay } from 'date-fns';
import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus, Clock, Calendar, CheckCircle2, XCircle, Users, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WeeklySummaryCardsProps {
  events: Array<{
    startTime?: string;
    endTime?: string;
    appointmentStatus?: string;
    contactId?: string;
  }>;
  currentWeek: Date;
  selectedDate?: Date | null;
}

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  trendLabel?: string;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ title, value, subtitle, trend, trendValue, trendLabel = 'vs last week', icon, color }: StatCardProps) {
  return (
    <Card className={cn(
      'p-4 relative overflow-hidden transition-all hover:scale-[1.02] hover:shadow-md',
      'bg-gradient-to-br from-background to-muted/30'
    )}>
      <div className={cn(
        'absolute top-0 right-0 w-20 h-20 rounded-full opacity-10 -translate-y-1/2 translate-x-1/2',
        color
      )} />
      
      <div className="flex items-start justify-between relative z-10">
        <div>
          <p className="text-xs text-muted-foreground mb-1">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className={cn('p-2 rounded-lg', color.replace('bg-', 'bg-').replace('-500', '-500/20'))}>
          {icon}
        </div>
      </div>

      {trend && trendValue && (
        <div className="flex items-center gap-1 mt-2">
          {trend === 'up' && <TrendingUp className="h-3 w-3 text-success" />}
          {trend === 'down' && <TrendingDown className="h-3 w-3 text-destructive" />}
          {trend === 'neutral' && <Minus className="h-3 w-3 text-muted-foreground" />}
          <span className={cn(
            'text-xs font-medium',
            trend === 'up' && 'text-success',
            trend === 'down' && 'text-destructive',
            trend === 'neutral' && 'text-muted-foreground'
          )}>
            {trendValue}
          </span>
          <span className="text-xs text-muted-foreground">{trendLabel}</span>
        </div>
      )}
    </Card>
  );
}

export function WeeklySummaryCards({ events, currentWeek, selectedDate }: WeeklySummaryCardsProps) {
  const safeParseISO = (value: string | undefined): Date | null => {
    try {
      if (!value) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  // Determine if showing single day or week
  const isDateSelected = selectedDate !== null && selectedDate !== undefined;
  
  // For single day mode, compare to yesterday
  // For week mode, compare to last week
  const rangeStart = isDateSelected ? startOfDay(selectedDate) : startOfWeek(currentWeek);
  const rangeEnd = isDateSelected ? endOfDay(selectedDate) : endOfWeek(currentWeek);
  const prevRangeStart = isDateSelected ? startOfDay(subDays(selectedDate, 1)) : startOfWeek(subWeeks(currentWeek, 1));
  const prevRangeEnd = isDateSelected ? endOfDay(subDays(selectedDate, 1)) : endOfWeek(subWeeks(currentWeek, 1));

  const stats = useMemo(() => {
    // Current period events
    const currentPeriodEvents = events.filter(e => {
      const start = safeParseISO(e.startTime);
      return start && start >= rangeStart && start <= rangeEnd;
    });

    // Previous period events (for comparison)
    const prevPeriodEvents = events.filter(e => {
      const start = safeParseISO(e.startTime);
      return start && start >= prevRangeStart && start <= prevRangeEnd;
    });

    // Total events
    const totalEvents = currentPeriodEvents.length;
    const prevPeriodTotal = prevPeriodEvents.length;

    // Total hours
    const totalMinutes = currentPeriodEvents.reduce((sum, e) => {
      const start = safeParseISO(e.startTime);
      const end = safeParseISO(e.endTime);
      if (start && end) return sum + differenceInMinutes(end, start);
      return sum;
    }, 0);
    const totalHours = Math.round(totalMinutes / 60 * 10) / 10;

    const prevPeriodMinutes = prevPeriodEvents.reduce((sum, e) => {
      const start = safeParseISO(e.startTime);
      const end = safeParseISO(e.endTime);
      if (start && end) return sum + differenceInMinutes(end, start);
      return sum;
    }, 0);
    const prevPeriodHours = Math.round(prevPeriodMinutes / 60 * 10) / 10;

    // Confirmed appointments
    const confirmed = currentPeriodEvents.filter(e => 
      e.appointmentStatus === 'confirmed' || e.appointmentStatus === 'showed'
    ).length;
    const prevPeriodConfirmed = prevPeriodEvents.filter(e => 
      e.appointmentStatus === 'confirmed' || e.appointmentStatus === 'showed'
    ).length;

    // No shows
    const noShows = currentPeriodEvents.filter(e => e.appointmentStatus === 'noshow').length;
    const prevPeriodNoShows = prevPeriodEvents.filter(e => e.appointmentStatus === 'noshow').length;

    // Unique contacts
    const uniqueContacts = new Set(currentPeriodEvents.map(e => e.contactId).filter(Boolean)).size;
    const prevPeriodUniqueContacts = new Set(prevPeriodEvents.map(e => e.contactId).filter(Boolean)).size;

    // Show rate
    const showRate = totalEvents > 0 
      ? Math.round((confirmed / totalEvents) * 100) 
      : 0;
    const prevPeriodShowRate = prevPeriodTotal > 0 
      ? Math.round((prevPeriodConfirmed / prevPeriodTotal) * 100) 
      : 0;

    // Busiest day (only relevant for week view)
    const dayCount: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    currentPeriodEvents.forEach(e => {
      const start = safeParseISO(e.startTime);
      if (start) dayCount[start.getDay()]++;
    });
    const busiestDayIndex = Object.entries(dayCount)
      .sort((a, b) => b[1] - a[1])[0];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const busiestDay = isDateSelected 
      ? dayNames[rangeStart.getDay()] 
      : dayNames[Number(busiestDayIndex[0])];
    const busiestDayCount = isDateSelected ? totalEvents : busiestDayIndex[1];

    // Calculate trends
    const getTrend = (current: number, previous: number): 'up' | 'down' | 'neutral' => {
      if (current > previous) return 'up';
      if (current < previous) return 'down';
      return 'neutral';
    };

    const getTrendValue = (current: number, previous: number): string => {
      const diff = current - previous;
      if (diff === 0) return 'No change';
      return `${diff > 0 ? '+' : ''}${diff}`;
    };

    return {
      totalEvents,
      totalHours,
      confirmed,
      noShows,
      uniqueContacts,
      showRate,
      busiestDay,
      busiestDayCount,
      trends: {
        events: {
          direction: getTrend(totalEvents, prevPeriodTotal),
          value: getTrendValue(totalEvents, prevPeriodTotal),
        },
        hours: {
          direction: getTrend(totalHours, prevPeriodHours),
          value: `${totalHours > prevPeriodHours ? '+' : ''}${(totalHours - prevPeriodHours).toFixed(1)}h`,
        },
        confirmed: {
          direction: getTrend(confirmed, prevPeriodConfirmed),
          value: getTrendValue(confirmed, prevPeriodConfirmed),
        },
        noShows: {
          direction: getTrend(prevPeriodNoShows, noShows), // Inverted - fewer no-shows is better
          value: getTrendValue(noShows, prevPeriodNoShows),
        },
        contacts: {
          direction: getTrend(uniqueContacts, prevPeriodUniqueContacts),
          value: getTrendValue(uniqueContacts, prevPeriodUniqueContacts),
        },
        showRate: {
          direction: getTrend(showRate, prevPeriodShowRate),
          value: `${showRate > prevPeriodShowRate ? '+' : ''}${showRate - prevPeriodShowRate}%`,
        },
      },
    };
  }, [events, rangeStart, rangeEnd, prevRangeStart, prevRangeEnd, isDateSelected]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{isDateSelected ? 'Daily Summary' : 'Weekly Summary'}</h3>
        <span className="text-xs text-muted-foreground">
          {isDateSelected 
            ? format(rangeStart, 'EEEE, MMM d')
            : `${format(rangeStart, 'MMM d')} - ${format(rangeEnd, 'MMM d')}`
          }
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          title="Total Events"
          value={stats.totalEvents}
          icon={<Calendar className="h-4 w-4 text-info" />}
          color="bg-info"
          trend={stats.trends.events.direction}
          trendValue={stats.trends.events.value}
          trendLabel={isDateSelected ? 'vs yesterday' : 'vs last week'}
        />
        <StatCard
          title="Time Booked"
          value={`${stats.totalHours}h`}
          icon={<Clock className="h-4 w-4 text-accent" />}
          color="bg-accent"
          trend={stats.trends.hours.direction}
          trendValue={stats.trends.hours.value}
          trendLabel={isDateSelected ? 'vs yesterday' : 'vs last week'}
        />
        <StatCard
          title="Confirmed"
          value={stats.confirmed}
          subtitle={`${stats.showRate}% show rate`}
          icon={<CheckCircle2 className="h-4 w-4 text-success" />}
          color="bg-success"
          trend={stats.trends.showRate.direction}
          trendValue={stats.trends.showRate.value}
          trendLabel={isDateSelected ? 'vs yesterday' : 'vs last week'}
        />
        <StatCard
          title="No Shows"
          value={stats.noShows}
          icon={<XCircle className="h-4 w-4 text-destructive" />}
          color="bg-destructive"
          trend={stats.trends.noShows.direction}
          trendValue={stats.trends.noShows.value}
          trendLabel={isDateSelected ? 'vs yesterday' : 'vs last week'}
        />
        <StatCard
          title="Unique Clients"
          value={stats.uniqueContacts}
          icon={<Users className="h-4 w-4 text-brand-500" />}
          color="bg-brand-500"
          trend={stats.trends.contacts.direction}
          trendValue={stats.trends.contacts.value}
          trendLabel={isDateSelected ? 'vs yesterday' : 'vs last week'}
        />
        <StatCard
          title={isDateSelected ? 'Day' : 'Busiest Day'}
          value={stats.busiestDay}
          subtitle={`${stats.busiestDayCount} event${stats.busiestDayCount !== 1 ? 's' : ''}`}
          icon={<Zap className="h-4 w-4 text-warning" />}
          color="bg-warning"
        />
      </div>
    </div>
  );
}
