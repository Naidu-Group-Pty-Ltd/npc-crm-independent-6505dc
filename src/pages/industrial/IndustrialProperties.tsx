import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Pencil, Trash2, Factory } from 'lucide-react';
import { useIndustrialProperties, industrialApi, type IndustrialProperty } from '@/hooks/useIndustrialProperties';
import { IndustrialPropertyFormModal } from '@/components/industrial/IndustrialPropertyFormModal';
import { toast } from '@/hooks/use-toast';

function fmtMoney(n: number | null | undefined) {
  if (!n) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
}

const SUBTYPE_LABEL: Record<string, string> = {
  warehouse: 'Warehouse', logistics: 'Logistics', manufacturing: 'Manufacturing',
  cold_storage: 'Cold Storage', flex: 'Flex / Estate', data_centre: 'Data Centre',
  transport_yard: 'Transport Yard', other: 'Other',
};

export default function IndustrialProperties() {
  const { properties, loading, refresh } = useIndustrialProperties();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<IndustrialProperty | null>(null);
  const navigate = useNavigate();

  const handleDelete = async (id: string, addr: string) => {
    if (!confirm(`Delete "${addr}" and all tenancies & capex?`)) return;
    const res = await industrialApi.deleteProperty(id);
    if (res.error) toast({ title: 'Delete failed', description: res.error.message, variant: 'destructive' });
    else { toast({ title: 'Property deleted' }); refresh(); }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Factory className="h-7 w-7 text-primary" />
            Industrial Properties
          </h1>
          <p className="text-muted-foreground mt-1">
            Warehouses, logistics, manufacturing and cold-storage assets — rent rolls, site cover, NOI and serviceability.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/calculators?domain=industrial')}>Calculators</Button>
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> New Property
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center text-muted-foreground py-12">Loading…</div>
          ) : properties.length === 0 ? (
            <div className="text-center py-12">
              <Factory className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-lg font-medium">No industrial properties yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add your first industrial asset to start building the rent roll.</p>
              <Button className="mt-4" onClick={() => { setEditing(null); setOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" /> Add Property
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Sub-type</TableHead>
                  <TableHead className="text-right">GLA (m²)</TableHead>
                  <TableHead className="text-right">Site (m²)</TableHead>
                  <TableHead className="text-right">Valuation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map(p => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/industrial/${p.id}`)}>
                    <TableCell className="font-medium">
                      {p.property_name ? <div>{p.property_name}</div> : null}
                      <div className={p.property_name ? 'text-xs text-muted-foreground' : ''}>
                        {p.street}
                        {p.suburb && <>, {p.suburb} {p.state} {p.postcode}</>}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{SUBTYPE_LABEL[p.asset_subtype] || p.asset_subtype}</Badge></TableCell>
                    <TableCell className="text-right">{p.gla_sqm?.toLocaleString('en-AU') || '—'}</TableCell>
                    <TableCell className="text-right">{p.site_area_sqm?.toLocaleString('en-AU') || '—'}</TableCell>
                    <TableCell className="text-right">{fmtMoney(p.current_valuation || p.purchase_price)}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{p.status.replace('_', ' ')}</Badge></TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(p); setOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(p.id, p.street || 'property')}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {open && (
        <IndustrialPropertyFormModal
          open={open}
          onClose={() => setOpen(false)}
          property={editing}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
