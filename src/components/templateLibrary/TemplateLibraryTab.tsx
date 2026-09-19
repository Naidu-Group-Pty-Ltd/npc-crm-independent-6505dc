/**
 * Template Library — the browse surface on the Template Management page.
 *
 * Sits alongside the Visual PDF Template Builder rather than replacing it: the
 * library is a catalogue of designed masters, and "Use template" hands an
 * ordinary working copy to the existing Builder. Nothing here reads or writes
 * `report_templates` directly.
 */
import { useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LibraryBig, RefreshCw, TriangleAlert } from 'lucide-react';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { usePermissions } from '@/hooks/usePermissions';
import { useTemplateLibraryEntries } from '@/hooks/useTemplateLibrary';
import {
  EMPTY_FILTERS, availableDensities, availableFamilies, availableReportTypes,
  availableUseBuckets, filterLibraryEntries, hasActiveFilters,
  sortLibraryEntries, type TemplateLibrarySort,
} from '@/lib/templateLibrary/filterEntries';
import type { TemplateLibraryFilters as Filters, TemplateLibraryListEntry } from '@/lib/templateLibrary/types';
import { TemplateLibraryCard } from './TemplateLibraryCard';
import { TemplateLibraryFilters } from './TemplateLibraryFilters';
import { TemplateReaderDialog } from './TemplateReaderDialog';
import { UseTemplateDialog } from './UseTemplateDialog';
import { TemplateLibraryAdminPanel } from './TemplateLibraryAdminPanel';

export function TemplateLibraryTab() {
  const { canEdit } = useModulePermissions('templates');
  // Gates what is SHOWN. Every library mutation is independently authorised by
  // manage-template-library, so a forged client-side flag buys nothing.
  const { isSuperadmin } = usePermissions();
  const { data: entries = [], isLoading, isError, error, refetch, isFetching } =
    useTemplateLibraryEntries();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<TemplateLibrarySort>('recent');
  const [previewEntry, setPreviewEntry] = useState<TemplateLibraryListEntry | null>(null);
  const [useEntry, setUseEntry] = useState<TemplateLibraryListEntry | null>(null);
  const [useColourway, setUseColourway] = useState<string | null>(null);

  /**
   * Colourway chosen per entry, by entry id.
   *
   * Held at the grid rather than on each card so a choice survives the card
   * re-rendering, and so the Light/Dark filter can read the palette the user is
   * actually looking at rather than the template's declared ground.
   */
  const [colourways, setColourways] = useState<Record<string, string>>({});
  const chooseColourway = useCallback(
    (entry: TemplateLibraryListEntry, colourwayId: string) => {
      setColourways((prev) => ({ ...prev, [entry.id]: colourwayId }));
    },
    [],
  );

  const openUse = useCallback((entry: TemplateLibraryListEntry, colourwayId: string | null) => {
    setUseColourway(colourwayId);
    setUseEntry(entry);
  }, []);

  const reportTypes = useMemo(() => availableReportTypes(entries), [entries]);
  const families = useMemo(() => availableFamilies(entries), [entries]);
  const useBuckets = useMemo(() => availableUseBuckets(entries), [entries]);
  const densities = useMemo(() => availableDensities(entries), [entries]);
  const visible = useMemo(
    () => sortLibraryEntries(filterLibraryEntries(entries, filters, colourways), sort),
    [entries, filters, sort, colourways],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-semibold">Template Library</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Read any template end to end, filled with sample data, then create your own editable
            copy — the original stays untouched, and your copy opens in the Template Builder.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh the template library"
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {isError && (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <TriangleAlert className="h-8 w-8 text-destructive" aria-hidden="true" />
            <CardTitle className="text-base">Could not load the template library</CardTitle>
            <CardDescription className="max-w-md">
              {error instanceof Error ? error.message : 'An unexpected error occurred.'}
            </CardDescription>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {!isError && (
        <>
          <TemplateLibraryFilters
            filters={filters}
            onChange={setFilters}
            sort={sort}
            onSortChange={setSort}
            reportTypes={reportTypes}
            families={families}
            useBuckets={useBuckets}
            densities={densities}
            onClear={() => setFilters(EMPTY_FILTERS)}
            resultCount={visible.length}
            totalCount={entries.length}
          />

          {isLoading && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[520px] rounded-xl" />)}
            </div>
          )}

          {!isLoading && entries.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center">
                <LibraryBig className="mx-auto mb-4 h-12 w-12 text-muted-foreground" aria-hidden="true" />
                <CardTitle className="text-lg">No templates published yet</CardTitle>
                <CardDescription className="mx-auto mt-2 max-w-md">
                  Published library templates appear here. A superadmin can promote a template from
                  the Builder into the library and publish it.
                </CardDescription>
              </CardContent>
            </Card>
          )}

          {!isLoading && entries.length > 0 && visible.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <LibraryBig className="mx-auto mb-3 h-10 w-10 opacity-50" aria-hidden="true" />
              <p className="text-sm">No templates match these filters.</p>
              {hasActiveFilters(filters) && (
                <Button variant="link" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Clear filters
                </Button>
              )}
            </div>
          )}

          {!isLoading && visible.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {visible.map((entry) => (
                <TemplateLibraryCard
                  key={entry.id}
                  entry={entry}
                  canUse={canEdit}
                  colourwayId={colourways[entry.id] ?? null}
                  onPreview={setPreviewEntry}
                  onUse={openUse}
                  onColourway={chooseColourway}
                />
              ))}
            </div>
          )}
        </>
      )}

      {isSuperadmin && <TemplateLibraryAdminPanel />}

      <TemplateReaderDialog
        entry={previewEntry}
        open={!!previewEntry}
        onOpenChange={(open) => { if (!open) setPreviewEntry(null); }}
        canUse={canEdit}
        onUse={(entry, colourwayId) => {
          // Keep the reader's choice on the grid too, so closing the copy
          // dialog leaves the card showing what the user was just reading.
          if (colourwayId) chooseColourway(entry, colourwayId);
          setPreviewEntry(null);
          openUse(entry, colourwayId);
        }}
      />

      <UseTemplateDialog
        entry={useEntry}
        colourwayId={useColourway}
        open={!!useEntry}
        onOpenChange={(open) => { if (!open) setUseEntry(null); }}
      />
    </div>
  );
}

export default TemplateLibraryTab;
