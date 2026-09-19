/**
 * Choose the properties a cash-flow analysis is compared against.
 *
 * This replaces a 380px popover listing addresses. The act it supports — which
 * four completed reports a client's decision gets argued from — deserves the
 * figures the comparison will actually draw, so each property is a card
 * carrying its purchase price, weekly rent and the gross yield those imply,
 * searchable and sortable, with the report already open pinned in front so the
 * five being compared are visible as five.
 *
 * Nothing here decides what is comparable or fetches anything: the candidate
 * list arrives already filtered by `comparisonCandidates`, and every figure is
 * resolved from the row by `toPickerRow`.
 */
import { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Building2,
  Check,
  Home,
  Loader2,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  COMPARISON_TOTAL_REPORTS,
  MAX_COMPARISON_PEERS,
  type ComparisonCandidate,
} from '@/lib/cashFlow/comparisonCandidates.pure';
import {
  selectionSummary,
  toPickerRow,
  visibleRows,
  type PickerRow,
  type PickerSort,
} from '@/lib/cashFlow/comparisonPicker.pure';
import { AU_LOCALE } from '@/lib/aml/displayDate';

export interface CashFlowComparisonPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The report already open. Pinned, never removable — it is the comparison. */
  primaryAddress: string;
  candidates: (ComparisonCandidate & { created_at?: string | null })[];
  selectedIds: string[];
  onToggle: (reportId: string) => void;
  onClearAll: () => void;
  loading: boolean;
}

const AUD = new Intl.NumberFormat(AU_LOCALE, {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

const SORT_LABELS: Record<PickerSort, string> = {
  recent: 'Most recent',
  price_desc: 'Highest price',
  yield_desc: 'Highest yield',
  address: 'Address (A–Z)',
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleDateString(AU_LOCALE, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function CashFlowComparisonPicker({
  open,
  onOpenChange,
  primaryAddress,
  candidates,
  selectedIds,
  onToggle,
  onClearAll,
  loading,
}: CashFlowComparisonPickerProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PickerSort>('recent');

  const rows = useMemo(() => candidates.map(toPickerRow), [candidates]);
  const shown = useMemo(() => visibleRows(rows, query, sort), [rows, query, sort]);
  const selected = useMemo(
    () => selectedIds.map((id) => rows.find((row) => row.id === id)).filter((row): row is PickerRow => Boolean(row)),
    [selectedIds, rows],
  );
  const atCapacity = selectedIds.length >= MAX_COMPARISON_PEERS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        `DialogContent`'s own class list is modifier-scoped — `sm:max-w-lg`,
        `sm:max-h-[85dvh]`, `sm:p-6`, `sm:overflow-visible` — and an unmodified
        utility never displaces one of those. `tailwind-merge` keeps both
        (different modifiers are not a conflict) and the media-query rule then
        wins the cascade, so a plain `max-w-[...]` left this dialog 512px wide
        on a 1440px screen with three columns crushed into it. Each override
        has to be made at the same breakpoint the base declares.
      */}
      <DialogContent
        className="flex h-[min(92vh,900px)] max-h-[92dvh] max-w-[min(96vw,1180px)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(92vh,900px)] sm:max-w-[min(96vw,1180px)] sm:overflow-hidden sm:p-0"
      >
        <DialogHeader className="space-y-3 border-b border-border/60 px-5 py-4 text-left sm:px-6">
          <div className="flex flex-col gap-3 pr-8 md:flex-row md:items-start md:justify-between md:pr-10">
            <div className="space-y-1">
              <DialogTitle className="font-heading text-lg tracking-tight md:text-xl">
                Choose properties to compare
              </DialogTitle>
              <DialogDescription className="line-clamp-2 max-w-2xl text-sm sm:line-clamp-none">
                Completed reports the system has already generated for this workspace. Only
                properties carrying the figures a ten-year projection needs are offered.
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
              >
                {selectionSummary(selectedIds.length, COMPARISON_TOTAL_REPORTS)}
              </Badge>
              {selectedIds.length > 0 && (
                <Button variant="ghost" size="sm" onClick={onClearAll} className="text-xs">
                  Clear all
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search by address, suburb or state..."
              aria-label="Search comparison properties"
              containerClassName="flex-1 sm:basis-[320px]"
              className="h-10 rounded-xl"
            />
            <Select value={sort} onValueChange={(value) => setSort(value as PickerSort)}>
              <SelectTrigger className="h-10 w-full rounded-xl sm:w-[190px]" aria-label="Sort properties">
                <ArrowUpDown className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as PickerSort[]).map((key) => (
                  <SelectItem key={key} value={key}>{SORT_LABELS[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        {/* The five, as five. The primary is pinned and cannot be removed —
            it is what everything else is being compared against. */}
        <div className="border-b border-border/60 bg-muted/20 px-5 py-3 sm:px-6">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            In this comparison
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge className="gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/15">
              <Home className="h-3 w-3" />
              {primaryAddress.split(',')[0] || 'This report'}
              <span className="text-[10px] font-normal opacity-80">this report</span>
            </Badge>
            {selected.map((row) => (
              <Badge
                key={row.id}
                variant="secondary"
                className="gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              >
                {row.address.split(',')[0]}
                <button
                  type="button"
                  onClick={() => onToggle(row.id)}
                  className="rounded-full p-0.5 transition-colors hover:text-destructive"
                  aria-label={`Remove ${row.address} from the comparison`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {Array.from({ length: Math.max(0, MAX_COMPARISON_PEERS - selected.length) }).map((_, index) => (
              <span
                key={`slot-${index}`}
                className="hidden rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground sm:inline-flex"
              >
                Empty slot
              </span>
            ))}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 py-4 sm:px-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-20 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                Loading completed reports...
              </div>
            ) : shown.length === 0 ? (
              <EmptyState hasCandidates={rows.length > 0} query={query} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((row) => (
                  <PropertyCard
                    key={row.id}
                    row={row}
                    selected={selectedIds.includes(row.id)}
                    disabled={atCapacity && !selectedIds.includes(row.id)}
                    onToggle={() => onToggle(row.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex flex-col gap-2 border-t border-border/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-muted-foreground">
            {rows.length === 0
              ? 'No completed reports carry comparable figures yet.'
              : `${shown.length} of ${rows.length} ${rows.length === 1 ? 'property' : 'properties'} shown`}
          </p>
          <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ hasCandidates, query }: { hasCandidates: boolean; query: string }) {
  // Two different absences, said differently: a search that matched nothing is
  // the reader's own doing and is fixed by typing less, while a library with no
  // comparable reports is a fact about the workspace and reads as a broken page
  // if it is not explained.
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <Building2 className="h-8 w-8 text-muted-foreground/60" />
      {hasCandidates ? (
        <>
          <p className="text-sm font-medium">No property matches "{query}"</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Every word has to appear in the address. Try fewer words, or the suburb on its own.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">No comparable properties yet</p>
          <p className="max-w-md text-xs text-muted-foreground">
            A property can be compared once one of its completed reports carries a purchase
            price or a weekly rent. Generate a report for another property, or record its
            figures, and it will appear here.
          </p>
        </>
      )}
    </div>
  );
}

function PropertyCard({
  row,
  selected,
  disabled,
  onToggle,
}: {
  row: PickerRow;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const created = formatDate(row.createdAt);
  const [street, ...restOfAddress] = row.address.split(',');

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      className={`group flex h-full flex-col rounded-2xl border p-4 text-left transition-all duration-200 ${
        selected
          ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
          : 'border-border/60 bg-muted/20 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/40 hover:shadow-md'
      } ${disabled ? 'cursor-not-allowed opacity-45 hover:translate-y-0 hover:border-border/60 hover:shadow-none' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="truncate font-heading text-sm font-semibold leading-snug tracking-tight">
            {street?.trim() || row.address}
          </p>
          {restOfAddress.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">{restOfAddress.join(',').trim()}</p>
          )}
        </div>
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-transparent group-hover:border-primary/50'
          }`}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Figure label="Price" value={row.purchasePrice === null ? null : AUD.format(row.purchasePrice)} />
        <Figure label="Rent p/w" value={row.weeklyRent === null ? null : AUD.format(row.weeklyRent)} />
        <Figure
          label="Gross yield"
          value={row.grossYield === null ? null : `${row.grossYield.toFixed(1)}%`}
        />
      </div>

      {created && (
        <p className="mt-3 text-[11px] tabular-nums text-muted-foreground">Report generated {created}</p>
      )}
    </button>
  );
}

/**
 * One figure.
 *
 * A missing figure reads "Not recorded" rather than as a dash or a zero: the
 * comparison falls back to a default for it, and the reader is entitled to know
 * which of the three numbers on this card the report did not supply.
 */
function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/60 px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xs font-semibold tabular-nums ${value === null ? 'text-muted-foreground' : 'text-foreground'}`}>
        {value ?? 'Not recorded'}
      </p>
    </div>
  );
}
