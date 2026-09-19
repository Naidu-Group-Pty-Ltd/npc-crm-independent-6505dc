import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { toast } from 'sonner';
import {
  RefreshCw, Download, DollarSign, Wallet, Hourglass,
  CalendarCheck, TrendingUp, TrendingDown, Minus,
  FileText, FileSpreadsheet, Receipt, BarChart3,
  CalendarRange, Filter, X, ChevronRight, ListTree, AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { PortalEmptyState } from '@/components/finance-portal/PortalEmptyState';
import { smartCapitalize } from '@/lib/nameUtils';

const fmt = (n: number) =>
  `$${(Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  invoiced: 'default',
  paid: 'default',
  clawback: 'destructive',
  void: 'outline',
};

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-brand-500',
  invoiced: 'bg-info',
  paid: 'bg-success',
  clawback: 'bg-destructive',
  void: 'bg-muted-foreground',
};

// Animated count-up for KPI values
function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);
  useEffect(() => {
    if (target === prevTarget.current) return;
    prevTarget.current = target;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);
  return value;
}

function KpiCard({
  icon,
  label,
  value,
  rawValue,
  trend,
  accent,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  rawValue?: number;
  trend?: 'up' | 'down' | 'flat';
  accent?: boolean;
  loading?: boolean;
}) {
  const animatedVal = useCountUp(rawValue ?? 0);
  const displayVal = rawValue != null
    ? `$${animatedVal.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value;

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  return (
    <Card className={cn(
      'relative overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-primary/5 group',
      accent && 'border-primary/20'
    )}>
      {/* Gradient top accent */}
      <div className={cn(
        'absolute inset-x-0 top-0 h-0.5',
        accent ? 'bg-gradient-to-r from-primary/80 via-primary to-primary/60' : 'bg-gradient-to-r from-muted via-border to-muted'
      )} />
      <CardContent className="pt-5 pb-4 px-5">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <div className={cn(
                  'p-1.5 rounded-lg transition-colors',
                  accent ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
                )}>
                  {icon}
                </div>
                {label}
              </div>
              {trend && (
                <div className={cn(
                  'flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                  trend === 'up' && 'text-success bg-success/10',
                  trend === 'down' && 'text-destructive bg-destructive/10',
                  trend === 'flat' && 'text-muted-foreground bg-muted'
                )}>
                  <TrendIcon className="h-3 w-3" />
                </div>
              )}
            </div>
            <div className={cn(
              'text-2xl sm:text-3xl font-bold tracking-tight tabular-nums',
              accent ? 'text-primary' : 'text-foreground'
            )}>
              {displayVal}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-muted" />
      <CardContent className="pt-5 pb-4 px-5 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-32" />
      </CardContent>
    </Card>
  );
}

const normalizeDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isWithinRange = (value: string | null | undefined, startDate: string, endDate: string) => {
  const parsed = normalizeDate(value);
  if (!parsed) return false;

  if (startDate) {
    const start = new Date(`${startDate}T00:00:00`);
    if (parsed < start) return false;
  }

  if (endDate) {
    const end = new Date(`${endDate}T23:59:59.999`);
    if (parsed > end) return false;
  }

  return true;
};

const buildNoResultsDescription = ({
  statusFilter,
  startDate,
  endDate,
  subject,
}: {
  statusFilter: string;
  startDate: string;
  endDate: string;
  subject: 'commissions' | 'statements';
}) => {
  const filters: string[] = [];
  if (statusFilter !== 'all') filters.push(`status set to ${statusFilter}`);
  if (startDate && endDate) filters.push(`date range from ${startDate} to ${endDate}`);
  else if (startDate) filters.push(`dates after ${startDate}`);
  else if (endDate) filters.push(`dates before ${endDate}`);

  if (filters.length === 0) {
    return `No ${subject} have been recorded yet.`;
  }

  return `No ${subject} match your ${filters.join(' and ')}.`;
};

function MobileEarningsCardSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <div className="grid gap-3 pt-2 sm:grid-cols-2">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
        <Skeleton className="h-10 w-32 rounded-lg" />
      </CardContent>
    </Card>
  );
}

function DetailSubtotalStrip({
  gross,
  gst,
  net,
  className,
}: {
  gross: number;
  gst: number;
  net: number;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-primary/20 bg-primary/5 p-3 sm:p-4', className)}>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-xl border border-border/60 bg-background/80 px-3 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[11px]">Gross</div>
          <div className="mt-1 break-words text-sm font-semibold tabular-nums text-foreground sm:text-base">{fmt(gross)}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-background/80 px-3 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[11px]">GST</div>
          <div className="mt-1 break-words text-sm font-semibold tabular-nums text-foreground sm:text-base">{fmt(gst)}</div>
        </div>
        <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[11px]">Net</div>
          <div className="mt-1 break-words text-sm font-semibold tabular-nums text-primary sm:text-base">{fmt(net)}</div>
        </div>
      </div>
    </div>
  );
}

export default function FinancePortalEarnings() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [searchParams] = useSearchParams();
  const highlightLatest = searchParams.get('highlight') === 'latest';
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'commissions' | 'statements'>('commissions');
  const [kpis, setKpis] = useState<any>(null);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [statements, setStatements] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailType, setDetailType] = useState<'commission' | 'statement' | null>(null);
  const [selectedCommission, setSelectedCommission] = useState<any | null>(null);
  const [selectedStatement, setSelectedStatement] = useState<any | null>(null);
  const [statementLines, setStatementLines] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeAmount, setDisputeAmount] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const latestRowRef = useRef<HTMLTableRowElement>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [sumRes, cRes, stRes, dRes] = await Promise.all([
        invokeFinanceFunction('finance-portal-commissions', { operation: 'partner_summary' }),
        invokeFinanceFunction('finance-portal-commissions', { operation: 'partner_commissions' }),
        invokeFinanceFunction('finance-portal-commissions', { operation: 'partner_statements' }),
        invokeFinanceFunction('finance-portal-commissions', { operation: 'partner_disputes' }),
      ]);
      if (sumRes.error) throw new Error(sumRes.error.message);
      setKpis(sumRes.data?.kpis);
      setCommissions(cRes.data?.commissions || []);
      setStatements(stRes.data?.statements || []);
      setDisputes(dRes.data?.disputes || []);

    } catch (e: any) {
      toast.error('Failed to load earnings: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!loading && highlightLatest && latestRowRef.current) {
      latestRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [loading, highlightLatest]);

  const currentStatusOptions = useMemo(() => {
    const source = tab === 'commissions' ? commissions : statements;
    return Array.from(new Set(source.map((item) => item.status).filter(Boolean))).sort();
  }, [commissions, statements, tab]);

  useEffect(() => {
    if (statusFilter !== 'all' && !currentStatusOptions.includes(statusFilter)) {
      setStatusFilter('all');
    }
  }, [currentStatusOptions, statusFilter]);

  const filteredCommissions = useMemo(() => commissions.filter((commission) => {
    const statusMatches = statusFilter === 'all' || commission.status === statusFilter;
    const dateMatches = isWithinRange(commission.created_at, startDate, endDate);
    return statusMatches && dateMatches;
  }), [commissions, statusFilter, startDate, endDate]);

  const filteredStatements = useMemo(() => statements.filter((statement) => {
    const statusMatches = statusFilter === 'all' || statement.status === statusFilter;
    const dateMatches = isWithinRange(statement.issued_at || statement.period_end, startDate, endDate);
    return statusMatches && dateMatches;
  }), [statements, statusFilter, startDate, endDate]);

  const activeResultsCount = tab === 'commissions' ? filteredCommissions.length : filteredStatements.length;
  const hasActiveFilters = statusFilter !== 'all' || Boolean(startDate) || Boolean(endDate);

  const clearFilters = () => {
    setStatusFilter('all');
    setStartDate('');
    setEndDate('');
  };

  const downloadStatement = async (id: string, type: 'pdf' | 'csv') => {
    const { data, error } = await invokeFinanceFunction('finance-portal-commissions', {
      operation: 'partner_statement_pdf_url',
      statement_id: id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    const url = type === 'pdf' ? data?.pdf_url : data?.csv_url;
    if (url) window.open(url, '_blank', 'noopener');
  };

  const openCommissionDetails = (commission: any) => {
    setDetailType('commission');
    setSelectedCommission(commission);
    setSelectedStatement(null);
    setStatementLines([]);
    setDetailLoading(false);
    setDetailOpen(true);
  };

  const openStatementDetails = async (statement: any) => {
    setDetailType('statement');
    setSelectedStatement(statement);
    setSelectedCommission(null);
    setStatementLines([]);
    setDisputeReason('');
    setDisputeAmount('');
    setDetailLoading(true);
    setDetailOpen(true);

    const { data, error } = await invokeFinanceFunction('finance-portal-commissions', {
      operation: 'partner_statement_detail',
      statement_id: statement.id,
    });

    if (error) {
      toast.error(error.message || 'Could not load statement details');
      setDetailLoading(false);
      return;
    }

    setSelectedStatement(data?.statement || statement);
    setStatementLines(data?.lines || []);
    setDetailLoading(false);
  };

  const submitDispute = async () => {
    if (!selectedStatement || !disputeReason.trim()) return;
    setDisputeSubmitting(true);
    const { data, error } = await invokeFinanceFunction('finance-portal-commissions', {
      operation: 'partner_raise_dispute',
      statement_id: selectedStatement.id,
      reason: disputeReason.trim(),
      reason_category: 'other',
      ...(disputeAmount ? { disputed_amount: Number(disputeAmount) } : {}),
    });
    setDisputeSubmitting(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Could not raise the dispute');
      return;
    }
    setDisputeReason('');
    setDisputeAmount('');
    toast.success((data as any)?.within_window === false
      ? 'Dispute logged — note it was raised outside the agreed window'
      : 'Dispute raised — our team will review it');
    void refresh();
  };


  return (
    <motion.div
      className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5 text-foreground">
            <div className="p-2 rounded-xl bg-primary/10">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            Earnings
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 ml-[42px]">
            Your commissions and remittance statements
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="gap-2 rounded-xl self-start sm:self-auto"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {loading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <KpiCard
              icon={<DollarSign className="h-4 w-4" />}
              label="YTD Gross"
              value={fmt(kpis?.ytd_gross || 0)}
              rawValue={kpis?.ytd_gross || 0}
              trend="up"
            />
            <KpiCard
              icon={<Wallet className="h-4 w-4" />}
              label="YTD Net"
              value={fmt(kpis?.ytd_net || 0)}
              rawValue={kpis?.ytd_net || 0}
              trend="up"
              accent
            />
            <KpiCard
              icon={<Hourglass className="h-4 w-4" />}
              label="Pending Net"
              value={fmt(kpis?.pending_net || 0)}
              rawValue={kpis?.pending_net || 0}
              trend="flat"
            />
            <KpiCard
              icon={<CalendarCheck className="h-4 w-4" />}
              label="Paid This Month"
              value={fmt(kpis?.paid_this_month || 0)}
              rawValue={kpis?.paid_this_month || 0}
            />
          </>
        )}
      </div>

      <div className="space-y-4 rounded-2xl border border-border/60 bg-card/50 p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-1 rounded-xl bg-muted/50 p-1">
            <button
              onClick={() => setTab('commissions')}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                tab === 'commissions'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Receipt className="h-3.5 w-3.5" />
              Commissions
              <Badge variant={tab === 'commissions' ? 'secondary' : 'outline'} className="text-[10px] h-4 px-1.5">
                {filteredCommissions.length}
              </Badge>
            </button>
            <button
              onClick={() => setTab('statements')}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                tab === 'statements'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              Statements
              <Badge variant={tab === 'statements' ? 'secondary' : 'outline'} className="text-[10px] h-4 px-1.5">
                {filteredStatements.length}
              </Badge>
            </button>
          </div>

          <Badge variant="outline" className="h-8 w-fit gap-2 rounded-full border-primary/20 px-3 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5 text-primary" />
            {activeResultsCount} result{activeResultsCount === 1 ? '' : 's'}
          </Badge>
        </div>

        <Card className="border-border/60 shadow-sm shadow-primary/5">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
              <div className="flex items-center gap-2">
                <CalendarRange className="h-4 w-4 text-primary" />
                Filter {tab === 'commissions' ? 'commissions' : 'statements'}
              </div>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-8 gap-1 rounded-lg px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear filters
                </Button>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="earnings-status-filter">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger id="earnings-status-filter" className="h-11 rounded-xl">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {currentStatusOptions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="earnings-start-date">From</Label>
                <Input
                  id="earnings-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="earnings-end-date">To</Label>
                <Input
                  id="earnings-end-date"
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-xl"
                />
              </div>

              <div className="flex flex-col justify-end rounded-xl border border-dashed border-primary/20 bg-primary/5 px-4 py-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Showing</span>
                <span className="mt-1 text-lg font-semibold text-foreground">{activeResultsCount}</span>
                <span className="text-xs text-muted-foreground">
                  {tab === 'commissions' ? 'commission entries' : 'statement entries'} in range
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab Content */}
      
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
        >
          {loading ? (
            <>
              <Card className="hidden lg:block">
                <CardContent className="pt-6 space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-32 flex-1" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                  ))}
                </CardContent>
              </Card>
              <div className="space-y-3 lg:hidden">
                {Array.from({ length: 3 }).map((_, i) => <MobileEarningsCardSkeleton key={i} />)}
              </div>
            </>
          ) : tab === 'commissions' ? (
            <>
              {/* Desktop Table */}
              <Card className="hidden lg:block">
                <CardContent className="pt-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Trigger</TableHead>
                        <TableHead className="text-right">Basis</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCommissions.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                            <div className="mx-auto max-w-md">
                              <PortalEmptyState
                                icon={<Receipt className="h-8 w-8" />}
                                title={hasActiveFilters ? 'No commissions match these filters' : 'No commissions recorded yet'}
                                description={hasActiveFilters ? 'Adjust the status or date range to widen the results.' : 'New commission lines will appear here as client milestones are completed.'}
                                actionLabel={hasActiveFilters ? 'Clear filters' : undefined}
                                onAction={hasActiveFilters ? clearFilters : undefined}
                                className="border-0 bg-transparent shadow-none"
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {filteredCommissions.map((c, idx) => (
                        <TableRow
                          key={c.id}
                          ref={idx === 0 ? latestRowRef : undefined}
                          className={cn(
                            idx % 2 === 1 && 'bg-muted/30',
                            highlightLatest && idx === 0 && 'bg-primary/10 ring-1 ring-primary/30'
                          )}
                        >
                          <TableCell className="text-xs tabular-nums">
                            {format(new Date(c.created_at), 'd MMM yyyy')}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{smartCapitalize(c.client_name_snapshot) || '\u2014'}</div>
                            <div className="text-xs text-muted-foreground">{c.deal_type_snapshot || ''}</div>
                          </TableCell>
                          <TableCell className="text-xs">{c.trigger_event || '\u2014'}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(c.basis_amount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number(c.rate_pct).toFixed(2)}%</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{fmt(c.net_amount)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[c.status] || 'bg-muted-foreground')} />
                              <Badge variant={STATUS_VARIANT[c.status] || 'outline'} className="text-[10px] capitalize">
                                {c.status}
                              </Badge>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Mobile + tablet cards */}
              <div className="space-y-3 lg:hidden">
                {filteredCommissions.length === 0 ? (
                  <PortalEmptyState
                    icon={<Receipt className="h-8 w-8" />}
                    title={hasActiveFilters ? 'No commissions match these filters' : 'No commissions recorded yet'}
                    description={hasActiveFilters ? buildNoResultsDescription({ statusFilter, startDate, endDate, subject: 'commissions' }) : 'Commissions will appear here as readable stacked cards with the most important values first.'}
                    actionLabel={hasActiveFilters ? 'Clear filters' : undefined}
                    onAction={hasActiveFilters ? clearFilters : undefined}
                  />
                ) : (
                  filteredCommissions.map((c, idx) => (
                    <Card
                      key={c.id}
                      className={cn(
                        'transition-all hover:shadow-md hover:shadow-primary/5',
                        highlightLatest && idx === 0 && 'border-primary/30 bg-primary/5'
                      )}
                    >
                      <CardContent className="space-y-4 p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <p className="text-base font-semibold leading-tight text-foreground break-words">
                              {smartCapitalize(c.client_name_snapshot) || '—'}
                            </p>
                            <p className="text-xs text-muted-foreground break-words sm:text-sm">
                              {c.deal_type_snapshot || 'Deal type unavailable'}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[c.status] || 'bg-muted-foreground')} />
                            <Badge variant={STATUS_VARIANT[c.status] || 'outline'} className="text-[10px] capitalize">
                              {c.status}
                            </Badge>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Net</div>
                            <div className="mt-1 text-lg font-semibold tabular-nums text-primary">{fmt(c.net_amount)}</div>
                          </div>
                          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Basis × rate</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{fmt(c.basis_amount)}</div>
                            <div className="text-xs text-muted-foreground">{Number(c.rate_pct).toFixed(2)}% applied</div>
                          </div>
                        </div>

                        <div className="grid gap-3 border-t border-border/50 pt-3 sm:grid-cols-2">
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Created</div>
                            <div className="mt-1 text-sm text-foreground">{format(new Date(c.created_at), 'd MMM yyyy')}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Trigger</div>
                            <div className="mt-1 text-sm text-foreground break-words">{c.trigger_event || '—'}</div>
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => openCommissionDetails(c)}
                          className="h-10 w-full justify-between rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          Open details
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              {/* Desktop Table */}
              <Card className="hidden lg:block">
                <CardContent className="pt-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Lines</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Issued</TableHead>
                        <TableHead className="text-right">Download</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStatements.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                            <div className="mx-auto max-w-md">
                              <PortalEmptyState
                                icon={<FileText className="h-8 w-8" />}
                                title={hasActiveFilters ? 'No statements match these filters' : 'No statements issued yet'}
                                description={hasActiveFilters ? 'Try broadening the date range or switching the status filter.' : 'Monthly remittance statements and export files will appear here once issued.'}
                                actionLabel={hasActiveFilters ? 'Clear filters' : undefined}
                                onAction={hasActiveFilters ? clearFilters : undefined}
                                className="border-0 bg-transparent shadow-none"
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {filteredStatements.map((s, idx) => (
                        <TableRow key={s.id} className={cn(idx % 2 === 1 && 'bg-muted/30')}>
                          <TableCell className="text-sm tabular-nums">{s.period_start} \u2192 {s.period_end}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.line_count}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{fmt(s.total_net)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[s.status] || 'bg-muted-foreground')} />
                              <Badge variant={STATUS_VARIANT[s.status] || 'outline'} className="text-[10px] capitalize">
                                {s.status}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {s.issued_at ? format(new Date(s.issued_at), 'd MMM yyyy') : '\u2014'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {s.pdf_storage_path && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => downloadStatement(s.id, 'pdf')}
                                  className="gap-1.5 rounded-lg text-xs h-8"
                                >
                                  <FileText className="h-3.5 w-3.5 text-destructive" />
                                  PDF
                                </Button>
                              )}
                              {s.remittance_csv_path && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => downloadStatement(s.id, 'csv')}
                                  className="gap-1.5 rounded-lg text-xs h-8"
                                >
                                  <FileSpreadsheet className="h-3.5 w-3.5 text-success" />
                                  CSV
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Mobile + tablet cards */}
              <div className="space-y-3 lg:hidden">
                {filteredStatements.length === 0 ? (
                  <PortalEmptyState
                    icon={<FileText className="h-8 w-8" />}
                    title={hasActiveFilters ? 'No statements match these filters' : 'No statements issued yet'}
                    description={hasActiveFilters ? buildNoResultsDescription({ statusFilter, startDate, endDate, subject: 'statements' }) : 'Statements will appear here as stacked cards with totals and downloads surfaced first.'}
                    actionLabel={hasActiveFilters ? 'Clear filters' : undefined}
                    onAction={hasActiveFilters ? clearFilters : undefined}
                  />
                ) : (
                  filteredStatements.map((s) => (
                    <Card key={s.id} className="transition-all hover:shadow-md hover:shadow-primary/5">
                      <CardContent className="space-y-4 p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Period</div>
                            <p className="text-base font-semibold leading-tight text-foreground break-words">
                              {s.period_start} → {s.period_end}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[s.status] || 'bg-muted-foreground')} />
                            <Badge variant={STATUS_VARIANT[s.status] || 'outline'} className="text-[10px] capitalize">
                              {s.status}
                            </Badge>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Net total</div>
                            <div className="mt-1 text-lg font-semibold tabular-nums text-primary">{fmt(s.total_net)}</div>
                          </div>
                          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Lines & issued</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{s.line_count} line{s.line_count !== 1 ? 's' : ''}</div>
                            <div className="text-xs text-muted-foreground">{s.issued_at ? format(new Date(s.issued_at), 'd MMM yyyy') : 'Not issued yet'}</div>
                          </div>
                        </div>

                        <div className="border-t border-border/50 pt-3">
                          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Downloads</div>
                          <div className="flex flex-wrap gap-2">
                            {s.pdf_storage_path && (
                              <Button size="sm" variant="outline" onClick={() => downloadStatement(s.id, 'pdf')} className="h-9 gap-1.5 rounded-lg text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                                <FileText className="h-3.5 w-3.5 text-destructive" />
                                PDF
                              </Button>
                            )}
                            {s.remittance_csv_path && (
                              <Button size="sm" variant="outline" onClick={() => downloadStatement(s.id, 'csv')} className="h-9 gap-1.5 rounded-lg text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                                <FileSpreadsheet className="h-3.5 w-3.5 text-success" />
                                CSV
                              </Button>
                            )}
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => openStatementDetails(s)}
                          className="h-10 w-full justify-between rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          Open details
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <Drawer open={detailOpen} onOpenChange={setDetailOpen}>
        <DrawerContent className="max-h-[92vh] border-border bg-background">
          <DrawerHeader className="border-b border-border text-left">
            <DrawerTitle>{detailType === 'commission' ? 'Commission details' : 'Statement details'}</DrawerTitle>
            <DrawerDescription>
              {detailType === 'commission'
                ? 'Full commission breakdown and related metadata.'
                : 'Statement summary and included line items.'}
            </DrawerDescription>
          </DrawerHeader>

          <div className="space-y-4 overflow-y-auto p-4 pb-8">
            {detailType === 'commission' && selectedCommission && (
              <>
                <DetailSubtotalStrip
                  gross={selectedCommission.gross_amount}
                  gst={selectedCommission.gst_amount}
                  net={selectedCommission.net_amount}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Card><CardContent className="space-y-2 p-4"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Client</div><div className="text-base font-semibold text-foreground">{smartCapitalize(selectedCommission.client_name_snapshot) || '—'}</div><div className="text-sm text-muted-foreground">{selectedCommission.deal_type_snapshot || 'Deal type unavailable'}</div></CardContent></Card>
                  <Card><CardContent className="space-y-2 p-4"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</div><div className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', STATUS_DOT[selectedCommission.status] || 'bg-muted-foreground')} /><Badge variant={STATUS_VARIANT[selectedCommission.status] || 'outline'} className="capitalize">{selectedCommission.status}</Badge></div><div className="text-sm text-muted-foreground">Created {format(new Date(selectedCommission.created_at), 'd MMM yyyy')}</div></CardContent></Card>
                </div>
                <Card><CardContent className="space-y-3 p-4"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Breakdown</div><div className="grid gap-3 sm:grid-cols-2"><div><div className="text-xs text-muted-foreground">Trigger</div><div className="mt-1 text-sm text-foreground break-words">{selectedCommission.trigger_event || '—'}</div></div><div><div className="text-xs text-muted-foreground">Commission basis</div><div className="mt-1 text-sm text-foreground break-words">{selectedCommission.commission_basis || '—'}</div></div><div><div className="text-xs text-muted-foreground">Basis amount</div><div className="mt-1 text-sm text-foreground">{fmt(selectedCommission.basis_amount)}</div></div><div><div className="text-xs text-muted-foreground">Rate</div><div className="mt-1 text-sm text-foreground">{Number(selectedCommission.rate_pct || 0).toFixed(2)}%</div></div><div><div className="text-xs text-muted-foreground">Invoice ref</div><div className="mt-1 text-sm text-foreground break-words">{selectedCommission.invoice_ref || '—'}</div></div><div><div className="text-xs text-muted-foreground">Paid at</div><div className="mt-1 text-sm text-foreground">{selectedCommission.paid_at ? format(new Date(selectedCommission.paid_at), 'd MMM yyyy') : '—'}</div></div></div>{selectedCommission.notes && <div><div className="text-xs text-muted-foreground">Notes</div><div className="mt-1 text-sm text-foreground break-words">{selectedCommission.notes}</div></div>}</CardContent></Card>
              </>
            )}

            {detailType === 'statement' && selectedStatement && (
              <>
                <DetailSubtotalStrip
                  gross={selectedStatement.total_gross}
                  gst={selectedStatement.total_gst}
                  net={selectedStatement.total_net}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Card><CardContent className="space-y-2 p-4"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Statement period</div><div className="text-base font-semibold text-foreground">{selectedStatement.period_start} → {selectedStatement.period_end}</div><div className="text-sm text-muted-foreground">Issued {selectedStatement.issued_at ? format(new Date(selectedStatement.issued_at), 'd MMM yyyy') : 'Not issued yet'}</div></CardContent></Card>
                  <Card><CardContent className="space-y-2 p-4"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</div><div className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', STATUS_DOT[selectedStatement.status] || 'bg-muted-foreground')} /><Badge variant={STATUS_VARIANT[selectedStatement.status] || 'outline'} className="capitalize">{selectedStatement.status}</Badge></div><div className="text-sm text-muted-foreground">{selectedStatement.line_count} line{selectedStatement.line_count !== 1 ? 's' : ''}</div></CardContent></Card>
                </div>
                <Card>
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground"><ListTree className="h-4 w-4 text-primary" /> Included line items</div>
                    {detailLoading ? (
                      <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
                    ) : statementLines.length === 0 ? (
                      <PortalEmptyState icon={<ListTree className="h-8 w-8" />} title="No line items found" description="This statement does not have any line items available yet." className="border-0 shadow-none" />
                    ) : (
                      <div className="space-y-3">
                        {statementLines.map((line) => (
                          <div key={line.id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-medium text-foreground break-words">{smartCapitalize(line.client_name_snapshot) || '—'}</div><div className="text-xs text-muted-foreground break-words">{line.deal_type_snapshot || 'Deal type unavailable'}</div></div><div className="text-right"><div className="text-sm font-semibold text-primary">{fmt(line.net_snapshot || 0)}</div><div className="text-[11px] text-muted-foreground">{line.rate_pct_snapshot != null ? `${Number(line.rate_pct_snapshot).toFixed(2)}%` : '—'}</div></div></div>
                            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Trigger</div><div className="mt-1 break-words text-foreground">{line.trigger_event_snapshot || '—'}</div></div><div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Accrual date</div><div className="mt-1 text-foreground">{line.accrual_date ? format(new Date(line.accrual_date), 'd MMM yyyy') : '—'}</div></div><div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Basis</div><div className="mt-1 text-foreground">{line.basis_snapshot ? fmt(line.basis_snapshot) : '—'}</div></div><div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Gross / GST</div><div className="mt-1 text-foreground">{fmt(line.gross_snapshot || 0)} / {fmt(line.gst_snapshot || 0)}</div></div></div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-4 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <AlertTriangle className="h-4 w-4 text-primary" /> Query this statement
                      </div>
                      {selectedStatement.dispute_deadline && (
                        <Badge variant="outline" className="text-[11px]">
                          Window closes {format(new Date(selectedStatement.dispute_deadline), 'd MMM yyyy')}
                        </Badge>
                      )}
                    </div>

                    {(() => {
                      const mine = disputes.filter((d) => d.statement_id === selectedStatement.id);
                      return mine.length > 0 ? (
                        <div className="space-y-2">
                          {mine.map((d) => (
                            <div key={d.id} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 text-sm text-foreground break-words">{d.reason}</div>
                                <Badge variant={d.status === 'resolved' ? 'default' : d.status === 'rejected' ? 'destructive' : 'secondary'} className="capitalize shrink-0">
                                  {String(d.status).replace(/_/g, ' ')}
                                </Badge>
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                Raised {format(new Date(d.raised_at), 'd MMM yyyy')}
                                {d.disputed_amount != null ? ` · ${fmt(d.disputed_amount)}` : ''}
                                {d.within_window === false ? ' · outside agreed window' : ''}
                              </div>
                              {d.resolution_notes && (
                                <div className="mt-2 text-xs text-muted-foreground">Outcome: {d.resolution_notes}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : null;
                    })()}

                    {selectedStatement.status !== 'draft' && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="dispute-reason" className="text-xs text-muted-foreground">What looks incorrect?</Label>
                          <textarea
                            id="dispute-reason"
                            value={disputeReason}
                            onChange={(e) => setDisputeReason(e.target.value)}
                            rows={3}
                            maxLength={4000}
                            placeholder="Describe the line item and the amount you believe is incorrect…"
                            className="w-full rounded-xl border border-border/70 bg-background/75 p-3 text-sm shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[200px_auto] sm:items-end">
                          <div className="space-y-1.5">
                            <Label htmlFor="dispute-amount" className="text-xs text-muted-foreground">Amount in question (optional)</Label>
                            <Input
                              id="dispute-amount"
                              type="number"
                              inputMode="decimal"
                              value={disputeAmount}
                              onChange={(e) => setDisputeAmount(e.target.value)}
                              placeholder="0.00"
                            />
                          </div>
                          <Button onClick={submitDispute} disabled={disputeSubmitting || !disputeReason.trim()} className="sm:justify-self-start">
                            {disputeSubmitting ? 'Submitting…' : 'Raise dispute'}
                          </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Disputes are reviewed against the executed agreement. Payment of a disputed statement is held until the query is resolved.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>

            )}
          </div>
        </DrawerContent>
      </Drawer>
    </motion.div>
  );
}
