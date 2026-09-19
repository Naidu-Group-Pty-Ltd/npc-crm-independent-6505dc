import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface CreateFinanceContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (newContactId: string) => void;
}

const CONTACT_TYPES = [
  { value: 'external', label: 'External (Broker / Referrer / Partner)' },
  { value: 'internal', label: 'Internal Staff' },
];

const COMMISSION_BASES = [
  { value: 'gross_loan_amount', label: 'Gross Loan Amount' },
  { value: 'net_loan_amount', label: 'Net Loan Amount' },
  { value: 'flat_fee', label: 'Flat Fee' },
  { value: 'trail', label: 'Trail Commission' },
];

export function CreateFinanceContactDialog({ open, onOpenChange, onCreated }: CreateFinanceContactDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    company: '',
    contact_type: 'external',
    abn: '',
    default_commission_basis: '',
    default_commission_rate_pct: '',
    gst_registered: false,
    is_default: false,
    is_active: true,
    notes: '',
  });

  const reset = () => setForm({
    name: '', email: '', company: '', contact_type: 'external',
    abn: '', default_commission_basis: '', default_commission_rate_pct: '',
    gst_registered: false, is_default: false, is_active: true, notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || form.name.trim().length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(form.email.trim())) {
      toast.error('Please enter a valid email');
      return;
    }
    if (form.default_commission_rate_pct) {
      const n = Number(form.default_commission_rate_pct);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        toast.error('Commission rate must be between 0 and 100');
        return;
      }
    }

    setSubmitting(true);
    try {
      const { data, error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'create_contact',
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        company: form.company.trim() || null,
        contact_type: form.contact_type,
        abn: form.abn.trim() || null,
        default_commission_basis: form.default_commission_basis || null,
        default_commission_rate_pct: form.default_commission_rate_pct === '' ? null : Number(form.default_commission_rate_pct),
        gst_registered: form.gst_registered,
        is_default: form.is_default,
        is_active: form.is_active,
        notes: form.notes.trim() || null,
      });
      if (error) throw new Error(error.message);
      const created = (data as any)?.record;
      toast.success(`Finance contact "${created?.name}" created`);
      reset();
      onOpenChange(false);
      onCreated(created?.id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create finance contact');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            New Finance Contact
          </DialogTitle>
          <DialogDescription>
            Create a new broker, referrer or partner. You can invite them to the Finance Portal once created.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="fc-name">Name *</Label>
              <Input
                id="fc-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Jane Smith"
                maxLength={200}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fc-email">Email *</Label>
              <Input
                id="fc-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="jane@brokerage.com.au"
                maxLength={255}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fc-company">Company</Label>
              <Input
                id="fc-company"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="Brokerage Pty Ltd"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fc-type">Contact Type</Label>
              <Select value={form.contact_type} onValueChange={(v) => setForm({ ...form, contact_type: v })}>
                <SelectTrigger id="fc-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fc-abn">ABN</Label>
              <Input
                id="fc-abn"
                value={form.abn}
                onChange={(e) => setForm({ ...form, abn: e.target.value })}
                placeholder="11 222 333 444"
                maxLength={20}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fc-comm-basis">Default Commission Basis</Label>
              <Select
                value={form.default_commission_basis || 'none'}
                onValueChange={(v) => setForm({ ...form, default_commission_basis: v === 'none' ? '' : v })}
              >
                <SelectTrigger id="fc-comm-basis"><SelectValue placeholder="Not set" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Not set —</SelectItem>
                  {COMMISSION_BASES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fc-comm-rate">Default Commission Rate (%)</Label>
              <Input
                id="fc-comm-rate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.default_commission_rate_pct}
                onChange={(e) => setForm({ ...form, default_commission_rate_pct: e.target.value })}
                placeholder="e.g. 0.65"
              />
            </div>
            <div className="flex flex-col gap-3 pt-6">
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label htmlFor="fc-gst" className="cursor-pointer">GST Registered</Label>
                <Switch
                  id="fc-gst"
                  checked={form.gst_registered}
                  onCheckedChange={(c) => setForm({ ...form, gst_registered: c })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label htmlFor="fc-default" className="cursor-pointer">Set as Default Contact</Label>
                <Switch
                  id="fc-default"
                  checked={form.is_default}
                  onCheckedChange={(c) => setForm({ ...form, is_default: c })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="space-y-0.5">
                  <Label htmlFor="fc-active" className="cursor-pointer">Active</Label>
                  <p className="text-xs text-muted-foreground">Inactive contacts can't be invited or used.</p>
                </div>
                <Switch
                  id="fc-active"
                  checked={form.is_active}
                  onCheckedChange={(c) => setForm({ ...form, is_active: c })}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fc-notes">Notes</Label>
            <Textarea
              id="fc-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Internal notes (optional)"
              rows={3}
              maxLength={2000}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Create Contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
