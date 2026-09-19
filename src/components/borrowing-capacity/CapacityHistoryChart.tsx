import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format } from 'date-fns';
import { TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react';
import { formatCapacity } from '@/utils/borrowingCapacityCalculations';

interface HistoryEntry {
  id: string;
  borrowing_capacity: number;
  serviceability_band: string;
  created_at: string;
}

interface CapacityHistoryChartProps {
  history: HistoryEntry[];
  isLoading?: boolean;
}

export function CapacityHistoryChart({ history, isLoading }: CapacityHistoryChartProps) {
  const chartData = useMemo(() => {
    return [...history]
      .reverse()
      .map((entry) => ({
        date: format(new Date(entry.created_at), 'dd MMM'),
        fullDate: format(new Date(entry.created_at), 'dd MMM yyyy'),
        capacity: entry.borrowing_capacity,
        band: entry.serviceability_band,
      }));
  }, [history]);

  const trend = useMemo(() => {
    if (history.length < 2) return 'unchanged';
    const latest = history[0]?.borrowing_capacity || 0;
    const previous = history[1]?.borrowing_capacity || 0;
    if (latest > previous) return 'increase';
    if (latest < previous) return 'decrease';
    return 'unchanged';
  }, [history]);

  const latestCapacity = history[0]?.borrowing_capacity || 0;
  const averageCapacity = useMemo(() => {
    if (history.length === 0) return 0;
    return history.reduce((sum, h) => sum + h.borrowing_capacity, 0) / history.length;
  }, [history]);

  const formatYAxis = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${Math.round(value / 1000)}K`;
    return `$${value}`;
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const data = payload[0].payload;
    
    const bandColors: Record<string, string> = {
      green: 'bg-success',
      amber: 'bg-warning',
      red: 'bg-destructive',
    };

    return (
      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
        <p className="text-xs text-muted-foreground mb-1">{data.fullDate}</p>
        <p className="text-lg font-bold text-foreground">
          {formatCapacity(data.capacity)}
        </p>
        <Badge className={`mt-1 ${bandColors[data.band] || 'bg-muted'} text-foreground dark:text-white`}>
          {data.band?.toUpperCase()}
        </Badge>
      </div>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Capacity History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center">
            <p className="text-muted-foreground">Loading history...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Capacity History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center">
            <p className="text-muted-foreground text-center">
              No history yet.<br />
              <span className="text-sm">Calculate and save to build history.</span>
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Capacity History
          </CardTitle>
          <div className="flex items-center gap-2">
            {trend === 'increase' && (
              <Badge variant="outline" className="text-success border-success/30 bg-success/10">
                <TrendingUp className="h-3 w-3 mr-1" />
                Improving
              </Badge>
            )}
            {trend === 'decrease' && (
              <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/10">
                <TrendingDown className="h-3 w-3 mr-1" />
                Declining
              </Badge>
            )}
            {trend === 'unchanged' && (
              <Badge variant="outline" className="text-muted-foreground">
                <Minus className="h-3 w-3 mr-1" />
                Stable
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-secondary/30 text-center">
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="text-lg font-bold text-foreground">
              {formatCapacity(latestCapacity)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-secondary/30 text-center">
            <p className="text-xs text-muted-foreground">Average</p>
            <p className="text-lg font-bold text-foreground">
              {formatCapacity(averageCapacity)}
            </p>
          </div>
        </div>

        {/* Chart */}
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
              />
              <YAxis 
                tickFormatter={formatYAxis}
                tick={{ fontSize: 11 }}
                width={60}
                className="text-muted-foreground"
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine 
                y={averageCapacity} 
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                strokeOpacity={0.5}
              />
              <Line
                type="monotone"
                dataKey="capacity"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 4, fill: 'hsl(var(--primary))' }}
                activeDot={{ r: 6, fill: 'hsl(var(--primary))' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          Last {history.length} assessment{history.length !== 1 ? 's' : ''}
        </p>
      </CardContent>
    </Card>
  );
}
