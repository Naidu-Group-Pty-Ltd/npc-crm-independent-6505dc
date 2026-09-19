import { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface KPICardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  description?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
  compact?: boolean;
}

export function KPICard({ 
  title, 
  value, 
  icon, 
  description, 
  trend, 
  className,
  compact = false 
}: KPICardProps) {
  return (
    <Card className={cn("dashboard-kpi-card border-0", className)}>
      <CardHeader className={cn(
        "flex flex-row items-center justify-between space-y-0",
        compact ? "pb-1 pt-3 px-3" : "pb-2"
      )}>
        <CardTitle className={cn(
          "dashboard-kpi-title font-medium",
          compact ? "text-xs" : "text-sm"
        )}>
          {title}
        </CardTitle>
        {icon && (
          <div className={cn(
            "dashboard-kpi-icon text-muted-foreground",
            compact ? "h-3.5 w-3.5" : "h-4 w-4"
          )}>
            {icon}
          </div>
        )}
      </CardHeader>
      <CardContent className={compact ? "pb-3 px-3" : ""}>
        <div className={cn(
          "dashboard-kpi-value",
          compact ? "text-lg" : "text-2xl"
        )}>
          {value}
        </div>
        {description && !compact && (
          <p className="text-xs text-muted-foreground mt-1">
            {description}
          </p>
        )}
        {trend && (
          <div className={cn(
            "dashboard-trend-chip mt-2",
            trend.isPositive ? "dashboard-trend-chip-positive" : "dashboard-trend-chip-negative"
          )}>
            <span>
              {trend.isPositive ? "+" : ""}{trend.value}%
            </span>
            <span className="text-current/80">from last period</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}