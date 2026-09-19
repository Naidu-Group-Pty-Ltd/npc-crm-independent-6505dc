import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { commercialApi, useCommercialLeases, type CommercialLease } from '@/hooks/useCommercialProperties';
import { LeaseFormModal } from './LeaseFormModal';
import { calculateWale } from '@/utils/commercial';
import { toast } from '@/hooks/use-toast';

interface Props {
  propertyId: string;
}

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU');
}

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  occupied: 'default',
  vacant: 'destructive',
  holdover: 'outline',
  under_offer: 'secondary',
  expired: 'destructive',
};

export function RentRollTable({ propertyId }: Props) {
  const { leases, loading, refresh } = useCommercialLeases(propertyId);
  const [editing, setEditing] = useState<CommercialLease | null>(null);
  const [open, setOpen] = useState(false);

  const totalRent = leases.reduce((a, l) => a + (Number(l.base_rent_pa) || 0), 0);
  const totalArea = leases.reduce((a, l) => a + (Number(l.nla_sqm) || 0), 0);
  const wale = calculateWale(leases);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this tenancy?')) return;
    const res = await commercialApi.deleteLease(id);
    if (res.error) {
      toast({ title: 'Delete failed', description: res.error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Tenancy deleted' });
      refresh();
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Rent Roll</CardTitle>
            <div className="text-sm text-muted-foreground mt-1">
              {leases.length} tenancies · Total {fmtMoney(totalRent)} PA · {totalArea.toLocaleString('en-AU')} m² · WALE {wale.waleByIncome}y (income), {wale.waleByArea}y (area)
            </div>
          </div>
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Add Tenancy
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center text-muted-foreground py-8">Loading…</div>
          ) : leases.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No tenancies yet. Add the first one to start building the rent roll.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Suite</TableHead>
                  <TableHead className="text-right">NLA (m²)</TableHead>
                  <TableHead className="text-right">Rent PA</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leases.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.tenant_name}</TableCell>
                    <TableCell>{l.suite_unit || '—'}</TableCell>
                    <TableCell className="text-right">{l.nla_sqm?.toLocaleString('en-AU') || '—'}</TableCell>
                    <TableCell className="text-right">{fmtMoney(l.base_rent_pa)}</TableCell>
                    <TableCell className="capitalize">{l.rent_basis}</TableCell>
                    <TableCell>{fmtDate(l.lease_end)}</TableCell>
                    <TableCell className="capitalize">{l.review_type.replace('_', ' ')}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[l.status] || 'outline'} className="capitalize">{l.status.replace('_', ' ')}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(l); setOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(l.id)}>
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
        <LeaseFormModal
          open={open}
          onClose={() => setOpen(false)}
          propertyId={propertyId}
          lease={editing}
          onSaved={refresh}
        />
      )}
    </>
  );
}
