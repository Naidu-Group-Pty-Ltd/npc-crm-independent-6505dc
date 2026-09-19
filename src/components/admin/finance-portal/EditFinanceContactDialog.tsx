import { useEffect, useState } from 'react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Pencil, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface EditableFinanceContact {
  id: string;
  name: string;
  email: string;
  company: string | null;
  contact_type: string;
  is_default: boolean;
  notes?: string | null;
  hasPortalUser?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: EditableFinanceContact | null;
  onSaved: () => void;
}

const CONTACT_TYPES = [
  { value: 'external', label: 'External (Broker / Referrer / Partner)' },
  { value: 'internal', label: 'Internal Staff' },
];

export function EditFinanceContactDialog({ open, onOpenChange, contact, onSaved }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', company: '', contact_type: 'external',
    notes: '', is_default: false,
  });

  useEffect(() => {
    if (contact) {
      setForm({
        name: contact.name || '',
        email: contact.email || '',
        company: contact.company || '',
        contact_type: contact.contact_type || 'external',
        notes: contact.notes || '',
        is_default: !!contact.is_default,
      });
    }
  }, [contact]);

  if (!contact) return null;

  const emailChanged = form.email.trim().toLowerCase() !== (contact.email || '').toLowerCase();

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

    setSubmitting(true);
    try {
      const { data, error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'update_contact',
        contact_id: contact.id,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        company: form.company.trim() || null,
        contact_type: form.contact_type,
        notes: form.notes.trim() || null,
        is_default: form.is_default,
      });
      if (error) throw new Error(error.message);
      toast.success('Finance contact updated');
      if ((data as any)?.email_changed && (data as any)?.portal_email_synced) {
        toast.info('Login email synced for the portal user. They must use the new email next login.');
      }
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update contact');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            Edit Finance Contact
          </DialogTitle>
          <DialogDescription>
            Update contact details. Email changes are synced to the portal login record.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ec-name">Name *</Label>
              <Input
                id="ec-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-email">Email *</Label>
              <Input
                id="ec-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                maxLength={255}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-company">Company</Label>
              <Input
                id="ec-company"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-type">Contact Type</Label>
              <Select value={form.contact_type} onValueChange={(v) => setForm({ ...form, contact_type: v })}>
                <SelectTrigger id="ec-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label htmlFor="ec-default" className="cursor-pointer">Set as Default Contact</Label>
            <Switch
              id="ec-default"
              checked={form.is_default}
              onCheckedChange={(c) => setForm({ ...form, is_default: c })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ec-notes">Notes</Label>
            <Textarea
              id="ec-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              maxLength={2000}
            />
          </div>

          {emailChanged && contact.hasPortalUser && (
            <Alert variant="default" className="border-warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Changing the email will update this user's portal login address. They will need to use{' '}
                <strong>{form.email.trim().toLowerCase()}</strong> at next sign-in.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
