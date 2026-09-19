import * as React from 'react';
import { LayoutGrid, Rows3, Rows2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { cn } from '@/lib/utils';

/**
 * DataTableToolbar — Phase 3 primitive.
 *
 * Composable toolbar for list/table surfaces. Slots:
 *  - `leading`   : title / breadcrumb (optional)
 *  - `search`    : controlled search value + onChange
 *  - `filters`   : arbitrary filter controls (chips, selects)
 *  - `actions`   : trailing action cluster (export, create, refresh)
 *
 * Semantic-token only. Non-invasive: pages can adopt this incrementally
 * without ripping existing state management.
 */
export type TableDensity = 'comfortable' | 'compact';

export interface DataTableToolbarProps {
  leading?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  density?: TableDensity;
  onDensityChange?: (value: TableDensity) => void;
  viewMode?: 'list' | 'grid';
  onViewModeChange?: (value: 'list' | 'grid') => void;
  count?: { filtered: number; total: number };
  activeFilterCount?: number;
  onClearFilters?: () => void;
  className?: string;
}

export function DataTableToolbar({
  leading,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filters,
  actions,
  density,
  onDensityChange,
  viewMode,
  onViewModeChange,
  count,
  activeFilterCount = 0,
  onClearFilters,
  className,
}: DataTableToolbarProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[color:var(--glass-hairline)] bg-[color:hsl(var(--card)/0.65)] p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-[color:hsl(var(--card)/0.55)] md:p-4',
        className,
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {leading && <div className="min-w-0 shrink-0">{leading}</div>}

        {onSearchChange && (
          <SearchInput
            value={searchValue ?? ''}
            onValueChange={onSearchChange}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            containerClassName="min-w-0 flex-1"
            className="h-10"
          />
        )}

        {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}

        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          {count && (
            <span className="rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{count.filtered.toLocaleString('en-AU')}</span>
              <span className="mx-1 opacity-60">/</span>
              {count.total.toLocaleString('en-AU')}
            </span>
          )}

          {activeFilterCount > 0 && onClearFilters && (
            <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-9 gap-1.5 text-xs">
              <X className="h-3.5 w-3.5" />
              Clear
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {activeFilterCount}
              </Badge>
            </Button>
          )}

          {onDensityChange && (
            <div
              role="group"
              aria-label="Row density"
              className="inline-flex h-9 items-center rounded-lg border border-border/60 bg-background/60 p-0.5"
            >
              <button
                type="button"
                aria-pressed={density === 'comfortable'}
                onClick={() => onDensityChange('comfortable')}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  density === 'comfortable' && 'bg-primary/15 text-primary',
                )}
              >
                <Rows3 className="h-4 w-4" />
                <span className="sr-only">Comfortable</span>
              </button>
              <button
                type="button"
                aria-pressed={density === 'compact'}
                onClick={() => onDensityChange('compact')}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  density === 'compact' && 'bg-primary/15 text-primary',
                )}
              >
                <Rows2 className="h-4 w-4" />
                <span className="sr-only">Compact</span>
              </button>
            </div>
          )}

          {onViewModeChange && (
            <div
              role="group"
              aria-label="View mode"
              className="inline-flex h-9 items-center rounded-lg border border-border/60 bg-background/60 p-0.5"
            >
              <button
                type="button"
                aria-pressed={viewMode === 'list'}
                onClick={() => onViewModeChange('list')}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  viewMode === 'list' && 'bg-primary/15 text-primary',
                )}
              >
                <Rows3 className="h-4 w-4" />
                <span className="sr-only">List</span>
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'grid'}
                onClick={() => onViewModeChange('grid')}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  viewMode === 'grid' && 'bg-primary/15 text-primary',
                )}
              >
                <LayoutGrid className="h-4 w-4" />
                <span className="sr-only">Grid</span>
              </button>
            </div>
          )}

          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

export default DataTableToolbar;
