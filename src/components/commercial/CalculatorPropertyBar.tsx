/**
 * Property selector bar shown above the Commercial / Industrial calculator
 * suites. Reads the available properties for the active domain and lets users
 * pick one to prefill every downstream calculator card.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, Database, Factory, Link2, Link2Off, Loader2 } from 'lucide-react';
import { useCalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { commercialApi, type CommercialProperty } from '@/hooks/useCommercialProperties';
import { industrialApi, type IndustrialProperty } from '@/hooks/useIndustrialProperties';

const UNASSIGNED = '__unassigned__';

export function CalculatorPropertyBar() {
  const { domain, prefill, property, loading, selectProperty, clear } = useCalculatorPrefill();
  const [list, setList] = useState<Array<{ id: string; label: string }>>([]);
  const [listLoading, setListLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListLoading(true);
      if (domain === 'commercial') {
        const res = await commercialApi.listProperties();
        if (!cancelled && res.data) {
          setList((res.data as CommercialProperty[]).map(p => ({
            id: p.id,
            label: `${p.address}${p.suburb ? `, ${p.suburb} ${p.state}` : ''}`,
          })));
        }
      } else {
        const res = await industrialApi.listProperties();
        if (!cancelled && res.data) {
          setList((res.data as IndustrialProperty[]).map(p => ({
            id: p.id,
            label: `${p.property_name || p.street || 'Untitled site'}${p.suburb ? `, ${p.suburb} ${p.state}` : ''}`,
          })));
        }
      }
      if (!cancelled) setListLoading(false);
    })();
    return () => { cancelled = true; };
  }, [domain]);

  const Icon = domain === 'industrial' ? Factory : Building2;

  return (
    <Card id="calculator-property-selector" className="border-border/60 bg-card/70 shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-[220px] items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Secondary selector</div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Database className="h-3.5 w-3.5 text-muted-foreground" /> Calculator data source</div>
            </div>
          </div>
          <div className="min-w-[260px] flex-1">
            <Select
              value={prefill?.propertyId ?? UNASSIGNED}
              onValueChange={(v) => selectProperty(v === UNASSIGNED ? null : v)}
              disabled={listLoading || loading}
            >
              <SelectTrigger className="h-11 border-border/70 bg-background/80 shadow-sm transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60">
                <SelectValue placeholder={listLoading ? 'Loading properties…' : 'Manual entry (no property linked)'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Manual entry (no property linked)</SelectItem>
                {list.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {prefill ? (
              <>
                <Badge variant="default" className="gap-1 px-2.5 py-1">
                  <Link2 className="h-3 w-3" /> Linked
                </Badge>
                {prefill.assetSubtype && <Badge variant="secondary" className="capitalize px-2.5 py-1">{String(prefill.assetSubtype).replace(/_/g, ' ')}</Badge>}
                <Button size="sm" variant="outline" onClick={clear}>
                  <Link2Off className="h-4 w-4 mr-1" /> Unlink
                </Button>
              </>
            ) : (
              <Badge variant="outline" className="border-dashed bg-background/80 px-2.5 py-1 font-medium text-muted-foreground">Manual</Badge>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/45 px-3 py-2 text-xs leading-5 text-muted-foreground">
          Choose a linked property to prefill calculator assumptions, or keep manual entry to work without a property connection.
          {property && (
            <span className="block pt-1">Prefill applied from the Active Property Header context. Edits stay local unless you save back to the property.</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
