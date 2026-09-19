/**
 * Calculators Tab (Batch 8 — Calculators & Decision Tools)
 *
 * #44 Inline Borrowing Capacity tweaks
 * #45 Side-by-Side Lender Comparison
 * #46 Stamp Duty + LMI
 * #47 Bridging / Refi Scenario Modeller
 * #48 Rate Change Impact Simulator
 *
 * All inline calculations are client-side for instant feedback. Persist + lender
 * comparison + simulator aggregation run through the `finance-portal-batch8`
 * edge function.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import {
  Calculator, Scale, Landmark, ArrowRightLeft, TrendingUp, Save, Pin, Trash2,
  Loader2,
} from 'lucide-react';
import { calculateStampDuty, type AustralianState, type PurchaseIntent, type PropertyCategory } from '@/utils/stampDutyCalculator';

const FN = 'finance-portal-batch8';

const AUD = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Math.round(n || 0));

/* ───────── Pure math (mirror edge fn) ───────── */
function monthlyPI(loan: number, ratePa: number, years: number) {
  if (loan <= 0) return 0;
  const r = ratePa / 100 / 12;
  const n = years * 12;
  if (r === 0) return loan / n;
  return (loan * r) / (1 - Math.pow(1 + r, -n));
}
function monthlyIO(loan: number, ratePa: number) {
  return (loan * (ratePa / 100)) / 12;
}
function quickLmi(loan: number, value: number) {
  const lvr = value > 0 ? (loan / value) * 100 : 0;
  if (lvr <= 80) return { lvr, lmi: 0, rate: 0 };
  const bands: Array<[number, number]> = [[82, 0.0058], [85, 0.0114], [88, 0.0192], [90, 0.0264], [92, 0.0355], [95, 0.0464]];
  let rate = 0.0464;
  for (const [cap, r] of bands) if (lvr <= cap) { rate = r; break; }
  return { lvr, lmi: Math.round(loan * rate), rate };
}

/* ============================================================ */
/* Main                                                          */
/* ============================================================ */
export function CalculatorsTab({ fileId, file }: { fileId: string; file: any }) {
  const [tab, setTab] = useState('borrowing');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5 text-primary" />Calculators &amp; decision tools</CardTitle>
        <CardDescription>
          Live scenarios for borrowing, lender shortlists, stamp duty, LMI, bridging, refinance and rate shocks.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="borrowing"><Calculator className="h-4 w-4 mr-1" />Borrowing</TabsTrigger>
            <TabsTrigger value="compare"><Scale className="h-4 w-4 mr-1" />Lender compare</TabsTrigger>
            <TabsTrigger value="stamp"><Landmark className="h-4 w-4 mr-1" />Stamp duty / LMI</TabsTrigger>
            <TabsTrigger value="bridging"><ArrowRightLeft className="h-4 w-4 mr-1" />Bridging / Refi</TabsTrigger>
            <TabsTrigger value="rates"><TrendingUp className="h-4 w-4 mr-1" />Rate shock</TabsTrigger>
          </TabsList>
          <div className="mt-4">
            <TabsContent value="borrowing"><BorrowingPanel fileId={fileId} file={file} /></TabsContent>
            <TabsContent value="compare"><LenderComparePanel fileId={fileId} file={file} /></TabsContent>
            <TabsContent value="stamp"><StampDutyLmiPanel fileId={fileId} file={file} /></TabsContent>
            <TabsContent value="bridging"><BridgingRefiPanel fileId={fileId} file={file} /></TabsContent>
            <TabsContent value="rates"><RateShockPanel fileId={fileId} /></TabsContent>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/* ============================================================ */
/* #44 Inline Borrowing tweak panel                              */
/* ============================================================ */
function BorrowingPanel({ fileId, file }: { fileId: string; file: any }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [loan, setLoan] = useState<number>(Number(file?.max_approved_budget || file?.purchase_price || 600000));
  const [value, setValue] = useState<number>(Number(file?.purchase_price || loan));
  const [rate, setRate] = useState<number>(6.24);
  const [years, setYears] = useState<number>(30);
  const [type, setType] = useState<'principal_and_interest' | 'interest_only'>('principal_and_interest');
  const [saving, setSaving] = useState(false);

  const repay = type === 'interest_only' ? monthlyIO(loan, rate) : monthlyPI(loan, rate, years);
  const annual = repay * 12;
  const { lvr, lmi } = quickLmi(loan, value);

  const { data: scenarios } = useQuery({
    queryKey: ['calc-scenarios', fileId, 'borrowing_capacity'],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, {
        operation: 'scenarios_list', purchase_file_id: fileId, calculator_type: 'borrowing_capacity',
      });
      if (error) throw new Error(error.message);
      return (data?.scenarios || []) as any[];
    },
  });

  const save = async () => {
    setSaving(true);
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'scenario_save',
      purchase_file_id: fileId,
      calculator_type: 'borrowing_capacity',
      label: `${AUD(loan)} @ ${rate}% ${type === 'interest_only' ? 'IO' : 'P&I'}`,
      inputs: { loan, value, rate, years, type },
      results: { repay, annual, lvr, lmi },
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Scenario saved');
    qc.invalidateQueries({ queryKey: ['calc-scenarios', fileId, 'borrowing_capacity'] });
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Tweak inputs</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <NumField label="Loan amount" value={loan} onChange={setLoan} />
          <NumField label="Property value" value={value} onChange={setValue} />
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Rate (% p.a.)" value={rate} step={0.05} onChange={setRate} />
            <NumField label="Term (years)" value={years} onChange={setYears} />
          </div>
          <div>
            <Label>Repayment type</Label>
            <Select value={type} onValueChange={(v: any) => setType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="principal_and_interest">Principal &amp; interest</SelectItem>
                <SelectItem value="interest_only">Interest only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Live result</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Row k="Monthly repayment" v={AUD(repay)} />
          <Row k="Annual repayment" v={AUD(annual)} />
          <Row k="LVR" v={`${lvr.toFixed(1)}%`} tone={lvr > 90 ? 'warn' : 'ok'} />
          <Row k="Estimated LMI" v={lmi ? AUD(lmi) : '—'} tone={lmi ? 'warn' : 'ok'} />
          <Button onClick={save} disabled={saving} className="w-full mt-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}Save scenario
          </Button>
        </CardContent>
      </Card>

      <SavedScenariosList fileId={fileId} type="borrowing_capacity" scenarios={scenarios || []} />
    </div>
  );
}

/* ============================================================ */
/* #45 Lender comparison                                         */
/* ============================================================ */
function LenderComparePanel({ fileId, file }: { fileId: string; file: any }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [loan, setLoan] = useState<number>(Number(file?.max_approved_budget || file?.purchase_price || 600000));
  const [value, setValue] = useState<number>(Number(file?.purchase_price || loan));
  const [years, setYears] = useState<number>(30);
  const [purpose, setPurpose] = useState<'owner_occupier' | 'investor'>('owner_occupier');
  const [repay, setRepay] = useState<'principal_and_interest' | 'interest_only'>('principal_and_interest');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    setRunning(true);
    const { data, error } = await invokeFinanceFunction(FN, {
      operation: 'lender_compare',
      loan_amount: loan, property_value: value, term_years: years,
      loan_purpose: purpose, repayment_type: repay,
    });
    setRunning(false);
    if (error) return toast.error(error.message);
    setResult(data);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Comparison inputs</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <NumField label="Loan amount" value={loan} onChange={setLoan} />
          <NumField label="Property value" value={value} onChange={setValue} />
          <NumField label="Term (yrs)" value={years} onChange={setYears} />
          <div>
            <Label>Purpose</Label>
            <Select value={purpose} onValueChange={(v: any) => setPurpose(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="owner_occupier">Owner occupier</SelectItem>
                <SelectItem value="investor">Investor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Repayment</Label>
            <Select value={repay} onValueChange={(v: any) => setRepay(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="principal_and_interest">P&amp;I</SelectItem>
                <SelectItem value="interest_only">Interest only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={run} disabled={running} className="w-full">
              {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Scale className="h-4 w-4 mr-1" />}Compare lenders
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Ranked lenders ({result.ranked?.length || 0}) — target LVR {result.target_lvr}% · est. LMI {AUD(result.estimated_lmi)}
            </CardTitle>
            <CardDescription>Ordered by 5-year total cost (repayments + fees + LMI).</CardDescription>
          </CardHeader>
          <CardContent>
            {!result.ranked?.length ? (
              <p className="text-sm text-muted-foreground">No matching lender rate cards. Add cards via Settings.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lender / Product</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Comp.</TableHead>
                    <TableHead className="text-right">Monthly</TableHead>
                    <TableHead className="text-right">Upfront</TableHead>
                    <TableHead className="text-right">LMI</TableHead>
                    <TableHead className="text-right">5-yr cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.ranked.map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.lender_key}</div>
                        <div className="text-xs text-muted-foreground">{c.product_name}</div>
                        <div className="flex gap-1 mt-1">
                          {c.offset_available && <Badge variant="outline" className="text-[10px]">Offset</Badge>}
                          {c.redraw_available && <Badge variant="outline" className="text-[10px]">Redraw</Badge>}
                          {c.lmi_waived && <Badge variant="outline" className="text-[10px] border-success/30 text-success">LMI waived</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{Number(c.rate_pa).toFixed(2)}%</TableCell>
                      <TableCell className="text-right">{c.comparison_rate ? `${Number(c.comparison_rate).toFixed(2)}%` : '—'}</TableCell>
                      <TableCell className="text-right">{AUD(c.monthly_repayment)}</TableCell>
                      <TableCell className="text-right">{AUD(c.upfront_fees)}</TableCell>
                      <TableCell className="text-right">{c.estimated_lmi ? AUD(c.estimated_lmi) : '—'}</TableCell>
                      <TableCell className="text-right font-medium">{AUD(c.five_year_total_cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ============================================================ */
/* #46 Stamp Duty + LMI                                          */
/* ============================================================ */
function StampDutyLmiPanel({ fileId, file }: { fileId: string; file: any }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [value, setValue] = useState<number>(Number(file?.purchase_price || 750000));
  const [loan, setLoan] = useState<number>(Number(file?.max_approved_budget || value * 0.8));
  const [state, setState] = useState<AustralianState>('NSW');
  const [intent, setIntent] = useState<PurchaseIntent>('owner_occupier');
  const [category, setCategory] = useState<PropertyCategory>('established');
  const [fhb, setFhb] = useState(false);
  const [foreign, setForeign] = useState(false);
  const [saving, setSaving] = useState(false);

  const stamp = useMemo(
    () => calculateStampDuty({ propertyValue: value, state, intent, category, isFirstHomeBuyer: fhb, isForeignBuyer: foreign }),
    [value, state, intent, category, fhb, foreign],
  );
  const lmi = quickLmi(loan, value);

  const { data: scenarios } = useQuery({
    queryKey: ['calc-scenarios', fileId, 'stamp_duty'],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, {
        operation: 'scenarios_list', purchase_file_id: fileId, calculator_type: 'stamp_duty',
      });
      if (error) throw new Error(error.message);
      return (data?.scenarios || []) as any[];
    },
  });

  const save = async () => {
    setSaving(true);
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'scenario_save',
      purchase_file_id: fileId,
      calculator_type: 'stamp_duty',
      label: `${state} ${AUD(value)} · ${intent} · ${fhb ? 'FHB' : 'no FHB'}`,
      inputs: { value, loan, state, intent, category, fhb, foreign },
      results: { totalDuty: stamp.totalDuty, baseDuty: stamp.baseDuty, lmi: lmi.lmi, lvr: lmi.lvr },
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Scenario saved');
    qc.invalidateQueries({ queryKey: ['calc-scenarios', fileId, 'stamp_duty'] });
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Inputs</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Property value" value={value} onChange={setValue} />
            <NumField label="Loan amount" value={loan} onChange={setLoan} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>State</Label>
              <Select value={state} onValueChange={(v: any) => setState(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['NSW','VIC','QLD','WA','SA','TAS','NT','ACT'] as const).map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Intent</Label>
              <Select value={intent} onValueChange={(v: any) => setIntent(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner_occupier">Owner occupier</SelectItem>
                  <SelectItem value="investor">Investor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={(v: any) => setCategory(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="established">Established</SelectItem>
                <SelectItem value="new">New build</SelectItem>
                <SelectItem value="vacant_land">Vacant land</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={fhb} onChange={e => setFhb(e.target.checked)} />First home buyer</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={foreign} onChange={e => setForeign(e.target.checked)} />Foreign buyer</label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Results</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Row k="Base duty" v={AUD(stamp.baseDuty)} />
          {stamp.fhbConcession > 0 && <Row k="FHB concession" v={`− ${AUD(stamp.fhbConcession)}`} tone="ok" />}
          {stamp.foreignSurcharge > 0 && <Row k="Foreign surcharge" v={`+ ${AUD(stamp.foreignSurcharge)}`} tone="warn" />}
          <Row k="Total stamp duty" v={AUD(stamp.totalDuty)} bold />
          <Row k="Effective rate" v={`${stamp.effectiveRate.toFixed(2)}%`} />
          <div className="h-px bg-border my-2" />
          <Row k="LVR" v={`${lmi.lvr.toFixed(1)}%`} tone={lmi.lvr > 90 ? 'warn' : 'ok'} />
          <Row k="Estimated LMI" v={lmi.lmi ? AUD(lmi.lmi) : 'Not required'} />
          <Row k="Total upfront (duty + LMI)" v={AUD(stamp.totalDuty + lmi.lmi)} bold />
          <Button onClick={save} disabled={saving} className="w-full mt-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}Save scenario
          </Button>
          {!!stamp.notes?.length && (
            <ul className="text-xs text-muted-foreground list-disc pl-4 mt-2 space-y-1">
              {stamp.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>

      <SavedScenariosList fileId={fileId} type="stamp_duty" scenarios={scenarios || []} />
    </div>
  );
}

/* ============================================================ */
/* #47 Bridging / Refi                                            */
/* ============================================================ */
function BridgingRefiPanel({ fileId, file }: { fileId: string; file: any }) {
  return (
    <Tabs defaultValue="bridging">
      <TabsList>
        <TabsTrigger value="bridging">Bridging</TabsTrigger>
        <TabsTrigger value="refi">Refinance</TabsTrigger>
      </TabsList>
      <TabsContent value="bridging" className="mt-4"><BridgingForm fileId={fileId} file={file} /></TabsContent>
      <TabsContent value="refi" className="mt-4"><RefiForm fileId={fileId} file={file} /></TabsContent>
    </Tabs>
  );
}

function BridgingForm({ fileId, file }: { fileId: string; file: any }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [peak, setPeak] = useState<number>(900000);
  const [end, setEnd] = useState<number>(500000);
  const [months, setMonths] = useState<number>(6);
  const [bridgeRate, setBridgeRate] = useState<number>(7.5);
  const [endRate, setEndRate] = useState<number>(6.0);
  const [endTerm, setEndTerm] = useState<number>(30);
  const [sellingCosts, setSellingCosts] = useState<number>(20000);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    setBusy(true);
    const { data, error } = await invokeFinanceFunction(FN, {
      operation: 'bridging_calculate',
      inputs: { peak_debt: peak, end_debt: end, bridging_months: months, bridging_rate_pa: bridgeRate, end_rate_pa: endRate, end_term_years: endTerm, selling_costs: sellingCosts },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setResult(data?.result);
  };

  const save = async () => {
    if (!result) return;
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'scenario_save', purchase_file_id: fileId, calculator_type: 'bridging',
      label: `Bridging ${AUD(peak)} → ${AUD(end)} over ${months}m`,
      inputs: { peak, end, months, bridgeRate, endRate, endTerm, sellingCosts }, results: result,
    });
    if (error) return toast.error(error.message);
    toast.success('Saved');
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Bridging inputs</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Peak debt" value={peak} onChange={setPeak} />
            <NumField label="End debt" value={end} onChange={setEnd} />
            <NumField label="Bridging months" value={months} onChange={setMonths} />
            <NumField label="Bridging rate %" value={bridgeRate} step={0.05} onChange={setBridgeRate} />
            <NumField label="End rate %" value={endRate} step={0.05} onChange={setEndRate} />
            <NumField label="End term yrs" value={endTerm} onChange={setEndTerm} />
            <NumField label="Selling costs" value={sellingCosts} onChange={setSellingCosts} />
          </div>
          <div className="flex gap-2">
            <Button onClick={run} disabled={busy} className="flex-1">{busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Calculate</Button>
            {result && <Button variant="outline" onClick={save}><Save className="h-4 w-4 mr-1" />Save</Button>}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Result</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!result ? <p className="text-sm text-muted-foreground">Run the calculation to see results.</p> : (
            <>
              <Row k="Bridging monthly interest" v={AUD(result.bridging_monthly_interest)} />
              <Row k="Total bridging interest" v={AUD(result.total_bridging_interest)} bold />
              <Row k="End loan monthly repayment" v={AUD(result.end_monthly_repayment)} />
              <Row k="Bridging finance required" v={AUD(result.bridging_finance_required)} bold />
              {result.notes?.map((n: string, i: number) => <p key={i} className="text-xs text-brand-500">{n}</p>)}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RefiForm({ fileId, file }: { fileId: string; file: any }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [currentLoan, setCurrentLoan] = useState<number>(Number(file?.max_approved_budget || 600000));
  const [newLoan, setNewLoan] = useState<number>(currentLoan);
  const [currentRate, setCurrentRate] = useState<number>(6.5);
  const [newRate, setNewRate] = useState<number>(5.99);
  const [term, setTerm] = useState<number>(30);
  const [switchCosts, setSwitchCosts] = useState<number>(1200);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    setBusy(true);
    const { data, error } = await invokeFinanceFunction(FN, {
      operation: 'refi_calculate',
      inputs: { current_loan: currentLoan, new_loan: newLoan, current_rate_pa: currentRate, new_rate_pa: newRate, term_years: term, switch_costs: switchCosts },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setResult(data?.result);
  };

  const save = async () => {
    if (!result) return;
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'scenario_save', purchase_file_id: fileId, calculator_type: 'refinance',
      label: `Refi ${currentRate}% → ${newRate}%`,
      inputs: { currentLoan, newLoan, currentRate, newRate, term, switchCosts }, results: result,
    });
    if (error) return toast.error(error.message);
    toast.success('Saved');
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Refinance inputs</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Current loan" value={currentLoan} onChange={setCurrentLoan} />
            <NumField label="New loan" value={newLoan} onChange={setNewLoan} />
            <NumField label="Current rate %" value={currentRate} step={0.05} onChange={setCurrentRate} />
            <NumField label="New rate %" value={newRate} step={0.05} onChange={setNewRate} />
            <NumField label="Term (yrs)" value={term} onChange={setTerm} />
            <NumField label="Switch costs" value={switchCosts} onChange={setSwitchCosts} />
          </div>
          <div className="flex gap-2">
            <Button onClick={run} disabled={busy} className="flex-1">{busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Calculate</Button>
            {result && <Button variant="outline" onClick={save}><Save className="h-4 w-4 mr-1" />Save</Button>}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Savings</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!result ? <p className="text-sm text-muted-foreground">Run the calculation to see results.</p> : (
            <>
              <Row k="Current monthly" v={AUD(result.current_monthly_repayment)} />
              <Row k="New monthly" v={AUD(result.new_monthly_repayment)} />
              <Row k="Monthly saving" v={AUD(result.monthly_saving)} tone={result.monthly_saving > 0 ? 'ok' : 'warn'} bold />
              <Row k="Annual saving" v={AUD(result.annual_saving)} />
              <Row k="Break-even" v={result.break_even_months ? `${result.break_even_months} mo` : '—'} />
              <Row k="5-year net saving" v={AUD(result.five_year_saving)} bold />
              {result.notes?.map((n: string, i: number) => <p key={i} className="text-xs text-brand-500">{n}</p>)}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================ */
/* #48 Rate Change Impact Simulator                              */
/* ============================================================ */
function RateShockPanel({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [bps, setBps] = useState<number>(25);
  const [baseline, setBaseline] = useState<number>(6.24);
  const [scope, setScope] = useState<'file' | 'book'>('file');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = async () => {
    setBusy(true);
    const { data, error } = await invokeFinanceFunction(FN, {
      operation: 'rate_change_simulate',
      bps_change: bps, baseline_rate_pa: baseline, term_years: 30,
      purchase_file_id: scope === 'file' ? fileId : null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setResult(data);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rate move</CardTitle>
          <CardDescription>Project repayment impact across this file or your whole book.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label>Scope</Label>
              <Select value={scope} onValueChange={(v: any) => setScope(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="file">This file only</SelectItem>
                  <SelectItem value="book">My whole book</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumField label="Baseline rate %" value={baseline} step={0.05} onChange={setBaseline} />
            <div>
              <Label>Rate change ({bps > 0 ? '+' : ''}{bps} bps)</Label>
              <Slider value={[bps]} min={-100} max={200} step={5} onValueChange={(v) => setBps(v[0])} />
            </div>
          </div>
          <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <TrendingUp className="h-4 w-4 mr-1" />}Simulate</Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {result.bps_change > 0 ? '+' : ''}{result.bps_change} bps → {result.new_rate_pa}% · {(result.files?.length || 0)} file{(result.files?.length || 0) === 1 ? '' : 's'}
            </CardTitle>
            <CardDescription>
              Δ Monthly {AUD(result.total_delta_monthly)} · Δ Annual {AUD(result.total_delta_annual)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!result.files?.length ? <p className="text-sm text-muted-foreground">No files in scope.</p> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Address</TableHead>
                    <TableHead>Lender</TableHead>
                    <TableHead className="text-right">Loan</TableHead>
                    <TableHead className="text-right">Before</TableHead>
                    <TableHead className="text-right">After</TableHead>
                    <TableHead className="text-right">Δ Monthly</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.files.map((f: any) => (
                    <TableRow key={f.id}>
                      <TableCell className="max-w-[260px] truncate">{f.address || f.id}</TableCell>
                      <TableCell>{f.lender || '—'}</TableCell>
                      <TableCell className="text-right">{AUD(f.loan)}</TableCell>
                      <TableCell className="text-right">{AUD(f.before_monthly)}</TableCell>
                      <TableCell className="text-right">{AUD(f.after_monthly)}</TableCell>
                      <TableCell className="text-right font-medium">{AUD(f.delta_monthly)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ============================================================ */
/* Shared bits                                                    */
/* ============================================================ */
function NumField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </div>
  );
}

function Row({ k, v, tone, bold }: { k: string; v: string; tone?: 'ok' | 'warn'; bold?: boolean }) {
  const toneCls = tone === 'warn' ? 'text-brand-500' : tone === 'ok' ? 'text-success' : '';
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className={`${bold ? 'font-semibold' : ''} ${toneCls}`}>{v}</span>
    </div>
  );
}

function SavedScenariosList({ fileId, type, scenarios }: { fileId: string; type: string; scenarios: any[] }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();

  const togglePin = async (s: any) => {
    const { error } = await invokeFinanceFunction(FN, { operation: 'scenario_update', id: s.id, is_pinned: !s.is_pinned });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ['calc-scenarios', fileId, type] });
  };
  const remove = async (s: any) => {
    const { error } = await invokeFinanceFunction(FN, { operation: 'scenario_delete', id: s.id });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ['calc-scenarios', fileId, type] });
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader><CardTitle className="text-base">Saved scenarios</CardTitle></CardHeader>
      <CardContent>
        {!scenarios.length ? <p className="text-sm text-muted-foreground">No saved scenarios yet.</p> : (
          <div className="space-y-1">
            {scenarios.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 border border-border rounded-md p-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.label || s.calculator_type}</div>
                  <div className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString('en-AU')}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => togglePin(s)} title={s.is_pinned ? 'Unpin' : 'Pin'}>
                    <Pin className={`h-4 w-4 ${s.is_pinned ? 'text-primary' : ''}`} />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(s)} title="Delete">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
