/**
 * Search, sort and multi-select filter chips for the library grid.
 *
 * Chips are real toggle buttons carrying `aria-pressed`, not styled divs, so
 * the filter state is reachable and announced. Filtering itself is pure and
 * lives in `filterEntries.ts`.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import {
  CATEGORY_OPTIONS, INDUSTRY_OPTIONS, ORIENTATION_OPTIONS, STYLE_OPTIONS, reportTypeLabel,
} from '@/lib/templateLibrary/taxonomy';
import { hasActiveFilters, type TemplateLibrarySort } from '@/lib/templateLibrary/filterEntries';
import type { TemplateLibraryFilters as Filters } from '@/lib/templateLibrary/types';

interface Props {
  filters: Filters;
  onChange: (next: Filters) => void;
  sort: TemplateLibrarySort;
  onSortChange: (next: TemplateLibrarySort) => void;
  reportTypes: string[];
  /** Design families present in the catalogue, with their entry counts. */
  families: Array<{ key: string; name: string; count: number }>;
  /** Recommended-use buckets present in the catalogue. */
  useBuckets: string[];
  /** Density steps present, in compact → spacious order. */
  densities: string[];
  onClear: () => void;
  resultCount: number;
  totalCount: number;
}

/** Toggle a value in one of the array-valued filter axes. */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

interface ChipProps {
  label: string;
  pressed: boolean;
  onClick: () => void;
}

function FilterChip({ label, pressed, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={[
        'rounded-full border px-3 py-1 text-xs transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function ChipGroup({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

const GROUND_OPTIONS: Array<{ value: Filters['ground']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function TemplateLibraryFilters({
  filters, onChange, sort, onSortChange, reportTypes, families, useBuckets, densities,
  onClear, resultCount, totalCount,
}: Props) {
  const active = hasActiveFilters(filters);
  const [moreOpen, setMoreOpen] = useState(false);

  /**
   * How many of the collapsed axes are in use.
   *
   * A disclosure that hides an ACTIVE filter is a filter nobody can find, so
   * the count is on the trigger and the panel opens itself when there is one.
   */
  const refinementCount =
    filters.densities.length
    + filters.useBuckets.length
    + filters.categories.length
    + filters.styles.length
    + filters.industries.length
    + filters.orientations.length
    + (filters.productionReadyOnly ? 1 : 0);
  const showMore = moreOpen || refinementCount > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <SearchInput
          value={filters.search}
          onValueChange={(value) => onChange({ ...filters, search: value })}
          placeholder="Search templates by name, description or tag..."
          aria-label="Search templates"
          containerClassName="flex-1"
        />
        <Select value={sort} onValueChange={(v) => onSortChange(v as TemplateLibrarySort)}>
          <SelectTrigger className="w-full sm:w-[200px]" aria-label="Sort templates">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Recently updated</SelectItem>
            <SelectItem value="popular">Most used</SelectItem>
            <SelectItem value="name_asc">Name (A–Z)</SelectItem>
            <SelectItem value="name_desc">Name (Z–A)</SelectItem>
            <SelectItem value="pages_asc">Fewest pages</SelectItem>
            <SelectItem value="pages_desc">Most pages</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/*
        Ten chip groups, all open, ~60 chips above the grid they filter.

        That is what the 19 Sep 2026 clone audit called "too messy and looks
        unprofessional", and the arithmetic bears it out: the filters took more
        vertical space than the templates. The same shape the AML action list
        had, and the same answer — the axes a person reaches for are open, the
        rest are a disclosure that says how many of them are in use so nothing
        is hidden silently.

        Which axes are "open" is not a taste call: design family and report
        type are the two the catalogue is organised by (families × variants ×
        colourways, serving ten report formats), and they are what a reader
        narrows on first.
      */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Design-family axes come first: in a catalogue organised as families ×
            variants × colourways, those are the questions a user asks before
            "which report type is this". They hide entirely when the catalogue
            holds no family entries, so a deployment that has not applied the
            Investment Compass migration sees exactly the previous filter set. */}
        {families.length > 0 && (
          <ChipGroup legend="Design family">
            {families.map((f) => (
              <FilterChip
                key={f.key}
                label={`${f.name} (${f.count})`}
                pressed={filters.families.includes(f.key)}
                onClick={() => onChange({ ...filters, families: toggle(filters.families, f.key) })}
              />
            ))}
          </ChipGroup>
        )}

        {families.length > 0 && (
          <ChipGroup legend="Ground">
            {GROUND_OPTIONS.map((o) => (
              <FilterChip
                key={o.value}
                label={o.label}
                pressed={filters.ground === o.value}
                // Single-select: "Light" and "Dark" together is what "All"
                // means, so offering both pressed at once would be a third way
                // of saying the same thing.
                onClick={() => onChange({ ...filters, ground: o.value })}
              />
            ))}
          </ChipGroup>
        )}

        {reportTypes.length > 0 && (
          <ChipGroup legend="Report type">
            {reportTypes.map((t) => (
              <FilterChip
                key={t}
                label={reportTypeLabel(t) ?? t}
                pressed={filters.reportTypes.includes(t)}
                onClick={() => onChange({ ...filters, reportTypes: toggle(filters.reportTypes, t) })}
              />
            ))}
          </ChipGroup>
        )}
      </div>

      <Collapsible open={showMore} onOpenChange={setMoreOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            More filters
            {refinementCount > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 justify-center px-1 text-[10px]">
                {refinementCount}
              </Badge>
            )}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showMore ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          {densities.length > 0 && (
            <ChipGroup legend="Density">
              {densities.map((d) => (
                <FilterChip
                  key={d}
                  label={d.charAt(0).toUpperCase() + d.slice(1)}
                  pressed={filters.densities.includes(d)}
                  onClick={() => onChange({ ...filters, densities: toggle(filters.densities, d) })}
                />
              ))}
            </ChipGroup>
          )}

          {useBuckets.length > 0 && (
            <ChipGroup legend="Recommended use">
              {useBuckets.map((b) => (
                <FilterChip
                  key={b}
                  label={b}
                  pressed={filters.useBuckets.includes(b)}
                  onClick={() => onChange({ ...filters, useBuckets: toggle(filters.useBuckets, b) })}
                />
              ))}
            </ChipGroup>
          )}

          <ChipGroup legend="Category">
            {CATEGORY_OPTIONS.map((o) => (
              <FilterChip
                key={o.value}
                label={o.label}
                pressed={filters.categories.includes(o.value)}
                onClick={() => onChange({ ...filters, categories: toggle(filters.categories, o.value) })}
              />
            ))}
          </ChipGroup>

        <ChipGroup legend="Style">
          {STYLE_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              label={o.label}
              pressed={filters.styles.includes(o.value)}
              onClick={() => onChange({ ...filters, styles: toggle(filters.styles, o.value) })}
            />
          ))}
        </ChipGroup>

        <ChipGroup legend="Industry">
          {INDUSTRY_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              label={o.label}
              pressed={filters.industries.includes(o.value)}
              onClick={() => onChange({ ...filters, industries: toggle(filters.industries, o.value) })}
            />
          ))}
        </ChipGroup>

        <ChipGroup legend="Orientation">
          {ORIENTATION_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              label={o.label}
              pressed={filters.orientations.includes(o.value)}
              onClick={() => onChange({ ...filters, orientations: toggle(filters.orientations, o.value) })}
            />
          ))}
        </ChipGroup>

          <ChipGroup legend="Compatibility">
            <FilterChip
              label="Report-ready only"
              pressed={filters.productionReadyOnly}
              onClick={() => onChange({ ...filters, productionReadyOnly: !filters.productionReadyOnly })}
            />
          </ChipGroup>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {active
            ? `${resultCount} of ${totalCount} template${totalCount === 1 ? '' : 's'}`
            : `${totalCount} template${totalCount === 1 ? '' : 's'}`}
        </p>
        {active && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onClear}>
            <X className="h-3 w-3" aria-hidden="true" /> Clear filters
          </Button>
        )}
        {filters.productionReadyOnly && (
          <Badge variant="outline" className="text-xs">Report-ready only</Badge>
        )}
        {filters.ground !== 'all' && (
          <Badge variant="outline" className="text-xs capitalize">{filters.ground} ground</Badge>
        )}
      </div>
    </div>
  );
}
