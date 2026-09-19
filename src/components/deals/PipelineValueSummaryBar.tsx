import { useMemo } from "react";
import {
  Building2,
  Home,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Users,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { DealWithClient } from "@/hooks/useAllDeals";
import { cn } from "@/lib/utils";

interface Props {
  deals: DealWithClient[];
}

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  variant:
    | "headline"
    | "analytical"
    | "financial"
    | "existing"
    | "land"
    | "refinance"
    | "operations";
}

/**
 * Each card carries a categorical accent so the seven metrics stay scannable,
 * but the surface itself is derived from `--card` rather than a baked-in dark
 * gradient. The previous styling hardcoded near-black backgrounds with near-white
 * text, which only ever resolved correctly on the dark theme; on light it painted
 * a row of black tiles across a cream dashboard.
 *
 * Restraint: only the headline card gets a filled brand treatment. The other six
 * are quiet accent-tinted cards, so the eye lands on total pipeline value first.
 */
const metricCardStyles: Record<
  MetricCardProps["variant"],
  {
    card: string;
    iconWrap: string;
    icon: string;
  }
> = {
  headline: {
    card: "border-brand/45 bg-gradient-to-br from-brand/25 via-card to-card",
    iconWrap: "border-brand/30 bg-brand/15",
    icon: "text-brand-700 dark:text-brand",
  },
  analytical: {
    card: "border-info/30 bg-gradient-to-br from-info/12 via-card to-card",
    iconWrap: "border-info/25 bg-info/10",
    icon: "text-info",
  },
  financial: {
    card: "border-success/30 bg-gradient-to-br from-success/12 via-card to-card",
    iconWrap: "border-success/25 bg-success/10",
    icon: "text-success",
  },
  existing: {
    card: "border-accent/30 bg-gradient-to-br from-accent/12 via-card to-card",
    iconWrap: "border-accent/25 bg-accent/10",
    icon: "text-accent",
  },
  land: {
    card: "border-warning/30 bg-gradient-to-br from-warning/12 via-card to-card",
    iconWrap: "border-warning/25 bg-warning/10",
    icon: "text-warning",
  },
  refinance: {
    card: "border-chart-7/30 bg-gradient-to-br from-chart-7/12 via-card to-card",
    iconWrap: "border-chart-7/25 bg-chart-7/10",
    icon: "text-chart-7",
  },
  operations: {
    card: "border-border bg-card",
    iconWrap: "border-border bg-muted",
    icon: "text-muted-foreground",
  },
};

function MetricCard({ label, value, icon: Icon, variant }: MetricCardProps) {
  const styles = metricCardStyles[variant];

  return (
    <Card
      className={cn(
        "group relative overflow-hidden rounded-3xl border shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        "before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-foreground/10 before:to-transparent",
        styles.card,
      )}
    >
      <CardContent className="relative z-10 flex min-h-[118px] flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-[0.72rem] font-medium uppercase leading-snug tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100",
              styles.iconWrap,
            )}
          >
            <Icon className={cn("h-[18px] w-[18px]", styles.icon)} aria-hidden="true" />
          </span>
        </div>
        {/* Fluid size instead of three fixed steps: a seven-figure pipeline
            total must shrink to fit its tile, never print as "$3,300…". */}
        <p
          className="mt-6 whitespace-nowrap text-[clamp(1.3rem,0.9vw+0.9rem,2.35rem)] font-semibold leading-none tracking-[-0.045em] text-foreground"
          title={typeof value === 'string' ? value : undefined}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export function PipelineValueSummaryBar({ deals }: Props) {
  const stats = useMemo(() => {
    const totalValue = deals.reduce(
      (s, d) => s + (d.total_contract_price || 0),
      0,
    );
    const avgValue = deals.length > 0 ? totalValue / deals.length : 0;
    const totalCommission = deals.reduce(
      (s, d) => s + (d.commission_estimate || 0),
      0,
    );

    const byType = {
      existing_property: deals.filter(
        (d) => d.deal_type === "existing_property",
      ).length,
      house_and_land: deals.filter((d) => d.deal_type === "house_and_land")
        .length,
      refinance: deals.filter((d) => d.deal_type === "refinance").length,
    };

    // Stage distribution for conversion
    const stageGroups = { early: 0, mid: 0, late: 0 };
    deals.forEach((d) => {
      if (d.current_stage_number <= 2) stageGroups.early++;
      else if (d.current_stage_number <= 5) stageGroups.mid++;
      else stageGroups.late++;
    });

    const uniquePersons = new Set(
      deals.map((d) => d.responsible_person).filter(Boolean),
    ).size;

    return {
      totalValue,
      avgValue,
      totalCommission,
      byType,
      stageGroups,
      uniquePersons,
    };
  }, [deals]);

  const fmt = (v: number) =>
    new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 0,
    }).format(v);

  return (
    <section className="deal-pipeline-kpis grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7">
      <MetricCard
        label="Total Pipeline"
        value={fmt(stats.totalValue)}
        icon={DollarSign}
        variant="headline"
      />
      <MetricCard
        label="Avg Deal Size"
        value={fmt(stats.avgValue)}
        icon={BarChart3}
        variant="analytical"
      />
      <MetricCard
        label="Est. Commission"
        value={fmt(stats.totalCommission)}
        icon={TrendingUp}
        variant="financial"
      />
      <MetricCard
        label="Existing Property"
        value={stats.byType.existing_property}
        icon={Building2}
        variant="existing"
      />
      <MetricCard
        label="House & Land"
        value={stats.byType.house_and_land}
        icon={Home}
        variant="land"
      />
      <MetricCard
        label="Refinance"
        value={stats.byType.refinance}
        icon={RefreshCw}
        variant="refinance"
      />
      <MetricCard
        label="Team Members"
        value={stats.uniquePersons}
        icon={Users}
        variant="operations"
      />
    </section>
  );
}
