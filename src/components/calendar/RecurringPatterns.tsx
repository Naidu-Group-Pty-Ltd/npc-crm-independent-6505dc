import { useMemo } from 'react';
import { format, getDay, getHours, differenceInDays, startOfWeek, isSameDay } from 'date-fns';
import { Repeat, Calendar, Clock, TrendingUp, AlertCircle, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface RecurringPatternsProps {
  events: Array<{
    id: string;
    title?: string;
    startTime?: string;
    endTime?: string;
    calendarId?: string;
    calendarColor?: string;
  }>;
  onPatternClick?: (pattern: DetectedPattern) => void;
}

interface DetectedPattern {
  type: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';
  title: string;
  occurrences: number;
  confidence: number;
  dayOfWeek?: number;
  hourOfDay?: number;
  events: string[];
  suggestedAction?: string;
}

export function RecurringPatterns({ events, onPatternClick }: RecurringPatternsProps) {
  const safeParseISO = (value: string | undefined): Date | null => {
    try {
      if (!value) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  const patterns = useMemo(() => {
    const detected: DetectedPattern[] = [];
    const titleGroups: Record<string, Array<{ event: typeof events[0]; date: Date }>> = {};

    // Group events by normalized title
    events.forEach(event => {
      const date = safeParseISO(event.startTime);
      if (!date || !event.title) return;

      const normalizedTitle = event.title.toLowerCase().trim()
        .replace(/\d+/g, '') // Remove numbers
        .replace(/\s+/g, ' '); // Normalize spaces

      if (!titleGroups[normalizedTitle]) {
        titleGroups[normalizedTitle] = [];
      }
      titleGroups[normalizedTitle].push({ event, date });
    });

    // Analyze each group for patterns
    Object.entries(titleGroups).forEach(([normalizedTitle, group]) => {
      if (group.length < 2) return;

      // Sort by date
      group.sort((a, b) => a.date.getTime() - b.date.getTime());

      // Analyze day of week consistency
      const dayOfWeekCounts: Record<number, number> = {};
      const hourCounts: Record<number, number> = {};
      const gaps: number[] = [];

      for (let i = 0; i < group.length; i++) {
        const dow = getDay(group[i].date);
        const hour = getHours(group[i].date);
        dayOfWeekCounts[dow] = (dayOfWeekCounts[dow] || 0) + 1;
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;

        if (i > 0) {
          gaps.push(differenceInDays(group[i].date, group[i - 1].date));
        }
      }

      // Find most common day and hour
      const mostCommonDay = Object.entries(dayOfWeekCounts)
        .sort((a, b) => b[1] - a[1])[0];
      const mostCommonHour = Object.entries(hourCounts)
        .sort((a, b) => b[1] - a[1])[0];

      // Determine pattern type
      let patternType: DetectedPattern['type'] = 'custom';
      let confidence = 0;

      if (gaps.length > 0) {
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const gapVariance = gaps.reduce((sum, g) => sum + Math.pow(g - avgGap, 2), 0) / gaps.length;
        const gapStdDev = Math.sqrt(gapVariance);

        if (gapStdDev <= 1) {
          if (avgGap >= 0.5 && avgGap <= 1.5) {
            patternType = 'daily';
            confidence = Math.max(0, 100 - gapStdDev * 20);
          } else if (avgGap >= 6 && avgGap <= 8) {
            patternType = 'weekly';
            confidence = Math.max(0, 100 - gapStdDev * 10);
          } else if (avgGap >= 13 && avgGap <= 15) {
            patternType = 'biweekly';
            confidence = Math.max(0, 100 - gapStdDev * 10);
          } else if (avgGap >= 28 && avgGap <= 32) {
            patternType = 'monthly';
            confidence = Math.max(0, 100 - gapStdDev * 5);
          }
        }
      }

      // Day consistency boost
      const dayConsistency = (Number(mostCommonDay[1]) / group.length) * 100;
      if (dayConsistency >= 80) {
        confidence = Math.min(100, confidence + 10);
      }

      // Only add patterns with reasonable confidence
      if (confidence >= 50 || group.length >= 3) {
        const displayTitle = group[0].event.title || 'Untitled';
        
        detected.push({
          type: patternType,
          title: displayTitle,
          occurrences: group.length,
          confidence: Math.round(confidence),
          dayOfWeek: Number(mostCommonDay[0]),
          hourOfDay: Number(mostCommonHour[0]),
          events: group.map(g => g.event.id),
          suggestedAction: patternType !== 'custom' 
            ? `Consider creating a recurring ${patternType} event`
            : undefined,
        });
      }
    });

    // Sort by confidence and occurrences
    return detected.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.occurrences - a.occurrences;
    }).slice(0, 10);
  }, [events]);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const getPatternIcon = (type: DetectedPattern['type']) => {
    switch (type) {
      case 'daily': return <Repeat className="h-3 w-3" />;
      case 'weekly': return <Calendar className="h-3 w-3" />;
      case 'biweekly': return <Calendar className="h-3 w-3" />;
      case 'monthly': return <TrendingUp className="h-3 w-3" />;
      default: return <Sparkles className="h-3 w-3" />;
    }
  };

  const getPatternLabel = (pattern: DetectedPattern) => {
    const timeStr = pattern.hourOfDay !== undefined 
      ? format(new Date().setHours(pattern.hourOfDay, 0), 'h a')
      : '';

    switch (pattern.type) {
      case 'daily':
        return `Daily${timeStr ? ` at ${timeStr}` : ''}`;
      case 'weekly':
        return `Every ${pattern.dayOfWeek !== undefined ? dayNames[pattern.dayOfWeek] : 'week'}${timeStr ? ` at ${timeStr}` : ''}`;
      case 'biweekly':
        return `Every 2 weeks${pattern.dayOfWeek !== undefined ? ` on ${dayNames[pattern.dayOfWeek]}` : ''}`;
      case 'monthly':
        return `Monthly`;
      default:
        return `Custom pattern (${pattern.occurrences}x)`;
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-success';
    if (confidence >= 60) return 'text-brand-400';
    return 'text-warning';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Repeat className="h-4 w-4" />
          Recurring Patterns
        </h3>
        <Badge variant="outline" className="text-xs">
          {patterns.length} detected
        </Badge>
      </div>

      {patterns.length === 0 ? (
        <Card className="p-6 text-center bg-muted/30">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="text-sm font-medium text-muted-foreground">No Patterns Detected</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add more events to detect recurring patterns
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
            {patterns.map((pattern, idx) => (
              <Card
                key={idx}
                className={cn(
                  'p-3 transition-all hover:scale-[1.01] cursor-pointer',
                  'hover:border-primary/30'
                )}
                onClick={() => onPatternClick?.(pattern)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      'p-1.5 rounded-md',
                      pattern.confidence >= 80 && 'bg-success/20',
                      pattern.confidence >= 60 && pattern.confidence < 80 && 'bg-brand-500/20',
                      pattern.confidence < 60 && 'bg-warning/20'
                    )}>
                      {getPatternIcon(pattern.type)}
                    </div>
                    <div>
                      <p className="text-sm font-medium truncate max-w-[180px]">{pattern.title}</p>
                      <p className="text-xs text-muted-foreground">{getPatternLabel(pattern)}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={cn('text-xs', getConfidenceColor(pattern.confidence))}>
                    {pattern.confidence}%
                  </Badge>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Confidence</span>
                    <span className={getConfidenceColor(pattern.confidence)}>{pattern.confidence}%</span>
                  </div>
                  <Progress value={pattern.confidence} className="h-1.5" />
                </div>

                <div className="flex items-center justify-between mt-2 pt-2 border-t">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {pattern.occurrences} occurrences
                  </div>
                  {pattern.suggestedAction && (
                    <span className="text-[10px] text-primary truncate max-w-[140px]">
                      {pattern.suggestedAction}
                    </span>
                  )}
                </div>
              </Card>
            ))}
        </div>
      )}

      {/* Pattern types legend */}
      <div className="pt-2 border-t">
        <p className="text-xs text-muted-foreground mb-2">Pattern types:</p>
        <div className="flex flex-wrap gap-2">
          {['daily', 'weekly', 'biweekly', 'monthly'].map(type => (
            <div key={type} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {getPatternIcon(type as DetectedPattern['type'])}
              <span className="capitalize">{type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
