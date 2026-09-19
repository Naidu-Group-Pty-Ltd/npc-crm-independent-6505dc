import { Building, ChevronsUpDown, GitCompare, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface InvestmentReport {
  id: string;
  property_address: string;
}

interface CashFlowComparisonBarProps {
  comparisonMode: boolean;
  onComparisonModeChange: (enabled: boolean) => void;
  selectedComparisonReportIds: string[];
  availableReports: InvestmentReport[];
  onToggleComparisonReport: (reportId: string) => void;
  loadingReports: boolean;
  investorProfile: 'growth' | 'income' | 'balanced';
  onInvestorProfileChange: (profile: 'growth' | 'income' | 'balanced') => void;
  excludeLandTaxFromCashFlow: boolean;
  onExcludeLandTaxChange: (checked: boolean) => void;
  hasChanges: boolean;
}

export function CashFlowComparisonBar({
  comparisonMode,
  onComparisonModeChange,
  selectedComparisonReportIds,
  availableReports,
  onToggleComparisonReport,
  loadingReports,
  investorProfile,
  onInvestorProfileChange,
  excludeLandTaxFromCashFlow,
  onExcludeLandTaxChange,
  hasChanges,
}: CashFlowComparisonBarProps) {
  return (
    <Card className="border-border/80 bg-muted/20 shadow-sm">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">Comparison & assumptions</p>
              {hasChanges && <Badge variant="outline" className="border-warning/30 text-warning">Unsaved assumptions</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">Compare reports, tune investor context, and adjust analysis assumptions.</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              variant={comparisonMode ? "default" : "outline"}
              size="sm"
              onClick={() => onComparisonModeChange(!comparisonMode)}
              className="gap-2"
            >
              <GitCompare className="h-4 w-4" />
              {comparisonMode ? "Exit Comparison" : "Compare Reports"}
            </Button>

            <Select value={investorProfile} onValueChange={(value) => onInvestorProfileChange(value as 'growth' | 'income' | 'balanced')}>
              <SelectTrigger className="h-9 w-full sm:w-[170px]">
                <SelectValue placeholder="Investor profile" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="balanced">Balanced Investor</SelectItem>
                <SelectItem value="growth">Growth Investor</SelectItem>
                <SelectItem value="income">Income Investor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1fr_280px] xl:items-start">
          <div className="space-y-3 rounded-2xl border bg-background/80 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <span className="text-xs font-medium text-muted-foreground">Select up to 4 comparison reports</span>
              {comparisonMode && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      size="sm"
                      className="min-h-9 w-full justify-between text-sm font-normal md:w-[300px]"
                      disabled={loadingReports || selectedComparisonReportIds.length >= 4}
                    >
                      {loadingReports ? "Loading..." : `Add property (${selectedComparisonReportIds.length}/4)`}
                      <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[calc(100vw-2rem)] max-w-[350px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search properties..." />
                      <CommandList>
                        <CommandEmpty>No properties found.</CommandEmpty>
                        <CommandGroup>
                          {availableReports
                            .filter(r => !selectedComparisonReportIds.includes(r.id))
                            .map((r) => (
                              <CommandItem
                                key={r.id}
                                value={r.property_address}
                                onSelect={() => onToggleComparisonReport(r.id)}
                                className="cursor-pointer"
                              >
                                <Building className="mr-2 h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="truncate">
                                  {r.property_address.length > 50
                                    ? r.property_address.substring(0, 50) + '...'
                                    : r.property_address}
                                </span>
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {comparisonMode && selectedComparisonReportIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selectedComparisonReportIds.map((id) => {
                  const r = availableReports.find(rep => rep.id === id);
                  return r ? (
                    <Badge key={id} variant="secondary" className="text-xs flex items-center gap-1">
                      {r.property_address.split(',')[0].substring(0, 20)}
                      <X
                        className="h-3 w-3 cursor-pointer hover:text-destructive"
                        onClick={() => onToggleComparisonReport(id)}
                      />
                    </Badge>
                  ) : null;
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {comparisonMode ? 'No comparison reports selected yet.' : 'Enable comparison mode to add peer reports.'}
              </p>
            )}
          </div>

          <label className="flex min-h-[70px] items-start gap-3 rounded-2xl border bg-background/80 p-3">
            <Checkbox
              id="excludeLandTax"
              checked={excludeLandTaxFromCashFlow}
              onCheckedChange={(checked) => onExcludeLandTaxChange(checked === true)}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium leading-none">Exclude Land Tax from analysis</span>
              <span className="block text-xs text-muted-foreground">Marks assumptions as changed when toggled.</span>
            </span>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
