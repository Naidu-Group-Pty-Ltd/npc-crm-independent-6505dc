import { useEffect, useMemo, useState } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertCircle, BookOpen, CheckCircle2, Database, Loader2, RefreshCw, Scale, Trophy,
} from 'lucide-react';

type LiveRate = {
  lender_id: string;
  lender_name: string;
  product_id?: string | null;
  product_name: string | null;
  rate: number | null;
  comparison_rate: number | null;
  rate_type: string | null;
  loan_purpose: string | null;
  repayment_type: string | null;
  lvr_min: number | null;
  lvr_max: number | null;
  min_loan?: number | null;
  max_loan?: number | null;
  fees?: string | null;
  notes?: string | null;
  features?: string[];
  last_updated?: string | null;
  fetched_at?: string | null;
  expires_at?: string | null;
  source?: string | null;
  status?: 'current' | 'stale' | 'missing_fields' | string | null;
  missing_fields?: string[];
};

type LenderSummary = {
  lender_id: string;
  lender_name: string;
  lowest: number | null;
  count: number;
  fetched_at?: string | null;
  expires_at?: string | null;
  status?: string | null;
};

const ALL = 'all';
const MAX_COMPARE = 5;
const MIN_COMPARE = 2;

const fmtPct = (n?: number | null, d = 2) => (n == null ? '—' : `${Number(n).toFixed(d)}%`);
const fmtAUD = (n?: number | null) => (n == null ? '—' : `$${Math.round(Number(n)).toLocaleString('en-AU')}`);
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-AU') : '—');
const titleCase = (s?: string | null) => (s || '—').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

function monthlyRepayment(rate: number | null, loanAmount: number, repaymentType?: string | null) {
  if (!rate || !loanAmount) return null;
  const monthlyRate = rate / 100 / 12;
  if (repaymentType === 'INTEREST_ONLY') return Math.round(loanAmount * monthlyRate);
  const months = 30 * 12;
  return Math.round((loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months)));
}

function getRateKey(rate: LiveRate) {
  return [
    rate.lender_id,
    rate.product_id || rate.product_name || 'product',
    rate.rate_type || 'rate',
    rate.loan_purpose || 'purpose',
    rate.repayment_type || 'repayment',
    rate.lvr_min ?? 'min',
    rate.lvr_max ?? 'max',
  ].join(':');
}

function missingFields(rate: LiveRate) {
  const missing = [...(rate.missing_fields || [])];
  if (rate.rate == null) missing.push('interest rate');
  if (rate.comparison_rate == null) missing.push('comparison rate');
  if (!rate.product_name) missing.push('product name');
  if (!rate.last_updated && !rate.fetched_at) missing.push('last updated date');
  return Array.from(new Set(missing));
}

export default function FinancePortalLenderIntelligence() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [rates, setRates] = useState<LiveRate[]>([]);
  const [lenderSummary, setLenderSummary] = useState<LenderSummary[]>([]);
  const [loanAmount, setLoanAmount] = useState<number>(700_000);
  const [lvr, setLvr] = useState<number>(80);
  const [purpose, setPurpose] = useState<string>('OWNER_OCCUPIED');
  const [repayment, setRepayment] = useState<string>('PRINCIPAL_AND_INTEREST');
  const [rateType, setRateType] = useState<string>(ALL);
  const [lenderFilter, setLenderFilter] = useState<string>(ALL);
  const [productFilter, setProductFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [minRate, setMinRate] = useState<string>('');
  const [maxRate, setMaxRate] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [comparisonKeys, setComparisonKeys] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [compareWarning, setCompareWarning] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await invokeFinanceFunction(
      'finance-portal-lender-intelligence',
      {
        operation: 'live_rates',
        loan_purpose: purpose,
        repayment_type: repayment,
        rate_type: rateType === ALL ? '' : rateType,
        lvr,
        loan_amount: loanAmount,
        limit: 500,
      },
    );

    if (error) {
      setLoadError(error.message || 'Unable to load lender intelligence');
      setRates([]);
      setLenderSummary([]);
    } else {
      const nextRates = data?.rates || [];
      setRates(nextRates);
      setLenderSummary(data?.lenders || []);
      setSelectedKeys((prev) => prev.filter((key) => nextRates.some((rate: LiveRate) => getRateKey(rate) === key)));
      setComparisonKeys((prev) => prev.filter((key) => nextRates.some((rate: LiveRate) => getRateKey(rate) === key)));
      setLastRefreshed(new Date());
    }
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [purpose, repayment, rateType, lvr, loanAmount]);

  const productTypes = useMemo(() => {
    const values = new Set<string>();
    rates.forEach((rate) => (rate.features || []).forEach((feature) => values.add(feature)));
    return Array.from(values).sort();
  }, [rates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = minRate === '' ? null : Number(minRate);
    const max = maxRate === '' ? null : Number(maxRate);

    return rates.filter((rate) => {
      if (q && !`${rate.lender_name} ${rate.product_name || ''} ${(rate.features || []).join(' ')}`.toLowerCase().includes(q)) return false;
      if (lenderFilter !== ALL && rate.lender_id !== lenderFilter) return false;
      if (productFilter !== ALL && !(rate.features || []).includes(productFilter)) return false;
      if (statusFilter !== ALL && (rate.status || 'current') !== statusFilter) return false;
      if (min != null && rate.rate != null && rate.rate < min) return false;
      if (max != null && rate.rate != null && rate.rate > max) return false;
      return true;
    });
  }, [lenderFilter, maxRate, minRate, productFilter, rates, search, statusFilter]);

  const selectedRates = useMemo(
    () => selectedKeys.map((key) => rates.find((rate) => getRateKey(rate) === key)).filter((rate): rate is LiveRate => !!rate),
    [rates, selectedKeys],
  );

  const comparisonRates = useMemo(
    () => comparisonKeys.map((key) => rates.find((rate) => getRateKey(rate) === key)).filter((rate): rate is LiveRate => !!rate),
    [comparisonKeys, rates],
  );

  const best = filtered.find((rate) => rate.rate != null);
  const hasData = rates.length > 0;

  const toggleSelected = (rate: LiveRate) => {
    const key = getRateKey(rate);
    setCompareWarning(null);
    setSelectedKeys((prev) => {
      if (prev.includes(key)) return prev.filter((item) => item !== key);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, key];
    });
  };

  const isSelected = (rate: LiveRate) => selectedKeys.includes(getRateKey(rate));

  const runCompare = () => {
    setComparing(true);
    setCompareWarning(null);
    if (selectedRates.length < MIN_COMPARE || selectedRates.length > MAX_COMPARE) {
      setComparisonKeys([]);
      setCompareWarning(`Select ${MIN_COMPARE}–${MAX_COMPARE} lender products before clicking Compare.`);
      setComparing(false);
      return;
    }
    if (!loanAmount || loanAmount <= 0) {
      setComparisonKeys([]);
      setCompareWarning('Enter a valid loan amount so repayments can be estimated.');
      setComparing(false);
      return;
    }

    const allMissing = selectedRates.flatMap((rate) => missingFields(rate).map((field) => `${rate.lender_name}: ${field}`));
    if (allMissing.length) {
      setCompareWarning(`Some comparison fields are missing from Command Centre data: ${allMissing.slice(0, 6).join('; ')}${allMissing.length > 6 ? '…' : ''}`);
    }
    setComparisonKeys(selectedRates.map(getRateKey));
    setComparing(false);
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" /> Lender Intelligence
          </h1>
          <p className="text-sm text-muted-foreground">
            Live lender and bank rate intelligence from the Command Centre rate cache. Search, filter,
            select 2–5 products, then compare repayments and key differences for Finance Partner scenarios.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Reload cache
          </Button>
        </div>
      </div>

      <Alert>
        <Database className="h-4 w-4" />
        <AlertTitle>Shared Command Centre source of truth</AlertTitle>
        <AlertDescription>
          Live rates are pulled from CDR data holders (Macquarie, NAB, CBA, ANZ, Westpac, BankWest, BOQ, AMP, Bendigo, Suncorp, BankSA, St.George, ING, HSBC, UBank) plus manual rate cards (Resimac) and cached in <code>bank_lending_rates_cache</code>. Use <strong>Reload cache</strong> to display the latest rates published by Command Centre.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Scenario and filters</CardTitle>
          <CardDescription>Filter by lender, product type, loan type, interest rate type, rate range and cache status.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Field label="Loan amount"><Input type="number" value={loanAmount} onChange={(e) => setLoanAmount(Number(e.target.value) || 0)} /></Field>
            <Field label="LVR %"><Input type="number" value={lvr} onChange={(e) => setLvr(Number(e.target.value) || 0)} /></Field>
            <Field label="Loan type">
              <Select value={purpose} onValueChange={setPurpose}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OWNER_OCCUPIED">Owner-occupied</SelectItem>
                  <SelectItem value="INVESTMENT">Investment</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Repayment">
              <Select value={repayment} onValueChange={setRepayment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRINCIPAL_AND_INTEREST">P&amp;I</SelectItem>
                  <SelectItem value="INTEREST_ONLY">Interest only</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Rate type">
              <Select value={rateType} onValueChange={setRateType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  <SelectItem value="VARIABLE">Variable</SelectItem>
                  <SelectItem value="FIXED">Fixed</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Search">
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder="Lender, product, note"
              />
            </Field>
            <Field label="Lender / bank">
              <Select value={lenderFilter} onValueChange={setLenderFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All lenders</SelectItem>
                  {lenderSummary.map((lender) => <SelectItem key={lender.lender_id} value={lender.lender_id}>{lender.lender_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Product type">
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All products</SelectItem>
                  {productTypes.map((product) => <SelectItem key={product} value={product}>{titleCase(product)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="current">Current</SelectItem>
                  <SelectItem value="stale">Stale</SelectItem>
                  <SelectItem value="missing_fields">Missing fields</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Min rate"><Input type="number" step="0.01" value={minRate} onChange={(e) => setMinRate(e.target.value)} placeholder="e.g. 5.50" /></Field>
            <Field label="Max rate"><Input type="number" step="0.01" value={maxRate} onChange={(e) => setMaxRate(e.target.value)} placeholder="e.g. 6.50" /></Field>
            <Field label="Last refresh"><div className="h-10 flex items-center text-sm text-muted-foreground">{lastRefreshed ? lastRefreshed.toLocaleTimeString('en-AU') : '—'}</div></Field>
          </div>
        </CardContent>
      </Card>

      {lenderSummary.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {lenderSummary.slice(0, 18).map((l) => (
            <Badge key={l.lender_id} variant="outline" className="text-xs">
              {l.lender_name} · from {fmtPct(l.lowest)} · {l.count} products · {titleCase(l.status || 'current')}
            </Badge>
          ))}
        </div>
      )}

      {best && !loading && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4 text-primary" /> Lowest matching rate</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <Stat label="Lender" value={best.lender_name} />
              <Stat label="Product" value={best.product_name || '—'} />
              <Stat label="Rate p.a." value={fmtPct(best.rate)} />
              <Stat label="Comparison" value={fmtPct(best.comparison_rate)} />
              <Stat label="Est. repayment" value={fmtAUD(monthlyRepayment(best.rate, loanAmount, best.repayment_type))} />
              <Stat label="Updated" value={fmtDate(best.last_updated || best.fetched_at)} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/30">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Scale className="h-4 w-4 text-primary" /> Side-by-side comparison</CardTitle>
              <CardDescription>Select 2–5 lender products, enter a loan amount, then click Compare.</CardDescription>
            </div>
            <Button onClick={runCompare} disabled={loading || comparing || selectedRates.length < MIN_COMPARE || selectedRates.length > MAX_COMPARE}>
              {comparing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Scale className="h-4 w-4 mr-2" />}
              Compare {selectedRates.length || ''}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Selected {selectedRates.length}/{MAX_COMPARE}. {selectedRates.length < MIN_COMPARE ? `Choose at least ${MIN_COMPARE} products to enable comparison.` : 'Ready to compare.'}
          </div>
          {compareWarning && (
            <Alert className="border-brand-300 bg-brand-50 text-brand-900">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Comparison data warning</AlertTitle>
              <AlertDescription>{compareWarning}</AlertDescription>
            </Alert>
          )}
          {comparisonRates.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {comparisonRates.map((rate) => {
                const missing = missingFields(rate);
                return (
                  <Card key={getRateKey(rate)} className="bg-muted/20">
                    <CardContent className="p-4 space-y-3">
                      <div>
                        <div className="font-semibold">{rate.lender_name}</div>
                        <div className="text-sm text-muted-foreground line-clamp-2">{rate.product_name || 'Unnamed product'}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <Stat label="Rate" value={fmtPct(rate.rate)} />
                        <Stat label="Comparison" value={fmtPct(rate.comparison_rate)} />
                        <Stat label="Repayment" value={fmtAUD(monthlyRepayment(rate.rate, loanAmount, rate.repayment_type))} />
                        <Stat label="LVR" value={`${rate.lvr_min ?? 0}–${rate.lvr_max ?? 100}%`} />
                        <Stat label="Loan type" value={titleCase(rate.loan_purpose)} />
                        <Stat label="Updated" value={fmtDate(rate.last_updated || rate.fetched_at)} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <strong>Fees / notes:</strong> {rate.fees || rate.notes || (rate.features || []).map(titleCase).join(', ') || 'No fee, servicing or policy notes supplied in Command Centre rate data.'}
                      </div>
                      {missing.length > 0 && <Badge variant="outline" className="text-[10px]">Missing: {missing.join(', ')}</Badge>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {loadError && !loading && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Unable to fetch lender data</AlertTitle>
          <AlertDescription>{loadError}. The Finance Portal can only show permitted shared lender data after the Command Centre cache is reachable.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lender/bank products ({filtered.length})</CardTitle>
          <CardDescription>Rows are read from the shared Command Centre cache; use the checkbox to select products for comparison.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading lender intelligence…</div>
          ) : !loadError && !hasData ? (
            <div className="py-10 text-center space-y-2">
              <p className="font-medium">No lender data found in Command Centre.</p>
              <p className="text-sm text-muted-foreground">Add or refresh lenders and rates in Command Centre first; Finance Portal does not maintain duplicate lender records.</p>
            </div>
          ) : !loadError && filtered.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="font-medium">No lender products match these filters.</p>
              <p className="text-sm text-muted-foreground">Widen the rate range, LVR, lender, product or status filters. Lender data exists in Command Centre but not for this scenario.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[56px]">Pick</TableHead>
                    <TableHead>Lender / bank</TableHead>
                    <TableHead>Product / loan type</TableHead>
                    <TableHead className="text-right">Rate p.a.</TableHead>
                    <TableHead className="text-right">Comparison</TableHead>
                    <TableHead className="text-right">Repayment</TableHead>
                    <TableHead>Fees / notes / criteria</TableHead>
                    <TableHead>Updated / source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((rate) => {
                    const key = getRateKey(rate);
                    const selected = isSelected(rate);
                    const missing = missingFields(rate);
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <Checkbox checked={selected} onCheckedChange={() => toggleSelected(rate)} disabled={!selected && selectedRates.length >= MAX_COMPARE} aria-label={`Select ${rate.lender_name} ${rate.product_name || ''}`} />
                        </TableCell>
                        <TableCell className="font-medium">
                          <div>{rate.lender_name}</div>
                          <Badge variant="outline" className="mt-1 text-[10px]">{titleCase(rate.status || 'current')}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div>{rate.product_name || 'Unnamed product'}</div>
                          <div className="text-xs text-muted-foreground">{titleCase(rate.loan_purpose)} · {titleCase(rate.repayment_type)} · {titleCase(rate.rate_type)}</div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{fmtPct(rate.rate)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{fmtPct(rate.comparison_rate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtAUD(monthlyRepayment(rate.rate, loanAmount, rate.repayment_type))}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                          <div className="line-clamp-2">{rate.fees || rate.notes || (rate.features || []).map(titleCase).join(', ') || 'No notes supplied'}</div>
                          {missing.length > 0 && <div className="text-brand-700 mt-1">Missing: {missing.join(', ')}</div>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div>{fmtDate(rate.last_updated || rate.fetched_at)}</div>
                          <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {rate.source || 'Command Centre cache'}</div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Audit: Command Centre lender/rate data currently lives in <code>bank_lending_rates_cache</code> (lender name, product, interest and comparison rates, loan purpose, repayment/rate type, LVR/loan limits, features, fetched/expiry timestamps) and <code>lender_submissions</code> (submitted file lender/product/rate/status history). This Finance Portal page reuses the cache and creates no duplicate lender records.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold mt-0.5">{value}</p>
    </div>
  );
}
