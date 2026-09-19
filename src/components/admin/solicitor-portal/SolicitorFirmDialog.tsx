import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { Building2, Loader2, Save } from 'lucide-react';

export interface SolicitorFirm {
  id: string;
  name: string;
  trading_name: string | null;
  abn: string | null;
  licence_number: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  address_line1: string | null;
  address_line2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  practising_states: string[];
  notes: string | null;
  is_active: boolean;
  user_count?: number;
  active_user_count?: number;
}

const STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

const blank = {
  name: '', trading_name: '', abn: '', licence_number: '',
  contact_email: '', contact_phone: '', website: '',
  address_line1: '', address_line2: '', suburb: '', state: '', postcode: '',
  notes: '',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  firm: SolicitorFirm | null;
  onSaved: () => void;
}

export function SolicitorFirmDialog({ open, onOpenChange, firm, onSaved }: Props) {
  const [form, setForm] = useState({ ...blank });
  const [states, setStates] = useState<string[]>(['NSW']);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (firm) {
      setForm({
        name: firm.name ?? '',
        trading_name: firm.trading_name ?? '',
        abn: firm.abn ?? '',
        licence_number: firm.licence_number ?? '',
        contact_email: firm.contact_email ?? '',
        contact_phone: firm.contact_phone ?? '',
        website: firm.website ?? '',
        address_line1: firm.address_line1 ?? '',
        address_line2: firm.address_line2 ?? '',
        suburb: firm.suburb ?? '',
        state: firm.state ?? '',
        postcode: firm.postcode ?? '',
        notes: firm.notes ?? '',
      });
      setStates(firm.practising_states?.length ? firm.practising_states : ['NSW']);
    } else {
      setForm({ ...blank });
      setStates(['NSW']);
    }
  }, [open, firm]);

  const set = (key: keyof typeof blank, value: string) => setForm(f => ({ ...f, [key]: value }));

  const toggleState = (s: string) =>
    setStates(prev => (prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]));

  const save = async () => {
    if (!form.name.trim()) { toast.error('Practice name is required'); return; }
    setSaving(true);
    try {
      const { data, error } = await invokeSecureFunction('solicitor-portal-admin', {
        operation: 'upsert_firm',
        firm_id: firm?.id,
        ...form,
        practising_states: states,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(firm ? 'Legal practice updated' : 'Legal practice created');
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save legal practice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            {firm ? 'Edit Legal Practice' : 'New Legal Practice'}
          </DialogTitle>
          <DialogDescription>
            Practices group solicitors, conveyancers and paralegals. Portal users always belong to one practice.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-3">
          <div className="space-y-4 pb-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Practice name *</Label>
                <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Harbourside Legal Pty Ltd" />
              </div>
              <div className="space-y-2">
                <Label>Trading name</Label>
                <Input value={form.trading_name} onChange={e => set('trading_name', e.target.value)} placeholder="Harbourside Conveyancing" />
              </div>
              <div className="space-y-2">
                <Label>ABN</Label>
                <Input value={form.abn} onChange={e => set('abn', e.target.value)} placeholder="12 345 678 901" />
              </div>
              <div className="space-y-2">
                <Label>Practising certificate / licence no.</Label>
                <Input value={form.licence_number} onChange={e => set('licence_number', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Contact email</Label>
                <Input type="email" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} placeholder="admin@practice.com.au" />
              </div>
              <div className="space-y-2">
                <Label>Contact phone</Label>
                <Input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} placeholder="(02) 9000 0000" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Website</Label>
                <Input value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Practising states</Label>
              <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-muted/30 p-3">
                {STATES.map(s => (
                  <label key={s} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={states.includes(s)} onCheckedChange={() => toggleState(s)} />
                    {s}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Drives state-specific conveyancing rules (cooling-off periods, settlement conventions) in later phases.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Address line 1</Label>
                <Input value={form.address_line1} onChange={e => set('address_line1', e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Address line 2</Label>
                <Input value={form.address_line2} onChange={e => set('address_line2', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Suburb</Label>
                <Input value={form.suburb} onChange={e => set('suburb', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>State</Label>
                  <Input value={form.state} onChange={e => set('state', e.target.value.toUpperCase())} maxLength={3} />
                </div>
                <div className="space-y-2">
                  <Label>Postcode</Label>
                  <Input value={form.postcode} onChange={e => set('postcode', e.target.value)} maxLength={4} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Internal notes</Label>
              <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Not visible to the practice." />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {firm ? 'Save changes' : 'Create practice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
