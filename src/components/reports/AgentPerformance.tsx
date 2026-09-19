import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { PropertyListing } from '@/lib/airtable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface AgentPerformanceProps {
  listings: PropertyListing[];
}

export function AgentPerformance({ listings }: AgentPerformanceProps) {
  const agentData = useMemo(() => {
    const agentStats = listings.reduce((acc, listing) => {
      // Enhanced agent/agency name extraction with better fallbacks
      const agentName = listing.agentName || listing.agent || 'Unknown Agent';
      const agencyName = listing.agencyName || 'Unknown Agency';
      
      if (!acc[agentName]) {
        acc[agentName] = {
          count: 0,
          totalValue: 0,
          listings: [],
          agency: agencyName,
          priceRange: { min: Infinity, max: 0 },
        };
      }
      
      acc[agentName].count++;
      acc[agentName].listings.push(listing);
      
      if (listing.price && listing.price > 0) {
        acc[agentName].totalValue += listing.price;
        acc[agentName].priceRange.min = Math.min(acc[agentName].priceRange.min, listing.price);
        acc[agentName].priceRange.max = Math.max(acc[agentName].priceRange.max, listing.price);
      }
      
      return acc;
    }, {} as Record<string, { 
      count: number; 
      totalValue: number; 
      listings: PropertyListing[]; 
      agency: string;
      priceRange: { min: number; max: number };
    }>);

    const agentAnalysis = Object.entries(agentStats)
      .map(([agentName, stats]) => {
        const avgPrice = stats.count > 0 && stats.totalValue > 0 ? stats.totalValue / stats.count : 0;
        const efficiency = stats.count > 0 ? stats.totalValue / stats.count : 0;
        
        return {
          agentName,
          agency: stats.agency,
          count: stats.count,
          totalValue: stats.totalValue,
          avgPrice: Math.round(avgPrice),
          efficiency: Math.round(efficiency),
          priceRange: stats.priceRange.min !== Infinity 
            ? `$${Math.round(stats.priceRange.min / 1000)}k - $${Math.round(stats.priceRange.max / 1000)}k`
            : 'N/A',
          performance: stats.count > 10 ? 'High' : stats.count > 5 ? 'Medium' : 'Standard',
        };
      })
      .filter(agent => agent.agentName !== 'Unknown Agent' && agent.count > 1)
      .sort((a, b) => b.count - a.count);

    const agencyStats = listings.reduce((acc, listing) => {
      const agencyName = listing.agencyName || 'Unknown Agency';
      
      if (!acc[agencyName]) {
        acc[agencyName] = { count: 0, agents: new Set() };
      }
      
      acc[agencyName].count++;
      if (listing.agentName) {
        acc[agencyName].agents.add(listing.agentName);
      }
      
      return acc;
    }, {} as Record<string, { count: number; agents: Set<string> }>);

    const agencyAnalysis = Object.entries(agencyStats)
      .map(([agencyName, stats]) => ({
        agencyName,
        count: stats.count,
        agentCount: stats.agents.size,
        avgPerAgent: stats.agents.size > 0 ? Math.round(stats.count / stats.agents.size) : 0,
      }))
      .filter(agency => agency.agencyName !== 'Unknown Agency' && agency.count > 2)
      .sort((a, b) => b.count - a.count);

    return {
      allAgents: agentAnalysis,
      allAgencies: agencyAnalysis,
    };
  }, [listings]);

  const chartConfig = {
    count: { label: "Listings", color: "hsl(var(--chart-1))" },
    avgPrice: { label: "Avg Price", color: "hsl(var(--chart-3))" },
    agentCount: { label: "Agents", color: "hsl(var(--chart-5))" },
  };

  const [showAllAgents, setShowAllAgents] = useState(false);
  const [showAllAgencies, setShowAllAgencies] = useState(false);
  
  const displayedAgents = showAllAgents ? agentData.allAgents : agentData.allAgents.slice(0, 10);
  const displayedAgencies = showAllAgencies ? agentData.allAgencies : agentData.allAgencies.slice(0, 10);
  const topAgentChartData = agentData.allAgents.slice(0, 8);
  const topAgencyChartData = agentData.allAgencies.slice(0, 6);

  return (
    <div className="space-y-6 reports-agent-suite">
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="reports-agent-card reports-agent-ranking-card">
          <CardHeader className="reports-agent-card-header">
            <CardTitle>Performing Agents</CardTitle>
            <CardDescription>{agentData.allAgents.length} agents by listing volume and performance</CardDescription>
          </CardHeader>
          <CardContent className="reports-agent-card-content">
            <div className="reports-agent-list space-y-3 max-h-[500px] overflow-y-auto">
              {displayedAgents.length > 0 ? displayedAgents.map((agent, index) => (
                <div key={agent.agentName} className="reports-agent-row">
                  <div className="reports-agent-rank">#{index + 1}</div>
                  <div className="flex items-center gap-3 flex-1">
                    <Avatar className="h-9 w-9 border border-primary/25 shadow-sm">
                      <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                        {agent.agentName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="reports-agent-name">{agent.agentName}</div>
                      <div className="reports-agent-agency">{agent.agency}</div>
                    </div>
                  </div>
                  <div className="reports-agent-metric">
                    <div className="reports-agent-count">{agent.count} listings</div>
                    <div className="reports-agent-submetric">${agent.avgPrice.toLocaleString('en-AU')} avg</div>
                  </div>
                  <Badge variant={
                    agent.performance === 'High' ? 'default' :
                    agent.performance === 'Medium' ? 'secondary' : 'outline'
                  } className={`reports-agent-badge reports-performance-${agent.performance.toLowerCase()}`}>
                    {agent.performance}
                  </Badge>
                </div>
              )) : (
                <div className="reports-agent-empty-state">No agent performance data available.</div>
              )}
            </div>
            {agentData.allAgents.length > 10 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="reports-agent-toggle w-full mt-3 text-xs"
                onClick={() => setShowAllAgents(!showAllAgents)}
              >
                {showAllAgents ? 'Show Less' : `Show All ${agentData.allAgents.length} Agents`}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="reports-agent-card reports-agent-ranking-card">
          <CardHeader className="reports-agent-card-header">
            <CardTitle>Agency Performance</CardTitle>
            <CardDescription>{agentData.allAgencies.length} agencies by total listings and agent count</CardDescription>
          </CardHeader>
          <CardContent className="reports-agent-card-content">
            <div className="reports-agent-list space-y-3 max-h-[500px] overflow-y-auto">
              {displayedAgencies.length > 0 ? displayedAgencies.map((agency, index) => (
                <div key={agency.agencyName} className="reports-agency-row">
                  <div className="reports-agent-rank">#{index + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="reports-agent-name">{agency.agencyName}</div>
                    <div className="reports-agent-agency">
                      {agency.agentCount} agents • {agency.avgPerAgent} avg listings/agent
                    </div>
                  </div>
                  <div className="reports-agent-metric">
                    <div className="reports-agent-count">{agency.count}</div>
                    <div className="reports-agent-submetric">listings</div>
                  </div>
                </div>
              )) : (
                <div className="reports-agent-empty-state">No agency performance data available.</div>
              )}
            </div>
            {agentData.allAgencies.length > 10 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="reports-agent-toggle w-full mt-3 text-xs"
                onClick={() => setShowAllAgencies(!showAllAgencies)}
              >
                {showAllAgencies ? 'Show Less' : `Show All ${agentData.allAgencies.length} Agencies`}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="reports-agent-card reports-agent-ranking-card">
          <CardHeader className="reports-agent-card-header">
            <CardTitle>Agent Listing Volume</CardTitle>
            <CardDescription>Top agents by number of listings</CardDescription>
          </CardHeader>
          <CardContent className="reports-agent-card-content">
            {topAgentChartData.length > 0 ? (
              <ChartContainer config={chartConfig} className="reports-agent-chart h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topAgentChartData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="reports-agent-grid" />
                  <XAxis 
                    dataKey="agentName" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    fontSize={10}
                    interval={0}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border) / 0.55)' }}
                  />
                  <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent className="reports-agent-tooltip" />} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </ChartContainer>
            ) : (
              <div className="reports-agent-empty-state">No agent listing volume data available.</div>
            )}
          </CardContent>
        </Card>

        <Card className="reports-agent-card reports-agent-ranking-card">
          <CardHeader className="reports-agent-card-header">
            <CardTitle>Agency Size Distribution</CardTitle>
            <CardDescription>Agencies by number of active agents</CardDescription>
          </CardHeader>
          <CardContent className="reports-agent-card-content">
            {topAgencyChartData.length > 0 ? (
              <ChartContainer config={chartConfig} className="reports-agent-chart h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topAgencyChartData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="reports-agent-grid" />
                  <XAxis 
                    dataKey="agencyName" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    fontSize={10}
                    interval={0}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border) / 0.55)' }}
                  />
                  <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent className="reports-agent-tooltip" />} />
                  <Bar dataKey="agentCount" fill="hsl(var(--chart-5))" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </ChartContainer>
            ) : (
              <div className="reports-agent-empty-state">No agency size distribution data available.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}