import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { PropertyListing } from '@/lib/airtable';
import { Badge } from '@/components/ui/badge';

interface GeographicAnalysisProps {
  listings: PropertyListing[];
}

export function GeographicAnalysis({ listings }: GeographicAnalysisProps) {
  const geoData = useMemo(() => {
    const suburbStats = listings.reduce((acc, listing) => {
      const suburb = listing.suburb || 'Unknown';
      if (!acc[suburb]) {
        acc[suburb] = {
          count: 0,
          prices: [],
          totalPrice: 0,
          confidenceScores: [],
        };
      }
      
      acc[suburb].count++;
      if (listing.price && listing.price > 0) {
        acc[suburb].prices.push(listing.price);
        acc[suburb].totalPrice += listing.price;
      }
      if (listing.confidence) {
        acc[suburb].confidenceScores.push(listing.confidence);
      }
      
      return acc;
    }, {} as Record<string, { count: number; prices: number[]; totalPrice: number; confidenceScores: number[] }>);

    // Extract state/postcode from listings for each suburb
    const suburbLocationMap = new Map<string, { states: Set<string>; postcodes: Set<string> }>();
    listings.forEach(listing => {
      const suburb = listing.suburb || 'Unknown';
      if (!suburbLocationMap.has(suburb)) {
        suburbLocationMap.set(suburb, { states: new Set(), postcodes: new Set() });
      }
      const loc = suburbLocationMap.get(suburb)!;
      if (listing.state) loc.states.add(listing.state);
      if (listing.zipCode) loc.postcodes.add(listing.zipCode);
    });

    const suburbAnalysis = Object.entries(suburbStats).map(([suburb, stats]) => {
      const avgPrice = stats.prices.length > 0 ? stats.totalPrice / stats.prices.length : 0;
      const avgConfidence = stats.confidenceScores.length > 0 
        ? stats.confidenceScores.reduce((sum, c) => sum + c, 0) / stats.confidenceScores.length * 100 
        : 0;
      
      const priceVsVolume = avgPrice > 0 && stats.count > 0 ? avgPrice / stats.count : 0;
      const locationInfo = suburbLocationMap.get(suburb);
      
      return {
        suburb,
        count: stats.count,
        avgPrice: Math.round(avgPrice),
        avgConfidence: Math.round(avgConfidence),
        priceVsVolume: Math.round(priceVsVolume),
        marketActivity: stats.count > 5 ? 'High' : stats.count > 2 ? 'Medium' : 'Low',
        state: locationInfo ? Array.from(locationInfo.states).join(', ') : '',
        postcode: locationInfo ? Array.from(locationInfo.postcodes).join(', ') : '',
      };
    }).sort((a, b) => b.count - a.count);

    return {
      topSuburbs: suburbAnalysis.slice(0, 12),
      priceVsVolume: suburbAnalysis
        .filter(s => s.avgPrice > 0 && s.count > 0)
        .slice(0, 20)
        .map(s => ({
          x: s.count,
          y: s.avgPrice,
          suburb: s.suburb,
          confidence: s.avgConfidence
        })),
    };
  }, [listings]);

  const chartConfig = {
    count: { label: "Listings", color: "hsl(var(--chart-1))" },
    avgPrice: { label: "Avg Price", color: "hsl(var(--chart-3))" },
    avgConfidence: { label: "Confidence", color: "hsl(var(--chart-4))" },
  };

  const topSuburbRows = geoData.topSuburbs.slice(0, 8);

  return (
    <div className="space-y-6 reports-geographic-suite">
      <Card className="reports-geographic-card reports-location-matrix-card">
        <CardHeader className="reports-geographic-card-header">
          <CardTitle>Suburb Performance Matrix</CardTitle>
          <CardDescription>Top suburbs by listing volume with price and quality metrics</CardDescription>
        </CardHeader>
        <CardContent className="reports-geographic-card-content">
          <div className="space-y-4">
            <div className="grid gap-3">
              {topSuburbRows.length > 0 ? topSuburbRows.map((suburb) => (
                <div key={suburb.suburb} className="reports-location-row">
                  <div className="min-w-0 flex-1">
                    <div className="reports-location-label">{suburb.suburb}</div>
                    <div className="reports-location-meta">
                      {suburb.count} listings • ${suburb.avgPrice.toLocaleString('en-AU')} avg
                      {suburb.state && ` • ${suburb.state}`}
                      {suburb.postcode && ` ${suburb.postcode}`}
                    </div>
                  </div>
                  <div className="reports-location-badges">
                    <Badge variant={
                      suburb.marketActivity === 'High' ? 'default' :
                      suburb.marketActivity === 'Medium' ? 'secondary' : 'outline'
                    } className={`reports-location-badge reports-activity-${suburb.marketActivity.toLowerCase()}`}>
                      {suburb.marketActivity}
                    </Badge>
                    <Badge
                      variant={suburb.avgConfidence > 70 ? 'default' : suburb.avgConfidence > 50 ? 'secondary' : 'destructive'}
                      className="reports-location-badge"
                    >
                      {suburb.avgConfidence}% conf.
                    </Badge>
                  </div>
                </div>
              )) : (
                <div className="reports-geographic-empty-state">No geographic location data available.</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="reports-geographic-card">
          <CardHeader className="reports-geographic-card-header">
            <CardTitle>Suburb Volume Distribution</CardTitle>
            <CardDescription>Listing count by location</CardDescription>
          </CardHeader>
          <CardContent className="reports-geographic-card-content">
            {topSuburbRows.length > 0 ? (
              <ChartContainer config={chartConfig} className="reports-geographic-chart h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topSuburbRows} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="reports-geographic-grid" />
                  <XAxis 
                    dataKey="suburb" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    fontSize={12}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border) / 0.55)' }}
                  />
                  <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent className="reports-geographic-tooltip" />} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </ChartContainer>
            ) : (
              <div className="reports-geographic-empty-state">No suburb volume data available.</div>
            )}
          </CardContent>
        </Card>

        <Card className="reports-geographic-card">
          <CardHeader className="reports-geographic-card-header">
            <CardTitle>Price vs Volume Analysis</CardTitle>
            <CardDescription>Relationship between average price and listing volume</CardDescription>
          </CardHeader>
          <CardContent className="reports-geographic-card-content">
            {geoData.priceVsVolume.length > 0 ? (
              <ChartContainer config={chartConfig} className="reports-geographic-chart h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart data={geoData.priceVsVolume} margin={{ top: 12, right: 18, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="reports-geographic-grid" />
                  <XAxis 
                    dataKey="x" 
                    name="Listings"
                    type="number"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border) / 0.55)' }}
                  />
                  <YAxis 
                    dataKey="y" 
                    name="Avg Price"
                    type="number"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border) / 0.55)' }}
                    tickFormatter={(value) => `$${Math.round(value / 1000)}k`}
                  />
                  <ChartTooltip 
                    content={<ChartTooltipContent
                      className="reports-geographic-tooltip"
                      formatter={(value: any, name: string, props: any) => {
                        if (name === 'y') return [`$${parseInt(value).toLocaleString('en-AU')}`, 'Avg Price'];
                        if (name === 'x') return [value, 'Listings'];
                        return [value, name];
                      }}
                      labelFormatter={(label: any, payload: any) => {
                        if (payload && payload[0] && payload[0].payload) {
                          return payload[0].payload.suburb;
                        }
                        return label;
                      }}
                    />}
                  />
                  <Scatter
                    fill="hsl(var(--chart-3))"
                    stroke="hsl(var(--background))"
                    strokeWidth={1.5}
                  />
                </ScatterChart>
              </ResponsiveContainer>
              </ChartContainer>
            ) : (
              <div className="reports-geographic-empty-state">No price versus volume data available.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}