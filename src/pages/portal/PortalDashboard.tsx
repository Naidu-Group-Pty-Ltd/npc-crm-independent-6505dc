import { usePortalAuth } from '@/hooks/usePortalAuth';
import { stageDisplayOf } from '@/lib/deals/dealJourney.pure';
import { usePortalDashboardData } from '@/hooks/usePortalData';
import { smartCapitalize } from '@/lib/nameUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Building2, User, Briefcase, Mail, FileText,
  DollarSign, Home, TrendingUp, Loader2, ArrowRight,
  Sparkles, ChevronRight
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { PortalPanel, PortalPanelContent, PortalPanelHeader, PortalPanelTitle, portalStatCardClassName } from '@/components/portal/PortalSurface';
import { AmlComplianceCallout } from '@/components/portal/AmlComplianceCallout';

const quickLinks = [
  { to: '/client/profile', icon: User, label: 'My Profile', desc: 'View and update your personal details' },
  { to: '/client/properties', icon: Building2, label: 'Properties', desc: 'View your property portfolio' },
  { to: '/client/employment', icon: Briefcase, label: 'Employment & Finances', desc: 'Employment and income details' },
  { to: '/client/reports', icon: FileText, label: 'Reports', desc: 'View reports shared by your advisor' },
  { to: '/client/documents', icon: FileText, label: 'Documents', desc: 'Access your uploaded documents' },
];

function formatCurrency(val?: number | null): string {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
}

function getDealStageBadge(stage?: string) {
  if (!stage) return null;
  const colors: Record<string, string> = {
    'New Lead': 'border border-border/70 bg-muted text-muted-foreground',
    'Initial Consultation': 'border border-primary/20 bg-primary/10 text-primary',
    'Pre-Approval': 'border border-warning/20 bg-warning/10 text-warning',
    'Property Search': 'border border-primary/20 bg-primary/10 text-primary',
    'Under Contract': 'border border-warning/20 bg-warning/10 text-warning',
    'Settlement': 'border border-success/20 bg-success/10 text-success',
    'Settled': 'border border-success/20 bg-success/10 text-success',
  };
  return <Badge className={colors[stage] || 'bg-muted text-muted-foreground'}>{stage}</Badge>;
}

function getInitials(name?: string): string {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export default function PortalDashboard() {
  const { user } = usePortalAuth();
  const { data, isLoading, error } = usePortalDashboardData();

  const client = data?.client;
  const properties = data?.properties || [];
  const deals = data?.deals || [];
  const borrowingCapacity = data?.borrowingCapacity;
  const displayName = client?.primary_first_name
    ? smartCapitalize(`${client.primary_first_name} ${client.primary_surname || ''}`.trim())
    : smartCapitalize(user?.name);

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="client-portal-page-header">
        <div className="relative flex items-start gap-4">
          <Avatar className="h-14 w-14 border-2 border-primary/20 shadow-lg hidden sm:flex">
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-primary/60" />
              <span className="text-xs font-medium text-primary/70 uppercase tracking-widest">Welcome back</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
              {displayName || 'Client'}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Here's an overview of your property portfolio and account.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card/70 px-6 py-7 shadow-lg shadow-primary/5">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading your dashboard...</p>
          </div>
        </div>
      ) : error ? (
            <Card className="border-destructive/20 bg-destructive/5 shadow-lg shadow-primary/5">
          <CardContent className="py-8 text-center">
            <p className="text-destructive font-medium">Unable to load your data.</p>
            <p className="text-muted-foreground text-sm mt-1">Please try refreshing the page.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Persistent entry point into the AML/CTF compliance check —
              renders only when the client has an open case. */}
          <AmlComplianceCallout />

          {/* Stats Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Properties', value: properties.length.toString(), icon: Home, gradient: 'from-primary/10 to-primary/5', iconColor: 'text-primary' },
              { label: 'Portfolio Value', value: formatCurrency(client?.total_portfolio_value), icon: DollarSign, gradient: 'from-success/10 to-success/5', iconColor: 'text-success dark:text-success' },
              { label: 'Rental Income', value: formatCurrency(client?.total_monthly_rental_income), suffix: '/mo', icon: TrendingUp, gradient: 'from-info/10 to-info/5', iconColor: 'text-info dark:text-info' },
              { label: 'Net Cash Flow', value: formatCurrency(client?.net_monthly_cash_flow), suffix: '/mo', icon: Briefcase, gradient: 'from-accent/10 to-accent/5', iconColor: 'text-accent dark:text-accent' },
            ].map((stat) => (
              <Card key={stat.label} className={portalStatCardClassName()}>
                <CardContent className="pt-6 relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent opacity-80" />
                  <div className="relative flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-background/80 shadow-sm">
                      <stat.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{stat.label}</p>
                      <p className="text-xl font-bold text-foreground mt-0.5">
                        {stat.value}
                        {stat.suffix && <span className="text-xs text-muted-foreground font-normal">{stat.suffix}</span>}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Active Deals */}
          {deals.length > 0 && (
            <PortalPanel>
              <PortalPanelHeader className="pb-3">
                <PortalPanelTitle className="text-lg">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  Active Deals
                </PortalPanelTitle>
              </PortalPanelHeader>
              <PortalPanelContent>
                <div className="space-y-2">
                  {deals.slice(0, 5).map((deal: any) => (
                    <div key={deal.id} className="flex items-center justify-between rounded-xl border border-border/50 bg-background/50 px-4 py-3 transition-colors hover:border-primary/20 hover:bg-accent/20">
                      <div className="space-y-1">
                        <p className="font-medium text-sm text-foreground">{deal.property_address || 'New Deal'}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="capitalize">{deal.deal_type?.replace(/_/g, ' ') || 'Purchase'}</span>
                          {deal.loan_amount && (
                            <>
                              <span className="text-border">•</span>
                              <span className="font-medium">{formatCurrency(deal.loan_amount)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {getDealStageBadge(stageDisplayOf(deal))}
                    </div>
                  ))}
                </div>
              </PortalPanelContent>
            </PortalPanel>
          )}

          {/* Properties Preview */}
          {properties.length > 0 && (
            <PortalPanel>
              <PortalPanelHeader className="flex flex-row items-center justify-between pb-3">
                <PortalPanelTitle className="text-lg">Your Properties</PortalPanelTitle>
                <Link to="/client/properties" className="text-sm text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors">
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </PortalPanelHeader>
              <PortalPanelContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {properties.slice(0, 4).map((prop: any) => (
                    <div key={prop.id} className="group rounded-2xl border border-border/60 bg-background/50 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg hover:shadow-primary/5">
                      <div className="flex items-start gap-3">
                        <div className="p-2.5 rounded-xl bg-primary/10 shrink-0 group-hover:bg-primary/15 transition-colors">
                          <Building2 className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm text-foreground truncate">{prop.address}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <span className="capitalize">{prop.property_type?.replace(/_/g, ' ')}</span>
                            {prop.value && <span>• {formatCurrency(prop.value)}</span>}
                          </div>
                          {prop.monthly_rental_income && (
                            <p className="mt-1.5 text-xs font-medium text-primary">
                              {formatCurrency(prop.monthly_rental_income)}/mo rental
                            </p>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-primary transition-colors shrink-0 mt-1" />
                      </div>
                    </div>
                  ))}
                </div>
              </PortalPanelContent>
            </PortalPanel>
          )}

          <Separator />

          {/* Quick Links */}
          <div>
            <h2 className="client-portal-section-title mb-4">Quick Access</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {quickLinks.map((link) => (
                <Link key={link.to} to={link.to}>
                  <Card className="client-portal-stat-card h-full cursor-pointer overflow-hidden border group">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <CardHeader className="pb-2 relative">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-primary/10 group-hover:bg-primary/15 transition-colors">
                            <link.icon className="h-5 w-5 text-primary" />
                          </div>
                          <CardTitle className="text-base font-semibold">{link.label}</CardTitle>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-1 transition-all" />
                      </div>
                    </CardHeader>
                    <CardContent className="relative">
                      <p className="text-sm text-muted-foreground">{link.desc}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}