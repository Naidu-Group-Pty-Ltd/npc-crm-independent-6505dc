import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import {
  commercialApi,
  useCommercialCapex,
  type CommercialCapexCategory,
  type CommercialCapexItem,
} from '@/hooks/useCommercialProperties';
import { toast } from '@/hooks/use-toast';

interface Props { propertyId: string; }

const CATEGORIES: { value: CommercialCapexCategory; label: string }[] = [
  { value: 'base_building', label: 'Base Building' },
  { value: 'fit_out', label: 'Fit Out' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'lifts', label: 'Lifts' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'roof', label: 'Roof' },
  { value: 'facade', label: 'Façade' },
  { value: 'sustainability', label: 'Sustainability' },
  { value: 'other', label: 'Other' },
];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);

export function CommercialCapexTable({ propertyId }: Props) {
  const { items, loading, refresh } = useCommercialCapex(propertyId);
  const [editing, setEditing] = useState<CommercialCapexItem | null>(null);
  const [open, setOpen] = useState(false);

  const total = items.reduce((s, i) => s + Number(i.amount || 0), 0);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete capex item?')) return;
    const res = await commercialApi.deleteCapex(id);
    if (res.error) toast({ title: 'Delete failed', description: res.error.message, variant: 'destructive' });
    else { toast({ title: 'Capex item deleted' }); refresh(); }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Capex Schedule</CardTitle>
            <div className="text-sm text-muted-foreground mt-1">
              {items.length} items · Total {fmt(total)}
            </div>
          </div>
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> Add Capex
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center text-muted-foreground py-8">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No capex items planned.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Year</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.sort((a, b) => a.year - b.year).map(i => (
                  <TableRow key={i.id}>
                    <TableCell>{i.year}</TableCell>
                    <TableCell><Badge variant="secondary" className="capitalize">{String(i.category).replace(/_/g, ' ')}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{fmt(Number(i.amount))}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[400px] truncate">{i.notes || '—'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(i); setOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(i.id)}>
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
        <CapexFormModal
          open={open}
          onClose={() => setOpen(false)}
          propertyId={propertyId}
          item={editing}
          onSaved={refresh}
        />
      )}
    </>
  );
}

function CapexFormModal({ open, onClose, propertyId, item, onSaved }: {
  open: boolean; onClose: () => void; propertyId: string; item?: CommercialCapexItem | null; onSaved: () => void;
}) {
  const isEdit = !!item;
  const [year, setYear] = useState(String(item?.year ?? new Date().getFullYear()));
  const [amount, setAmount] = useState(String(item?.amount ?? ''));
  const [category, setCategory] = useState<CommercialCapexCategory>((item?.category as CommercialCapexCategory) ?? 'other');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      property_id: propertyId,
      year: Number(year),
      amount: Number(amount) || 0,
      category,
      notes: notes || null,
    };
    const res = isEdit
      ? await commercialApi.updateCapex(item!.id, payload)
      : await commercialApi.createCapex(payload);
    setSaving(false);
    if (res.error) {
      toast({ title: 'Save failed', description: res.error.message, variant: 'destructive' });
      return;
    }
    toast({ title: isEdit ? 'Capex updated' : 'Capex added' });
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Capex' : 'Add Capex'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Year</Label><Input type="number" value={year} onChange={e => setYear(e.target.value)} /></div>
          <div><Label>Amount ($)</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as CommercialCapexCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Notes</Label><Textarea rows={3} value={notes ?? ''} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
