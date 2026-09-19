import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { PropertyListing } from '@/lib/airtable';
import { format, subDays, eachDayOfInterval } from 'date-fns';

interface TemporalAnalysisProps {
  listings: PropertyListing[];
}

export function TemporalAnalysis({ listings }: TemporalAnalysisProps) {
  const temporalData = useMemo(() => {
    const endDate = new Date();
    const startDate = subDays(endDate, 30);
    
    console.log('TemporalAnalysis: Total listings:', listings.length);
    console.log('TemporalAnalysis: Sample listing:', listings[0]);
    console.log('TemporalAnalysis: Listings with receivedAt:', listings.filter(l => l.receivedAt).length);
    
    const dailyData = eachDayOfInterval({ start: startDate, end: endDate }).map(date => {
      const dayListings = listings.filter(listing => {
        // Try multiple date fields as fallback
        const dateToCheck = listing.receivedAt || listing.createdTime || listing.listingDate;
        if (!dateToCheck) return false;
        
        const listingDate = new Date(dateToCheck);
        return format(listingDate, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
      });

      const avgPrice = dayListings.length > 0 && dayListings.some(l => l.price)
        ? dayListings.filter(l => l.price).reduce((sum, l) => sum + (l.price || 0), 0) / dayListings.filter(l => l.price).length
        : null;

      return {
        date: format(date, 'MMM dd'),
        listings: dayListings.length,
        avgPrice: avgPrice ? Math.round(avgPrice) : null,
        confidenceScore: dayListings.length > 0 
          ? Math.round(dayListings.reduce((sum, l) => sum + (l.confidence || 0), 0) / dayListings.length * 100)
          : null,
      };
    });

    return dailyData;
  }, [listings]);

  const chartConfig = {
    listings: {
      label: "Listings",
      color: "hsl(var(--primary))",
    },
    avgPrice: {
      label: "Avg Price",
      color: "hsl(var(--chart-3))",
    },
    confidenceScore: {
      label: "Confidence",
      color: "hsl(var(--warning))",
    },
  };

  const pricingTrendData = temporalData.filter(d => d.avgPrice !== null);
  const confidenceTrendData = temporalData.filter(d => d.confidenceScore !== null);
  const chartMargin = { top: 12, right: 16, left: 4, bottom: 8 };

  const EmptyTrendState = ({ message }: { message: string }) => (
    <div className="reports-trend-empty-state">
      {message}
    </div>
  );

  return (
    <div className="space-y-4 reports-trends-suite">
      <Card className="reports-trend-card reports-trend-card-primary">
        <CardHeader className="reports-trend-card-header">
          <CardTitle>Daily Listing Activity (Last 30 Days)</CardTitle>
          <CardDescription>Trend analysis of listing volume over time</CardDescription>
        </CardHeader>
        <CardContent className="reports-trend-card-content">
          <ChartContainer config={chartConfig} className="reports-trends-chart h-[300px] md:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={temporalData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" className="reports-trends-grid" />
                <XAxis 
                  dataKey="date" 
                  fontSize={12}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(var(--border) / 0.55)' }}
                />
                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent className="reports-trend-tooltip" />} />
                <Line
                  type="monotone"
                  dataKey="listings"
                  stroke="hsl(var(--primary))"
                  strokeWidth={3}
                  dot={{ r: 3.5, strokeWidth: 2, fill: 'hsl(var(--background))', stroke: 'hsl(var(--primary))' }}
                  activeDot={{ r: 6, strokeWidth: 2, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--background))' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="reports-trend-card">
          <CardHeader className="reports-trend-card-header">
            <CardTitle>Average Daily Pricing Trends</CardTitle>
            <CardDescription>Price movements over the last 30 days</CardDescription>
          </CardHeader>
          <CardContent className="reports-trend-card-content">
            {pricingTrendData.length > 0 ? (
              <ChartContainer config={chartConfig} className="reports-trends-chart h-[250px] md:h-[270px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pricingTrendData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" className="reports-trends-grid" />
                  <XAxis 
                    dataKey="date" 
                    fontSize={12}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border) / 0.55)' }}
                  />
                  <YAxis
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickFormatter={(value) => `$${Math.round(value / 1000)}k`}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent
                      className="reports-trend-tooltip"
                      formatter={(value: any) => [`$${parseInt(value).toLocaleString('en-AU')}`, 'Avg Price']}
                    />}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgPrice"
                    stroke="hsl(var(--chart-3))"
                    strokeWidth={2.5}
                    dot={{ r: 3, strokeWidth: 2, fill: 'hsl(var(--background))', stroke: 'hsl(var(--chart-3))' }}
                    activeDot={{ r: 5, strokeWidth: 2, fill: 'hsl(var(--chart-3))', stroke: 'hsl(var(--background))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
              </ChartContainer>
            ) : (
              <EmptyTrendState message="No pricing trend data available for the selected 30 day window." />
            )}
          </CardContent>
        </Card>

        <Card className="reports-trend-card">
          <CardHeader className="reports-trend-card-header">
            <CardTitle>Daily Data Confidence</CardTitle>
            <CardDescription>Quality score trends over time</CardDescription>
          </CardHeader>
          <CardContent className="reports-trend-card-content">
            {confidenceTrendData.length > 0 ? (
              <ChartContainer config={chartConfig} className="reports-trends-chart h-[250px] md:h-[270px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={confidenceTrendData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" className="reports-trends-grid" />
                  <XAxis 
                    dataKey="date" 
                    fontSize={12}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border) / 0.55)' }}
                  />
                  <YAxis domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                  <ChartTooltip
                    content={<ChartTooltipContent
                      className="reports-trend-tooltip"
                      formatter={(value: any) => [`${value}%`, 'Confidence']}
                    />}
                  />
                  <Line
                    type="monotone"
                    dataKey="confidenceScore"
                    stroke="hsl(var(--warning))"
                    strokeWidth={2.5}
                    dot={{ r: 3, strokeWidth: 2, fill: 'hsl(var(--background))', stroke: 'hsl(var(--warning))' }}
                    activeDot={{ r: 5, strokeWidth: 2, fill: 'hsl(var(--warning))', stroke: 'hsl(var(--background))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
              </ChartContainer>
            ) : (
              <EmptyTrendState message="No confidence trend data available for the selected 30 day window." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}