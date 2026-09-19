import { useEffect, useState, useMemo } from 'react';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { Mail, Building2, User, Phone, ArrowUpRight, Loader2, RefreshCw, BarChart3, TrendingUp, Hash } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import { PropertyListing } from '@/lib/airtable';
import { propertyDataService } from '@/services/propertyDataService';
import { toast } from 'sonner';

interface EmailSource {
  host: string;
  from: string;
  count: number;
  latestReceived: Date;
  subjects: string[];
  percentage: number;
}

interface AgencySource {
  name: string;
  count: number;
  agents: string[];
  latestListing: Date;
  percentage: number;
}

interface AgentSource {
  name: string;
  phone?: string;
  agency?: string;
  count: number;
  latestListing: Date;
  percentage: number;
}

export default function Sources() {
  const { canEdit: canEditSources } = useModulePermissions('sources');
  const [listings, setListings] = useState<PropertyListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const formatDate = (dateValue: any): string => {
    try {
      if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
        return dateValue.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
      }
      if (typeof dateValue === 'string') {
        const date = new Date(dateValue);
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
        }
      }
      return 'Unknown date';
    } catch {
      return 'Unknown date';
    }
  };

  const ensureDate = (dateValue: any): Date => {
    if (dateValue instanceof Date) return dateValue;
    if (typeof dateValue === 'string') return new Date(dateValue);
    return new Date();
  };

  const extractDomain = (email: string): string => {
    if (!email || typeof email !== 'string') return '';
    const match = email.match(/@(.+)/);
    return match ? match[1] : email;
  };

  const loadSources = async (bypass = false) => {
    try {
      if (bypass) setRefreshing(true); else setLoading(true);

      const result = await propertyDataService.fetchAllListings({
        bypassCache: bypass,
        includeDebugInfo: true,
      });

      setListings(result.listings);

      if (bypass) {
        toast.success(`Sources refreshed — ${result.listings.length} listings loaded`);
      }
    } catch (error) {
      console.error('Failed to load sources:', error);
      toast.error('Failed to load sources data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSources();
  }, []);

  // Derived data
  const { emailSources, agencySources, agentSources } = useMemo(() => {
    const emailMap = new Map<string, Omit<EmailSource, 'percentage'>>();
    const agencyMap = new Map<string, Omit<AgencySource, 'percentage'>>();
    const agentMap = new Map<string, Omit<AgentSource, 'percentage'>>();

    listings.forEach(listing => {
      // Email sources
      if (listing.source) {
        const sourceEmail = listing.source;
        const sourceDomain = extractDomain(sourceEmail);
        const key = `${sourceDomain}-${sourceEmail}`;
        const existing = emailMap.get(key);
        const receivedDate = ensureDate(listing.receivedAt || listing.createdAt || listing.createdTime);

        if (existing) {
          existing.count++;
          if (receivedDate > existing.latestReceived) existing.latestReceived = receivedDate;
        } else {
          emailMap.set(key, {
            host: sourceDomain,
            from: sourceEmail,
            count: 1,
            latestReceived: receivedDate,
            subjects: [],
          });
        }
      }

      // Agency sources
      if (listing.agencyName) {
        const existing = agencyMap.get(listing.agencyName);
        const createdDate = ensureDate(listing.createdTime);

        if (existing) {
          existing.count++;
          if (listing.agent && !existing.agents.includes(listing.agent)) existing.agents.push(listing.agent);
          if (createdDate > existing.latestListing) existing.latestListing = createdDate;
        } else {
          agencyMap.set(listing.agencyName, {
            name: listing.agencyName,
            count: 1,
            agents: listing.agent ? [listing.agent] : [],
            latestListing: createdDate,
          });
        }
      }

      // Agent sources
      const agentName = listing.agent;
      const agentPhone = (listing as any).fields?.['Agent Phone'] || listing.agentPhone;

      if (agentName) {
        const existing = agentMap.get(agentName);
        const createdDate = ensureDate(listing.createdTime);

        if (existing) {
          existing.count++;
          if (agentPhone && !existing.phone) existing.phone = agentPhone;
          if (createdDate > existing.latestListing) existing.latestListing = createdDate;
        } else {
          agentMap.set(agentName, {
            name: agentName,
            phone: agentPhone,
            agency: listing.agencyName,
            count: 1,
            latestListing: createdDate,
          });
        }
      }
    });

    const total = listings.length || 1;

    const emails = Array.from(emailMap.values())
      .map(s => ({ ...s, percentage: Math.round((s.count / total) * 100) }))
      .sort((a, b) => b.count - a.count);

    const agencies = Array.from(agencyMap.values())
      .map(s => ({ ...s, percentage: Math.round((s.count / total) * 100) }))
      .sort((a, b) => b.count - a.count);

    const agents = Array.from(agentMap.values())
      .map(s => ({ ...s, percentage: Math.round((s.count / total) * 100) }))
      .sort((a, b) => b.count - a.count);

    return { emailSources: emails, agencySources: agencies, agentSources: agents };
  }, [listings]);

  // Filter by search
  const filteredEmails = useMemo(() => {
    if (!searchQuery) return emailSources;
    const q = searchQuery.toLowerCase();
    return emailSources.filter(s => s.from.toLowerCase().includes(q) || s.host.toLowerCase().includes(q));
  }, [emailSources, searchQuery]);

  const filteredAgencies = useMemo(() => {
    if (!searchQuery) return agencySources;
    const q = searchQuery.toLowerCase();
    return agencySources.filter(s => s.name.toLowerCase().includes(q));
  }, [agencySources, searchQuery]);

  const filteredAgents = useMemo(() => {
    if (!searchQuery) return agentSources;
    const q = searchQuery.toLowerCase();
    return agentSources.filter(s => s.name.toLowerCase().includes(q) || (s.agency || '').toLowerCase().includes(q));
  }, [agentSources, searchQuery]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sources</h1>
          <p className="text-muted-foreground">
            Source attribution across {listings.length.toLocaleString('en-AU')} listings
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadSources(true)}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">Total Listings</span>
            </div>
            <p className="text-2xl font-bold">{listings.length.toLocaleString('en-AU')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">Email Sources</span>
            </div>
            <p className="text-2xl font-bold">{emailSources.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">Agencies</span>
            </div>
            <p className="text-2xl font-bold">{agencySources.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">Agents</span>
            </div>
            <p className="text-2xl font-bold">{agentSources.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Sources Bar */}
      {agencySources.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Top Contributing Agencies
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {agencySources.slice(0, 5).map((agency, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate flex-1 mr-2">{agency.name}</span>
                  <span className="text-muted-foreground shrink-0">{agency.count} ({agency.percentage}%)</span>
                </div>
                <Progress value={agency.percentage} className="h-1.5" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <SearchInput
        value={searchQuery}
        onValueChange={setSearchQuery}
        placeholder="Search sources, agencies, or agents..."
      />

      {/* Tabs */}
      <Tabs defaultValue="email" className="space-y-4">
        <div className="overflow-x-auto -mx-1 px-1 scrollbar-hide">
          <TabsList className="inline-flex w-auto min-w-max">
            <TabsTrigger value="email" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <Mail className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Email Sources ({filteredEmails.length})
            </TabsTrigger>
            <TabsTrigger value="agencies" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <Building2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Agencies ({filteredAgencies.length})
            </TabsTrigger>
            <TabsTrigger value="agents" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
              <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Agents ({filteredAgents.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="email" className="space-y-3">
          {filteredEmails.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Mail className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{searchQuery ? 'No matching email sources' : 'No email sources found'}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {filteredEmails.map((source, index) => (
                <Card key={index}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm truncate">{source.host}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate ml-6">{source.from}</p>
                        <p className="text-xs text-muted-foreground mt-1 ml-6">
                          Latest: {formatDate(source.latestReceived)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="secondary">{source.count} listings</Badge>
                        <p className="text-xs text-muted-foreground mt-1">{source.percentage}% of total</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="agencies" className="space-y-3">
          {filteredAgencies.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{searchQuery ? 'No matching agencies' : 'No agencies found'}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {filteredAgencies.map((agency, index) => (
                <Card key={index}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm">{agency.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 ml-6">
                          Latest listing: {formatDate(agency.latestListing)}
                        </p>
                        {agency.agents.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2 ml-6">
                            {agency.agents.slice(0, 4).map((agent, idx) => (
                              <Badge key={idx} variant="outline" className="text-[10px]">{agent}</Badge>
                            ))}
                            {agency.agents.length > 4 && (
                              <Badge variant="outline" className="text-[10px]">+{agency.agents.length - 4} more</Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="secondary">{agency.count} listings</Badge>
                        <p className="text-xs text-muted-foreground mt-1">{agency.percentage}% of total</p>
                        <p className="text-[10px] text-muted-foreground">{agency.agents.length} agent{agency.agents.length !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="agents" className="space-y-3">
          {filteredAgents.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <User className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{searchQuery ? 'No matching agents' : 'No agents found'}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {filteredAgents.map((agent, index) => (
                <Card key={index}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <User className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm">{agent.name}</span>
                        </div>
                        {agent.agency && (
                          <div className="flex items-center gap-1.5 ml-6 mt-0.5">
                            <Building2 className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">{agent.agency}</span>
                          </div>
                        )}
                        {agent.phone && (
                          <div className="flex items-center gap-1.5 ml-6 mt-0.5">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs font-mono">{agent.phone}</span>
                            <a href={`tel:${agent.phone}`} className="text-primary hover:text-primary/80">
                              <ArrowUpRight className="h-3 w-3" />
                            </a>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-1 ml-6">
                          Latest: {formatDate(agent.latestListing)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="secondary">{agent.count} listings</Badge>
                        <p className="text-xs text-muted-foreground mt-1">{agent.percentage}% of total</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
