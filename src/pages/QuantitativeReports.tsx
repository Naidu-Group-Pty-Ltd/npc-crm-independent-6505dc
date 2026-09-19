import { useState, useEffect, useRef, lazy, Suspense, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthenticatedSupabase } from "@/hooks/useAuthenticatedSupabase";
import { useUserNames } from "@/hooks/useUserNames";
import { QuantitativeReportCard } from "@/components/reports/library/QuantitativeReportCard";
import type { GeneratedReport } from "@/components/reports/library/types";
import { useQuery } from "@tanstack/react-query";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { PropertyListing } from "@/lib/airtable";
import { propertyDataService } from "@/services/propertyDataService";
import { chartDataService } from "@/services/chartDataService";
import { KPICard } from "@/components/dashboard/KPICard";
import { ReportConfigModal } from "@/components/reports/ReportConfigModal";
import { useReportGenerator } from "@/hooks/useReportGenerator";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import {
  Building2,
  MapPin,
  DollarSign,
  Calendar,
  TrendingUp,
  Users,
  Globe,
  BarChart3,
  Lightbulb,
  Loader2,
  AlertTriangle,
  FileText,
} from "lucide-react";

// Lazy load heavy analytics components
const AdvancedAnalytics = lazy(() =>
  import("@/components/reports/AdvancedAnalytics").then((m) => ({
    default: m.AdvancedAnalytics,
  })),
);
const TemporalAnalysis = lazy(() =>
  import("@/components/reports/TemporalAnalysis").then((m) => ({
    default: m.TemporalAnalysis,
  })),
);
const GeographicAnalysis = lazy(() =>
  import("@/components/reports/GeographicAnalysis").then((m) => ({
    default: m.GeographicAnalysis,
  })),
);
const AgentPerformance = lazy(() =>
  import("@/components/reports/AgentPerformance").then((m) => ({
    default: m.AgentPerformance,
  })),
);
const ExecutiveInsights = lazy(() =>
  import("@/components/reports/ExecutiveInsights").then((m) => ({
    default: m.ExecutiveInsights,
  })),
);
const DataQualityAnalysis = lazy(() =>
  import("@/components/reports/DataQualityAnalysis").then((m) => ({
    default: m.DataQualityAnalysis,
  })),
);

// Loading fallback component
const ComponentLoader = () => (
  <Card className="ci-card-premium reports-loading-card">
    <CardContent className="p-6">
      <div className="flex items-center gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-3 text-sm font-medium text-primary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading reporting module...
      </div>
      <div className="mt-5 space-y-4">
        <Skeleton className="h-8 w-1/3 rounded-full" />
        <Skeleton className="h-4 w-2/3 rounded-full" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    </CardContent>
  </Card>
);

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
  "hsl(var(--chart-7))",
  "hsl(var(--chart-8))",
  "hsl(var(--chart-9))",
  "hsl(var(--chart-10))",
];

export default function QuantitativeReports() {
  const navigate = useNavigate();
  const { canEdit: canEditReports } = useModulePermissions("reports");
  const [allListings, setAllListings] = useState<PropertyListing[]>([]);
  const { generateReport, isGenerating, progress, currentStep } =
    useReportGenerator();

  // Chart refs for PDF generation
  const kpisRef = useRef<HTMLDivElement>(null);
  const advancedAnalyticsRef = useRef<HTMLDivElement>(null);
  const temporalAnalysisRef = useRef<HTMLDivElement>(null);
  const suburbChartRef = useRef<HTMLDivElement>(null);
  const propertyTypeChartRef = useRef<HTMLDivElement>(null);
  const priceRangeChartRef = useRef<HTMLDivElement>(null);
  const bedroomChartRef = useRef<HTMLDivElement>(null);
  const geographicAnalysisRef = useRef<HTMLDivElement>(null);
  const agentPerformanceRef = useRef<HTMLDivElement>(null);
  const executiveInsightsRef = useRef<HTMLDivElement>(null);

  const { data: listings, isLoading } = useQuery({
    queryKey: ["all-listings"],
    queryFn: async () => {
      // Use unified data service for consistent data fetching
      const result = await propertyDataService.fetchAllListings({
        includeDebugInfo: true,
      });

      console.log("Reports data fetch:", result.debugInfo);
      console.log("Reports listings count:", result.listings.length);
      return result.listings;
    },
  });

  useEffect(() => {
    if (listings) {
      setAllListings(listings);
    }
  }, [listings]);

  // Calculate metrics
  const totalListings = allListings.length;
  const avgPrice =
    allListings.length > 0
      ? Math.round(
          allListings.reduce((sum, listing) => sum + (listing.price || 0), 0) /
            allListings.length,
        )
      : 0;

  // Use unified chart data service for consistent suburb data
  const suburbChartData = chartDataService
    .generateSuburbData(allListings, 10)
    .data.map((item) => ({ suburb: item.label, count: item.value }));

  // Use unified chart data service for consistent property type data
  const propertyTypeChartData = chartDataService
    .generatePropertyTypeData(allListings)
    .data.map((item) => ({ type: item.label, count: item.value }));

  // Use unified chart data service for consistent price range data
  const priceRangeChartData = chartDataService
    .generatePriceRangeData(allListings)
    .data.map((item) => ({ range: item.label, count: item.value }));

  // Use unified chart data service for consistent bedroom data
  const bedroomChartData = chartDataService
    .generateBedroomData(allListings)
    .data.map((item) => ({ beds: item.label, count: item.value }));

  // Recent listings (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentListings = allListings.filter((listing) => {
    const receivedAt = listing.receivedAt;
    return receivedAt && new Date(receivedAt) >= thirtyDaysAgo;
  }).length;

  const chartConfig = {
    count: {
      label: "Count",
      color: "hsl(var(--chart-1))",
    },
    listings: {
      label: "Listings",
      color: "hsl(var(--chart-2))",
    },
    price: {
      label: "Price",
      color: "hsl(var(--chart-3))",
    },
  };

  if (isLoading) {
    return (
      <div className="ci-foundation ci-page-shell reports-page-premium">
        <Card className="ci-card-premium reports-loading-card overflow-hidden">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="ci-tab-eyebrow">NPC reporting command centre</p>
                <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">
                  Reports
                </h1>
                <p className="mt-2 text-muted-foreground">
                  Quantitative analysis of your property listings
                </p>
              </div>
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading reporting data...
              </div>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-4">
              {[0, 1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-border/70 bg-background/45 p-4 shadow-sm"
                >
                  <Skeleton className="h-4 w-24 rounded-full" />
                  <Skeleton className="mt-4 h-8 w-20 rounded-full" />
                  <Skeleton className="mt-3 h-3 w-full rounded-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleGenerateReport = async (config: any) => {
    await generateReport(config, allListings, {
      kpis: kpisRef.current,
      advancedAnalytics: advancedAnalyticsRef.current,
      temporalAnalysis: temporalAnalysisRef.current,
      suburbChart: suburbChartRef.current,
      propertyTypeChart: propertyTypeChartRef.current,
      priceRangeChart: priceRangeChartRef.current,
      bedroomChart: bedroomChartRef.current,
      geographicAnalysis: geographicAnalysisRef.current,
      agentPerformance: agentPerformanceRef.current,
      executiveInsights: executiveInsightsRef.current,
    });
  };

  return (
    <div className="ci-foundation ci-page-shell reports-page-premium">
      <div className="w-full space-y-6">
        <Card className="ci-suite-header overflow-hidden reports-top-command">
          <CardContent className="relative z-10 p-5 md:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex items-start gap-4">
                <span className="ci-header-icon reports-header-icon">
                  <BarChart3 className="h-6 w-6" />
                </span>
                <div>
                  <p className="ci-tab-eyebrow">Quantitative intelligence</p>
                  <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                    Quantitative Reports
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
                    Generate, review and manage quantitative property analytics
                    and reporting.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="h-11 rounded-2xl"
                onClick={() => navigate("/charts")}
              >
                <BarChart3 className="h-4 w-4" /> View Charts
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5 md:space-y-7">
          <Card className="ci-card-premium reports-quant-header">
            <CardContent className="p-5 md:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="max-w-3xl">
                  <p className="ci-tab-eyebrow">Quantitative intelligence</p>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                    Quantitative Analysis
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground md:text-base">
                    Statistical analysis of your property listings
                  </p>
                </div>
                <ReportConfigModal
                  onGenerateReport={handleGenerateReport}
                  isGenerating={isGenerating}
                  progress={progress}
                  currentStep={currentStep}
                />
              </div>
            </CardContent>
          </Card>

          {/* KPIs */}
          <div
            ref={kpisRef}
            className="grid gap-4 grid-cols-2 lg:grid-cols-4 reports-kpi-grid"
          >
            <KPICard
              className="reports-kpi-tile reports-kpi-tile-primary"
              title="Total Listings"
              value={totalListings.toLocaleString('en-AU')}
              icon={<Building2 className="h-4 w-4" />}
              description="All property listings"
            />
            <KPICard
              className="reports-kpi-tile reports-kpi-tile-value"
              title="Average Price"
              value={`$${avgPrice.toLocaleString('en-AU')}`}
              icon={<DollarSign className="h-4 w-4" />}
              description="Across all listings"
            />
            <KPICard
              className="reports-kpi-tile reports-kpi-tile-activity"
              title="Recent Listings"
              value={recentListings.toLocaleString('en-AU')}
              icon={<Calendar className="h-4 w-4" />}
              description="Last 30 days"
            />
            <KPICard
              className="reports-kpi-tile reports-kpi-tile-coverage"
              title="Unique Suburbs"
              value={suburbChartData.length.toLocaleString('en-AU')}
              icon={<MapPin className="h-4 w-4" />}
              description="Coverage areas"
            />
          </div>

          {/* Advanced Analytics */}
          <div ref={advancedAnalyticsRef}>
            <Suspense fallback={<ComponentLoader />}>
              <AdvancedAnalytics listings={allListings} />
            </Suspense>
          </div>

          {/* Executive Insights */}
          <div ref={executiveInsightsRef}>
            <Suspense fallback={<ComponentLoader />}>
              <ExecutiveInsights listings={allListings} />
            </Suspense>
          </div>

          {/* Charts and Analysis */}
          <Tabs
            defaultValue="temporal"
            className="ci-card-premium reports-analytics-tabs-panel p-3 md:p-4 space-y-4"
          >
            <div className="reports-analytics-tabs-shell overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
              <TabsList
                aria-label="Analytics report sections"
                className="reports-analytics-tabs-list inline-flex w-auto min-w-full md:grid md:w-full md:grid-cols-7 h-auto"
              >
                <TabsTrigger value="temporal" className="reports-analytics-tab">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Trends
                </TabsTrigger>
                <TabsTrigger
                  value="geographic"
                  className="reports-analytics-tab"
                >
                  <Globe className="h-3.5 w-3.5" />
                  Geographic
                </TabsTrigger>
                <TabsTrigger value="agents" className="reports-analytics-tab">
                  <Users className="h-3.5 w-3.5" />
                  Agents
                </TabsTrigger>
                <TabsTrigger
                  value="data-quality"
                  className="reports-analytics-tab"
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  Quality
                </TabsTrigger>
                <TabsTrigger value="suburbs" className="reports-analytics-tab">
                  <MapPin className="h-3.5 w-3.5" />
                  Suburbs
                </TabsTrigger>
                <TabsTrigger
                  value="property-type"
                  className="reports-analytics-tab"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  Types
                </TabsTrigger>
                <TabsTrigger
                  value="price-range"
                  className="reports-analytics-tab"
                >
                  <DollarSign className="h-3.5 w-3.5" />
                  Pricing
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="temporal" className="space-y-4">
              <div ref={temporalAnalysisRef}>
                <Suspense fallback={<ComponentLoader />}>
                  <TemporalAnalysis listings={allListings} />
                </Suspense>
              </div>
            </TabsContent>

            <TabsContent value="geographic" className="space-y-4">
              <div ref={geographicAnalysisRef}>
                <Suspense fallback={<ComponentLoader />}>
                  <GeographicAnalysis listings={allListings} />
                </Suspense>
              </div>
            </TabsContent>

            <TabsContent value="agents" className="space-y-4">
              <div ref={agentPerformanceRef}>
                <Suspense fallback={<ComponentLoader />}>
                  <AgentPerformance listings={allListings} />
                </Suspense>
              </div>
            </TabsContent>

            <TabsContent value="data-quality" className="space-y-4">
              <Suspense fallback={<ComponentLoader />}>
                <DataQualityAnalysis listings={allListings} />
              </Suspense>
            </TabsContent>

            <TabsContent
              value="suburbs"
              className="space-y-4 reports-suburbs-suite"
            >
              <Card className="ci-card reports-suburb-card">
                <CardHeader className="reports-suburb-card-header">
                  <CardTitle>Listings by Suburb</CardTitle>
                  <CardDescription>
                    Top 10 suburbs by listing volume — higher bars indicate
                    stronger market activity in that area
                  </CardDescription>
                </CardHeader>
                <CardContent className="reports-suburb-card-content space-y-4">
                  {suburbChartData.length > 0 ? (
                    <ChartContainer
                      ref={suburbChartRef}
                      config={chartConfig}
                      className="reports-suburb-chart h-[280px] md:h-[400px]"
                      role="img"
                      aria-label="Listings by suburb chart"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={suburbChartData}
                          margin={{ top: 12, right: 14, left: 0, bottom: 60 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            opacity={0.3}
                            className="reports-pricing-grid"
                          />
                          <XAxis
                            dataKey="suburb"
                            angle={-45}
                            textAnchor="end"
                            height={80}
                            fontSize={11}
                            tick={{
                              fill: "hsl(var(--muted-foreground))",
                              fontSize: 11,
                            }}
                            tickLine={false}
                            axisLine={{ stroke: "hsl(var(--border) / 0.55)" }}
                          />
                          <YAxis
                            tick={{
                              fill: "hsl(var(--muted-foreground))",
                              fontSize: 11,
                            }}
                            tickLine={false}
                            axisLine={{ stroke: "hsl(var(--border) / 0.55)" }}
                          />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const data = payload[0].payload;
                              const pct =
                                totalListings > 0
                                  ? (
                                      (data.count / totalListings) *
                                      100
                                    ).toFixed(1)
                                  : "0";
                              return (
                                <div className="reports-suburb-tooltip">
                                  <p className="font-semibold text-sm text-foreground">
                                    {data.suburb}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {data.count} listings ({pct}% of total)
                                  </p>
                                </div>
                              );
                            }}
                          />
                          <Bar
                            dataKey="count"
                            fill="hsl(var(--primary))"
                            radius={[8, 8, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  ) : (
                    <div className="reports-suburb-empty-state">
                      <BarChart3 className="h-5 w-5" />
                      <span>No suburb listing data available.</span>
                    </div>
                  )}
                  {/* Sub-metrics */}
                  {suburbChartData.length >= 2 &&
                    (() => {
                      const top = suburbChartData[0];
                      const second = suburbChartData[1];
                      const topPct =
                        totalListings > 0
                          ? ((top.count / totalListings) * 100).toFixed(0)
                          : "0";
                      const ratio =
                        second.count > 0
                          ? (top.count / second.count).toFixed(1)
                          : "—";
                      return (
                        <div className="reports-suburb-insight flex items-start gap-2 p-3 rounded-2xl bg-brand-500/10 border border-brand-500/25">
                          <Lightbulb className="h-4 w-4 mt-0.5 text-brand-500 shrink-0" />
                          <p className="text-xs text-foreground">
                            <span className="font-semibold">{top.suburb}</span>{" "}
                            leads with {topPct}% of all listings ({top.count}),{" "}
                            {ratio}× the volume of the next suburb (
                            {second.suburb} at {second.count}).
                            {suburbChartData.length >= 3 &&
                              ` The top 3 suburbs account for ${totalListings > 0 ? (((suburbChartData[0].count + suburbChartData[1].count + suburbChartData[2].count) / totalListings) * 100).toFixed(0) : 0}% of total activity.`}
                          </p>
                        </div>
                      );
                    })()}
                  <div className="reports-pricing-stat-grid grid grid-cols-3 gap-3 pt-2 border-t">
                    <div className="reports-suburb-stat text-center">
                      <p className="text-lg font-bold text-foreground">
                        {suburbChartData.length}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Suburbs Tracked
                      </p>
                    </div>
                    <div className="reports-suburb-stat text-center">
                      <p className="text-lg font-bold text-foreground">
                        {suburbChartData[0]?.suburb || "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Top Suburb
                      </p>
                    </div>
                    <div className="reports-suburb-stat text-center">
                      <p className="text-lg font-bold text-foreground">
                        {suburbChartData.length > 0
                          ? Math.round(
                              suburbChartData.reduce((s, d) => s + d.count, 0) /
                                suburbChartData.length,
                            )
                          : 0}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Avg per Suburb
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent
              value="property-type"
              className="space-y-4 reports-types-suite"
            >
              <Card className="ci-card reports-types-card">
                <CardHeader className="reports-types-card-header">
                  <CardTitle>Property Type Distribution</CardTitle>
                  <CardDescription>
                    Proportional breakdown of listings by property category
                  </CardDescription>
                </CardHeader>
                <CardContent className="reports-types-card-content space-y-4">
                  {propertyTypeChartData.length > 0 ? (
                    <ChartContainer
                      ref={propertyTypeChartRef}
                      config={chartConfig}
                      className="reports-types-chart h-[280px] md:h-[400px]"
                      role="img"
                      aria-label="Listings by property type chart"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={propertyTypeChartData}
                            cx="50%"
                            cy="50%"
                            labelLine={true}
                            label={(props: any) => {
                              const pct = (props.percent * 100).toFixed(0);
                              return `${props.type} (${pct}%)`;
                            }}
                            outerRadius={112}
                            innerRadius={56}
                            fill="#8884d8"
                            dataKey="count"
                            paddingAngle={2}
                          >
                            {propertyTypeChartData.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={COLORS[index % COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const data = payload[0].payload;
                              const pct =
                                totalListings > 0
                                  ? (
                                      (data.count / totalListings) *
                                      100
                                    ).toFixed(1)
                                  : "0";
                              return (
                                <div className="reports-types-tooltip">
                                  <p className="font-semibold text-sm text-foreground">
                                    {data.type}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {data.count} listings • {pct}% of total
                                  </p>
                                </div>
                              );
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  ) : (
                    <div className="reports-types-empty-state">
                      <BarChart3 className="h-5 w-5" />
                      <span>No property type data available.</span>
                    </div>
                  )}
                  {/* Dominant type callout */}
                  {propertyTypeChartData.length > 0 &&
                    (() => {
                      const dominant = propertyTypeChartData.reduce(
                        (max, d) => (d.count > max.count ? d : max),
                        propertyTypeChartData[0],
                      );
                      const dominantPct =
                        totalListings > 0
                          ? ((dominant.count / totalListings) * 100).toFixed(0)
                          : "0";
                      return (
                        <div className="reports-types-insight flex items-center gap-2 p-3 rounded-2xl bg-brand-500/10 border border-brand-500/25">
                          <Lightbulb className="h-4 w-4 text-brand-500 shrink-0" />
                          <p className="text-xs text-foreground">
                            <span className="font-semibold">
                              {dominant.type}
                            </span>{" "}
                            properties dominate at{" "}
                            <span className="font-semibold">
                              {dominantPct}%
                            </span>{" "}
                            of all listings ({dominant.count} of {totalListings}
                            ).
                          </p>
                          <Badge
                            variant="outline"
                            className="reports-types-badge ml-auto shrink-0 text-[10px]"
                          >
                            Dominant
                          </Badge>
                        </div>
                      );
                    })()}
                  {/* Legend table */}
                  <div className="reports-types-legend grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t">
                    {propertyTypeChartData.map((entry, i) => {
                      const pct =
                        totalListings > 0
                          ? ((entry.count / totalListings) * 100).toFixed(1)
                          : "0";
                      return (
                        <div
                          key={entry.type}
                          className="reports-types-legend-item flex items-center gap-2 text-xs"
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{
                              backgroundColor: COLORS[i % COLORS.length],
                            }}
                          />
                          <span className="text-muted-foreground truncate">
                            {entry.type}
                          </span>
                          <span className="font-medium ml-auto">
                            {entry.count} ({pct}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent
              value="price-range"
              className="space-y-4 reports-pricing-suite"
            >
              <Card className="ci-card reports-pricing-card">
                <CardHeader className="reports-pricing-card-header">
                  <CardTitle>Price Range Distribution</CardTitle>
                  <CardDescription>
                    Listings grouped by price brackets — identifies the dominant
                    market segment
                  </CardDescription>
                </CardHeader>
                <CardContent className="reports-pricing-card-content space-y-4">
                  {priceRangeChartData.length > 0 ? (
                    <ChartContainer
                      ref={priceRangeChartRef}
                      config={chartConfig}
                      className="reports-pricing-chart h-[280px] md:h-[400px]"
                      role="img"
                      aria-label="Pricing distribution chart"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={priceRangeChartData}
                          margin={{ top: 12, right: 14, left: 0, bottom: 8 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            opacity={0.3}
                            className="reports-pricing-grid"
                          />
                          <XAxis
                            dataKey="range"
                            fontSize={11}
                            tick={{
                              fill: "hsl(var(--muted-foreground))",
                              fontSize: 11,
                            }}
                            tickLine={false}
                            axisLine={{ stroke: "hsl(var(--border) / 0.55)" }}
                          />
                          <YAxis
                            tick={{
                              fill: "hsl(var(--muted-foreground))",
                              fontSize: 11,
                            }}
                            tickLine={false}
                            axisLine={{ stroke: "hsl(var(--border) / 0.55)" }}
                          />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const data = payload[0].payload;
                              const pct =
                                totalListings > 0
                                  ? (
                                      (data.count / totalListings) *
                                      100
                                    ).toFixed(1)
                                  : "0";
                              return (
                                <div className="reports-pricing-tooltip">
                                  <p className="font-semibold text-sm text-foreground">
                                    {data.range}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {data.count} listings • {pct}% of total
                                  </p>
                                </div>
                              );
                            }}
                          />
                          <Bar
                            dataKey="count"
                            fill="hsl(var(--primary))"
                            radius={[8, 8, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  ) : (
                    <div className="reports-pricing-empty-state">
                      <BarChart3 className="h-5 w-5" />
                      <span>No pricing distribution data available.</span>
                    </div>
                  )}
                  {/* Price insights row */}
                  {(() => {
                    const validPrices = allListings
                      .filter((l) => l.price && l.price > 0)
                      .map((l) => l.price!)
                      .sort((a, b) => a - b);
                    const medianPrice =
                      validPrices.length > 0
                        ? validPrices[Math.floor(validPrices.length / 2)]
                        : 0;
                    const p25 =
                      validPrices.length > 0
                        ? validPrices[Math.floor(validPrices.length * 0.25)]
                        : 0;
                    const p75 =
                      validPrices.length > 0
                        ? validPrices[Math.floor(validPrices.length * 0.75)]
                        : 0;
                    return (
                      <div className="reports-pricing-stat-grid grid grid-cols-2 md:grid-cols-5 gap-3 pt-2 border-t">
                        <div className="reports-pricing-stat text-center">
                          <p className="text-lg font-bold text-foreground">
                            ${medianPrice.toLocaleString('en-AU')}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Median Price
                          </p>
                        </div>
                        <div className="reports-pricing-stat text-center">
                          <p className="text-lg font-bold text-foreground">
                            ${avgPrice.toLocaleString('en-AU')}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Average Price
                          </p>
                        </div>
                        <div className="reports-pricing-stat text-center">
                          <p className="text-lg font-bold text-foreground">
                            ${p25.toLocaleString('en-AU')}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            25th Percentile
                          </p>
                        </div>
                        <div className="reports-pricing-stat text-center">
                          <p className="text-lg font-bold text-foreground">
                            ${p75.toLocaleString('en-AU')}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            75th Percentile
                          </p>
                        </div>
                        <div className="reports-pricing-stat text-center">
                          <p className="text-lg font-bold text-foreground">
                            {priceRangeChartData.length > 0
                              ? priceRangeChartData.reduce(
                                  (max, d) => (d.count > max.count ? d : max),
                                  priceRangeChartData[0],
                                ).range
                              : "—"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Most Common Range
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              <Card className="ci-card reports-pricing-card">
                <CardHeader className="reports-pricing-card-header">
                  <CardTitle>Bedroom Distribution</CardTitle>
                  <CardDescription>
                    Listings by number of bedrooms — reveals the dominant
                    property configuration
                  </CardDescription>
                </CardHeader>
                <CardContent className="reports-pricing-card-content space-y-4">
                  {bedroomChartData.length > 0 ? (
                    <ChartContainer
                      ref={bedroomChartRef}
                      config={chartConfig}
                      className="reports-pricing-chart h-[280px] md:h-[400px]"
                      role="img"
                      aria-label="Bedroom distribution chart"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={bedroomChartData}
                          margin={{ top: 12, right: 14, left: 0, bottom: 8 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            opacity={0.3}
                            className="reports-pricing-grid"
                          />
                          <XAxis
                            dataKey="beds"
                            tick={{
                              fill: "hsl(var(--muted-foreground))",
                              fontSize: 11,
                            }}
                            tickLine={false}
                            axisLine={{ stroke: "hsl(var(--border) / 0.55)" }}
                          />
                          <YAxis
                            tick={{
                              fill: "hsl(var(--muted-foreground))",
                              fontSize: 11,
                            }}
                            tickLine={false}
                            axisLine={{ stroke: "hsl(var(--border) / 0.55)" }}
                          />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const data = payload[0].payload;
                              const pct =
                                totalListings > 0
                                  ? (
                                      (data.count / totalListings) *
                                      100
                                    ).toFixed(1)
                                  : "0";
                              return (
                                <div className="reports-pricing-tooltip">
                                  <p className="font-semibold text-sm text-foreground">
                                    {data.beds} Bedroom
                                    {data.beds !== "1" ? "s" : ""}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {data.count} listings • {pct}% of total
                                  </p>
                                </div>
                              );
                            }}
                          />
                          <Bar
                            dataKey="count"
                            fill="hsl(var(--chart-4))"
                            radius={[8, 8, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  ) : (
                    <div className="reports-pricing-empty-state">
                      <BarChart3 className="h-5 w-5" />
                      <span>No bedroom distribution data available.</span>
                    </div>
                  )}
                  {/* Bedroom insights */}
                  <div className="reports-pricing-stat-grid grid grid-cols-3 gap-3 pt-2 border-t">
                    <div className="reports-pricing-stat text-center">
                      <p className="text-lg font-bold text-foreground">
                        {bedroomChartData.length > 0
                          ? bedroomChartData.reduce(
                              (max, d) => (d.count > max.count ? d : max),
                              bedroomChartData[0],
                            ).beds
                          : "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Most Common
                      </p>
                    </div>
                    <div className="reports-pricing-stat text-center">
                      <p className="text-lg font-bold text-foreground">
                        {bedroomChartData.length}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Configurations
                      </p>
                    </div>
                    <div className="reports-pricing-stat text-center">
                      <p className="text-lg font-bold text-foreground">
                        {allListings.filter((l) => l.beds && l.beds > 0).length}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        With Bed Data
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <QuantitativeReportHistory />
        </div>
      </div>
    </div>
  );
}

function QuantitativeReportHistory() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusedReportId = (searchParams.get("focus") || "").trim();
  // Read with the staff JWT so generated_reports can drop its anon SELECT grant
  // (RLS-W2) without breaking this history view.
  const { supabase: authedSupabase } = useAuthenticatedSupabase();
  const {
    data: reports = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["quantitative-reports"],
    queryFn: async () => {
      const { data, error } = await authedSupabase
        .from("generated_reports")
        .select("*")
        .eq("report_type", "quantitative")
        .eq("status", "completed")
        .eq("workspace_id", "default")
        .order("generated_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as GeneratedReport[];
    },
  });
  const generatorIds = reports
    .map((report) => report.generated_by)
    .filter((id): id is string => Boolean(id));
  const { labelFor: generatorLabel } = useUserNames(generatorIds);
  const generatedThisPeriod = reports.filter((report) => {
    const date = new Date(report.generated_at || report.created_at);
    return (
      date.getMonth() === new Date().getMonth() &&
      date.getFullYear() === new Date().getFullYear()
    );
  }).length;

  return (
    <section
      id="generated-quantitative-reports"
      className="space-y-5"
      aria-labelledby="generated-quantitative-reports-title"
    >
      <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/70 p-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="ci-tab-eyebrow">Report library</p>
          <h2
            id="generated-quantitative-reports-title"
            className="mt-1 text-2xl font-bold tracking-tight text-foreground"
          >
            Generated Quantitative Reports
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Review, open and export previously generated quantitative analyses.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:flex">
          <div className="rounded-xl border border-border/70 px-3 py-2">
            <span className="block text-xs text-muted-foreground">
              Total reports
            </span>
            <strong>{reports.length}</strong>
          </div>
          <div className="rounded-xl border border-border/70 px-3 py-2">
            <span className="block text-xs text-muted-foreground">
              This period
            </span>
            <strong>{generatedThisPeriod}</strong>
          </div>
        </div>
      </div>
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="font-medium">Unable to load quantitative reports.</p>
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <h3 className="font-semibold">
              No quantitative reports generated yet
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Generate your first quantitative analysis to create a report and
              supporting charts.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => (
            <QuantitativeReportCard
              key={report.id}
              report={report}
              generatorLabel={generatorLabel}
              isFocused={report.id === focusedReportId}
              onView={(id) => navigate(`/quantitative-reports/${id}`)}
              onDownloadPDF={(selected) =>
                navigate(`/quantitative-reports/${selected.id}?download=true`)
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
