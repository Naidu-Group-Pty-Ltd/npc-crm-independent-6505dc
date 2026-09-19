import { SlidersHorizontal, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import type { BuildTypeFilter, DateRangeFilter } from './types';
import { BUILD_TYPE_FILTER_OPTIONS, DATE_RANGE_OPTIONS } from './utils';

interface CashFlowToolbarProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  dateRange: DateRangeFilter;
  onDateRangeChange: (value: DateRangeFilter) => void;
  buildTypeFilter: BuildTypeFilter;
  onBuildTypeFilterChange: (value: BuildTypeFilter) => void;
  filteredCount: number;
  loadedCount: number;
}

export function CashFlowToolbar({
  searchQuery,
  onSearchQueryChange,
  dateRange,
  onDateRangeChange,
  buildTypeFilter,
  onBuildTypeFilterChange,
  filteredCount,
  loadedCount,
}: CashFlowToolbarProps) {
  const activeDateLabel = DATE_RANGE_OPTIONS.find((option) => option.value === dateRange)?.label || 'Date range';
  const activeBuildTypeLabel = BUILD_TYPE_FILTER_OPTIONS.find((option) => option.value === buildTypeFilter)?.label || 'Build Type';
  const hasSearch = searchQuery.trim().length > 0;
  const hasBuildTypeFilter = buildTypeFilter !== 'all';
  const hasNonDefaultFilters = hasSearch || dateRange !== '30' || hasBuildTypeFilter;

  const handleClearFilters = () => {
    onSearchQueryChange('');
    onDateRangeChange('30');
    onBuildTypeFilterChange('all');
  };

  return (
    <Card className="border-border/80 bg-background/95 shadow-sm">
      <CardContent className="space-y-3 p-3 md:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground xl:w-44">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            Command filters
          </div>

          <SearchInput
            value={searchQuery}
            onValueChange={onSearchQueryChange}
            placeholder="Search by property address..."
            containerClassName="flex-1"
            className="h-11"
          />

          <div className="flex flex-col gap-3 sm:flex-row xl:items-center">
            <Select value={dateRange} onValueChange={(value) => onDateRangeChange(value as DateRangeFilter)}>
              <SelectTrigger className="h-11 w-full sm:w-[170px]">
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={buildTypeFilter} onValueChange={(value) => onBuildTypeFilterChange(value as BuildTypeFilter)}>
              <SelectTrigger className="h-11 w-full sm:w-[190px]">
                <SelectValue placeholder="Build Type" />
              </SelectTrigger>
              <SelectContent>
                {BUILD_TYPE_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="rounded-xl border bg-muted/40 px-3 py-2 text-sm text-muted-foreground sm:min-w-[150px]">
              <span className="font-semibold tabular-nums text-foreground">{filteredCount.toLocaleString('en-AU')}</span> of {loadedCount.toLocaleString('en-AU')} visible
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active filters</span>
          {hasSearch && (
            <FilterChip label={`Search: “${searchQuery}”`} onRemove={() => onSearchQueryChange('')} />
          )}
          <FilterChip label={`Date: ${activeDateLabel}`} onRemove={dateRange === '30' ? undefined : () => onDateRangeChange('30')} />
          {hasBuildTypeFilter && (
            <FilterChip label={`Build Type: ${activeBuildTypeLabel}`} onRemove={() => onBuildTypeFilterChange('all')} />
          )}
          {hasNonDefaultFilters && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleClearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1.5 rounded-full px-2.5 py-1 font-normal">
      {label}
      {onRemove && (
        <button type="button" className="rounded-full hover:text-destructive" onClick={onRemove} aria-label={`Remove ${label} filter`}>
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}
