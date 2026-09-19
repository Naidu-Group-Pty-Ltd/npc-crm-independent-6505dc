/**
 * The commercial / industrial asset register.
 *
 * Extracted from the old `CommercialProperties` page so the register survives
 * intact under the new Properties tab — every existing record, route and modal
 * still works. The one behavioural change is the decluttering the brief asked
 * for: a single "Add property" action with a segment choice, instead of
 * duplicated "New Commercial" and "New Industrial" buttons.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchInput } from '@/components/ui/search-input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Building2, Factory, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCommercialProperties, commercialApi, type CommercialProperty } from '@/hooks/useCommercialProperties';
import { useIndustrialProperties, industrialApi, type IndustrialProperty } from '@/hooks/useIndustrialProperties';
import { CommercialPropertyFormModal } from '@/components/commercial/CommercialPropertyFormModal';
import { IndustrialPropertyFormModal } from '@/components/industrial/IndustrialPropertyFormModal';
import { toast } from '@/hooks/use-toast';

type AssetKind = 'commercial' | 'industrial';
type CombinedRow =
  | { kind: 'commercial'; property: CommercialProperty }
  | { kind: 'industrial'; property: IndustrialProperty };

const ASSET_LABEL: Record<string, string> = {
  office: 'Office', retail: 'Retail', industrial: 'Industrial', mixed_use: 'Mixed use',
  medical: 'Medical', childcare: 'Childcare', hospitality: 'Hospitality', other: 'Other',
};

const SUBTYPE_LABEL: Record<string, string> = {
  warehouse: 'Warehouse', logistics: 'Logistics', manufacturing: 'Manufacturing',
  cold_storage: 'Cold storage', flex: 'Flex / estate', data_centre: 'Data centre',
  transport_yard: 'Transport yard', other: 'Other',
};

function money(value: number | null | undefined) {
  if (!value) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
  }).format(value);
}

function commercialAddress(property: CommercialProperty) {
  return [property.address, [property.suburb, property.state, property.postcode].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
}

function industrialAddress(property: IndustrialProperty) {
  return [property.street, [property.suburb, property.state, property.postcode].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
}

function Value({ children }: { children: ReactNode }) {
  const missing = children === '—' || children == null || children === '';
  return <span className={missing ? 'text-muted-foreground' : ''}>{missing ? '—' : children}</span>;
}

export function CommercialPropertyRegister() {
  const commercial = useCommercialProperties();
  const industrial = useIndustrialProperties();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | AssetKind>('all');
  const [commercialOpen, setCommercialOpen] = useState(false);
  const [industrialOpen, setIndustrialOpen] = useState(false);
  const [editingCommercial, setEditingCommercial] = useState<CommercialProperty | null>(null);
  const [editingIndustrial, setEditingIndustrial] = useState<IndustrialProperty | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CombinedRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const rows = useMemo<CombinedRow[]>(() => {
    const combined: CombinedRow[] = [
      ...commercial.properties.map((property) => ({ kind: 'commercial' as const, property })),
      ...industrial.properties.map((property) => ({ kind: 'industrial' as const, property })),
    ];
    const byKind = kindFilter === 'all' ? combined : combined.filter((row) => row.kind === kindFilter);
    const term = search.trim().toLowerCase();
    if (!term) return byKind;
    return byKind.filter((row) => {
      const address = row.kind === 'industrial' ? industrialAddress(row.property) : commercialAddress(row.property);
      const name = row.kind === 'industrial' ? (row.property.property_name ?? '') : '';
      return `${address} ${name}`.toLowerCase().includes(term);
    });
  }, [commercial.properties, industrial.properties, kindFilter, search]);

  const loading = commercial.loading || industrial.loading;

  const refreshAll = () => {
    commercial.refresh();
    industrial.refresh();
  };

  const openNew = (kind: AssetKind) => {
    if (kind === 'commercial') {
      setEditingCommercial(null);
      setCommercialOpen(true);
    } else {
      setEditingIndustrial(null);
      setIndustrialOpen(true);
    }
  };

  const editRow = (row: CombinedRow) => {
    if (row.kind === 'commercial') {
      setEditingCommercial(row.property);
      setCommercialOpen(true);
    } else {
      setEditingIndustrial(row.property);
      setIndustrialOpen(true);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const result = pendingDelete.kind === 'commercial'
      ? await commercialApi.deleteProperty(pendingDelete.property.id)
      : await industrialApi.deleteProperty(pendingDelete.property.id);
    setDeleting(false);
    setPendingDelete(null);

    if (result.error) {
      toast({ title: 'Delete failed', description: result.error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Property deleted' });
    refreshAll();
  };

  const deleteLabel = pendingDelete
    ? (pendingDelete.kind === 'commercial'
      ? commercialAddress(pendingDelete.property)
      : industrialAddress(pendingDelete.property)) || 'this property'
    : '';

  return (
    <div className="space-y-4">
      <div className="ci-toolbar">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search properties"
          aria-label="Search properties"
          containerClassName="w-full max-w-sm"
        />
        <div className="ci-toolbar-filters">
          <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Filter by segment">
            {([
              { key: 'all' as const, label: `All (${commercial.properties.length + industrial.properties.length})` },
              { key: 'commercial' as const, label: `Commercial (${commercial.properties.length})` },
              { key: 'industrial' as const, label: `Industrial (${industrial.properties.length})` },
            ]).map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={kindFilter === option.key}
                onClick={() => setKindFilter(option.key)}
                className={
                  kindFilter === option.key
                    ? 'border-r border-border bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground last:border-r-0'
                    : 'border-r border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground last:border-r-0 hover:bg-muted'
                }
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* One action, with the segment as a choice inside it. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add property
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openNew('commercial')}>
                <Building2 className="mr-2 h-4 w-4" aria-hidden="true" /> Commercial property
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openNew('industrial')}>
                <Factory className="mr-2 h-4 w-4" aria-hidden="true" /> Industrial property
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading asset register…
        </div>
      ) : !rows.length ? (
        <div className="ci-inline-empty">
          <div className="ci-inline-empty-copy">
            <p className="ci-inline-empty-title">
              {search ? 'No properties match this search' : 'No properties in the register'}
            </p>
            <p className="ci-inline-empty-body">
              Add an asset manually, scrape a listing URL, or parse a PDF or image in the property form.
            </p>
          </div>
          <Button size="sm" onClick={() => openNew('commercial')}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add property
          </Button>
        </div>
      ) : (
        <div className="ci-table-wrap" role="region" aria-label="Commercial and industrial properties" tabIndex={0}>
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[260px]">Property</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Area (m²)</TableHead>
                <TableHead className="text-right">Site (m²)</TableHead>
                <TableHead className="text-right">Price / valuation</TableHead>
                <TableHead>Status / GST</TableHead>
                <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const property = row.property as CommercialProperty & IndustrialProperty;
                const isIndustrial = row.kind === 'industrial';
                const address = isIndustrial ? industrialAddress(property) : commercialAddress(property);
                const area = isIndustrial ? property.gla_sqm : (property.nla_sqm || property.gfa_sqm);
                const value = isIndustrial
                  ? (property.current_valuation || property.purchase_price)
                  : (property.valuation || property.purchase_price);
                const statusValue = isIndustrial
                  ? property.status?.replace(/_/g, ' ')
                  : property.gst_treatment?.replace(/_/g, ' ');

                return (
                  <TableRow key={`${row.kind}-${property.id}`}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => navigate(`/${row.kind}/${property.id}`)}
                      >
                        {isIndustrial && property.property_name ? property.property_name : (address || 'Untitled property')}
                      </button>
                      {isIndustrial && property.property_name ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{address}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="ci-segment-tag">
                        {isIndustrial
                          ? <Factory className="h-3 w-3" aria-hidden="true" />
                          : <Building2 className="h-3 w-3" aria-hidden="true" />}
                        {isIndustrial ? 'Industrial' : 'Commercial'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Value>
                        {isIndustrial
                          ? (SUBTYPE_LABEL[property.asset_subtype] || property.asset_subtype)
                          : (ASSET_LABEL[property.asset_class] || property.asset_class)}
                      </Value>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      <Value>{area?.toLocaleString('en-AU') || '—'}</Value>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      <Value>{property.site_area_sqm?.toLocaleString('en-AU') || '—'}</Value>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">
                      <Value>{money(value)}</Value>
                    </TableCell>
                    <TableCell className="text-sm capitalize text-muted-foreground">
                      <Value>{statusValue || '—'}</Value>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8"
                          onClick={() => editRow(row)}
                          aria-label={`Edit ${address || 'property'}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setPendingDelete(row)}
                          aria-label={`Delete ${address || 'property'}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {commercialOpen ? (
        <CommercialPropertyFormModal
          open={commercialOpen}
          onClose={() => setCommercialOpen(false)}
          property={editingCommercial}
          onSaved={refreshAll}
        />
      ) : null}
      {industrialOpen ? (
        <IndustrialPropertyFormModal
          open={industrialOpen}
          onClose={() => setIndustrialOpen(false)}
          property={editingIndustrial}
          onSaved={refreshAll}
        />
      ) : null}

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteLabel}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This also deletes the property&apos;s tenancies, capital expenditure and saved scenarios.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete property'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
