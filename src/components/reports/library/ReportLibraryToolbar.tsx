import { useState, type ReactNode } from 'react';
import {
  Archive,
  Building2,
  Calendar,
  ChevronDown,
  Compass,
  FileText,
  Calculator,
  Target,
  Filter,
  Globe,
  Grid2X2,
  Home,
  ListFilter,
  Map,
  SlidersHorizontal,
  Star,
  Table2,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ReportLibraryFilterChips, type ReportLibraryFilterChip } from './ReportLibraryFilterChips';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SearchInput } from '@/components/ui/search-input';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import type { InvestmentReport } from './types';

interface Props {
  isMobile: boolean;
  investmentSearchQuery: string;
  setInvestmentSearchQuery: (v: string) => void;
  setInvestmentPage: (v: number) => void;
  scopeFilter: string;
  setScopeFilter: (v: string) => void;
  gradeFilter: string;
  setGradeFilter: (v: string) => void;
  tierFilter: string;
  setTierFilter: (v: string) => void;
  sourceFilter: string;
  setSourceFilter: (v: string) => void;
  scoreRange: [number, number];
  setScoreRange: (v: [number, number]) => void;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  dateRange: string;
  setDateRange: (v: string) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
  dateRangeLabel: string;
  filteredCount: number;
  investmentReports: InvestmentReport[];
  getGradeColor: (grade: string) => string;
  viewMode: ReportLibraryViewMode;
  setViewMode: (mode: ReportLibraryViewMode) => void;
}

export type ReportLibraryViewMode = 'cards' | 'table';

const scopeOptions = [
  { value: 'all', label: 'All Reports', icon: ListFilter },
  { value: 'address', label: 'Property Analysis', icon: Home },
  { value: 'suburb', label: 'Suburb Analysis', icon: Building2 },
  { value: 'zipcode', label: 'Postcode Analysis', icon: Map },
  { value: 'state', label: 'State Analysis', icon: Globe },
];

// Canonical values are retained internally; labels intentionally never expose legacy codes.
const tierOptions = [
  { value: 'all', label: 'All Tiers', icon: ListFilter },
  { value: 'compass', label: 'Compass', icon: Compass, iconClassName: 'text-chart-5' },
  { value: 'financial', label: 'Financial', icon: Calculator, iconClassName: 'text-success' },
  { value: 'strategic', label: 'Strategic', icon: Target, iconClassName: 'text-warning' },
  { value: 'snapshot', label: 'Snapshot', icon: Zap, iconClassName: 'text-info' },
  { value: 'briefing', label: 'Briefing', icon: FileText, iconClassName: 'text-info' },
];

const sourceOptions = [
  { value: 'all', label: 'All Sources' },
  { value: 'manual', label: 'Manual' },
  { value: 'auto', label: 'Auto-generated' },
];

const dateRangeOptions = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range…' },
];

export function ReportLibraryToolbar(props: Props) {
  const {
    isMobile,
    investmentSearchQuery,
    setInvestmentSearchQuery,
    setInvestmentPage,
    scopeFilter,
    setScopeFilter,
    gradeFilter,
    setGradeFilter,
    tierFilter,
    setTierFilter,
    sourceFilter,
    setSourceFilter,
    scoreRange,
    setScoreRange,
    showArchived,
    setShowArchived,
    dateRange,
    setDateRange,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    dateRangeLabel,
    filteredCount,
    investmentReports,
    getGradeColor,
    viewMode,
    setViewMode,
  } = props;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const updateFilter = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setInvestmentPage(1);
  };

  const resetScoreRange = () => {
    setScoreRange([0, 100]);
    setInvestmentPage(1);
  };

  const resetDateRange = () => {
    setDateRange('30');
    setCustomFrom('');
    setCustomTo('');
    setInvestmentPage(1);
  };

  const activeChips: ReportLibraryFilterChip[] = [];
  if (investmentSearchQuery.trim()) {
    activeChips.push({ key: 'search', label: `Search: ${investmentSearchQuery.trim()}`, onReset: () => { setInvestmentSearchQuery(''); setInvestmentPage(1); } });
  }
  if (scopeFilter !== 'all') {
    activeChips.push({ key: 'scope', label: `Scope: ${scopeOptions.find(option => option.value === scopeFilter)?.label || scopeFilter}`, onReset: () => updateFilter(setScopeFilter)('all') });
  }
  if (gradeFilter !== 'all') {
    activeChips.push({ key: 'grade', label: `Grade: ${gradeFilter}`, onReset: () => updateFilter(setGradeFilter)('all') });
  }
  if (tierFilter !== 'all') {
    activeChips.push({ key: 'tier', label: `Tier: ${tierOptions.find(option => option.value === tierFilter)?.label || tierFilter}`, onReset: () => updateFilter(setTierFilter)('all') });
  }
  if (sourceFilter !== 'all') {
    activeChips.push({ key: 'source', label: `Source: ${sourceOptions.find(option => option.value === sourceFilter)?.label || sourceFilter}`, onReset: () => updateFilter(setSourceFilter)('all') });
  }
  if (scoreRange[0] > 0 || scoreRange[1] < 100) {
    activeChips.push({ key: 'score', label: `Score: ${scoreRange[0]}–${scoreRange[1]}`, onReset: resetScoreRange });
  }
  if (dateRange !== '30') {
    activeChips.push({ key: 'date', label: `Date: ${dateRangeLabel.replace(/^Showing /, '')}`, onReset: resetDateRange });
  }
  if (showArchived) {
    activeChips.push({ key: 'archive', label: 'Archived visible', onReset: () => setShowArchived(false) });
  }

  const archivedScopeCount = investmentReports.filter(r => showArchived ? r.is_archived : !r.is_archived).length;

  const advancedFilters = (
    <AdvancedFilters
      scopeFilter={scopeFilter}
      setScopeFilter={updateFilter(setScopeFilter)}
      gradeFilter={gradeFilter}
      setGradeFilter={updateFilter(setGradeFilter)}
      tierFilter={tierFilter}
      setTierFilter={updateFilter(setTierFilter)}
      sourceFilter={sourceFilter}
      setSourceFilter={updateFilter(setSourceFilter)}
      scoreRange={scoreRange}
      setScoreRange={(value) => { setScoreRange(value); setInvestmentPage(1); }}
      dateRange={dateRange}
      setDateRange={(value) => { setDateRange(value); setInvestmentPage(1); }}
      customFrom={customFrom}
      setCustomFrom={(value) => { setCustomFrom(value); setInvestmentPage(1); }}
      customTo={customTo}
      setCustomTo={(value) => { setCustomTo(value); setInvestmentPage(1); }}
      showArchived={showArchived}
      setShowArchived={setShowArchived}
      getGradeColor={getGradeColor}
      onResetScore={resetScoreRange}
    />
  );

  return (
    <div className="space-y-3">
      <DashboardThemeFrame variant="toolbar" className="items-stretch p-3">
        <SearchInput
          value={investmentSearchQuery}
          onValueChange={(value) => {
              setInvestmentSearchQuery(value);
              setInvestmentPage(1);
            }}
          placeholder="Search by property address..."
          containerClassName="min-w-[220px] flex-1"
          className="h-10 rounded-xl bg-background/80"
        />

        <div className="hidden items-center rounded-xl border border-border/60 bg-background/65 p-1 shadow-sm md:flex">
          <Button variant={viewMode === 'cards' ? 'secondary' : 'ghost'} size="sm" className="h-8 gap-1.5 rounded-lg" onClick={() => setViewMode('cards')} aria-pressed={viewMode === 'cards'}>
            <Grid2X2 className="h-3.5 w-3.5" />
            Cards
          </Button>
          <Button variant={viewMode === 'table' ? 'secondary' : 'ghost'} size="sm" className="h-8 gap-1.5 rounded-lg" onClick={() => setViewMode('table')} aria-pressed={viewMode === 'table'}>
            <Table2 className="h-3.5 w-3.5" />
            Table
          </Button>
        </div>

        {isMobile ? (
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" className="h-10 gap-2 rounded-xl">
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {activeChips.length > 0 && <Badge className="ml-1 h-5 rounded-full px-1.5 text-[11px]">{activeChips.length}</Badge>}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[78vh] flex flex-col p-0">
              <SheetHeader className="border-b p-4 text-left">
                <SheetTitle>Report Filters</SheetTitle>
              </SheetHeader>
              <ScrollArea className="flex-1 p-4">
                {advancedFilters}
              </ScrollArea>
            </SheetContent>
          </Sheet>
        ) : (
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="h-10 gap-2 rounded-xl">
                <Filter className="h-4 w-4" />
                Filters
                {activeChips.length > 0 && <Badge className="ml-1 h-5 rounded-full px-1.5 text-[11px]">{activeChips.length}</Badge>}
                <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        )}

        <Button
          variant={showArchived ? 'secondary' : 'outline'}
          className="h-10 gap-2 rounded-xl"
          onClick={() => setShowArchived(!showArchived)}
        >
          <Archive className="h-4 w-4" />
          {showArchived ? 'Viewing Archived' : 'Show Archived'}
        </Button>

        <div className="flex min-w-fit flex-col justify-center rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{filteredCount} of {archivedScopeCount} reports</span>
          {!showArchived && <span>{dateRangeLabel}</span>}
        </div>
      </DashboardThemeFrame>

      <ReportLibraryFilterChips chips={activeChips} />

      {!isMobile && (
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleContent>
            <DashboardThemeFrame variant="section" className="p-4">
              {advancedFilters}
            </DashboardThemeFrame>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function AdvancedFilters({
  scopeFilter,
  setScopeFilter,
  gradeFilter,
  setGradeFilter,
  tierFilter,
  setTierFilter,
  sourceFilter,
  setSourceFilter,
  scoreRange,
  setScoreRange,
  dateRange,
  setDateRange,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  showArchived,
  setShowArchived,
  getGradeColor,
  onResetScore,
}: {
  scopeFilter: string;
  setScopeFilter: (v: string) => void;
  gradeFilter: string;
  setGradeFilter: (v: string) => void;
  tierFilter: string;
  setTierFilter: (v: string) => void;
  sourceFilter: string;
  setSourceFilter: (v: string) => void;
  scoreRange: [number, number];
  setScoreRange: (v: [number, number]) => void;
  dateRange: string;
  setDateRange: (v: string) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  getGradeColor: (grade: string) => string;
  onResetScore: () => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <FilterField label="Scope">
        <Select value={scopeFilter} onValueChange={setScopeFilter}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Filter by scope" /></SelectTrigger>
          <SelectContent className="bg-background z-50">
            {scopeOptions.map(({ value, label, icon: Icon }) => (
              <SelectItem key={value} value={value}>
                <div className="flex items-center gap-2"><Icon className="h-4 w-4" />{label}</div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label="Grade">
        <Select value={gradeFilter} onValueChange={setGradeFilter}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Filter by grade" /></SelectTrigger>
          <SelectContent className="bg-background z-50">
            <SelectItem value="all">All Grades</SelectItem>
            {['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'].map(g => (
              <SelectItem key={g} value={g}>
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded text-xs font-bold flex items-center justify-center ${getGradeColor(g)}`}>{g}</span>
                  Grade {g}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label="Tier">
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Filter by tier" /></SelectTrigger>
          <SelectContent className="bg-background z-50">
            {tierOptions.map(({ value, label, icon: Icon, iconClassName }) => (
              <SelectItem key={value} value={value}>
                <div className="flex items-center gap-2"><Icon className={`h-4 w-4 ${iconClassName || ''}`} />{label}</div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label="Source">
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Filter by source" /></SelectTrigger>
          <SelectContent className="bg-background z-50">
            {sourceOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label={`Score Range: ${scoreRange[0]} - ${scoreRange[1]}`} className="md:col-span-2">
        <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-background/55 px-3 py-3">
          <span className="text-sm font-medium w-8">{scoreRange[0]}</span>
          <Slider value={scoreRange} onValueChange={(value) => setScoreRange(value as [number, number])} min={0} max={100} step={5} className="flex-1" />
          <span className="text-sm font-medium w-8">{scoreRange[1]}</span>
          {(scoreRange[0] > 0 || scoreRange[1] < 100) && <Button variant="ghost" size="sm" onClick={onResetScore} className="text-xs">Reset</Button>}
        </div>
      </FilterField>

      <FilterField label="Date Range">
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-full"><Calendar className="h-4 w-4 mr-1 text-muted-foreground" /><SelectValue placeholder="Date range" /></SelectTrigger>
          <SelectContent className="bg-background z-50">
            {dateRangeOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label="Archive Visibility">
        <Button variant={showArchived ? 'secondary' : 'outline'} className="w-full justify-start gap-2" onClick={() => setShowArchived(!showArchived)}>
          <Archive className="h-4 w-4" />
          {showArchived ? 'Viewing Archived' : 'Show Archived'}
        </Button>
      </FilterField>

      {dateRange === 'custom' && (
        <FilterField label="Custom Date Range" className="md:col-span-2">
          <div className="flex items-center gap-2">
            <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className="h-10" aria-label="From date" />
            <span className="text-muted-foreground text-xs">→</span>
            <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className="h-10" aria-label="To date" />
          </div>
        </FilterField>
      )}
    </div>
  );
}

function FilterField({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Star className="h-3 w-3 text-brand-500/80" />
        {label}
      </label>
      {children}
    </div>
  );
}
