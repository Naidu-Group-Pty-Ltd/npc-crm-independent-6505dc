import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Users, ArrowRight, ShieldCheck, MessageSquare, FileText, AlertTriangle,
  Clock, FileWarning, Gavel, CalendarClock, Inbox, FolderOpen, Briefcase,
  TrendingUp, Wallet,
} from 'lucide-react';
import { TodayPanel } from '@/components/finance-portal/TodayPanel';
import { DocumentExpiryWatchlist } from '@/components/finance-portal/DocumentExpiryWatchlist';
import { EngagementHeader } from '@/components/finance-portal/EngagementHeader';
import AgreementTemplateResources from '@/components/agreement-templates/AgreementTemplateResources';
import { downloadAgreementTemplateDocx } from '@/lib/agreements/templateDownloads';
import { GoalsProgressCard } from '@/components/finance-portal/GoalsProgressCard';
import { AiRiskSnifferWidget } from '@/components/finance-portal/AiRiskSnifferWidget';
import { AiCoachWidget } from '@/components/finance-portal/AiCoachWidget';

import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useBrand } from '@/branding/useBrand';
import { smartCapitalize } from '@/lib/nameUtils';

function KpiCard({
  label, value, icon: Icon, accent = false, index = 0, tone,
}: {
  label: string; value: string | number; icon: React.ElementType;
  accent?: boolean; index?: number;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const toneClasses = {
    default: 'border-border bg-card',
    warning: 'border-brand-500/30 bg-gradient-to-br from-brand-500/5 via-card to-card',
    danger: 'border-destructive/30 bg-gradient-to-br from-destructive/5 via-card to-card',
    success: 'border-success/30 bg-gradient-to-br from-success/5 via-card to-card',
  }[tone || 'default'];

  const iconTone = {
    default: 'bg-muted text-muted-foreground',
    warning: 'bg-brand-500/15 text-brand-600 dark:text-brand-400',
    danger: 'bg-destructive/15 text-destructive',
    success: 'bg-success/15 text-success',
  }[tone || 'default'];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
    >
      <Card className={cn(
        'relative overflow-hidden border transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5',
        accent && tone === 'default'
          ? 'border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card'
          : toneClasses
      )}>
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        <CardHeader className="pb-2 flex flex-row items-center gap-3">
          <div className={cn(
            'flex items-center justify-center h-10 w-10 rounded-xl shrink-0',
            accent && tone === 'default' ? 'bg-primary/15 text-primary' : iconTone
          )}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardDescription className="text-xs">{label}</CardDescription>
            <CardTitle className="text-2xl tabular-nums mt-0.5">{value}</CardTitle>
          </div>
        </CardHeader>
      </Card>
    </motion.div>
  );
}

function FileRow({ file, badge, badgeTone }: { file: any; badge?: string; badgeTone?: 'warning' | 'danger' | 'default' }) {
  const toneCls = badgeTone === 'danger' ? 'bg-destructive/10 text-destructive border-destructive/20'
    : badgeTone === 'warning' ? 'bg-brand-500/10 text-brand-700 dark:text-brand-400 border-brand-500/20'
    : 'bg-primary/10 text-primary border-primary/20';
  return (
    <Link
      to={`/finance/purchase-files/${file.id}`}
      className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/40 transition-colors border border-transparent hover:border-border/60"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">
          {smartCapitalize(file.client_name) || 'Client'}
          <span className="text-muted-foreground font-normal"> · {file.title}</span>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {file.property_address || file.purchase_type || '—'}
          {file.lender && <span> · {file.lender}</span>}
        </div>
      </div>
      {badge && (
        <Badge variant="outline" className={cn('text-[10px] capitalize shrink-0', toneCls)}>
          {badge}
        </Badge>
      )}
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
    </Link>
  );
}

function WidgetCard({
  title, description, icon: Icon, items, emptyText, accent, renderRow, footerLink,
}: {
  title: string; description?: string; icon: React.ElementType;
  items: any[]; emptyText: string;
  accent?: 'warning' | 'danger' | 'success' | 'default';
  renderRow: (item: any, i: number) => React.ReactNode;
  footerLink?: { to: string; label: string };
}) {
  const accentCls = {
    danger: 'border-destructive/30',
    warning: 'border-brand-500/30',
    success: 'border-success/30',
    default: 'border-border',
  }[accent || 'default'];
  return (
    <Card className={cn('border overflow-hidden', accentCls)}>
      <div className="h-[2px] bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
            accent === 'danger' ? 'bg-destructive/10 text-destructive'
              : accent === 'warning' ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400'
              : accent === 'success' ? 'bg-success/10 text-success'
              : 'bg-primary/10 text-primary'
          )}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-sm">{title}</CardTitle>
            {description && <CardDescription className="text-[11px]">{description}</CardDescription>}
          </div>
        </div>
        <Badge variant="secondary" className="tabular-nums">{items.length}</Badge>
      </CardHeader>
      <CardContent className="pt-1">
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center border border-dashed rounded-lg">
            {emptyText}
          </div>
        ) : (
          <div className="space-y-1">
            {items.slice(0, 5).map(renderRow)}
            {items.length > 5 && (
              <div className="text-[11px] text-muted-foreground text-center pt-1">
                +{items.length - 5} more
              </div>
            )}
          </div>
        )}
        {footerLink && (
          <div className="mt-2">
            <Button variant="ghost" size="sm" asChild className="w-full text-xs h-7">
              <Link to={footerLink.to}>{footerLink.label} <ArrowRight className="h-3 w-3 ml-1" /></Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function FinancePortalDashboard() {
  const { user, invokeFinanceFunction } = useFinancePortalAuth();
  const { settings: brandSettings } = useBrand();
  const brandName = brandSettings.companyName || 'the team';

  const { data: metrics, isLoading } = useQuery({
    queryKey: ['finance-portal-dashboard-metrics', user?.id],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-dashboard-metrics', {});
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!user,
    refetchInterval: 60000,
  });

  const firstName = user?.name?.split(' ')[0] || 'Partner';
  const f = metrics?.files || {};
  const settlements = f.settlements || { d7: [], d14: [], d30: [] };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
        {/* Welcome header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            Welcome back, <span className="text-primary">{firstName}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {user?.company || 'Independent Finance Partner'} · {user?.email}
          </p>
        </motion.div>

        {/* Agreement templates — a resource, not a queue.
            This slot used to hold an ACTION CARD for an agreement issued to
            this partner through the platform. That workflow is retired: the
            platform no longer issues, records or stands behind an agreement
            between the partner and anyone else. What is left is the blank
            template, offered on exactly the same terms to both sides. */}
        <Card>
          <CardContent className="p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Agreement Templates
            </h2>
            <AgreementTemplateResources onDownloadDocx={downloadAgreementTemplateDocx} />
          </CardContent>
        </Card>

        {/* Engagement: streak + what changed since last visit */}
        <EngagementHeader />

        {/* Today triage + document expiry + goals */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2"><TodayPanel /></div>
          <div className="space-y-4">
            <GoalsProgressCard />
            <DocumentExpiryWatchlist withinDays={30} />
          </div>
        </div>

        {/* AI Copilot row: risk sniffer + coach */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AiRiskSnifferWidget />
          <AiCoachWidget />
        </div>







        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="border border-border">
                <CardHeader className="pb-2 flex flex-row items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <div className="flex-1 space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-12" /></div>
                </CardHeader>
              </Card>
            ))
          ) : (
            <>
              <KpiCard label="Assigned Clients" value={metrics?.client_count ?? 0} icon={Users} accent index={0} />
              <KpiCard label="Active Files" value={f.total ?? 0} icon={Briefcase} index={1} />
              <KpiCard label="Action Required" value={f.action_required?.length ?? 0} icon={Inbox} tone="warning" index={2} />
              <KpiCard label="At Risk" value={f.at_risk?.length ?? 0} icon={AlertTriangle} tone="danger" index={3} />
              <KpiCard label="Settlements 30d" value={(settlements.d7.length + settlements.d14.length + settlements.d30.length)} icon={CalendarClock} tone="success" index={4} />
            </>
          )}
        </div>

        {/* Widget grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="border"><CardContent className="p-4"><Skeleton className="h-40 w-full" /></CardContent></Card>
            ))
          ) : (
            <>
              <WidgetCard
                title="Files requiring action"
                description="Docs requested, in review, lodged or awaiting decisions"
                icon={Inbox}
                items={f.action_required || []}
                emptyText="Nothing waiting on your input."
                accent="warning"
                renderRow={(file: any) => (
                  <FileRow key={file.id} file={file} badge={file.finance_status?.replace(/_/g, ' ')} badgeTone="warning" />
                )}
                footerLink={{ to: '/finance/purchase-files', label: 'View all files' }}
              />

              <WidgetCard
                title="Approvals due this week"
                description="Finance clause within 7 days"
                icon={Gavel}
                items={f.approvals_this_week || []}
                emptyText="No approvals scheduled this week."
                accent="warning"
                renderRow={(file: any) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    badge={file.finance_clause_days != null ? `${file.finance_clause_days}d to clause` : undefined}
                    badgeTone={file.finance_clause_days != null && file.finance_clause_days <= 2 ? 'danger' : 'warning'}
                  />
                )}
              />

              <WidgetCard
                title="At-risk files"
                description="Flagged high risk or escalated"
                icon={AlertTriangle}
                items={f.at_risk || []}
                emptyText="No files currently flagged."
                accent="danger"
                renderRow={(file: any) => (
                  <FileRow key={file.id} file={file} badge={file.risk_level || 'at risk'} badgeTone="danger" />
                )}
              />

              <WidgetCard
                title="Documents pending"
                description="Required or requested from client"
                icon={FileWarning}
                items={f.action_required?.filter((x: any) => x.docs_pending > 0) || []}
                emptyText="No outstanding documents."
                renderRow={(file: any) => (
                  <FileRow key={file.id} file={file} badge={`${file.docs_pending} pending`} />
                )}
              />

              <WidgetCard
                title="Valuations pending"
                description="Ordered, inspecting or awaiting return"
                icon={FolderOpen}
                items={f.action_required?.filter((x: any) => x.valuations_pending > 0) || []}
                emptyText="No valuations in flight."
                renderRow={(file: any) => (
                  <FileRow key={file.id} file={file} badge={`${file.valuations_pending} val`} />
                )}
              />

              <WidgetCard
                title="Broker response required"
                description={`Files where ${brandName} is awaiting your input`}
                icon={Clock}
                items={f.broker_response_required || []}
                emptyText="You're all caught up."
                renderRow={(file: any) => (
                  <FileRow key={file.id} file={file} badge={file.finance_status?.replace(/_/g, ' ')} />
                )}
              />
            </>
          )}
        </div>

        {/* Settlements upcoming */}
        {!isLoading && (
          <Card className="border overflow-hidden">
            <div className="h-[2px] bg-gradient-to-r from-transparent via-success/40 to-transparent" />
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-success/10 text-success flex items-center justify-center">
                  <CalendarClock className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">Settlements upcoming</CardTitle>
                  <CardDescription className="text-[11px]">Files settling in the next 30 days</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: 'Next 7 days', list: settlements.d7, tone: 'danger' as const },
                  { label: '8–14 days', list: settlements.d14, tone: 'warning' as const },
                  { label: '15–30 days', list: settlements.d30, tone: 'default' as const },
                ].map((bucket) => (
                  <div key={bucket.label}>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center justify-between">
                      <span>{bucket.label}</span>
                      <Badge variant="outline" className="tabular-nums text-[10px]">{bucket.list.length}</Badge>
                    </div>
                    {bucket.list.length === 0 ? (
                      <div className="text-xs text-muted-foreground py-4 text-center border border-dashed rounded-lg">None</div>
                    ) : (
                      <div className="space-y-1">
                        {bucket.list.slice(0, 4).map((file: any) => (
                          <FileRow
                            key={file.id}
                            file={file}
                            badge={file.settlement_date ? format(new Date(file.settlement_date), 'd MMM') : undefined}
                            badgeTone={bucket.tone}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick actions row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { to: '/finance/purchase-files', icon: Briefcase, label: 'Purchase Files', description: 'Active deal rooms' },
            { to: '/finance/clients', icon: Users, label: 'My Clients', description: 'All assigned clients' },
            { to: '/finance/messages', icon: MessageSquare, label: 'Messages', description: `Chat with ${brandName}` },
            { to: '/finance/earnings', icon: Wallet, label: 'Earnings', description: 'Commissions & statements' },
          ].map((qa, i) => (
            <motion.div
              key={qa.to}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 + i * 0.05 }}
            >
              <Link to={qa.to}>
                <Card className="group border hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors flex items-center justify-center shrink-0">
                      <qa.icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{qa.label}</div>
                      <div className="text-[11px] text-muted-foreground">{qa.description}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Account status footer */}
        {!isLoading && (
          <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground/70 pt-2">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-success" /> Account active</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              {user?.has_completed_onboarding ? 'Onboarding complete' : 'Onboarding in progress'}
            </span>
            {metrics?.recent_activity?.[0]?.created_at && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1.5">
                  <TrendingUp className="h-3 w-3" />
                  Last activity {format(new Date(metrics.recent_activity[0].created_at), 'd MMM, p')}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
