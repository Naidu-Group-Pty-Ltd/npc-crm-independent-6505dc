import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { industrialApi, useIndustrialTenancies, type IndustrialTenancy } from '@/hooks/useIndustrialProperties';
import { IndustrialTenancyFormModal } from './IndustrialTenancyFormModal';
import { calculateIndustrialWale } from '@/utils/industrial';
import { toast } from '@/hooks/use-toast';

interface Props { propertyId: string; }

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
}
function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU');
}

export function IndustrialRentRollTable({ propertyId }: Props) {
  const { tenancies, loading, refresh } = useIndustrialTenancies(propertyId);
  const [editing, setEditing] = useState<IndustrialTenancy | null>(null);
  const [open, setOpen] = useState(false);

  const totalRent = tenancies.reduce((a, t) => a + (Number(t.base_rent_pa) || 0), 0);
  const totalArea = tenancies.reduce((a, t) => a + (Number(t.gla_sqm) || 0), 0);
  const wale = calculateIndustrialWale(tenancies.map(t => ({
    base_rent_pa: t.base_rent_pa || 0,
    gla_sqm: t.gla_sqm || 0,
    lease_end: t.lease_end || null,
  })));

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this tenancy?')) return;
    const res = await industrialApi.deleteTenancy(id);
    if (res.error) toast({ title: 'Delete failed', description: res.error.message, variant: 'destructive' });
    else { toast({ title: 'Tenancy deleted' }); refresh(); }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Rent Roll</CardTitle>
            <div className="text-sm text-muted-foreground mt-1">
              {tenancies.length} tenancies · {fmtMoney(totalRent)} PA · {totalArea.toLocaleString('en-AU')} m² · WALE {wale.waleByIncome}y (income), {wale.waleByArea}y (area)
            </div>
          </div>
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Add Tenancy
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center text-muted-foreground py-8">Loading…</div>
          ) : tenancies.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No tenancies yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">GLA (m²)</TableHead>
                  <TableHead className="text-right">$/m² PA</TableHead>
                  <TableHead className="text-right">Rent PA</TableHead>
                  <TableHead>Recovery</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenancies.map(t => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      {t.tenant_name}
                      {t.anzsic_industry && <div className="text-xs text-muted-foreground">{t.anzsic_industry}</div>}
                    </TableCell>
                    <TableCell>{t.unit_label || '—'}</TableCell>
                    <TableCell className="text-right">{t.gla_sqm?.toLocaleString('en-AU') || '—'}</TableCell>
                    <TableCell className="text-right">{t.base_rent_per_sqm_pa ? `$${Number(t.base_rent_per_sqm_pa).toFixed(2)}` : '—'}</TableCell>
                    <TableCell className="text-right">{fmtMoney(t.base_rent_pa)}</TableCell>
                    <TableCell><Badge variant="secondary" className="capitalize">{t.outgoings_recovery_type.replace('_', ' ')}</Badge></TableCell>
                    <TableCell className="capitalize text-xs">{t.annual_review_type.replace('_', ' ')}{t.review_rate_pct ? ` ${t.review_rate_pct}%` : ''}</TableCell>
                    <TableCell>{fmtDate(t.lease_end)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(t); setOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(t.id)}>
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
        <IndustrialTenancyFormModal
          open={open}
          onClose={() => setOpen(false)}
          propertyId={propertyId}
          tenancy={editing}
          onSaved={refresh}
        />
      )}
    </>
  );
}
