import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { differenceInMinutes, format, startOfWeek, endOfWeek, eachDayOfInterval, getDay } from 'date-fns';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { statusBadgeClass, statusLabel } from '@/lib/calendar/eventColour.pure';
import { FALLBACK_CALENDAR_COLOR } from '@/lib/calendarColors';

interface TimeAllocationDashboardProps {
  events: Array<{
    startTime?: string;
    endTime?: string;
    calendarId?: string;
    appointmentStatus?: string;
    title?: string;
  }>;
  calendars: Array<{ id: string; name: string; eventColor?: string }>;
  currentWeek: Date;
  selectedDate?: Date | null;
}

export function TimeAllocationDashboard({ events, calendars, currentWeek, selectedDate }: TimeAllocationDashboardProps) {
  const safeParseISO = (value: string | undefined): Date | null => {
    try {
      if (!value) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  // Determine date range based on selectedDate
  const isDateSelected = selectedDate !== null && selectedDate !== undefined;
  const rangeStart = isDateSelected ? selectedDate : startOfWeek(currentWeek);
  const rangeEnd = isDateSelected ? selectedDate : endOfWeek(currentWeek);
  const weekDays = isDateSelected 
    ? [selectedDate] 
    : eachDayOfInterval({ start: rangeStart, end: rangeEnd });

  // Calculate time by calendar
  const timeByCalendar = useMemo(() => {
    const data: Record<string, number> = {};
    
    events.forEach(event => {
      const start = safeParseISO(event.startTime);
      const end = safeParseISO(event.endTime);
      if (start && end) {
        // For single date, check same day; for range, check within range
        const inRange = isDateSelected 
          ? start.toDateString() === rangeStart.toDateString()
          : (start >= rangeStart && start <= rangeEnd);
        
        if (inRange) {
          const duration = differenceInMinutes(end, start);
          const calId = event.calendarId || 'unknown';
          data[calId] = (data[calId] || 0) + duration;
        }
      }
    });

    return Object.entries(data).map(([calId, minutes]) => {
      const cal = calendars.find(c => c.id === calId);
      return {
        name: cal?.name || 'Unknown',
        value: Math.round(minutes / 60 * 10) / 10,
        color: cal?.eventColor || FALLBACK_CALENDAR_COLOR,
        minutes,
      };
    }).sort((a, b) => b.value - a.value);
  }, [events, calendars, rangeStart, rangeEnd, isDateSelected]);

  // Calculate time by day
  const timeByDay = useMemo(() => {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const data = weekDays.map(day => ({
      name: dayNames[getDay(day)],
      date: format(day, 'MMM d'),
      hours: 0,
      events: 0,
    }));

    events.forEach(event => {
      const start = safeParseISO(event.startTime);
      const end = safeParseISO(event.endTime);
      if (start && end) {
        const inRange = isDateSelected 
          ? start.toDateString() === rangeStart.toDateString()
          : (start >= rangeStart && start <= rangeEnd);
        
        if (inRange) {
          const dayIndex = isDateSelected ? 0 : getDay(start);
          const duration = differenceInMinutes(end, start);
          if (data[dayIndex]) {
            data[dayIndex].hours += Math.round(duration / 60 * 10) / 10;
            data[dayIndex].events += 1;
          }
        }
      }
    });

    return data;
  }, [events, weekDays, rangeStart, rangeEnd, isDateSelected]);

  // Calculate status distribution
  const statusDistribution = useMemo(() => {
    const data: Record<string, number> = {};
    
    events.forEach(event => {
      const start = safeParseISO(event.startTime);
      if (start) {
        const inRange = isDateSelected 
          ? start.toDateString() === rangeStart.toDateString()
          : (start >= rangeStart && start <= rangeEnd);
        
        if (inRange) {
          const status = event.appointmentStatus || 'pending';
          data[status] = (data[status] || 0) + 1;
        }
      }
    });

    // No colour here. A status is drawn as a BADGE and a calendar as a coloured
    // dot, because the two used to share both the mark and the hue: "Confirmed"
    // wore the same green round dot as the "Strategy Session" calendar directly
    // above it. Colour alone could never separate them — a calendar's colour is
    // assigned from an open palette that contains greens — so form carries the
    // distinction and `statusBadgeClass` carries the hue.
    return Object.entries(data).map(([status, count]) => ({
      status,
      name: statusLabel(status),
      value: count,
    }));
  }, [events, rangeStart, rangeEnd, isDateSelected]);

  const totalHours = timeByCalendar.reduce((sum, c) => sum + c.value, 0);
  const totalEvents = timeByDay.reduce((sum, d) => sum + d.events, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Time Allocation</h3>
        <span className="text-xs text-muted-foreground">
          {isDateSelected 
            ? format(rangeStart, 'EEEE, MMM d')
            : `${format(rangeStart, 'MMM d')} - ${format(rangeEnd, 'MMM d')}`
          }
        </span>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3 text-center">
          <div className="text-lg font-bold text-primary">{totalHours.toFixed(1)}h</div>
          <div className="text-xs text-muted-foreground">Total Time</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-lg font-bold text-info">{totalEvents}</div>
          <div className="text-xs text-muted-foreground">Events</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-lg font-bold text-brand-400">
            {totalEvents > 0 ? (totalHours / totalEvents * 60).toFixed(0) : 0}m
          </div>
          <div className="text-xs text-muted-foreground">Avg Duration</div>
        </Card>
      </div>

      {/* Time by Calendar Pie Chart */}
      {timeByCalendar.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">By Calendar</h4>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={timeByCalendar}
                  cx="50%"
                  cy="50%"
                  innerRadius={25}
                  outerRadius={50}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {timeByCalendar.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-popover border rounded-lg px-3 py-2 shadow-lg">
                          <p className="font-medium text-sm">{data.name}</p>
                          <p className="text-xs text-muted-foreground">{data.value}h booked</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-2">
            {timeByCalendar.slice(0, 4).map((cal, idx) => (
              <div key={idx} className="flex items-center gap-1.5 text-xs">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cal.color }} />
                <span className="truncate max-w-[80px]">{cal.name}</span>
                <span className="text-muted-foreground">({cal.value}h)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hours by Day Bar Chart */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">Hours by Day</h4>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timeByDay} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-popover border rounded-lg px-3 py-2 shadow-lg">
                        <p className="font-medium text-sm">{data.date}</p>
                        <p className="text-xs text-muted-foreground">{data.hours}h • {data.events} events</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="hours" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Status Distribution */}
      {statusDistribution.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Status Breakdown</h4>
          <div className="flex flex-wrap gap-2">
            {statusDistribution.map((status, idx) => (
              <div
                key={idx}
                className={cn(
                  'flex items-center gap-1.5 border px-2 py-1 text-xs',
                  statusBadgeClass(status.status),
                )}
              >
                <span>{status.name}</span>
                <span className="font-medium">{status.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
