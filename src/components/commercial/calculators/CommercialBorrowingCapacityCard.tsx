import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { AlertTriangle, Building2, Check, ChevronsUpDown, Circle, CheckCircle2, Factory, FileCheck2, Link2, ShieldAlert, Sparkles, UserRound, GitBranch } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchInput } from '@/components/ui/search-input';
import { useCommercialDealState } from '@/utils/commercial/commercialDealState';
import { buildGlobalSyncLabel } from '@/utils/commercial/calculatorDataSync';
import { calculateCommercialIndustrialBorrowing, lenderPolicyProfiles, type AcquisitionPurpose, type AssetCategory, type BorrowingInputs, type BorrowingResult, type LenderPolicyProfileKey, type LeaseStatus, type PurchaserStructure } from '@/utils/commercial';
import { useApplyPrefill } from '@/contexts/CalculatorPrefillContext';
import { SaveBackButton } from '@/components/commercial/SaveBackButton';
import { applyPortfolioImportToggles, summarizeClientPortfolio } from '@/utils/commercial/clientPortfolioEngine';
import { countProfileImportConflicts } from '@/utils/commercial/clientProfileSyncEngine';
import { fetchClientProfile, persistClientScenario, persistCommittedScenarioAssessment, searchClientProfiles, type ClientProfileOption } from '@/utils/commercial/clientPortfolioRepository';
import { buildClientScenario, type ProposedScenarioInputs } from '@/utils/commercial/scenarioModellingEngine';
import { buildScenarioComparisonRows, comparePortfolioScenario } from '@/utils/commercial/scenarioComparisonEngine';
import { buildScenarioReportPayload } from '@/utils/commercial/scenarioReportBuilder';
import { CommercialBCScenarioAgent, type CommercialScenarioProposal } from '@/components/commercial/calculators/CommercialBCScenarioAgent';
import { applyCommercialScenarioProposal } from '@/utils/commercial/scenarioApplyEngine';
import { toast } from 'sonner';
import type { AssumptionStatus, ClientProfile, ClientScenario, ScenarioStatus, ScenarioType } from '@/utils/commercial/clientPortfolioTypes';


const isUsableNumber = (v: unknown) => v !== '' && v != null && Number.isFinite(Number(v));
const fmt = (n: number) => Number.isFinite(n) ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n) : 'Pending';
const fmtMaybe = (v: string | number | null | undefined) => (!isUsableNumber(v) ? 'Pending' : fmt(Number(v)));
const pct = (n: number) => Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : 'Pending';
const num = (v: string) => (v === '' ? Number.NaN : Number(v));
const set = (setter: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => setter(e.target.value);
const hasValue = (v: string) => v.trim() !== '';
const valueOrUndefined = (v: string) => hasValue(v) ? num(v) : undefined;
const sourceNumber = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : Number.NaN;
const badgeVariant = (r: string) => (r === 'green' ? 'default' : r === 'amber' ? 'secondary' : r === 'red' ? 'destructive' : 'outline');
const title = (v: string) => v.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

const commercialSubtypes = ['Office', 'Retail', 'Medical', 'Childcare', 'Showroom', 'Hospitality', 'Mixed-use commercial', 'Other commercial'];
const industrialSubtypes = ['Warehouse', 'Factory', 'Logistics facility', 'Cold storage', 'Workshop', 'Storage yard', 'Manufacturing facility', 'Last-mile facility', 'Other industrial'];

type ScenarioCardModel = BorrowingResult['scenarios'][number] & {
  missingFields: string[];
  ready: boolean;
};

const blankClientProfile: ClientProfile = {
  clientId: '', clientName: 'No client selected', lastUpdated: '', personalIncome: 0, businessIncome: 0, ownershipStructures: [],
  residentialAssets: [], commercialAssets: [], industrialAssets: [],
  sharePortfolio: { portfolioValue: 0, listedShares: 0, etfs: 0, managedFunds: 0, dividendIncome: 0, marginLoan: 0, liquidityHaircutPct: 20, availableLiquidValue: 0 },
  cashAndOffsets: { cashBalance: 0, offsetBalance: 0, businessCash: 0, availableEquityContribution: 0, postSettlementLiquidity: 0 },
  otherInvestments: 0,
  liabilities: { residentialLoans: 0, commercialLoans: 0, businessLoans: 0, equipmentFinance: 0, vehicleFinance: 0, creditCards: 0, overdrafts: 0, atoPaymentPlans: 0, personalLoans: 0, directorGuarantees: 0, relatedPartyLoans: 0, annualDebtService: 0 },
  existingLoans: { residentialLoans: 0, commercialLoans: 0, businessLoans: 0, equipmentFinance: 0, vehicleFinance: 0, creditCards: 0, overdrafts: 0, atoPaymentPlans: 0, personalLoans: 0, directorGuarantees: 0, relatedPartyLoans: 0, annualDebtService: 0 },
  businessFinancials: { businessRevenue: 0, ebitdaNpbt: null, addbacks: 0, directorDrawings: 0, existingRent: 0, existingDebtService: 0, equipmentFinance: 0, workingCapitalRequirement: 0, basAvailable: false, financialsAvailable: false, taxReturnsAvailable: false },
  guarantors: [], taxProfile: {}, gstProfile: {}, scenarios: [],
};

function displayValue(value: number | string | null | undefined) {
  if (value == null) return 'Pending';
  if (typeof value === 'number') return Number.isFinite(value) ? fmt(value) : 'Pending';
  if (['NaN', 'undefined', 'null', 'Infinity', '-Infinity'].includes(value)) return 'Pending';
  return value;
}

function MoneyRow({ label, value, emph }: { label: string; value: number | string | null | undefined; emph?: boolean }) {
  return <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-muted-foreground">{label}<LockedBadge /></span><span className={emph ? 'font-semibold text-primary' : 'font-medium'}>{displayValue(value)}</span></div>;
}

function SafeMoneyRow({ label, value, ready, emph }: { label: string; value: number | string | null | undefined; ready: boolean; emph?: boolean }) {
  const display = !ready || value == null || (typeof value === 'number' && !Number.isFinite(value)) || value === 'N/A' ? 'Pending' : value;
  return <MoneyRow label={label} value={display as number | string} emph={emph} />;
}

const safePct = (n: number | undefined, ready: boolean) => ready && Number.isFinite(Number(n)) ? pct(Number(n)) : 'Pending';
const safeRatio = (n: number | undefined, ready: boolean) => ready && Number.isFinite(Number(n)) ? `${Number(n).toFixed(2)}x` : 'Pending';
const severityVariant = (severity: string) => severity === 'Critical' ? 'destructive' : severity === 'Required' ? 'secondary' : 'outline';

const exportBlockedReason = 'Complete purchase price, NOI, interest rate, loan term and lender policy assumptions before exporting this scenario.';
const warningLogLabels: Record<string, string> = { financial: 'Financial', data: 'Data', asset: 'Asset', structure: 'Documents', lender: 'Lender', gstDuty: 'GST', specialistReview: 'System' };
const documentCategories: Record<string, string[]> = {
  'Contract and title': ['Contract of sale', 'Title search'],
  'Lease and tenant': ['Lease agreement', 'Rent ledger', 'Tenant incentive deed or side agreement'],
  'Outgoings and statutory charges': ['Outgoings statement', 'Council rates notice', 'Water rates notice', 'Land tax estimate'],
  'Valuation and inspections': ['Insurance certificate', 'Building inspection', 'Fire compliance / essential safety measures report', 'Zoning confirmation', 'Strata / owners corporation records, if applicable', 'Valuation'],
  'GST and tax': ['GST treatment confirmation'],
  'Purchaser entity': ['Purchaser entity documents'],
  'Business financials': ['Company financials'],
  'Lender documents': ['Loan statements / debt schedule', 'Bank statements', 'Director guarantees'],
};
const statusTone = (status: 'verified' | 'assumed' | 'missing' | 'na') => ({ verified: 'bg-success/15 text-success border-success/30', assumed: 'bg-brand-500/15 text-brand-100 border-brand-500/30', missing: 'bg-destructive/15 text-destructive border-destructive/30', na: 'bg-muted text-muted-foreground border-border' }[status]);
const statusLabel = (status: 'verified' | 'assumed' | 'missing' | 'na') => ({ verified: 'Green: verified', assumed: 'Amber: assumed', missing: 'Red: missing / unreliable', na: 'Grey: not applicable' }[status]);

function StatusIcon({ status = 'Manual Estimate' }: { status?: AssumptionStatus | string }) {
  if (status === 'Verified') return <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="Verified" />;
  if (status === 'Client Profile Source') return <Link2 className="h-3.5 w-3.5 text-primary" aria-label="Client Profile Source" />;
  if (status === 'AI Estimate') return <Sparkles className="h-3.5 w-3.5 text-brand-300" aria-label="AI Estimate" />;
  if (status === 'Overridden') return <GitBranch className="h-3.5 w-3.5 text-info" aria-label="Overridden" />;
  if (status === 'Specialist Review Required') return <ShieldAlert className="h-3.5 w-3.5 text-destructive" aria-label="Specialist Review Required" />;
  if (status === 'Unknown') return <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-label="Unknown" />;
  return <Circle className="h-2.5 w-2.5 text-muted-foreground" aria-label="Manual Estimate" />;
}
function FieldSourceBadge({ source }: { source: string }) {
  return <Badge variant={source === 'User Override' ? 'secondary' : source === 'Verified' ? 'default' : 'outline'} className="text-[10px]">{source}</Badge>;
}

function LockedBadge() {
  return <Badge variant="outline" className="text-[10px]">Locked calculated output</Badge>;
}

function Field({ label, value, onChange, step = '1', status }: { label: string; value: string; onChange: (v: string) => void; step?: string; status?: string }) {
  const source = status ?? (value ? 'Manual' : 'Blank');
  return <div className="space-y-1 rounded-md border border-border/60 bg-background/70 p-2"><Label className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5">{label}<StatusIcon status={source} /></span><FieldSourceBadge source={source} /></Label><Input className="bg-background" type="number" step={step} value={value} onChange={set(onChange)} /><p className="text-[10px] text-muted-foreground">Editable assumption — updates calculated outputs only.</p></div>;
}

function SelectField({ label, value, onChange, options, status }: { label: string; value: string; onChange: (v: any) => void; options: Array<{ value: string; label: string }>; status?: string }) {
  const source = status ?? (value ? 'Manual' : 'Blank');
  return <div className="space-y-1 rounded-md border border-border/60 bg-background/70 p-2"><Label className="flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5">{label}<StatusIcon status={source} /></span><FieldSourceBadge source={source} /></Label><Select value={value} onValueChange={onChange}><SelectTrigger className="bg-background"><SelectValue /></SelectTrigger><SelectContent>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select><p className="text-[10px] text-muted-foreground">Editable assumption — policy logic is unchanged.</p></div>;
}

function WorkflowSection({ kicker, title, description }: { kicker: string; title: string; description: string }) {
  return (
    <div className="mb-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">{kicker}</p>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function OutcomeTile({ label, value, helper, tone = 'default' }: { label: string; value: string; helper?: string; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  const toneClass = {
    default: 'border-primary/20 bg-background/70',
    success: 'border-success/30 bg-success/10',
    warning: 'border-brand-500/30 bg-brand-500/10',
    danger: 'border-destructive/30 bg-destructive/10',
  }[tone];
  return (
    <div className={cn('rounded-xl border p-4 shadow-sm', toneClass)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{value}</p>
      {helper && <p className="mt-1 text-xs leading-5 text-muted-foreground">{helper}</p>}
    </div>
  );
}


function openSourceTab(tab: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('calculator-tab-open', { detail: { tab } }));
}

function SourceTabNotice({ title, description, tab, metrics }: { title: string; description: string; tab: string; metrics?: Array<{ label: string; value: number | string | null | undefined }> }) {
  return (
    <div className="md:col-span-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => openSourceTab(tab)}>Open source tab</Button>
      </div>
      {metrics?.length ? <div className="mt-3 grid gap-2 md:grid-cols-3">{metrics.map((metric) => <MoneyRow key={metric.label} label={metric.label} value={metric.value} />)}</div> : null}
    </div>
  );
}

function ClientProfileCombobox({ value, options, loading, onChange }: { value: string; options: ClientProfileOption[]; loading?: boolean; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => [o.clientName, o.clientId].some(part => part.toLowerCase().includes(q)));
  }, [options, query]);
  const selected = options.find(o => o.clientId === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between h-10 font-normal">
          <span className={cn('truncate text-sm', !selected && 'text-muted-foreground')}>
            {selected ? selected.clientName : (loading ? 'Loading…' : 'Select client profile…')}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Type to search clients…"
          containerClassName="p-2 border-b flex items-center gap-2"
          className="border-0 h-8 p-0 text-sm focus-visible:ring-0 shadow-none"
          iconClassName="h-3.5 w-3.5"
        />
        <ScrollArea className="max-h-[260px]">
          <div className="p-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{loading ? 'Loading…' : 'No clients found'}</p>
            ) : filtered.map(o => (
              <button key={o.clientId} type="button" onClick={() => { onChange(o.clientId); setOpen(false); setQuery(''); }} className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors text-left', value === o.clientId && 'bg-accent')}>
                <Check className={cn('h-3.5 w-3.5 shrink-0', value === o.clientId ? 'opacity-100 text-primary' : 'opacity-0')} />
                <span className="truncate flex-1">{o.clientName}</span>
                {(o.source as string) === 'sample' && <span className="text-[10px] text-muted-foreground shrink-0">sample</span>}
              </button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

export function CommercialBorrowingCapacityCard({ initialAssetCategory = 'commercial' }: { initialAssetCategory?: AssetCategory }) {
  const updateGlobal = useCommercialDealState(s => s.updateGlobal);
  const linkedActualNoi = useCommercialDealState(s => (s.profile.noiOutputs as any)?.actualNoi ?? (s.profile.noiOutputs as any)?.actualNOI);
  const linkedStabilisedNoi = useCommercialDealState(s => (s.profile.noiOutputs as any)?.stabilisedNoi ?? (s.profile.noiOutputs as any)?.stabilisedNOI);
  const linkedLenderNoi = useCommercialDealState(s => (s.profile.noiOutputs as any)?.lenderAdjustedNoi ?? (s.profile.noiOutputs as any)?.lenderAdjustedNOI);
  const linkedOtherIncome = useCommercialDealState(s => (s.profile.leaseIncome as any)?.otherIncome);
  const linkedRecoveredOutgoings = useCommercialDealState(s => (s.profile.leaseIncome as any)?.recoveredOutgoings);
  const linkedMarketRent = useCommercialDealState(s => (s.profile.leaseIncome as any)?.marketRent);
  const linkedVacancyAllowancePct = useCommercialDealState(s => (s.profile.leaseIncome as any)?.vacancyAllowancePct);
  const sourceMode = useCommercialDealState(s => s.sourceModes.borrowing);
  const [assetCategory, setAssetCategory] = useState<AssetCategory>(initialAssetCategory);
  const [assetSubtype, setAssetSubtype] = useState('');
  const [purpose, setPurpose] = useState<AcquisitionPurpose>('investment');
  const [leaseStatus, setLeaseStatus] = useState<LeaseStatus>('fullyLeased');
  const [state, setState] = useState<'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT'>('NSW');
  const [proposedLoan, setProposedLoan] = useState('');
  const [purchaserType, setPurchaserType] = useState<PurchaserStructure>('company');
  const [entityName, setEntityName] = useState('');
  const [guarantees, setGuarantees] = useState<'yes' | 'no' | 'unknown'>('yes');
  const [gstRegistered, setGstRegistered] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [relatedPartyTenant, setRelatedPartyTenant] = useState<'yes' | 'no'>('no');
  const [availableEquity, setAvailableEquity] = useState('');
  const [sponsorLiquidity, setSponsorLiquidity] = useState('');
  const [liquidityMult, setLiquidityMult] = useState('');
  const [businessDebt, setBusinessDebt] = useState('');
  const [businessEbitda, setBusinessEbitda] = useState('');
  const [currentRent, setCurrentRent] = useState('');
  const [proposedRent, setProposedRent] = useState('');
  const [smsfBalance, setSmsfBalance] = useState('');

  const [purchasePrice, setPurchasePrice] = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [bankValue, setBankValue] = useState('');
  const [conservativeValue, setConservativeValue] = useState<'yes' | 'no'>('yes');
  const [landArea, setLandArea] = useState('');
  const [buildingArea, setBuildingArea] = useState('');
  const [lettableArea, setLettableArea] = useState('');
  const [valuationConfidence, setValuationConfidence] = useState<'low' | 'medium' | 'high'>('medium');
  const [clearance, setClearance] = useState('');
  const [rollerDoors, setRollerDoors] = useState('');
  const [truckAccess, setTruckAccess] = useState<'poor' | 'average' | 'good' | 'excellent'>('good');
  const [powerCapacity, setPowerCapacity] = useState<'unknown' | 'singlePhase' | 'threePhase' | 'highCapacity' | 'substationPresent'>('unknown');
  const [slabCondition, setSlabCondition] = useState<'unknown' | 'good' | 'average' | 'poor'>('good');
  const [roofCondition, setRoofCondition] = useState<'unknown' | 'good' | 'average' | 'poor'>('good');

  const [passingRent, setPassingRent] = useState('');
  const [otherIncome, setOtherIncome] = useState('');
  const [recoveries, setRecoveries] = useState('');
  const [marketRent, setMarketRent] = useState('');
  const [vacancy, setVacancy] = useState('');
  const [incentives, setIncentives] = useState('');
  const [arrearsAdj, setArrearsAdj] = useState('');
  const [nonRecoverable, setNonRecoverable] = useState('');
  const [rates, setRates] = useState('');
  const [water, setWater] = useState('');
  const [landTax, setLandTax] = useState('');
  const [insurance, setInsurance] = useState('');
  const [management, setManagement] = useState('');
  const [repairs, setRepairs] = useState('');
  const [wale, setWale] = useState('');
  const [tenantCovenant, setTenantCovenant] = useState<'government' | 'nationalTenant' | 'listedCompany' | 'establishedSme' | 'newBusiness' | 'relatedParty' | 'weakUnknown'>('establishedSme');
  const [rentOverMarket, setRentOverMarket] = useState<'yes' | 'no' | 'unknown'>('no');
  const [aboveMarketPct, setAboveMarketPct] = useState('');
  const [noiBasis, setNoiBasis] = useState<'actual' | 'stabilised' | 'lenderAdjusted'>('lenderAdjusted');

  const [stampDuty, setStampDuty] = useState('');
  const [transferRegistrationFee, setTransferRegistrationFee] = useState('');
  const [mortgageRegistrationFee, setMortgageRegistrationFee] = useState('');
  const [pexaSettlementFee, setPexaSettlementFee] = useState('');
  const [autoEstimatedAcquisitionCosts, setAutoEstimatedAcquisitionCosts] = useState('');
  const [legal, setLegal] = useState('');
  const [bankLegal, setBankLegal] = useState('');
  const [valuationFee, setValuationFee] = useState('');
  const [dueDiligence, setDueDiligence] = useState('');
  const [environmentalCost, setEnvironmentalCost] = useState('');
  const [asbestosCost, setAsbestosCost] = useState('');
  const [capexReserve, setCapexReserve] = useState('');
  const [workingCapital, setWorkingCapital] = useState('');
  const [otherCosts, setOtherCosts] = useState('');
  const [gstTreatment, setGstTreatment] = useState<'gstInclusive' | 'plusGst' | 'gstFreeGoingConcern' | 'marginScheme' | 'unknown'>('unknown');
  const [gstCashflow, setGstCashflow] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [gstClaimable, setGstClaimable] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [goingConcernConfirmed, setGoingConcernConfirmed] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [landholderAcquisition, setLandholderAcquisition] = useState<'yes' | 'no' | 'unknown'>('no');

  const [profile, setProfile] = useState<LenderPolicyProfileKey>('mainstreamCommercialBank');
  const [rate, setRate] = useState('');
  const [buffer, setBuffer] = useState('');
  const [floorRate, setFloorRate] = useState('');
  const [assessmentBasis, setAssessmentBasis] = useState<'contractPlusBuffer' | 'higherOfBufferAndFloor' | 'interestOnlyAssessment' | 'principalAndInterestAssessment' | 'custom'>('contractPlusBuffer');
  const [term, setTerm] = useState('');
  const [ioPeriod, setIoPeriod] = useState('');
  const [amortisation, setAmortisation] = useState('');
  const [maxLvr, setMaxLvr] = useState('');
  const [minIcr, setMinIcr] = useState('');
  const [minDscr, setMinDscr] = useState('');
  const [minDebtYield, setMinDebtYield] = useState('');

  const [tenantStrength, setTenantStrength] = useState<'strong' | 'established' | 'weak' | 'unknown'>('established');
  const [vacancyLevel, setVacancyLevel] = useState<'none' | 'minor' | 'major'>('minor');
  const [buildingCondition, setBuildingCondition] = useState<'good' | 'average' | 'poor'>('good');
  const [zoning, setZoning] = useState<'clear' | 'uncertain' | 'notPermitted'>('clear');
  const [leaseDocs, setLeaseDocs] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [environmentalRisk, setEnvironmentalRisk] = useState<'low' | 'unknown' | 'present' | 'knownContamination'>('unknown');
  const [asbestosRisk, setAsbestosRisk] = useState<'low' | 'unknown' | 'likely' | 'confirmed'>('unknown');
  const [capexRequired, setCapexRequired] = useState<'none' | 'some' | 'heavy'>('some');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioType, setScenarioType] = useState<ScenarioType>('Acquire Commercial Asset');
  const [scenarioStatus, setScenarioStatus] = useState<ScenarioStatus>('Draft');
  const [savedScenario, setSavedScenario] = useState<ClientScenario | null>(null);
  const [assessmentMode, setAssessmentMode] = useState<'propertyOnly' | 'clientScenario'>('propertyOnly');
  const [includeResidential, setIncludeResidential] = useState(true);
  const [includeCommercial, setIncludeCommercial] = useState(true);
  const [includeIndustrial, setIncludeIndustrial] = useState(true);
  const [includeShares, setIncludeShares] = useState(true);
  const [includeCash, setIncludeCash] = useState(true);
  const [includeBusinessFinancials, setIncludeBusinessFinancials] = useState(true);
  const [includeSpouseGuarantor, setIncludeSpouseGuarantor] = useState(true);
  const [includeEntityStructures, setIncludeEntityStructures] = useState(true);
  const [includeLiabilities, setIncludeLiabilities] = useState(true);
  const [includeIncome, setIncludeIncome] = useState(true);
  const [includeExistingLoans, setIncludeExistingLoans] = useState(true);
  const [includeLatestBorrowingCapacity, setIncludeLatestBorrowingCapacity] = useState(true);
  const [profileImported, setProfileImported] = useState(false);
  const [clientOptions, setClientOptions] = useState<ClientProfileOption[]>([]);
  const [selectedClientProfile, setSelectedClientProfile] = useState<ClientProfile | null>(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Client profile data has not been imported yet.');
  const [pendingImportOpen, setPendingImportOpen] = useState(false);
  const [lastPersistedScenarioId, setLastPersistedScenarioId] = useState<string | null>(null);
  const [commitConfirmOpen, setCommitConfirmOpen] = useState(false);
  const [globalInputSync, setGlobalInputSync] = useState(true);
  const [activeTab, setActiveTab] = useState('quick');
  const [showUnchangedMetrics, setShowUnchangedMetrics] = useState(false);
  const [recommendedScenarioName, setRecommendedScenarioName] = useState('');

  useEffect(() => { setAssetCategory(initialAssetCategory); }, [initialAssetCategory]);

  const showBusinessFields = ['company', 'discretionaryTrust', 'unitTrust', 'holdingCompany', 'spv', 'operatingBusiness'].includes(purchaserType) || purpose === 'ownerOccupied' || purpose === 'relatedPartyLease';
  const selectedLinkedNoi = noiBasis === 'actual' ? linkedActualNoi : noiBasis === 'stabilised' ? linkedStabilisedNoi : linkedLenderNoi ?? linkedStabilisedNoi ?? linkedActualNoi;

  useEffect(() => {
    let alive = true;
    searchClientProfiles().then(options => { if (alive) setClientOptions(options); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!selectedClientId) { setSelectedClientProfile(null); setProfileImported(false); setSyncMessage('No client profile selected. Search and select a client before importing portfolio data.'); return; }
    let alive = true;
    setClientLoading(true);
    fetchClientProfile(selectedClientId).then(profile => {
      if (!alive) return;
      setSelectedClientProfile(profile);
      setSyncMessage(`Loaded ${profile.clientName} from client profile source. Import to apply values to this scenario.`);
    }).catch(err => {
      if (alive) setSyncMessage(`Client profile load failed: ${err?.message || 'Unknown error'}`);
    }).finally(() => { if (alive) setClientLoading(false); });
    return () => { alive = false; };
  }, [selectedClientId]);

  useApplyPrefill((p) => {
    setAssetCategory(p.assetCategory);
    if (p.assetSubtype) setAssetSubtype(p.assetSubtype);
    if (p.state && ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT'].includes(p.state)) setState(p.state as any);
    if (p.purchasePrice != null) setPurchasePrice(String(p.purchasePrice));
    if (p.valuation != null) setEstimatedValue(String(p.valuation));
    if (p.siteAreaSqm != null) setLandArea(String(p.siteAreaSqm));
    if (p.gfaSqm != null) setBuildingArea(String(p.gfaSqm));
    if (p.nlaSqm != null) setLettableArea(String(p.nlaSqm));
    if (p.clearanceMetres != null) setClearance(String(p.clearanceMetres));
    if (p.dockDoors != null) setRollerDoors(String(p.dockDoors));
    if (p.grossPassingRentPa != null) setPassingRent(String(p.grossPassingRentPa));
    if (p.marketRentPa != null) setMarketRent(String(p.marketRentPa));
    if (p.recoveredOutgoingsPa != null) setRecoveries(String(p.recoveredOutgoingsPa));
    if (p.outgoings?.council != null) setRates(String(p.outgoings.council));
    if (p.outgoings?.water != null) setWater(String(p.outgoings.water));
    if (p.outgoings?.land_tax != null) setLandTax(String(p.outgoings.land_tax));
    if (p.outgoings?.insurance != null) setInsurance(String(p.outgoings.insurance));
    if (p.outgoings?.management != null) setManagement(String(p.outgoings.management));
    if (p.outgoings?.repairs_maintenance != null) setRepairs(String(p.outgoings.repairs_maintenance));
    if (p.gstTreatment) {
      const map: Record<string, typeof gstTreatment> = { going_concern: 'gstFreeGoingConcern', margin_scheme: 'marginScheme', standard: 'gstInclusive', input_taxed: 'unknown' };
      const v = map[p.gstTreatment]; if (v) setGstTreatment(v);
    }
  });

  const result = useMemo(() => {
    const inputs: BorrowingInputs = {
      dealProfile: { assetCategory, assetSubtype, acquisitionPurpose: purpose, leaseStatus, state, proposedLoan: proposedLoan ? num(proposedLoan) : undefined },
      purchaserStructure: { purchaserType, borrowerEntityName: entityName, corporateTrustee: purchaserType.includes('Trust') ? 'yes' : 'notApplicable', guaranteesAvailable: guarantees, relatedPartyTenant: relatedPartyTenant === 'yes', gstRegistered, availableCashEquity: valueOrUndefined(availableEquity), sponsorLiquidity: valueOrUndefined(sponsorLiquidity), liquidityMultiplier: num(liquidityMult), existingBusinessDebts: num(businessDebt), existingBusinessEbitda: num(businessEbitda), existingRentPaid: num(currentRent), proposedRentPayable: num(proposedRent), smsfBalance: num(smsfBalance), smsfSpecialistReviewRequired: purchaserType === 'smsf' },
      propertyValuation: { purchasePrice: valueOrUndefined(purchasePrice), estimatedMarketValue: valueOrUndefined(estimatedValue), bankValuation: bankValue ? num(bankValue) : undefined, useConservativeValuation: conservativeValue === 'yes', landArea: valueOrUndefined(landArea), buildingArea: valueOrUndefined(buildingArea), lettableArea: valueOrUndefined(lettableArea), valuationConfidence, clearanceHeight: valueOrUndefined(clearance), rollerDoors: valueOrUndefined(rollerDoors), truckAccessQuality: truckAccess, powerCapacity, slabCondition, roofCondition },
      income: { grossPassingRent: valueOrUndefined(passingRent) ?? sourceNumber(selectedLinkedNoi), otherIncome: valueOrUndefined(otherIncome) ?? sourceNumber(linkedOtherIncome), recoveredOutgoings: valueOrUndefined(recoveries) ?? sourceNumber(linkedRecoveredOutgoings), marketRent: valueOrUndefined(marketRent) ?? sourceNumber(linkedMarketRent), vacancyAllowancePct: valueOrUndefined(vacancy) ?? sourceNumber(linkedVacancyAllowancePct), incentivesAdjustment: valueOrUndefined(incentives) ?? Number.NaN, tenantArrearsAdjustment: valueOrUndefined(arrearsAdj) ?? Number.NaN, nonRecoverableExpenses: valueOrUndefined(nonRecoverable) ?? Number.NaN, councilRates: valueOrUndefined(rates) ?? Number.NaN, water: valueOrUndefined(water) ?? Number.NaN, landTax: valueOrUndefined(landTax) ?? Number.NaN, insurance: valueOrUndefined(insurance) ?? Number.NaN, strataOwnersCorp: Number.NaN, managementFees: valueOrUndefined(management) ?? Number.NaN, repairsMaintenance: valueOrUndefined(repairs) ?? Number.NaN, utilities: Number.NaN, cleaning: Number.NaN, security: Number.NaN, otherExpenses: Number.NaN, wale: valueOrUndefined(wale) ?? Number.NaN, tenantCovenant, rentOverMarket, percentageAboveMarket: valueOrUndefined(aboveMarketPct), noiBasis },
      acquisitionCosts: { depositPaid: 0, stampDuty: num(stampDuty), transferRegistrationFee: num(transferRegistrationFee), mortgageRegistrationFee: num(mortgageRegistrationFee), pexaSettlementFee: num(pexaSettlementFee), legalConveyancingFee: num(legal), bankLegalFee: num(bankLegal), valuationFee: num(valuationFee), loanApplicationFee: 0, buyersAgentFee: 0, buildingInspection: 0, pestInspection: 0, structuralInspection: assetCategory === 'industrial' ? 5000 : 0, fireComplianceInspection: 2500, planningZoningReview: 2500, environmentalReport: num(environmentalCost), asbestosReport: num(asbestosCost), dueDiligence: num(dueDiligence), capexReserve: num(capexReserve), workingCapitalReserve: num(workingCapital), otherAcquisitionCosts: num(otherCosts) + num(autoEstimatedAcquisitionCosts), gstTreatment, gstAmount: 0, gstClaimable, gstCashflowRequired: gstCashflow, goingConcernConfirmed, landholderAcquisition, vicCommercialIndustrialPropertyTax: state === 'VIC' ? 'yes' : 'no', saQualifyingNonResidentialLand: state === 'SA' ? 'yes' : 'no' },
      lendingAssumptions: { profile, contractInterestRatePct: num(rate), assessmentBufferPct: num(buffer), assessmentFloorRatePct: num(floorRate), assessmentBasis, repaymentType: assessmentBasis === 'interestOnlyAssessment' ? 'interestOnly' : 'principalAndInterest', exitStrategy: 'unknown', loanTermYears: num(term), interestOnlyPeriodYears: num(ioPeriod), amortisationYears: num(amortisation), maxLvr: num(maxLvr), minIcr: num(minIcr), minDscr: num(minDscr), minDebtYield: num(minDebtYield), debtYieldEnabled: true },
      riskInputs: { tenantStrength, vacancyLevel, buildingCondition, zoningCertainty: zoning, leaseDocumentationComplete: leaseDocs, environmentalRisk, asbestosRisk, capexRequired, rentComparedToMarket: rentOverMarket === 'yes' ? 'materiallyOver' : 'belowOrAtMarket' },
    };
    return calculateCommercialIndustrialBorrowing(inputs);
  }, [assetCategory, assetSubtype, purpose, leaseStatus, state, proposedLoan, purchaserType, entityName, guarantees, gstRegistered, relatedPartyTenant, availableEquity, sponsorLiquidity, liquidityMult, businessDebt, businessEbitda, currentRent, proposedRent, smsfBalance, purchasePrice, estimatedValue, bankValue, conservativeValue, landArea, buildingArea, lettableArea, valuationConfidence, clearance, rollerDoors, truckAccess, powerCapacity, slabCondition, roofCondition, passingRent, otherIncome, recoveries, marketRent, vacancy, incentives, arrearsAdj, nonRecoverable, rates, water, landTax, insurance, management, repairs, wale, tenantCovenant, rentOverMarket, aboveMarketPct, noiBasis, stampDuty, legal, bankLegal, valuationFee, dueDiligence, environmentalCost, asbestosCost, capexReserve, workingCapital, otherCosts, autoEstimatedAcquisitionCosts, transferRegistrationFee, mortgageRegistrationFee, pexaSettlementFee, gstTreatment, gstCashflow, gstClaimable, goingConcernConfirmed, landholderAcquisition, profile, rate, buffer, floorRate, assessmentBasis, term, ioPeriod, amortisation, maxLvr, minIcr, minDscr, minDebtYield, tenantStrength, vacancyLevel, buildingCondition, zoning, leaseDocs, environmentalRisk, asbestosRisk, capexRequired, selectedLinkedNoi, linkedOtherIncome, linkedRecoveredOutgoings, linkedMarketRent, linkedVacancyAllowancePct]);


  const selectedClient = selectedClientProfile ?? blankClientProfile;
  const missingPropertyFields = useMemo(() => [
    ['Purchase price / property value', purchasePrice || estimatedValue],
    ['Annual rent / NOI input', passingRent || marketRent],
    ['Interest rate', rate],
    ['Loan term', term],
  ].filter(([, value]) => !hasValue(String(value))).map(([label]) => label), [purchasePrice, estimatedValue, passingRent, marketRent, rate, term]);
  const propertyInfoIncomplete = missingPropertyFields.length > 0;
  const readinessItems = useMemo(() => [
    { label: 'Purchase price or estimated market value', complete: hasValue(purchasePrice) || hasValue(estimatedValue) },
    { label: 'Proposed loan amount or target/max LVR', complete: hasValue(proposedLoan) || hasValue(maxLvr) },
    { label: 'NOI source value', complete: hasValue(passingRent) || hasValue(nonRecoverable) || Number.isFinite(Number(selectedLinkedNoi)) },
    { label: 'Contract interest rate', complete: hasValue(rate) },
    { label: 'Loan term years', complete: hasValue(term) },
    { label: 'Max LVR', complete: hasValue(maxLvr) },
    { label: 'Minimum ICR or Minimum DSCR', complete: hasValue(minIcr) || hasValue(minDscr) },
    { label: 'Lease status', complete: hasValue(leaseStatus) },
    { label: 'Purchaser type', complete: hasValue(purchaserType) },
  ], [purchasePrice, estimatedValue, proposedLoan, maxLvr, passingRent, nonRecoverable, selectedLinkedNoi, rate, term, minIcr, minDscr, leaseStatus, purchaserType]);
  const completedReadinessItems = readinessItems.filter(item => item.complete).length;
  const completenessPct = Math.round((completedReadinessItems / readinessItems.length) * 100);
  const assessmentReady = completedReadinessItems === readinessItems.length;
  const noRequiredInputsStarted = [purchasePrice || estimatedValue, passingRent || marketRent || nonRecoverable || (Number.isFinite(Number(selectedLinkedNoi)) ? String(selectedLinkedNoi) : ''), rate, term].every(value => !hasValue(String(value)));
  const missingRequiredInputs = readinessItems.filter(item => !item.complete).map(item => item.label);
  const readinessStatus = noRequiredInputsStarted ? 'Awaiting Inputs' : assessmentReady ? 'Calculated' : 'Preliminary Estimate';
  const readinessHelper = noRequiredInputsStarted
    ? 'Complete the required deal, income and lending fields to generate a borrowing estimate.'
    : assessmentReady
      ? result.proposedLoanSupportabilityMessage
      : 'This result is indicative and may change once valuation, lease, GST and borrower documents are confirmed.';
  const completenessStatus = noRequiredInputsStarted ? 'Awaiting Inputs' : assessmentReady ? 'Ready to Calculate' : 'Preliminary Estimate';
  const purchaseAbilityStatus = noRequiredInputsStarted ? 'Awaiting Inputs' : !assessmentReady ? 'Preliminary Estimate' : result.fundsToComplete.requiredEquity == null ? 'Review Required' : result.fundsToComplete.equitySurplusShortfall >= 0 ? 'Calculated' : 'Review Required';
  const validCalculatedResult = assessmentReady && Number.isFinite(result.finalRiskAdjustedLoan) && result.finalRiskAdjustedLoan > 0;
  const formatAdvancedMoney = (value: number | null | undefined) => assessmentReady && isUsableNumber(value) ? fmt(Number(value)) : 'Pending';
  const criticalExportFields = useMemo(() => [
    { label: 'Purchase price', complete: hasValue(purchasePrice) || hasValue(estimatedValue) },
    { label: 'NOI', complete: hasValue(passingRent) || hasValue(marketRent) || hasValue(nonRecoverable) },
    { label: 'Interest rate', complete: hasValue(rate) },
    { label: 'Loan term', complete: hasValue(term) },
    { label: 'Lender policy assumptions', complete: hasValue(maxLvr) && (hasValue(minIcr) || hasValue(minDscr)) && hasValue(profile) },
  ], [purchasePrice, estimatedValue, passingRent, marketRent, nonRecoverable, rate, term, maxLvr, minIcr, minDscr, profile]);
  const missingCriticalExportFields = criticalExportFields.filter(item => !item.complete).map(item => item.label);
  const exportBlocked = missingCriticalExportFields.length > 0 || !validCalculatedResult;
  const hasAssumptionsPresent = [gstTreatment === 'unknown', gstCashflow === 'unknown', leaseDocs !== 'yes', environmentalRisk === 'unknown', asbestosRisk === 'unknown', valuationConfidence !== 'high'].some(Boolean);
  const criticalDocumentNames = ['Contract of sale', 'Title search', 'Lease agreement', 'Rent ledger', 'Outgoings statement', 'Valuation', 'GST treatment confirmation', 'Purchaser entity documents', 'Company financials'];
  const missingCriticalDocuments = criticalDocumentNames.filter(name => {
    if (name === 'Contract of sale') return !hasValue(purchasePrice);
    if (name === 'Title search') return !(hasValue(estimatedValue) || hasValue(bankValue));
    if (name === 'Lease agreement' || name === 'Rent ledger') return leaseDocs !== 'yes';
    if (name === 'Outgoings statement') return !(hasValue(recoveries) || hasValue(rates) || hasValue(water) || hasValue(landTax) || hasValue(insurance));
    if (name === 'GST treatment confirmation') return gstTreatment === 'unknown';
    if (name === 'Valuation') return valuationConfidence !== 'high';
    if (name === 'Purchaser entity documents') return !hasValue(entityName) && purchaserType === 'company';
    if (name === 'Company financials') return showBusinessFields && !num(businessEbitda);
    return false;
  });
  const allRequiredDocumentsVerified = missingCriticalDocuments.length === 0;
  const exportReadinessStatus = noRequiredInputsStarted ? 'Awaiting Inputs' : exportBlocked ? 'Review Required' : allRequiredDocumentsVerified && !hasAssumptionsPresent ? 'Verified' : 'Ready to Calculate';
  const exportButtonDisabled = exportBlocked;
  const exportButtonLabel = exportBlocked ? 'Export Scenario Report' : hasAssumptionsPresent || !allRequiredDocumentsVerified ? 'Export Scenario Report (with assumptions)' : 'Export Scenario Report';
  const documentChecklistGroups = Object.entries(documentCategories).map(([category, configuredItems]) => ({
    category,
    items: configuredItems.filter(item => result.documentChecklist.includes(item) || criticalDocumentNames.includes(item)),
  })).filter(group => group.items.length > 0);
  const assumptionStatusRows = [
    { label: 'Purchase price / valuation', status: (hasValue(purchasePrice) || hasValue(estimatedValue)) ? (valuationConfidence === 'high' ? 'verified' : 'assumed') : 'missing', detail: valuationConfidence === 'high' ? 'Valuation confidence high' : 'Needs contract or valuation confirmation' },
    { label: 'NOI and lease income', status: (hasValue(passingRent) || hasValue(marketRent) || hasValue(nonRecoverable)) ? (leaseDocs === 'yes' ? 'verified' : 'assumed') : 'missing', detail: leaseDocs === 'yes' ? 'Lease documents verified' : 'Lease / rent ledger not verified' },
    { label: 'GST treatment', status: gstTreatment === 'unknown' ? 'missing' : gstCashflow === 'unknown' ? 'assumed' : 'verified', detail: title(gstTreatment) },
    { label: 'Lender policy', status: hasValue(rate) && hasValue(term) && hasValue(maxLvr) ? 'verified' : 'missing', detail: `${title(profile)} policy profile` },
    { label: 'Industrial environmental / asbestos', status: assetCategory === 'industrial' ? (environmentalRisk === 'unknown' || asbestosRisk === 'unknown' ? 'assumed' : 'verified') : 'na', detail: assetCategory === 'industrial' ? 'Industrial due diligence status' : 'Not applicable to commercial asset' },
  ] as Array<{ label: string; status: 'verified' | 'assumed' | 'missing' | 'na'; detail: string }>;
  const missingInformationGroups = useMemo(() => ({
    Financial: [!hasValue(availableEquity) && 'Available cash / equity', showBusinessFields && !hasValue(businessEbitda) && 'Business EBITDA / NPBT'].filter(Boolean) as string[],
    Property: [!(hasValue(purchasePrice) || hasValue(estimatedValue)) && 'Purchase price or estimated market value', !hasValue(assetSubtype) && 'Asset subtype'].filter(Boolean) as string[],
    Lease: [!(hasValue(passingRent) || hasValue(marketRent) || hasValue(nonRecoverable)) && 'Gross passing rent, market rent or NOI input', leaseDocs !== 'yes' && 'Executed lease documents'].filter(Boolean) as string[],
    Lending: [!hasValue(rate) && 'Contract interest rate', !hasValue(term) && 'Loan term years', !hasValue(maxLvr) && 'Max LVR'].filter(Boolean) as string[],
    GST: [gstTreatment === 'unknown' && 'GST treatment', gstCashflow === 'unknown' && 'GST cashflow at settlement'].filter(Boolean) as string[],
    Documents: [...result.documentChecklist.slice(0, 3)],
  }), [availableEquity, businessEbitda, showBusinessFields, purchasePrice, estimatedValue, assetSubtype, passingRent, marketRent, nonRecoverable, leaseDocs, rate, term, maxLvr, gstTreatment, gstCashflow, result.documentChecklist]);
  const criticalMissingItems = Object.entries(missingInformationGroups).flatMap(([group, items]) => items.map(item => ({ group, item }))).slice(0, 5);
  const noiSourceMetrics = [
    { label: 'Actual NOI', value: assessmentReady ? formatAdvancedMoney(result.noi.actualNoi) : 'Pending' },
    { label: 'Stabilised NOI', value: assessmentReady ? formatAdvancedMoney(result.noi.stabilisedNoi) : 'Pending' },
    { label: 'Lender-adjusted NOI', value: assessmentReady ? formatAdvancedMoney(result.noi.lenderAdjustedNoi) : 'Pending' },
  ];
  const gstSourceMetrics = [
    { label: 'GST cashflow required', value: assessmentReady ? formatAdvancedMoney(result.fundsToComplete.gstCashflowRequirement) : 'Pending' },
    { label: 'GST economic cost', value: assessmentReady ? formatAdvancedMoney(result.fundsToComplete.gst.economicCost) : 'Pending' },
    { label: 'Net acquisition cost', value: assessmentReady ? formatAdvancedMoney(result.fundsToComplete.totalCostBase) : 'Pending' },
  ];
  const warningSummary = useMemo(() => {
    if (noRequiredInputsStarted) return [];
    const critical = missingRequiredInputs.map(w => ({ severity: 'Required', text: w }));
    const required = result.warnings.slice(0, 4).map(w => ({ severity: 'Required', text: w }));
    const recommended = result.documentChecklist.slice(0, 3).map(w => ({ severity: 'Recommended', text: w }));
    return [...critical, ...required, ...recommended].slice(0, 8);
  }, [noRequiredInputsStarted, missingRequiredInputs, result.warnings, result.documentChecklist]);
  const hasRequiredWarnings = warningSummary.some(w => w.severity === 'Required');
  const scenarioMinimumMissing = useMemo(() => [
    { label: 'Purchase price or estimated market value', complete: hasValue(purchasePrice) || hasValue(estimatedValue) },
    { label: 'Gross passing rent, market rent or NOI input', complete: hasValue(passingRent) || hasValue(marketRent) || hasValue(nonRecoverable) },
    { label: 'Contract interest rate', complete: hasValue(rate) },
    { label: 'Loan term years', complete: hasValue(term) },
    { label: 'Max LVR', complete: hasValue(maxLvr) },
  ].filter(item => !item.complete).map(item => item.label), [purchasePrice, estimatedValue, passingRent, marketRent, nonRecoverable, rate, term, maxLvr]);
  const scenarioMissingFields = (scenarioName: string) => {
    const missing = new Set(scenarioMinimumMissing);
    if (scenarioName === 'Conservative Valuation Case' && !(hasValue(bankValue) || hasValue(estimatedValue) || hasValue(purchasePrice))) {
      missing.add('Bank valuation, estimated market value or purchase price');
    }
    if (scenarioName === 'Higher Vacancy Case' && !(hasValue(vacancy) || hasValue(passingRent) || hasValue(marketRent) || hasValue(nonRecoverable))) {
      missing.add('Vacancy allowance or income / NOI input');
    }
    if (['Interest-Only Case', 'Principal-and-Interest Case'].includes(scenarioName) && !hasValue(amortisation) && !hasValue(term)) {
      missing.add('Loan term or amortisation years');
    }
    return Array.from(missing);
  };
  const scenarioInputsReady = scenarioMinimumMissing.length === 0;
  const scenarioExplanation = (constraint: string) => {
    if (constraint === 'lvr' || constraint === 'valuation') return 'Loan is capped by security value / LVR before income tests.';
    if (constraint === 'icr') return 'Loan is capped by interest coverage.';
    if (constraint === 'dscr') return 'Loan is capped by debt service coverage.';
    if (constraint === 'debtYield') return 'Loan is capped by lender debt-yield requirement.';
    if (constraint === 'fundsToComplete' || constraint === 'liquidity') return 'Purchase is limited by available funds to complete.';
    return 'Scenario result reflects the current lender policy and risk-adjusted borrowing settings.';
  };
  const scenarioCards: ScenarioCardModel[] = result.scenarios.map(s => {
    const missingFields = scenarioMissingFields(s.name);
    return { ...s, missingFields, ready: missingFields.length === 0 };
  });
  const recommendedScenario = scenarioCards.find(s => s.name === recommendedScenarioName) ?? scenarioCards[0];
  const renderScenarioMetrics = (scenario: ScenarioCardModel) => (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
      <MoneyRow label="Max loan" value={scenario.maxLoan} />
      <MoneyRow label="LVR" value={pct(scenario.impliedLvr)} />
      <MoneyRow label="ICR" value={`${scenario.icr.toFixed(2)}x`} />
      <MoneyRow label="DSCR" value={`${scenario.dscr.toFixed(2)}x`} />
      <MoneyRow label="Debt yield" value={pct(scenario.debtYield)} />
      <MoneyRow label="Required equity" value={scenario.requiredEquity} />
      <MoneyRow label="Equity surplus / shortfall" value={scenario.equitySurplusShortfall} />
      <MoneyRow label="Binding constraint" value={title(scenario.bindingConstraint)} />
      <MoneyRow label="Supportability status" value={scenario.proposedLoanSupportability} />
    </div>
  );
  const renderPendingScenario = (scenario: ScenarioCardModel) => (
    <>
      <div className="rounded border bg-muted/20 p-2 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Pending inputs</p>
        <p className="mt-1 font-medium text-foreground">Missing fields required for this scenario</p>
        <ul className="mt-1 space-y-1">
          {scenario.missingFields.map(item => <li key={item}>• {item}</li>)}
        </ul>
      </div>
      <Button size="sm" variant="outline" disabled>Run scenario</Button>
    </>
  );
  const missingPropertyMessage = 'Property-level information is incomplete. Add or import property details before relying on this calculation.';
  const portfolioImportToggles = useMemo(() => ({ residential: includeResidential, commercial: includeCommercial, industrial: includeIndustrial, shares: includeShares, cash: includeCash, businessFinancials: includeBusinessFinancials, liabilities: includeLiabilities, income: includeIncome, existingLoans: includeExistingLoans }), [includeResidential, includeCommercial, includeIndustrial, includeShares, includeCash, includeBusinessFinancials, includeLiabilities, includeIncome, includeExistingLoans]);
  const scenarioClient = useMemo(() => applyPortfolioImportToggles(selectedClient, portfolioImportToggles), [selectedClient, portfolioImportToggles]);
  const currentPortfolio = useMemo(() => summarizeClientPortfolio(scenarioClient), [scenarioClient]);
  const scenarioInputs: ProposedScenarioInputs = useMemo(() => ({
    scenarioName,
    scenarioType,
    status: scenarioStatus,
    purchasePrice: num(purchasePrice),
    proposedDebt: result.finalRiskAdjustedLoan,
    requiredEquity: result.fundsToComplete.requiredEquity,
    annualNoi: result.noi.actualNoi,
    annualDebtService: result.annualDebtService,
    annualCashflow: result.noi.actualNoi - result.annualDebtService,
    selectedProperty: assetSubtype || undefined,
    borrowingResult: result,
  }), [scenarioName, scenarioType, scenarioStatus, purchasePrice, result, assetSubtype]);
  const activeScenario = useMemo(() => buildClientScenario(scenarioClient, scenarioInputs), [scenarioClient, scenarioInputs]);
  const auditTrailRows = [
    { label: 'Created date', value: savedScenario?.createdAt ? new Date(savedScenario.createdAt).toLocaleString('en-AU') : 'Current session draft' },
    { label: 'Last updated date', value: savedScenario?.auditLog.length ? new Date(savedScenario.auditLog[savedScenario.auditLog.length - 1].timestamp).toLocaleString('en-AU') : new Date().toLocaleString('en-AU') },
    { label: 'User who changed assumptions', value: activeScenario.auditLog[activeScenario.auditLog.length - 1]?.user || 'Calculator user' },
    { label: 'Scenario save history', value: savedScenario ? `${savedScenario.status} saved${lastPersistedScenarioId ? ` (${lastPersistedScenarioId})` : ''}` : 'Not saved yet' },
    { label: 'Import history', value: profileImported ? `${selectedClient.clientName} portfolio imported` : 'No client profile import' },
    { label: 'Export history', value: syncMessage.toLowerCase().includes('downloaded') ? syncMessage : 'No export in this session' },
    { label: 'Calculation version', value: 'Commercial / Industrial Borrowing Capacity Unified v1' },
  ];
  const scenarioComparison = useMemo(() => comparePortfolioScenario(activeScenario.currentPositionSnapshot, activeScenario.resultingPosition), [activeScenario]);

  const conflictCount = countProfileImportConflicts({
    availableEquity, sponsorLiquidity, businessEbitda, businessDebt, currentRent, purchasePrice, estimatedValue, passingRent, marketRent, lettableArea, landArea, proposedLoan,
  });

  const importClientProfile = () => {
    if (!selectedClientId) { setSyncMessage('Select a client profile before importing a current portfolio.'); toast.error('Select a client profile first.'); return; }
    setPendingImportOpen(true);
  };
  const runPropertyOnly = () => {
    setAssessmentMode('propertyOnly');
    setProfileImported(false);
    if (propertyInfoIncomplete) { setSyncMessage(`${missingPropertyMessage} Missing: ${missingPropertyFields.join(', ')}.`); toast.warning('Required property-level data is missing.'); return; }
    setSyncMessage(`Property-only assessment run. Capacity ${fmt(result.finalRiskAdjustedLoan)} calculated without requiring a client profile.`);
    toast.success('Property-only borrowing capacity updated.');
  };
  const importLatestBorrowingCapacity = () => {
    if (!selectedClientId) { setSyncMessage('Select a client profile before importing latest borrowing capacity.'); toast.error('Select a client profile first.'); return; }
    if (!selectedClient.latestBorrowingCapacity) { setSyncMessage('No latest borrowing capacity assessment is available for this client profile.'); return; }
    setProposedLoan(String(Math.round(selectedClient.latestBorrowingCapacity)));
    setAssessmentMode('clientScenario');
    setProfileImported(true);
    setSyncMessage(`Imported latest borrowing capacity assessment (${fmt(selectedClient.latestBorrowingCapacity)}) as Client Profile Source into proposed loan.`);
  };
  const applyClientProfileImport = (mode: 'replace' | 'scenario') => {
    setAssessmentMode('clientScenario');
    if (includeCash && (mode === 'replace' || !availableEquity)) setAvailableEquity(String(currentPortfolio.availableLiquidity));
    if (includeCash && (mode === 'replace' || !sponsorLiquidity)) setSponsorLiquidity(String(scenarioClient.cashAndOffsets.cashBalance + scenarioClient.cashAndOffsets.offsetBalance));
    if (includeBusinessFinancials && scenarioClient.businessFinancials.ebitdaNpbt != null && (mode === 'replace' || !num(businessEbitda))) setBusinessEbitda(String(scenarioClient.businessFinancials.ebitdaNpbt));
    if (includeLiabilities && (mode === 'replace' || !num(businessDebt))) setBusinessDebt(String(scenarioClient.liabilities.businessLoans + scenarioClient.liabilities.equipmentFinance + scenarioClient.liabilities.vehicleFinance + scenarioClient.liabilities.creditCards + scenarioClient.liabilities.overdrafts));
    if (includeIncome && (mode === 'replace' || !num(currentRent))) setCurrentRent(String(scenarioClient.businessFinancials.existingRent));
    // Current portfolio import intentionally updates current-position/client values only.
    // Property-level transaction inputs remain blank unless a specific property record, manual input, scenario option, or accepted AI estimate supplies them.
    setProfileImported(true);
    setPendingImportOpen(false);
    setSyncMessage(mode === 'replace'
      ? `Replaced calculator inputs with ${selectedClient.clientName}'s portfolio using active toggles; imported values tagged Client Profile Source.`
      : `Created scenario override from ${selectedClient.clientName}'s portfolio using active toggles; imported values tagged Client Profile Source.`);
    toast.success('Current portfolio imported with active toggles.');
  };


  const saveScenario = async (status: ScenarioStatus) => {
    if (!scenarioName.trim()) { setSyncMessage('Scenario name is required before saving.'); toast.error('Enter a scenario name before saving.'); return; }
    if (propertyInfoIncomplete) { setSyncMessage(`${missingPropertyMessage} Scenario saved only after required fields are supplied. Missing: ${missingPropertyFields.join(', ')}.`); toast.warning('Complete property-level fields before saving a reliable scenario.'); return; }
    if (!selectedClientId) { setSyncMessage('Select a client profile before saving this scenario.'); toast.error('Select a client profile first.'); return; }
    const scenario = { ...activeScenario, status, auditLog: [...activeScenario.auditLog, { timestamp: new Date().toISOString(), user: 'Calculator user', action: `Scenario saved as ${status}`, source: 'Commercial / Industrial calculator', scenarioId: activeScenario.scenarioId }] };
    setScenarioStatus(status);
    setSavedScenario(scenario);
    setSyncMessage(`Saving scenario as ${status}...`);
    const saved = await persistClientScenario(scenario);
    if (!saved.ok) { setSyncMessage(`Scenario could not be persisted: ${saved.error}`); return; }
    setLastPersistedScenarioId(saved.id ?? scenario.scenarioId);
    if (status === 'Committed') {
      const committed = await persistCommittedScenarioAssessment({ ...scenario, scenarioId: saved.id ?? scenario.scenarioId, status: 'Committed', auditLog: [...scenario.auditLog, { timestamp: new Date().toISOString(), user: 'Calculator user', action: 'Scenario committed to client profile', source: 'Commit to Client Profile confirmation', scenarioId: saved.id ?? scenario.scenarioId }] });
      setSyncMessage(committed.ok ? 'Scenario committed to client profile and latest borrowing assessment saved.' : `Scenario saved, but commit assessment failed: ${committed.error}`);
    } else {
      setSyncMessage(`Scenario saved to client profile as ${status}.`);
    }
  };

  const exportScenarioReport = () => {
    if (exportBlocked) {
      setSyncMessage(exportBlockedReason);
      toast.error(exportBlockedReason);
      return;
    }
    try {
      const payload = buildScenarioReportPayload(activeScenario);
      const blob = new Blob([JSON.stringify({ ...payload, exportReadiness: { status: exportReadinessStatus, missingCriticalDocuments, missingCriticalExportFields, assumptionsPresent: hasAssumptionsPresent } }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safe = (scenarioName || 'commercial-bc-scenario').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      a.href = url; a.download = `${safe}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setSyncMessage(hasAssumptionsPresent ? 'Scenario report downloaded with assumption warnings recorded in export history.' : 'Scenario report downloaded and export history updated.');
      toast.success(hasAssumptionsPresent ? 'Scenario report downloaded with assumption warning.' : 'Scenario report downloaded.');
    } catch (err: any) {
      toast.error(`Export failed: ${err?.message || 'Unknown error'}`);
    }
  };

  const applyAIProposal = (proposal: CommercialScenarioProposal) => {
    const changed = applyCommercialScenarioProposal(proposal, {
      setPurchasePrice, setEstimatedValue, setProposedLoan, setAvailableEquity, setSponsorLiquidity,
      setBusinessEbitda, setBusinessDebt, setCurrentRent, setProposedRent,
      setPassingRent, setMarketRent, setVacancy, setRecoveries, setRates, setWater, setLandTax, setInsurance, setManagement, setRepairs,
      setRate, setBuffer, setTerm, setIoPeriod, setAmortisation,
      setMaxLvr, setMinIcr, setMinDscr, setMinDebtYield,
      applyProfile: (k: string) => applyProfile(k as LenderPolicyProfileKey),
      setGstTreatment, setLeaseStatus, setGuarantees, setRelatedPartyTenant, setScenarioType,
    });
    setScenarioName(proposal.name);
    setAssessmentMode('clientScenario');
    setSyncMessage(`AI scenario option selected and cascaded (${changed.length} field${changed.length === 1 ? '' : 's'}): ${changed.join(', ') || 'no recognised fields'}. Assumptions remain AI Estimate until verified.`);
  };


  const assumptionRows = [
    { field: 'Available equity', value: fmt(num(availableEquity)), status: profileImported ? 'Client Profile Source' : 'Manual Estimate', source: profileImported ? selectedClient.clientName : 'Calculator input', document: 'Bank statements / portfolio evidence' },
    { field: 'Business EBITDA / NPBT', value: num(businessEbitda) ? fmt(num(businessEbitda)) : 'Unknown', status: profileImported && num(businessEbitda) ? 'Client Profile Source' : 'Unknown', source: profileImported ? 'Client business financials' : 'Not provided', document: 'Business financial statements / tax returns' },
    { field: 'Existing liabilities', value: fmt(num(businessDebt)), status: profileImported ? 'Client Profile Source' : 'Manual Estimate', source: profileImported ? 'Client liabilities' : 'Calculator input', document: 'Loan statements / debt schedule' },
    { field: 'Purchase price', value: fmt(num(purchasePrice)), status: profileImported ? 'Overridden' : 'Manual Estimate', source: profileImported ? 'Scenario override' : 'Calculator input', document: 'Contract of sale' },
    { field: 'GST treatment', value: title(gstTreatment), status: gstTreatment === 'unknown' ? 'Specialist Review Required' : 'Manual Estimate', source: 'Calculator input', document: 'GST treatment confirmation' },
    { field: 'Lease documents', value: title(leaseDocs), status: leaseDocs === 'yes' ? 'Verified' : leaseDocs === 'unknown' ? 'Unknown' : 'Specialist Review Required', source: 'Calculator input', document: 'Lease agreement / rent ledger' },
  ];
  useEffect(() => { updateGlobal('clientScenarioOutputs', activeScenario as any); }, [activeScenario, updateGlobal]);

  const scenarioRows = useMemo(() => buildScenarioComparisonRows(currentPortfolio, scenarioComparison.proposed), [currentPortfolio, scenarioComparison.proposed]);
  const visibleScenarioRows = useMemo(() => scenarioRows.filter(row => showUnchangedMetrics || row.indicator !== 'neutral'), [scenarioRows, showUnchangedMetrics]);
  const formatScenarioValue = (value: any, kind?: string) => value == null || value === 'N/A' || value === 'NaN' || (typeof value === 'number' && !Number.isFinite(value)) ? 'Pending' : kind === 'pct' ? pct(value) : kind === 'ratio' ? `${Number(value).toFixed(2)}x` : kind === 'text' || kind === 'risk' ? title(String(value)) : fmt(Number(value));
  const formatAdvancedPct = (value: number | null | undefined) => assessmentReady && isUsableNumber(value) ? pct(Number(value)) : 'Pending';
  const formatAdvancedRatio = (value: number | null | undefined) => assessmentReady && isUsableNumber(value) ? `${Number(value).toFixed(2)}x` : 'Pending';
  const advancedMetricRows = [
    ['Security value used', formatAdvancedMoney(result.propertyValueUsedForLvr)],
    ['Valuation source', bankValue ? 'Bank valuation' : estimatedValue ? 'Estimated market value' : purchasePrice ? 'Purchase price' : 'Pending'],
    ['Valuation date', 'Pending'],
    ['Commercial lease risk overlay', title(result.riskRating)],
    ['Asset-specific risk notes', result.secondaryRisks[0] ?? 'Pending'],
    ['Lender policy risk notes', result.primaryReason || 'Pending'],
  ];


  useEffect(() => {
    if (!globalInputSync) return;
    updateGlobal('dealProfile', { assetCategory, assetSubtype, acquisitionPurpose: purpose, leaseStatus, state, proposedLoan: proposedLoan ? num(proposedLoan) : undefined });
    updateGlobal('purchaserStructure', { purchaserType, borrowerEntityName: entityName, guaranteesAvailable: guarantees, relatedPartyTenant: relatedPartyTenant === 'yes', gstRegistered, availableCashEquity: valueOrUndefined(availableEquity), sponsorLiquidity: valueOrUndefined(sponsorLiquidity), liquidityMultiplier: num(liquidityMult), existingBusinessDebts: num(businessDebt), existingBusinessEbitda: num(businessEbitda), existingRentPaid: num(currentRent), proposedRentPayable: num(proposedRent) });
    updateGlobal('propertyValuation', { purchasePrice: valueOrUndefined(purchasePrice), estimatedMarketValue: valueOrUndefined(estimatedValue), bankValuation: bankValue ? num(bankValue) : undefined, useConservativeValuation: conservativeValue === 'yes', landArea: valueOrUndefined(landArea), buildingArea: valueOrUndefined(buildingArea), lettableArea: valueOrUndefined(lettableArea), valuationConfidence, clearanceHeight: valueOrUndefined(clearance), rollerDoors: valueOrUndefined(rollerDoors), truckAccessQuality: truckAccess, powerCapacity, slabCondition, roofCondition, siteCoverageRatio: num(landArea) > 0 ? num(buildingArea) / num(landArea) : undefined });
    updateGlobal('leaseIncome', { grossPassingRent: valueOrUndefined(passingRent), otherIncome: num(otherIncome), recoveredOutgoings: valueOrUndefined(recoveries), marketRent: valueOrUndefined(marketRent), vacancyAllowancePct: valueOrUndefined(vacancy) });
    updateGlobal('lendingAssumptions', { profile, contractInterestRatePct: valueOrUndefined(rate), assessmentBufferPct: valueOrUndefined(buffer), assessmentFloorRatePct: num(floorRate), loanTermYears: valueOrUndefined(term), interestOnlyPeriodYears: num(ioPeriod), amortisationYears: valueOrUndefined(amortisation), maxLvr: num(maxLvr), minIcr: num(minIcr), minDscr: num(minDscr), minDebtYield: num(minDebtYield), debtYieldEnabled: true });
    updateGlobal('acquisitionCosts', { stampDuty: valueOrUndefined(stampDuty), transferRegistrationFee: valueOrUndefined(transferRegistrationFee), mortgageRegistrationFee: valueOrUndefined(mortgageRegistrationFee), pexaSettlementFee: valueOrUndefined(pexaSettlementFee), legalConveyancingFee: valueOrUndefined(legal), bankLegalFee: valueOrUndefined(bankLegal), valuationFee: valueOrUndefined(valuationFee), dueDiligence: valueOrUndefined(dueDiligence), capexReserve: valueOrUndefined(capexReserve), workingCapitalReserve: valueOrUndefined(workingCapital), otherAcquisitionCosts: num(otherCosts) + num(autoEstimatedAcquisitionCosts), gstTreatment });
    updateGlobal('fundsToComplete', result.fundsToComplete);
    updateGlobal('borrowingOutputs', result);
    updateGlobal('industrialMetrics', { netRentPerSqm: num(lettableArea) ? num(passingRent) / num(lettableArea) : undefined, grossRentPerSqm: num(lettableArea) ? (num(passingRent) + num(recoveries)) / num(lettableArea) : undefined, siteCover: num(landArea) ? num(buildingArea) / num(landArea) : undefined, gla: valueOrUndefined(lettableArea), siteArea: valueOrUndefined(landArea) });
  }, [updateGlobal, result, assetCategory, assetSubtype, purpose, leaseStatus, state, proposedLoan, purchaserType, entityName, guarantees, relatedPartyTenant, gstRegistered, availableEquity, sponsorLiquidity, liquidityMult, businessDebt, businessEbitda, currentRent, proposedRent, purchasePrice, estimatedValue, bankValue, conservativeValue, landArea, buildingArea, lettableArea, valuationConfidence, clearance, rollerDoors, truckAccess, powerCapacity, slabCondition, roofCondition, passingRent, otherIncome, recoveries, marketRent, vacancy, profile, rate, buffer, floorRate, term, ioPeriod, amortisation, maxLvr, minIcr, minDscr, minDebtYield, stampDuty, transferRegistrationFee, mortgageRegistrationFee, pexaSettlementFee, legal, bankLegal, valuationFee, dueDiligence, capexReserve, workingCapital, otherCosts, autoEstimatedAcquisitionCosts, gstTreatment, globalInputSync]);

  const applyProfile = (next: LenderPolicyProfileKey) => {
    setProfile(next);
    const p = lenderPolicyProfiles[next];
    setMaxLvr(String(p.maxLvr)); setMinIcr(String(p.minIcr)); setMinDscr(String(p.minDscr)); setBuffer(String(p.assessmentBufferPct)); setFloorRate(String(p.assessmentFloorRatePct ?? 0)); setAssessmentBasis(p.assessmentBasis ?? 'contractPlusBuffer'); setMinDebtYield(String(p.minDebtYield));
    if (next === 'smsfCommercial') setPurchaserType('smsf');
  };

  return (
    <Card className="bg-card/95">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">{assetCategory === 'industrial' ? <Factory className="h-5 w-5 text-primary" /> : <Building2 className="h-5 w-5 text-primary" />} Borrowing Capacity</CardTitle>
            <CardDescription>Shared lending engine with commercial and industrial profiles, funds-to-complete, risk overlays, commentary and document checklist.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="px-3 py-1 text-sm" onClick={() => { setGlobalInputSync(v => !v); setSyncMessage(globalInputSync ? 'Global Input Sync: Off. Shared deal inputs will not overwrite scenario values.' : 'Global Input Sync: On. Shared commercial/industrial deal inputs are synced without clearing scenario values.'); }}>{globalInputSync ? buildGlobalSyncLabel(sourceMode) : 'Global Input Sync: Off'}</Button><Badge variant={badgeVariant(result.riskRating) as any} className="px-3 py-1 text-sm">{title(result.riskRating)}</Badge>
            <Sheet><SheetTrigger asChild><Button size="sm" variant="outline">Assumption Status</Button></SheetTrigger><SheetContent className="w-full sm:max-w-3xl overflow-y-auto"><SheetHeader><SheetTitle>Assumption Status Drawer</SheetTitle><SheetDescription>Review source, status and verification requirements without cluttering each input.</SheetDescription></SheetHeader><div className="mt-4 space-y-3">{assumptionRows.map(row => <div key={row.field} className="rounded-md border bg-muted/20 p-3 text-sm"><div className="flex items-center justify-between gap-3"><div className="font-medium">{row.field}</div><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><StatusIcon status={row.status} />{row.status}</div></div><div className="mt-2 grid sm:grid-cols-2 gap-2 text-xs text-muted-foreground"><div>Current value: <span className="text-foreground">{row.value}</span></div><div>Source: <span className="text-foreground">{row.source}</span></div><div>Last updated: <span className="text-foreground">Current session</span></div><div>Updated by: <span className="text-foreground">Calculator user</span></div><div>Verification required: <span className="text-foreground">{row.status === 'Verified' ? 'No' : 'Yes'}</span></div><div>Required document: <span className="text-foreground">{row.document}</span></div></div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setSyncMessage(`${row.field}: AI estimate queued for review; value will not update until accepted.`)}>Estimate with AI</Button><Button size="sm" variant="outline" onClick={() => setSyncMessage(`${row.field}: marked verified for this scenario audit trail.`)}>Mark as verified</Button><Button size="sm" variant="outline" onClick={() => setSyncMessage(`${row.field}: manual replacement mode selected.`)}>Replace manual value</Button><Button size="sm" variant="outline" onClick={() => applyClientProfileImport('scenario')}>Revert to client profile</Button><Button size="sm" variant="ghost" onClick={() => setSyncMessage(`${row.field} source: ${row.source}; required document: ${row.document}.`)}>View source</Button></div></div>)}</div></SheetContent></Sheet>
            <SaveBackButton build={() => ({
              purchase_price: valueOrUndefined(purchasePrice),
              valuation: valueOrUndefined(estimatedValue),
              gfa_sqm: valueOrUndefined(buildingArea),
              nla_sqm: valueOrUndefined(lettableArea),
              site_area_sqm: valueOrUndefined(landArea),
              state: state,
              asset_class: assetCategory === 'industrial' ? 'industrial' : undefined,
              industrial_specs: assetCategory === 'industrial' ? {
                clearance_metres: valueOrUndefined(clearance),
                dock_doors: valueOrUndefined(rollerDoors),
              } : undefined,
            })} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 h-auto">
            <TabsTrigger value="quick">Quick Assessment</TabsTrigger>
            <TabsTrigger value="advanced">Advanced Analysis</TabsTrigger>
            <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
            <TabsTrigger value="audit">Documents & Audit</TabsTrigger>
          </TabsList>
          <TabsContent value="quick" className="mt-0">
            <div className="grid xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] gap-8">
              <div className="order-2 xl:order-1 space-y-6">
                <Card className="border-primary/20 bg-background/60"><CardContent className="pt-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-muted-foreground">Data completeness</p><p className="text-xl font-semibold">{completenessStatus}</p></div><Badge variant={assessmentReady ? 'default' : completedReadinessItems ? 'secondary' : 'outline'}>{completenessPct}% complete</Badge></div><Progress value={completenessPct} />{!assessmentReady && <p className="text-xs text-muted-foreground">Missing: {missingRequiredInputs.join(', ')}.</p>}</CardContent></Card><Card className="border-brand-500/30 bg-brand-500/5"><CardHeader className="pb-2"><CardTitle className="text-base">Missing Information</CardTitle><CardDescription>Critical items needed before a final borrowing estimate can be relied on.</CardDescription></CardHeader><CardContent className="space-y-2 text-xs">{criticalMissingItems.length ? criticalMissingItems.map(({ group, item }) => <div key={`${group}-${item}`} className="flex items-center justify-between gap-2 rounded border bg-background/50 px-2 py-1"><span>{item}</span><Badge variant="outline">{group}</Badge></div>) : <p className="text-muted-foreground">No critical missing items identified.</p>}<button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setSyncMessage('Open document checklist to view all missing items grouped by Financial, Property, Lease, Lending, GST and Documents.')}>View all warnings</button></CardContent></Card><Card className="border-primary/20 bg-background/60"><CardContent className="pt-4 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">Need deeper underwriting controls?</p><p className="text-xs text-muted-foreground">For lender policy, GST, detailed NOI, business servicing and full underwriting assumptions.</p></div><Button variant="outline" onClick={() => setActiveTab('advanced')}>Open Advanced Analysis</Button></CardContent></Card>
          <Card className="hidden border-primary/20 bg-primary/5"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base flex items-center gap-2"><UserRound className="h-4 w-4 text-primary" /> Client Profile Integration</CardTitle><CardDescription>Import a verified client portfolio, run property-only or client-profile scenario assessment, and save scenario outcomes without overwriting verified client data.</CardDescription></div><Badge variant={assessmentMode === 'clientScenario' ? 'default' : 'outline'}>{assessmentMode === 'clientScenario' ? 'Client-profile scenario assessment' : 'Property-only assessment'}</Badge></div></CardHeader><CardContent className="space-y-4"><div className="grid md:grid-cols-3 gap-3"><div><Label className="flex items-center gap-1.5">Select client profile<StatusIcon status="Client Profile Source" /></Label><ClientProfileCombobox value={selectedClientId} options={clientOptions} loading={clientLoading} onChange={setSelectedClientId} /></div><SelectField label="Scenario type" value={scenarioType} onChange={setScenarioType} status="Overridden" options={['Acquire Commercial Asset','Acquire Industrial Asset','Owner-Occupied Business Premises','Related-Party Lease Structure','Sell Existing Asset','Refinance Existing Debt','Equity Release','Debt Restructure','Cash Injection','Interest Rate Stress','Vacancy / Rent Stress','Capex Shock','Multi-Asset Strategy'].map(v => ({ value: v, label: v }))} /><div><Label>Scenario name</Label><Input value={scenarioName} onChange={e => setScenarioName(e.target.value)} /></div></div><div className="flex flex-wrap gap-2"><Button size="sm" onClick={importClientProfile} disabled={clientLoading}>{clientLoading ? 'Loading profile...' : 'Import current portfolio'}</Button><Button size="sm" variant="outline" onClick={importLatestBorrowingCapacity} disabled={!includeLatestBorrowingCapacity}>Import latest borrowing capacity assessment</Button><Button size="sm" variant="outline" onClick={runPropertyOnly}>Run property-only</Button><Button size="sm" variant="outline" onClick={() => saveScenario('Draft')}>Save Scenario</Button><Button size="sm" variant="outline" onClick={() => saveScenario('Recommended')}>Mark Recommended</Button><Button size="sm" variant="outline" onClick={() => setCommitConfirmOpen(true)}>Commit to Client Profile</Button><Button size="sm" variant="outline" onClick={exportScenarioReport} disabled={exportButtonDisabled}>{exportButtonLabel}</Button></div><div className="rounded-md border border-primary/20 bg-background/40 p-2 text-xs text-muted-foreground">{syncMessage}{lastPersistedScenarioId ? ` Persisted scenario ID: ${lastPersistedScenarioId}.` : ''}</div>{savedScenario && <div className="rounded-md border border-success/30 bg-success/10 p-2 text-xs text-success">Scenario saved as {savedScenario.status}. Current profile data is not overwritten unless committed.</div>}<div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Metric</TableHead><TableHead className="text-right">Current Position</TableHead><TableHead className="text-right">Proposed Scenario</TableHead><TableHead className="text-right">Difference</TableHead><TableHead className="text-right">Movement</TableHead></TableRow></TableHeader><TableBody>{scenarioRows.map(row => <TableRow key={row.key}><TableCell>{row.label}</TableCell><TableCell className="text-right">{formatScenarioValue(row.current, row.kind)}</TableCell><TableCell className="text-right">{formatScenarioValue(row.proposed, row.kind)}</TableCell><TableCell className="text-right">{formatScenarioValue(row.difference, row.kind)}</TableCell><TableCell className="text-right"><Badge variant={row.indicator === 'improves' ? 'default' : row.indicator === 'weakens' ? 'destructive' : 'outline'}>{row.indicator}</Badge></TableCell></TableRow>)}</TableBody></Table></div><div className="grid md:grid-cols-4 gap-2 text-xs"><div className="rounded border bg-muted/20 p-2">Borrowing capacity movement: <span className="font-medium text-primary">{fmt(scenarioComparison.difference.borrowingCapacity)}</span></div><div className="rounded border bg-muted/20 p-2">New limiting factor: <span className="font-medium">{scenarioComparison.proposed.keyConstraint}</span></div><div className="rounded border bg-muted/20 p-2">Portfolio risk: <Badge variant={badgeVariant(scenarioComparison.proposed.riskRating) as any}>{title(scenarioComparison.proposed.riskRating)}</Badge></div><div className="rounded border bg-muted/20 p-2">Asset-level risk: <span className="font-medium">{title(result.riskRating)}</span></div><div className="rounded border bg-muted/20 p-2">Liquidity impact: <span className="font-medium">{scenarioComparison.proposed.postSettlementLiquidity < 0 ? 'Pending' : fmt(scenarioComparison.proposed.postSettlementLiquidity)}</span></div><div className="rounded border bg-muted/20 p-2">Debt-service impact: <span className="font-medium">{fmt(scenarioComparison.difference.annualDebtService)}</span></div><div className="rounded border bg-muted/20 p-2">Reliability: <span className="font-medium">{activeScenario.proposedChanges.reliability as string}</span></div><div className="rounded border bg-muted/20 p-2">Audit trail: <span className="font-medium">{activeScenario.auditLog.length} event(s)</span></div></div></CardContent></Card>

          <CommercialBCScenarioAgent
            clientId={selectedClientId}
            snapshot={{
              assetCategory, assetSubtype, state, purpose, leaseStatus,
              purchasePrice: valueOrUndefined(purchasePrice),
              estimatedValue: valueOrUndefined(estimatedValue),
              proposedLoan: valueOrUndefined(proposedLoan),
              availableEquity: valueOrUndefined(availableEquity),
              sponsorLiquidity: valueOrUndefined(sponsorLiquidity),
              businessEbitda: valueOrUndefined(businessEbitda),
              businessDebt: valueOrUndefined(businessDebt),
              marketRent: valueOrUndefined(marketRent),
              vacancy: valueOrUndefined(vacancy),
              rate: valueOrUndefined(rate), buffer: valueOrUndefined(buffer), term: valueOrUndefined(term),
              maxLvr: num(maxLvr), minDscr: num(minDscr), minIcr: num(minIcr),
              profile, gstTreatment,
              riskRating: result.riskRating,
              borrowingCapacity: result.finalRiskAdjustedLoan,
              dscr: result.dscr, icr: result.icr,
              noi: result.noi.actualNoi,
              client: selectedClientId ? { id: selectedClientId, name: selectedClient.clientName } : undefined,
              missingPropertyWarning: propertyInfoIncomplete ? missingPropertyMessage : undefined,
              missingPropertyFields,
            }}
            onApply={applyAIProposal}
          />


          <AlertDialog open={commitConfirmOpen} onOpenChange={setCommitConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Commit scenario to client profile?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will save the scenario as Committed and push a latest borrowing assessment to the selected client profile. Verified values are not silently overwritten; scenario values are stored with an audit log.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => { setCommitConfirmOpen(false); saveScenario('Committed'); }}>Commit to Client Profile</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={pendingImportOpen} onOpenChange={setPendingImportOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Import client profile values?</AlertDialogTitle>
                <AlertDialogDescription>
                  {selectedClient.clientName} has current portfolio values available. Choose whether to replace current calculator values, keep them, or create a scenario override. {conflictCount} populated calculator field(s) may conflict with profile data. Verified client profile values are tagged as Client Profile Source and are not committed back to Current Position unless you commit the scenario.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                Import preview: available liquidity {fmt(currentPortfolio.availableLiquidity)}, business EBITDA {selectedClient.businessFinancials.ebitdaNpbt == null ? 'Pending' : fmt(selectedClient.businessFinancials.ebitdaNpbt)}, liabilities {fmt(selectedClient.liabilities.businessLoans + selectedClient.liabilities.equipmentFinance + selectedClient.liabilities.vehicleFinance + selectedClient.liabilities.creditCards + selectedClient.liabilities.overdrafts)}.
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep current values</AlertDialogCancel>
                <Button variant="outline" onClick={() => applyClientProfileImport('scenario')}>Create scenario override</Button>
                <AlertDialogAction onClick={() => applyClientProfileImport('replace')}>Replace calculator values</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

	          <Accordion type="multiple" defaultValue={['deal', 'property', 'income', 'assumptions', 'costs']} className="rounded-lg border bg-card/70 px-4 shadow-sm">
	            <AccordionItem value="deal"><AccordionTrigger>Transaction snapshot</AccordionTrigger><AccordionContent><WorkflowSection kicker="Step 01" title="Transaction snapshot" description="Capture the transaction shape, purchase price / valuation context and target loan before lender constraints are applied." /><div className="grid md:grid-cols-3 gap-3">
              <SelectField label="Asset category" value={assetCategory} onChange={(v) => { setAssetCategory(v); setAssetSubtype(v === 'industrial' ? 'Warehouse' : 'Office'); }} options={[{ value: 'commercial', label: 'Commercial Asset Borrowing Capacity' }, { value: 'industrial', label: 'Industrial Asset Borrowing Capacity' }]} />
              <SelectField label="Asset subtype" value={assetSubtype} onChange={setAssetSubtype} options={(assetCategory === 'commercial' ? commercialSubtypes : industrialSubtypes).map(s => ({ value: s, label: s }))} />
              <SelectField label="Acquisition purpose" value={purpose} onChange={setPurpose} options={[['investment', 'Arm’s-length investment'], ['ownerOccupied', 'Owner-occupied business premises'], ['relatedPartyLease', 'Related-party lease'], ['vacant', 'Vacant possession'], ['partiallyVacant', 'Partially vacant'], ['mixedUse', 'Mixed-use'], ['development', 'Development / repositioning']].map(([value, label]) => ({ value: value as AcquisitionPurpose, label }))} />
              <SelectField label="Lease status" value={leaseStatus} onChange={setLeaseStatus} options={[['fullyLeased', 'Fully leased'], ['partiallyLeased', 'Partially leased'], ['vacant', 'Vacant'], ['monthToMonth', 'Month-to-month'], ['relatedPartyLease', 'Related-party lease'], ['leasePending', 'Lease pending']].map(([value, label]) => ({ value: value as LeaseStatus, label }))} />
              <SelectField label="State / Territory" value={state} onChange={setState} options={['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map(s => ({ value: s as typeof state, label: s }))} />
              <Field label="Proposed loan amount (optional)" value={proposedLoan} onChange={setProposedLoan} />
            </div></AccordionContent></AccordionItem>

            <AccordionItem value="purchaser"><AccordionTrigger>Show advanced fields: Purchaser Structure</AccordionTrigger><AccordionContent className="grid md:grid-cols-3 gap-3">
              <SelectField label="Purchaser type" value={purchaserType} onChange={setPurchaserType} options={[['individual', 'Individual'], ['company', 'Company'], ['discretionaryTrust', 'Discretionary trust'], ['unitTrust', 'Unit trust'], ['smsf', 'SMSF'], ['holdingCompany', 'Holding company'], ['spv', 'SPV'], ['operatingBusiness', 'Operating business entity'], ['other', 'Other']].map(([value, label]) => ({ value: value as PurchaserStructure, label }))} />
              <div><Label>Borrower entity name</Label><Input value={entityName} onChange={e => setEntityName(e.target.value)} /></div>
              <SelectField label="Guarantees available?" value={guarantees} onChange={setGuarantees} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' }]} />
              <SelectField label="Related-party tenant?" value={relatedPartyTenant} onChange={setRelatedPartyTenant} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
              <SelectField label="GST registered?" value={gstRegistered} onChange={setGstRegistered} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' }]} />
              <Field label="Available cash / equity" value={availableEquity} onChange={setAvailableEquity} />
              <Field label="Sponsor liquidity" value={sponsorLiquidity} onChange={setSponsorLiquidity} />
              <Field label="Liquidity multiplier" value={liquidityMult} onChange={setLiquidityMult} step="0.5" />
              {showBusinessFields && <><Field label="Existing business debts" value={businessDebt} onChange={setBusinessDebt} /><Field label="Business EBITDA / NPBT" value={businessEbitda} onChange={setBusinessEbitda} /><Field label="Current business rent" value={currentRent} onChange={setCurrentRent} /><Field label="Proposed related-party rent" value={proposedRent} onChange={setProposedRent} /></>}
              {purchaserType === 'smsf' && <><Field label="SMSF balance" value={smsfBalance} onChange={setSmsfBalance} /><div className="md:col-span-2 rounded-md border border-brand-500/40 bg-brand-500/10 p-3 text-sm text-brand-200">SMSF / LRBA placeholder only — specialist review is required before relying on this output.</div></>}
            </AccordionContent></AccordionItem>

	            <AccordionItem value="property"><AccordionTrigger>Purchase price / valuation</AccordionTrigger><AccordionContent><WorkflowSection kicker="Step 02" title="Purchase price / valuation" description="Inputs remain editable assumptions; security value, LVR and maximum-loan outputs remain locked calculated fields." /><div className="grid md:grid-cols-3 gap-3">
              <Field label="Purchase price" value={purchasePrice} onChange={setPurchasePrice} /><Field label="Estimated market value" value={estimatedValue} onChange={setEstimatedValue} /><Field label="Bank valuation" value={bankValue} onChange={setBankValue} />
              <SelectField label="Use conservative valuation?" value={conservativeValue} onChange={setConservativeValue} options={[{ value: 'yes', label: 'Yes — lowest available' }, { value: 'no', label: 'No' }]} />
              <Field label="Land area sqm" value={landArea} onChange={setLandArea} /><Field label="Building area sqm" value={buildingArea} onChange={setBuildingArea} /><Field label="Lettable area sqm" value={lettableArea} onChange={setLettableArea} />
              <SelectField label="Valuation confidence" value={valuationConfidence} onChange={setValuationConfidence} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
              {assetCategory === 'industrial' && <><Field label="Clearance height m" value={clearance} onChange={setClearance} step="0.1" /><Field label="Roller doors" value={rollerDoors} onChange={setRollerDoors} /><SelectField label="Truck access" value={truckAccess} onChange={setTruckAccess} options={[{ value: 'poor', label: 'Poor' }, { value: 'average', label: 'Average' }, { value: 'good', label: 'Good' }, { value: 'excellent', label: 'Excellent' }]} /><SelectField label="Power capacity" value={powerCapacity} onChange={setPowerCapacity} options={[{ value: 'unknown', label: 'Unknown' }, { value: 'singlePhase', label: 'Single phase' }, { value: 'threePhase', label: '3 phase' }, { value: 'highCapacity', label: 'High capacity' }, { value: 'substationPresent', label: 'Substation present' }]} /><SelectField label="Slab condition" value={slabCondition} onChange={setSlabCondition} options={[{ value: 'unknown', label: 'Unknown' }, { value: 'good', label: 'Good' }, { value: 'average', label: 'Average' }, { value: 'poor', label: 'Poor' }]} /><SelectField label="Roof condition" value={roofCondition} onChange={setRoofCondition} options={[{ value: 'unknown', label: 'Unknown' }, { value: 'good', label: 'Good' }, { value: 'average', label: 'Average' }, { value: 'poor', label: 'Poor' }]} /></>}
	            </div></AccordionContent></AccordionItem>

	            <AccordionItem value="income"><AccordionTrigger>Serviceability constraints</AccordionTrigger><AccordionContent><WorkflowSection kicker="Step 03" title="ICR / DSCR serviceability" description="Linked NOI source values support the ICR, DSCR and annual debt-service tests without changing source-tab data." /><div className="grid md:grid-cols-3 gap-3"><SourceTabNotice title="NOI is sourced from the NOI tab" description="Borrowing Capacity consumes final NOI outputs only. Rent, recoveries, vacancy, expenses and lease data are primary inputs in the NOI tab." tab="noi" metrics={noiSourceMetrics} /></div></AccordionContent></AccordionItem>

	            <AccordionItem value="costs"><AccordionTrigger>Purchase ability & acquisition costs</AccordionTrigger><AccordionContent><WorkflowSection kicker="Step 04" title="Liquidity, months covered and funds to complete" description="Acquisition costs and liquidity inputs support purchase ability, equity surplus / shortfall and months-covered outputs." /><div className="grid md:grid-cols-3 gap-3">
              <Field label="Stamp duty estimate" value={stampDuty} onChange={setStampDuty} /><Field label="Legal / conveyancing" value={legal} onChange={setLegal} /><Field label="Bank legal fee" value={bankLegal} onChange={setBankLegal} />
              <Field label="Valuation fee" value={valuationFee} onChange={setValuationFee} /><Field label="Due diligence allowance" value={dueDiligence} onChange={setDueDiligence} /><Field label="Capex reserve" value={capexReserve} onChange={setCapexReserve} />
              <Field label="Working capital reserve" value={workingCapital} onChange={setWorkingCapital} /><Field label="Environmental report" value={environmentalCost} onChange={setEnvironmentalCost} /><Field label="Asbestos report" value={asbestosCost} onChange={setAsbestosCost} />
              <Field label="Transfer registration fee" value={transferRegistrationFee} onChange={setTransferRegistrationFee} />
              <Field label="Mortgage registration fee" value={mortgageRegistrationFee} onChange={setMortgageRegistrationFee} />
              <Field label="PEXA / settlement fee" value={pexaSettlementFee} onChange={setPexaSettlementFee} />
              <Field label="Other statutory fees" value={otherCosts} onChange={setOtherCosts} />
              <Field label="Auto-estimated acquisition costs" value={autoEstimatedAcquisitionCosts} onChange={setAutoEstimatedAcquisitionCosts} />
              <SourceTabNotice title="GST values are sourced from the GST tab" description="Borrowing Capacity consumes GST cashflow and economic cost for funds-to-complete. Contract GST clauses, purchaser GST registration and claimability are maintained in the GST tab." tab="gst" metrics={gstSourceMetrics} />
	            </div></AccordionContent></AccordionItem>

	            <AccordionItem value="assumptions"><AccordionTrigger>Lending assumptions</AccordionTrigger><AccordionContent><WorkflowSection kicker="Step 05" title="Lender policy assumptions" description="Set interest rate, assessment rate, loan term, LVR cap, ICR cap and debt-yield requirements used by the existing engine." /><div className="grid md:grid-cols-3 gap-3">
              <SelectField label="Lender policy profile" value={profile} onChange={applyProfile} options={[['conservativeBank', 'Conservative bank'], ['mainstreamCommercialBank', 'Mainstream commercial bank'], ['nonBankCommercial', 'Non-bank commercial lender'], ['privateCreditShortTerm', 'Private credit / short-term'], ['smsfCommercial', 'SMSF commercial lender'], ['ownerOccupiedBusinessLending', 'Owner-occupied business lending'], ['custom', 'Custom']].map(([value, label]) => ({ value: value as LenderPolicyProfileKey, label }))} />
              <Field label="Contract interest rate %" value={rate} onChange={setRate} step="0.05" /><Field label="Assessment buffer %" value={buffer} onChange={setBuffer} step="0.05" />
              <Field label="Assessment floor rate %" value={floorRate} onChange={setFloorRate} step="0.05" />
              <SelectField label="Assessment basis" value={assessmentBasis} onChange={setAssessmentBasis} options={[['contractPlusBuffer', 'Contract rate plus buffer'], ['higherOfBufferAndFloor', 'Higher of buffer and floor'], ['interestOnlyAssessment', 'Interest-only assessment'], ['principalAndInterestAssessment', 'Principal-and-interest assessment'], ['custom', 'Custom']].map(([value, label]) => ({ value, label }))} />
              <Field label="Loan term years" value={term} onChange={setTerm} /><Field label="Interest-only years" value={ioPeriod} onChange={setIoPeriod} /><Field label="Amortisation years" value={amortisation} onChange={setAmortisation} />
              <Field label="Max LVR (0–1)" value={maxLvr} onChange={setMaxLvr} step="0.01" /><Field label="Minimum ICR (x)" value={minIcr} onChange={setMinIcr} step="0.05" /><Field label="Minimum DSCR (x)" value={minDscr} onChange={setMinDscr} step="0.05" />
              <Field label="Minimum debt yield (0–1)" value={minDebtYield} onChange={setMinDebtYield} step="0.01" />
              <div className="md:col-span-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">{result.assessmentRateEngine.helpNote}</div>
            </div></AccordionContent></AccordionItem>

            <AccordionItem value="risk"><AccordionTrigger>Show advanced fields: {assetCategory === 'industrial' ? 'Industrial' : 'Commercial'} Risk Assessment</AccordionTrigger><AccordionContent className="grid md:grid-cols-3 gap-3">
              <SelectField label="Tenant strength" value={tenantStrength} onChange={setTenantStrength} options={[{ value: 'strong', label: 'Strong' }, { value: 'established', label: 'Established' }, { value: 'weak', label: 'Weak' }, { value: 'unknown', label: 'Unknown' }]} />
              <SelectField label="Vacancy level" value={vacancyLevel} onChange={setVacancyLevel} options={[{ value: 'none', label: 'None' }, { value: 'minor', label: 'Minor' }, { value: 'major', label: 'Major' }]} />
              <SelectField label="Building condition" value={buildingCondition} onChange={setBuildingCondition} options={[{ value: 'good', label: 'Good' }, { value: 'average', label: 'Average' }, { value: 'poor', label: 'Poor' }]} />
              <SelectField label="Zoning / permitted use" value={zoning} onChange={setZoning} options={[{ value: 'clear', label: 'Clear' }, { value: 'uncertain', label: 'Uncertain' }, { value: 'notPermitted', label: 'Not permitted' }]} />
              <SelectField label="Lease docs complete?" value={leaseDocs} onChange={setLeaseDocs} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' }]} />
              {assetCategory === 'industrial' && <><SelectField label="Environmental risk" value={environmentalRisk} onChange={setEnvironmentalRisk} options={[{ value: 'low', label: 'Low' }, { value: 'unknown', label: 'Unknown' }, { value: 'present', label: 'Present' }, { value: 'knownContamination', label: 'Known contamination' }]} /><SelectField label="Asbestos risk" value={asbestosRisk} onChange={setAsbestosRisk} options={[{ value: 'low', label: 'Low' }, { value: 'unknown', label: 'Unknown' }, { value: 'likely', label: 'Likely' }, { value: 'confirmed', label: 'Confirmed' }]} /><SelectField label="Capex required" value={capexRequired} onChange={setCapexRequired} options={[{ value: 'none', label: 'None' }, { value: 'some', label: 'Some' }, { value: 'heavy', label: 'Heavy' }]} /></>}
            </AccordionContent></AccordionItem>
          </Accordion>
        </div>

        <div className="order-1 xl:order-2 space-y-4">
	          <Card className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-card to-background shadow-lg"><CardHeader className="pb-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Maximum loan outcome</p><CardTitle className="text-base">Borrowing result dashboard</CardTitle><CardDescription>Prominent locked outputs for serviceability outcome, purchase ability and lender policy constraints.</CardDescription></div><div className="flex flex-wrap gap-2"><Badge variant={(assessmentReady ? badgeVariant(result.creditAssessmentStatus) : 'secondary') as any}>{readinessStatus}</Badge><Badge variant={(assessmentReady ? badgeVariant(result.overallStatus) : 'secondary') as any}>{purchaseAbilityStatus}</Badge></div></div></CardHeader><CardContent className="space-y-4">
	            <div className="grid gap-3 sm:grid-cols-2">
	              <OutcomeTile label="Maximum loan" value={assessmentReady ? fmt(result.finalRiskAdjustedLoan) : 'Pending'} helper={assessmentReady ? `Binding constraint: ${title(result.bindingConstraint)}` : readinessHelper} tone={assessmentReady ? 'success' : 'warning'} />
	              <OutcomeTile label="Serviceability outcome" value={assessmentReady ? result.creditAssessmentStatusLabel : readinessStatus} helper={assessmentReady ? result.proposedLoanSupportabilityMessage : 'Pending inputs remain governed by the existing readiness logic.'} tone={assessmentReady ? (result.creditAssessmentStatus === 'green' ? 'success' : result.creditAssessmentStatus === 'red' ? 'danger' : 'warning') : 'warning'} />
	            </div>
	            <Separator />
	            <p className="rounded-md border border-primary/20 bg-background/60 p-3 text-xs text-muted-foreground">{readinessHelper}{assessmentReady && proposedLoan ? ` Supportability gap: ${fmt(result.loanSupportabilityGap)}` : ""}</p>{propertyInfoIncomplete && <div className="rounded-md border border-brand-500/30 bg-brand-500/10 p-3 text-xs text-brand-100"><p className="font-medium">Warnings / missing data</p><p>{missingPropertyMessage} Missing: {missingPropertyFields.join(', ')}.</p></div>}<div className="grid gap-2 text-sm sm:grid-cols-2"><SafeMoneyRow label="Required equity" value={result.fundsToComplete.requiredEquity} ready={assessmentReady} /><SafeMoneyRow label="Available equity" value={num(availableEquity)} ready={assessmentReady} /><SafeMoneyRow label="Equity surplus / shortfall" value={result.fundsToComplete.equitySurplusShortfall} ready={assessmentReady} /><MoneyRow label="Final LVR used" value={safePct(result.baseRiskAdjustedCriteria.finalMaxLvrUsed, assessmentReady)} /><SafeMoneyRow label="Annual NOI" value={result.noi.actualNoi} ready={assessmentReady} /><SafeMoneyRow label="Annual debt service" value={result.annualDebtService} ready={assessmentReady} /><MoneyRow label="ICR" value={safeRatio(result.icr, assessmentReady)} /><MoneyRow label="DSCR" value={safeRatio(result.dscr, assessmentReady)} /><MoneyRow label="Debt yield" value={safePct(result.debtYield, assessmentReady)} /><MoneyRow label="Binding constraint" value={assessmentReady ? title(result.bindingConstraint) : 'Pending'} /><MoneyRow label="Recommended next action" value={assessmentReady ? result.requiredNextAction : 'Complete required inputs'} /></div>
	          </CardContent></Card>

	          <Accordion type="single" collapsible><AccordionItem value="breakdown"><AccordionTrigger>Lender constraints comparison</AccordionTrigger><AccordionContent><Card><CardHeader><CardTitle className="text-base">Maximum loan caps</CardTitle><CardDescription>LVR cap, ICR cap, DSCR cap and debt-yield cap are locked calculated outputs from the existing engine.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><div className="grid gap-2 sm:grid-cols-2"><MoneyRow label="LVR cap" value={result.componentCaps.lvrCap} /><MoneyRow label="ICR cap" value={result.componentCaps.icrCap} /><MoneyRow label="DSCR cap" value={result.componentCaps.dscrCap} /><MoneyRow label="Debt-yield cap" value={result.componentCaps.debtYieldCap} />{result.componentCaps.liquidityCap != null && <MoneyRow label="Liquidity cap" value={result.componentCaps.liquidityCap} />}</div><Separator /><MoneyRow label="Annual interest" value={assessmentReady ? result.annualInterest : 'Pending'} /><MoneyRow label="Annual debt service" value={assessmentReady ? result.annualDebtService : 'Pending'} /></CardContent></Card></AccordionContent></AccordionItem></Accordion>

          <Card className="hidden"><CardHeader><CardTitle className="text-base">Base vs Risk-Adjusted Lending Criteria</CardTitle></CardHeader><CardContent className="space-y-2 text-xs">
            <MoneyRow label="Base Max LVR" value={pct(result.baseRiskAdjustedCriteria.baseMaxLvr)} /><MoneyRow label="LVR risk adjustment" value={pct(result.baseRiskAdjustedCriteria.lvrRiskAdjustment)} /><MoneyRow label="Final Max LVR used" value={pct(result.baseRiskAdjustedCriteria.finalMaxLvrUsed)} />
            <MoneyRow label="Base Minimum ICR" value={`${result.baseRiskAdjustedCriteria.baseMinimumIcr.toFixed(2)}x`} /><MoneyRow label="ICR risk adjustment" value={`${result.baseRiskAdjustedCriteria.icrRiskAdjustment.toFixed(2)}x`} /><MoneyRow label="Final Minimum ICR used" value={`${result.baseRiskAdjustedCriteria.finalMinimumIcrUsed.toFixed(2)}x`} />
            <MoneyRow label="Base Minimum DSCR" value={`${result.baseRiskAdjustedCriteria.baseMinimumDscr.toFixed(2)}x`} /><MoneyRow label="DSCR risk adjustment" value={`${result.baseRiskAdjustedCriteria.dscrRiskAdjustment.toFixed(2)}x`} /><MoneyRow label="Final Minimum DSCR used" value={`${result.baseRiskAdjustedCriteria.finalMinimumDscrUsed.toFixed(2)}x`} />
            <MoneyRow label="Base Minimum Debt Yield" value={pct(result.baseRiskAdjustedCriteria.baseMinimumDebtYield)} /><MoneyRow label="Debt-yield risk adjustment" value={pct(result.baseRiskAdjustedCriteria.debtYieldRiskAdjustment)} /><MoneyRow label="Final Minimum Debt Yield used" value={pct(result.baseRiskAdjustedCriteria.finalMinimumDebtYieldUsed)} />
            <Separator /><MoneyRow label="Actual NOI" value={result.baseRiskAdjustedCriteria.actualNoi} /><MoneyRow label="Stabilised NOI" value={result.baseRiskAdjustedCriteria.stabilisedNoi} /><MoneyRow label="Lender-adjusted NOI" value={result.baseRiskAdjustedCriteria.lenderAdjustedNoi} /><MoneyRow label="NOI haircut amount" value={result.baseRiskAdjustedCriteria.noiHaircutAmount} /><MoneyRow label="NOI haircut percentage" value={pct(result.baseRiskAdjustedCriteria.noiHaircutPercentage)} /><Separator /><MoneyRow label="LVR adjustment driver" value={result.baseRiskAdjustedCriteria.lvrAdjustmentDriver ?? "Profile Default"} /><MoneyRow label="ICR adjustment driver" value={result.baseRiskAdjustedCriteria.icrAdjustmentDriver ?? "Profile Default"} /><MoneyRow label="DSCR adjustment driver" value={result.baseRiskAdjustedCriteria.dscrAdjustmentDriver ?? "Profile Default"} /><MoneyRow label="Debt-yield adjustment driver" value={result.baseRiskAdjustedCriteria.debtYieldAdjustmentDriver ?? "Profile Default"} /><MoneyRow label="NOI haircut driver" value={result.baseRiskAdjustedCriteria.noiHaircutDriver ?? "Profile Default"} />
          </CardContent></Card>

          <Card className="hidden"><CardHeader><CardTitle className="text-base">Business Servicing & Group Debt</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><MoneyRow label="Business status" value={title(result.businessServicing.status)} /><MoneyRow label="Business debt service available" value={result.businessServicing.businessDebtServiceAvailable} /><MoneyRow label="Business DSCR" value={`${result.businessServicing.businessDscr.toFixed(2)}x`} /><MoneyRow label="Combined property/business DSCR" value={`${result.businessServicing.combinedPropertyBusinessDscr.toFixed(2)}x`} /><Separator /><MoneyRow label="Total existing debt" value={result.groupDebt.totalExistingDebt} /><MoneyRow label="Total group debt after acquisition" value={result.groupDebt.totalGroupDebtAfterAcquisition} /><MoneyRow label="Debt to EBITDA" value={result.groupDebt.debtToEbitda == null ? "Pending — EBITDA not provided." : `${result.groupDebt.debtToEbitda.toFixed(2)}x`} /><MoneyRow label="Group DSCR" value={`${result.groupDebt.groupDscr.toFixed(2)}x`} /></CardContent></Card>

          <Card className="hidden"><CardHeader><CardTitle className="text-base">Covenant Pressure / Fix the Deal</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><MoneyRow label="Covenant pressure" value={title(result.covenantPressure.status)} /><MoneyRow label="LVR headroom" value={pct(result.covenantPressure.lvrHeadroom)} /><MoneyRow label="ICR headroom" value={`${result.covenantPressure.icrHeadroom.toFixed(2)}x`} /><MoneyRow label="DSCR headroom" value={`${result.covenantPressure.dscrHeadroom.toFixed(2)}x`} /><Separator /><MoneyRow label="Required NOI for proposed loan" value={result.reverseCalculators.requiredNoiForProposedLoan} /><MoneyRow label="Required equity" value={result.reverseCalculators.requiredEquityForCurrentPurchasePrice} /><MoneyRow label="Indicative equity gap / price-reduction equivalent" value={result.reverseCalculators.indicativeEquityGapPriceReductionEquivalent} /><MoneyRow label="Required purchase price to fit available equity" value={result.reverseCalculators.requiredPurchasePriceToFitAvailableEquity} /><MoneyRow label="Required rent increase" value={result.reverseCalculators.requiredRentIncrease} /></CardContent></Card>

          <Card className="hidden"><CardHeader><CardTitle className="text-base">Purchase Ability / Funds to Complete</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><MoneyRow label="Purchase price" value={fmtMaybe(purchasePrice)} /><MoneyRow label="Acquisition costs" value={result.fundsToComplete.totalAcquisitionCosts} /><MoneyRow label="GST settlement cashflow requirement" value={result.fundsToComplete.gstCashflowRequirement} /><MoneyRow label="GST economic cost" value={result.fundsToComplete.gst.economicCost} /><MoneyRow label="GST claimable amount" value={result.fundsToComplete.gst.claimableAmount} /><MoneyRow label="Total cost base" value={result.fundsToComplete.totalCostBase} emph /><MoneyRow label="Final loan" value={result.finalRiskAdjustedLoan} /><MoneyRow label="Required equity" value={result.fundsToComplete.requiredEquity} emph /><MoneyRow label="Available equity" value={num(availableEquity)} /><MoneyRow label="Equity surplus / shortfall" value={result.fundsToComplete.equitySurplusShortfall} emph /><MoneyRow label="Post-settlement liquidity" value={result.fundsToComplete.postSettlementLiquidity} /><MoneyRow label="Liquidity surplus / shortfall" value={result.fundsToComplete.liquiditySurplusShortfall} /><MoneyRow label="Months debt service covered" value={result.fundsToComplete.monthsDebtServiceCovered == null ? "Pending — equity shortfall exists before liquidity reserve can be assessed." : `${result.fundsToComplete.monthsDebtServiceCovered.toFixed(1)} months`} /><MoneyRow label="Months outgoings covered" value={result.fundsToComplete.monthsOutgoingsCovered == null ? "Pending — equity shortfall exists before liquidity reserve can be assessed." : `${result.fundsToComplete.monthsOutgoingsCovered.toFixed(1)} months`} /></CardContent></Card>

          <Card><CardHeader><CardTitle className="text-base">Risk Summary & Commentary</CardTitle><CardDescription>{assessmentReady ? result.primaryReason : readinessHelper}</CardDescription></CardHeader><CardContent className="space-y-3"><div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{Object.entries(result.commentarySections).map(([heading, text]) => text && assessmentReady ? <p key={heading}><span className="font-semibold text-foreground">{title(heading)}:</span> {text}</p> : null)}</div>{warningSummary.length > 0 && <div className="rounded-md border border-brand-500/30 bg-brand-500/10 p-3"><div className="flex items-center gap-2 text-sm font-medium text-brand-200"><AlertTriangle className="h-4 w-4" /> Warning summary</div><div className="mt-2 space-y-1 text-xs text-muted-foreground">{warningSummary.map((w, i) => <div key={`${w.severity}-${i}`} className="flex items-start gap-2"><Badge variant={severityVariant(w.severity) as any}>{w.severity}</Badge><span>{w.text}</span></div>)}</div></div>}<p className="text-sm font-medium">Next action: {assessmentReady ? result.requiredNextAction : 'Complete required inputs'}</p></CardContent></Card>

          <Card className="border-primary/20 bg-background/60"><CardContent className="pt-4 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">Documents and audit controls</p><p className="text-xs text-muted-foreground">Required documents, full warning log, assumption status, audit trail and export readiness are available in the dedicated tab.</p></div><Button variant="outline" onClick={() => setActiveTab('audit')}>Open document checklist</Button></CardContent></Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Recommended Scenario Summary</CardTitle>
                  <CardDescription>
                    {recommendedScenario?.ready ? `Preferred case: ${recommendedScenario.name}` : 'Scenario comparison is pending required inputs.'}
                  </CardDescription>
                </div>
                {recommendedScenario?.ready && <Badge>Recommended</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {recommendedScenario?.ready ? (
                <>
                  {renderScenarioMetrics(recommendedScenario)}
                  <p className="text-xs text-muted-foreground">
                    {scenarioExplanation(recommendedScenario.bindingConstraint)}
                  </p>
                </>
              ) : (
                <div className="rounded border bg-muted/20 p-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Pending inputs</p>
                  <p>Missing: {(recommendedScenario?.missingFields.length ? recommendedScenario.missingFields : scenarioMinimumMissing).join(', ')}.</p>
                </div>
              )}
              <Button size="sm" variant="outline" onClick={() => setActiveTab('scenarios')}>Compare scenarios</Button>
            </CardContent>
          </Card>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="advanced" className="mt-0 space-y-4">
            <Accordion type="multiple" className="rounded-lg border px-4">
              <AccordionItem value="portfolio"><AccordionTrigger>1. Portfolio Integration</AccordionTrigger><AccordionContent className="space-y-4">
                <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Current position vs proposed scenario. Neutral movement chips are hidden unless enabled.</p><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={showUnchangedMetrics} onChange={e => setShowUnchangedMetrics(e.target.checked)} />Show unchanged metrics</label></div>
                <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Metric</TableHead><TableHead className="text-right">Current Position</TableHead><TableHead className="text-right">Proposed Scenario</TableHead><TableHead className="text-right">Difference</TableHead><TableHead className="text-right">Movement</TableHead></TableRow></TableHeader><TableBody>{visibleScenarioRows.map(row => <TableRow key={row.key}><TableCell>{row.label}</TableCell><TableCell className="text-right">{formatScenarioValue(row.current, row.kind)}</TableCell><TableCell className="text-right">{formatScenarioValue(row.proposed, row.kind)}</TableCell><TableCell className="text-right">{formatScenarioValue(row.difference, row.kind)}</TableCell><TableCell className="text-right">{row.indicator === 'neutral' ? null : <Badge variant={row.indicator === 'improves' ? 'default' : 'destructive'}>{row.indicator}</Badge>}</TableCell></TableRow>)}</TableBody></Table></div>
                <div className="grid md:grid-cols-3 gap-2 text-xs"><MoneyRow label="Required equity" value={formatAdvancedMoney(result.fundsToComplete.requiredEquity)} /><MoneyRow label="Post-settlement liquidity" value={formatAdvancedMoney(result.fundsToComplete.postSettlementLiquidity)} /><MoneyRow label="Borrowing capacity" value={assessmentReady ? result.finalRiskAdjustedLoan : 'Pending'} /></div>
              </AccordionContent></AccordionItem>

              <AccordionItem value="valuation"><AccordionTrigger>2. Valuation & Security</AccordionTrigger><AccordionContent className="grid md:grid-cols-3 gap-3"><Field label="Bank valuation" value={bankValue} onChange={setBankValue} /><SelectField label="Use conservative valuation?" value={conservativeValue} onChange={setConservativeValue} options={[{ value: 'yes', label: 'Yes — lowest available' }, { value: 'no', label: 'No' }]} /><Field label="Land area sqm" value={landArea} onChange={setLandArea} /><Field label="Building area sqm" value={buildingArea} onChange={setBuildingArea} /><Field label="Lettable area sqm" value={lettableArea} onChange={setLettableArea} /><SelectField label="Valuation confidence" value={valuationConfidence} onChange={setValuationConfidence} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />{advancedMetricRows.slice(0, 3).map(([label, value]) => <MoneyRow key={label} label={label} value={value} />)}</AccordionContent></AccordionItem>

              <AccordionItem value="noi"><AccordionTrigger>3. NOI Source Values</AccordionTrigger><AccordionContent className="grid md:grid-cols-3 gap-3"><SourceTabNotice title="NOI build-up lives in the NOI tab" description="This advanced borrowing section shows the linked NOI outputs only. Edit rent, recoveries, vacancy, expenses and lease data in the NOI tab." tab="noi" metrics={noiSourceMetrics} /></AccordionContent></AccordionItem>

              <AccordionItem value="policy"><AccordionTrigger>4. Lending Policy</AccordionTrigger><AccordionContent className="grid md:grid-cols-3 gap-3"><Field label="Assessment floor rate %" value={floorRate} onChange={setFloorRate} step="0.05" /><SelectField label="Assessment basis" value={assessmentBasis} onChange={setAssessmentBasis} options={[["contractPlusBuffer", "Contract rate plus buffer"], ["higherOfBufferAndFloor", "Higher of buffer and floor"], ["interestOnlyAssessment", "Interest-only assessment"], ["principalAndInterestAssessment", "Principal-and-interest assessment"], ["custom", "Custom"]].map(([value, label]) => ({ value, label }))} /><Field label="Interest-only years" value={ioPeriod} onChange={setIoPeriod} /><Field label="Amortisation years" value={amortisation} onChange={setAmortisation} /><Field label="Minimum debt yield (0–1)" value={minDebtYield} onChange={setMinDebtYield} step="0.01" /><MoneyRow label="LVR risk adjustment" value={formatAdvancedPct(result.baseRiskAdjustedCriteria.lvrRiskAdjustment)} /><MoneyRow label="ICR risk adjustment" value={formatAdvancedRatio(result.baseRiskAdjustedCriteria.icrRiskAdjustment)} /><MoneyRow label="DSCR risk adjustment" value={formatAdvancedRatio(result.baseRiskAdjustedCriteria.dscrRiskAdjustment)} /><MoneyRow label="Debt yield risk adjustment" value={formatAdvancedPct(result.baseRiskAdjustedCriteria.debtYieldRiskAdjustment)} /><MoneyRow label="Final minimum ICR used" value={formatAdvancedRatio(result.baseRiskAdjustedCriteria.finalMinimumIcrUsed)} /><MoneyRow label="Final minimum DSCR used" value={formatAdvancedRatio(result.baseRiskAdjustedCriteria.finalMinimumDscrUsed)} /><MoneyRow label="Final debt yield used" value={formatAdvancedPct(result.baseRiskAdjustedCriteria.finalMinimumDebtYieldUsed)} /></AccordionContent></AccordionItem>

              <AccordionItem value="gst"><AccordionTrigger>5. GST Source Values</AccordionTrigger><AccordionContent className="grid md:grid-cols-3 gap-3"><SourceTabNotice title="GST treatment is sourced from the GST tab" description="Borrowing Capacity consumes GST treatment, settlement cashflow, claimability and GST economic cost. Contract GST clauses and purchaser GST registration are maintained in the GST calculator, not duplicated here." tab="gst" metrics={gstSourceMetrics} /></AccordionContent></AccordionItem>

              <AccordionItem value="business"><AccordionTrigger>6. Business Servicing & Group Debt</AccordionTrigger><AccordionContent className="grid md:grid-cols-3 gap-3"><MoneyRow label="Business status" value={assessmentReady ? title(result.businessServicing.status) : 'Pending'} /><Field label="Business EBITDA / NPBT" value={businessEbitda} onChange={setBusinessEbitda} /><Field label="Current business rent" value={currentRent} onChange={setCurrentRent} /><Field label="Proposed related-party rent" value={proposedRent} onChange={setProposedRent} /><Field label="Existing business debts" value={businessDebt} onChange={setBusinessDebt} /><Field label="Sponsor liquidity" value={sponsorLiquidity} onChange={setSponsorLiquidity} /><Field label="Liquidity multiplier" value={liquidityMult} onChange={setLiquidityMult} step="0.5" /><MoneyRow label="Business debt service available" value={formatAdvancedMoney(result.businessServicing.businessDebtServiceAvailable)} /><MoneyRow label="Business DSCR" value={formatAdvancedRatio(result.businessServicing.businessDscr)} /><MoneyRow label="Combined property/business DSCR" value={formatAdvancedRatio(result.businessServicing.combinedPropertyBusinessDscr)} /><MoneyRow label="Total group debt" value={formatAdvancedMoney(result.groupDebt.totalGroupDebtAfterAcquisition)} /><MoneyRow label="Debt to EBITDA" value={result.groupDebt.debtToEbitda == null ? 'Pending — EBITDA not provided.' : formatAdvancedRatio(result.groupDebt.debtToEbitda)} /><MoneyRow label="Group DSCR" value={formatAdvancedRatio(result.groupDebt.groupDscr)} /></AccordionContent></AccordionItem>

              <AccordionItem value="risk"><AccordionTrigger>7. Risk Overlay</AccordionTrigger><AccordionContent className="grid md:grid-cols-3 gap-3"><SelectField label="Tenant strength" value={tenantStrength} onChange={setTenantStrength} options={[{ value: 'strong', label: 'Strong' }, { value: 'established', label: 'Established' }, { value: 'weak', label: 'Weak' }, { value: 'unknown', label: 'Unknown' }]} /><SelectField label="Vacancy level" value={vacancyLevel} onChange={setVacancyLevel} options={[{ value: 'none', label: 'None' }, { value: 'minor', label: 'Minor' }, { value: 'major', label: 'Major' }]} /><SelectField label="Building condition" value={buildingCondition} onChange={setBuildingCondition} options={[{ value: 'good', label: 'Good' }, { value: 'average', label: 'Average' }, { value: 'poor', label: 'Poor' }]} /><SelectField label="Zoning / permitted use" value={zoning} onChange={setZoning} options={[{ value: 'clear', label: 'Clear' }, { value: 'uncertain', label: 'Uncertain' }, { value: 'notPermitted', label: 'Not permitted' }]} /><SelectField label="Lease docs complete?" value={leaseDocs} onChange={setLeaseDocs} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Unknown' }]} />{advancedMetricRows.slice(3).map(([label, value]) => <MoneyRow key={label} label={label} value={value} />)}</AccordionContent></AccordionItem>

              <AccordionItem value="output"><AccordionTrigger>8. Detailed Lending Output</AccordionTrigger><AccordionContent className="grid md:grid-cols-2 gap-3 text-sm"><MoneyRow label="LVR cap" value={formatAdvancedMoney(result.componentCaps.lvrCap)} /><MoneyRow label="ICR cap" value={formatAdvancedMoney(result.componentCaps.icrCap)} /><MoneyRow label="DSCR cap" value={formatAdvancedMoney(result.componentCaps.dscrCap)} /><MoneyRow label="Debt yield cap" value={formatAdvancedMoney(result.componentCaps.debtYieldCap)} /><MoneyRow label="Annual interest" value={formatAdvancedMoney(result.annualInterest)} /><MoneyRow label="Annual debt service" value={formatAdvancedMoney(result.annualDebtService)} /><MoneyRow label="Base Max LVR" value={formatAdvancedPct(result.baseRiskAdjustedCriteria.baseMaxLvr)} /><MoneyRow label="LVR risk adjustment" value={formatAdvancedPct(result.baseRiskAdjustedCriteria.lvrRiskAdjustment)} /><MoneyRow label="Final Max LVR used" value={formatAdvancedPct(result.baseRiskAdjustedCriteria.finalMaxLvrUsed)} /><MoneyRow label="Base Minimum ICR" value={formatAdvancedRatio(result.baseRiskAdjustedCriteria.baseMinimumIcr)} /><MoneyRow label="ICR risk adjustment" value={formatAdvancedRatio(result.baseRiskAdjustedCriteria.icrRiskAdjustment)} /><MoneyRow label="Final Minimum ICR used" value={formatAdvancedRatio(result.baseRiskAdjustedCriteria.finalMinimumIcrUsed)} /><MoneyRow label="Base Minimum DSCR" value={formatAdvancedRatio(result.baseRiskAdjustedCriteria.baseMinimumDscr)} /><MoneyRow label="DSCR risk adjustment" value={formatAdvancedRatio(result.baseRiskAdjustedCriteria.dscrRiskAdjustment)} /><MoneyRow label="Final Minimum DSCR used" value={formatAdvancedRatio(result.baseRiskAdjustedCriteria.finalMinimumDscrUsed)} /><MoneyRow label="Base Minimum Debt Yield" value={formatAdvancedPct(result.baseRiskAdjustedCriteria.baseMinimumDebtYield)} /><MoneyRow label="Debt-yield risk adjustment" value={formatAdvancedPct(result.baseRiskAdjustedCriteria.debtYieldRiskAdjustment)} /><MoneyRow label="Final Minimum Debt Yield used" value={formatAdvancedPct(result.baseRiskAdjustedCriteria.finalMinimumDebtYieldUsed)} /><MoneyRow label="Actual NOI" value={formatAdvancedMoney(result.baseRiskAdjustedCriteria.actualNoi)} /><MoneyRow label="Stabilised NOI" value={formatAdvancedMoney(result.baseRiskAdjustedCriteria.stabilisedNoi)} /><MoneyRow label="Lender-adjusted NOI" value={formatAdvancedMoney(result.baseRiskAdjustedCriteria.lenderAdjustedNoi)} /><MoneyRow label="NOI haircut amount" value={formatAdvancedMoney(result.baseRiskAdjustedCriteria.noiHaircutAmount)} /><MoneyRow label="NOI haircut percentage" value={formatAdvancedPct(result.baseRiskAdjustedCriteria.noiHaircutPercentage)} /><MoneyRow label="LVR adjustment driver" value={assessmentReady ? result.baseRiskAdjustedCriteria.lvrAdjustmentDriver ?? 'Profile Default' : 'Pending'} /><MoneyRow label="ICR adjustment driver" value={assessmentReady ? result.baseRiskAdjustedCriteria.icrAdjustmentDriver ?? 'Profile Default' : 'Pending'} /><MoneyRow label="DSCR adjustment driver" value={assessmentReady ? result.baseRiskAdjustedCriteria.dscrAdjustmentDriver ?? 'Profile Default' : 'Pending'} /><MoneyRow label="Debt-yield adjustment driver" value={assessmentReady ? result.baseRiskAdjustedCriteria.debtYieldAdjustmentDriver ?? 'Profile Default' : 'Pending'} /></AccordionContent></AccordionItem>
            </Accordion>
          </TabsContent>
          <TabsContent value="scenarios" className="mt-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Scenario Comparison Workspace</CardTitle>
                <CardDescription>
                  Compare lender, valuation, vacancy and rate cases without treating missing inputs as failed results.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!scenarioInputsReady && (
                  <div className="rounded-md border border-brand-500/30 bg-brand-500/10 p-3 text-sm text-brand-100">
                    <p className="font-medium">Pending inputs</p>
                    <p className="text-xs">Complete these fields before scenario results are run: {scenarioMinimumMissing.join(', ')}.</p>
                  </div>
                )}

                <div className="grid lg:grid-cols-2 gap-3">
                  {scenarioCards.map(scenario => (
                    <Card
                      key={scenario.name}
                      className={recommendedScenarioName === scenario.name ? 'border-primary/60 bg-primary/5' : 'bg-background/60'}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <CardTitle className="text-base">{scenario.name}</CardTitle>
                            <CardDescription>
                              {scenario.ready ? scenarioExplanation(scenario.bindingConstraint) : 'Pending inputs'}
                            </CardDescription>
                          </div>
                          {recommendedScenarioName === scenario.name && <Badge>Recommended</Badge>}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm">
                        {scenario.ready ? (
                          <>
                            {renderScenarioMetrics(scenario)}
                            <p className="text-xs text-muted-foreground">
                              {scenarioExplanation(scenario.bindingConstraint)}
                            </p>
                            <Button
                              size="sm"
                              variant={recommendedScenarioName === scenario.name ? 'default' : 'outline'}
                              onClick={() => setRecommendedScenarioName(scenario.name)}
                            >
                              {recommendedScenarioName === scenario.name ? 'Recommended' : 'Mark as recommended'}
                            </Button>
                          </>
                        ) : renderPendingScenario(scenario)}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scenario</TableHead>
                      <TableHead className="text-right">Max Loan</TableHead>
                      <TableHead className="text-right">Required Equity</TableHead>
                      <TableHead className="text-right">LVR</TableHead>
                      <TableHead className="text-right">ICR</TableHead>
                      <TableHead className="text-right">DSCR</TableHead>
                      <TableHead className="text-right">Debt Yield</TableHead>
                      <TableHead>Binding Constraint</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scenarioCards.map(scenario => (
                      <TableRow key={scenario.name}>
                        <TableCell className="font-medium">
                          {scenario.name}
                          {recommendedScenarioName === scenario.name && <Badge className="ml-2">Recommended</Badge>}
                        </TableCell>
                        <TableCell className="text-right">{scenario.ready ? fmt(scenario.maxLoan) : 'Pending inputs'}</TableCell>
                        <TableCell className="text-right">{scenario.ready ? fmt(scenario.requiredEquity) : 'Pending inputs'}</TableCell>
                        <TableCell className="text-right">{scenario.ready ? pct(scenario.impliedLvr) : 'Pending inputs'}</TableCell>
                        <TableCell className="text-right">{scenario.ready ? `${scenario.icr.toFixed(2)}x` : 'Pending inputs'}</TableCell>
                        <TableCell className="text-right">{scenario.ready ? `${scenario.dscr.toFixed(2)}x` : 'Pending inputs'}</TableCell>
                        <TableCell className="text-right">{scenario.ready ? pct(scenario.debtYield) : 'Pending inputs'}</TableCell>
                        <TableCell>{scenario.ready ? title(scenario.bindingConstraint) : 'Pending inputs'}</TableCell>
                        <TableCell>{scenario.ready ? scenario.proposedLoanSupportability : `Missing: ${scenario.missingFields.slice(0, 3).join(', ')}`}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="audit" className="mt-0 space-y-4">
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-primary" /> Export Readiness</CardTitle>
                <CardDescription>Report controls are kept here so the default calculator stays focused on inputs and borrowing results.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={exportBlocked ? 'destructive' : allRequiredDocumentsVerified && !hasAssumptionsPresent ? 'default' : 'secondary'}>{exportReadinessStatus}</Badge>
                  {exportBlocked && <Badge variant="destructive">Missing required fields</Badge>}
                  {missingCriticalDocuments.length > 0 && <Badge variant="secondary">Missing critical documents</Badge>}
                  {hasAssumptionsPresent && !exportBlocked && <Badge variant="outline">Export allowed with assumptions</Badge>}
                </div>
                {exportBlocked ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{exportBlockedReason}</p> : <p className="rounded-md border border-brand-500/30 bg-brand-500/10 p-3 text-xs text-brand-100">{allRequiredDocumentsVerified && !hasAssumptionsPresent ? 'Ready to export. Calculation is complete and required documents are verified.' : 'Export is allowed because the calculation is complete, but assumptions and document gaps will be disclosed in the report.'}</p>}
                <div className="grid md:grid-cols-3 gap-2 text-xs">
                  <MoneyRow label="Last calculated result" value={validCalculatedResult ? result.finalRiskAdjustedLoan : 'Pending'} />
                  <MoneyRow label="Missing required fields" value={missingCriticalExportFields.length ? missingCriticalExportFields.join(', ') : 'None'} />
                  <MoneyRow label="Missing critical documents" value={missingCriticalDocuments.length ? String(missingCriticalDocuments.length) : 'None'} />
                </div>
                <Button size="sm" onClick={exportScenarioReport} disabled={exportButtonDisabled}>{exportButtonLabel}</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Required Documents</CardTitle><CardDescription>Checklist grouped by category. Unverified items remain visible here instead of crowding the calculator view.</CardDescription></CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-3">
                {documentChecklistGroups.map(group => <div key={group.category} className="rounded-md border bg-muted/10 p-3"><p className="text-sm font-medium">{group.category}</p><div className="mt-2 space-y-1.5 text-xs text-muted-foreground">{group.items.map(item => {
                  const verified = item === 'Contract of sale' ? hasValue(purchasePrice) : item === 'Title search' ? hasValue(estimatedValue) || hasValue(bankValue) : item === 'Lease agreement' || item === 'Rent ledger' ? leaseDocs === 'yes' : item === 'Outgoings statement' ? hasValue(recoveries) || hasValue(rates) || hasValue(water) || hasValue(landTax) || hasValue(insurance) : item === 'GST treatment confirmation' ? gstTreatment !== 'unknown' : item === 'Valuation' ? valuationConfidence === 'high' : item === 'Purchaser entity documents' ? hasValue(entityName) || purchaserType !== 'company' : item === 'Company financials' ? !showBusinessFields || Boolean(num(businessEbitda)) : false;
                  return <label key={item} className="flex items-start gap-2"><input type="checkbox" checked={verified} readOnly className="mt-0.5" /><span>{item}</span></label>;
                })}</div></div>)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Warning Log</CardTitle><CardDescription>Full grouped warnings for underwriting review.</CardDescription></CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-3 text-xs text-muted-foreground">
                {Object.entries(warningLogLabels).map(([key, label]) => {
                  const items = (result.warningGroups as any)[key] || [];
                  return <div key={key} className="rounded-md border bg-muted/10 p-3"><p className="font-medium text-foreground">{label}</p>{items.length ? <ul className="mt-2 space-y-1">{items.map((w: string, i: number) => <li key={i}>• {w}</li>)}</ul> : <p className="mt-2">No warnings.</p>}</div>;
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Assumption Status</CardTitle><CardDescription>Green verified, amber assumed, red missing / unreliable, grey not applicable.</CardDescription></CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-3 text-xs">
                {assumptionStatusRows.map(row => <div key={row.label} className={cn('rounded-md border p-3', statusTone(row.status))}><div className="flex items-center justify-between gap-2"><span className="font-medium">{row.label}</span><span>{statusLabel(row.status)}</span></div><p className="mt-1 opacity-90">{row.detail}</p></div>)}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Audit Trail</CardTitle><CardDescription>Scenario events and calculation metadata for report governance.</CardDescription></CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="grid md:grid-cols-2 gap-2">{auditTrailRows.map(row => <div key={row.label} className="rounded border bg-muted/10 p-2"><span className="text-muted-foreground">{row.label}: </span><span className="font-medium">{row.value}</span></div>)}</div>
                <div className="rounded-md border bg-muted/10 p-3"><p className="font-medium text-sm">Scenario event history</p>{activeScenario.auditLog.length ? <ul className="mt-2 space-y-1 text-muted-foreground">{activeScenario.auditLog.map((event, index) => <li key={`${event.timestamp}-${index}`}>• {new Date(event.timestamp).toLocaleString('en-AU')} — {event.user}: {event.action} ({event.source})</li>)}</ul> : <p className="mt-2 text-muted-foreground">No scenario events recorded.</p>}</div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
