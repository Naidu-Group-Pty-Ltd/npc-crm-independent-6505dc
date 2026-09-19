import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { Loader2, Save, UserPlus } from 'lucide-react';
import type { SolicitorFirm } from './SolicitorFirmDialog';

export const SOLICITOR_ROLES = [
  { value: 'solicitor', label: 'Solicitor' },
  { value: 'conveyancer', label: 'Conveyancer' },
  { value: 'paralegal', label: 'Paralegal' },
  { value: 'practice_admin', label: 'Practice Admin' },
];

export interface SolicitorUserRow {
  id: string;
  firm_id: string;
  firm_name: string | null;
  firm_is_active: boolean;
  email: string;
  name: string;
  phone: string | null;
  position: string | null;
  portal_role: string;
  is_active: boolean;
  must_change_password: boolean;
  invited_at: string | null;
  invite_accepted_at: string | null;
  invite_token_expires_at: string | null;
  last_login_at: string | null;
  last_seen_at: string | null;
  has_accepted_terms: boolean;
  has_completed_onboarding: boolean;
  terms_accepted_at: string | null;
  revoked_at: string | null;
  locked_until: string | null;
  notes: string | null;
  created_at: string;
  assignment_count: number;
  status: 'no_access' | 'invited' | 'invite_expired' | 'active' | 'inactive' | 'revoked';
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: SolicitorUserRow | null;
  firms: SolicitorFirm[];
  defaultFirmId?: string | null;
  onSaved: () => void;
}

export function SolicitorUserDialog({ open, onOpenChange, user, firms, defaultFirmId, onSaved }: Props) {
  const [firmId, setFirmId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [role, setRole] = useState('solicitor');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirmId(user?.firm_id ?? defaultFirmId ?? '');
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    setPhone(user?.phone ?? '');
    setPosition(user?.position ?? '');
    setRole(user?.portal_role ?? 'solicitor');
    setNotes(user?.notes ?? '');
  }, [open, user, defaultFirmId]);

  const activeFirms = firms.filter(f => f.is_active || f.id === user?.firm_id);

  const save = async () => {
    if (!firmId) { toast.error('Select a legal practice'); return; }
    if (!name.trim()) { toast.error('Full name is required'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast.error('A valid email address is required'); return; }

    setSaving(true);
    try {
      const payload = user
        ? {
            operation: 'update_user',
            solicitor_user_id: user.id,
            firm_id: firmId, name, email, phone, position, portal_role: role, notes,
          }
        : {
            operation: 'create_user',
            firm_id: firmId, name, email, phone, position, portal_role: role, notes,
          };
      const { data, error } = await invokeSecureFunction('solicitor-portal-admin', payload);
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(user ? 'Portal user updated' : 'Portal user created — send an invite to grant access');
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save portal user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            {user ? 'Edit Portal User' : 'New Solicitor Portal User'}
          </DialogTitle>
          <DialogDescription>
            {user
              ? 'Update contact details, practice and role. Access itself is controlled by invites and permissions.'
              : 'Creating a user does not grant access — send them an invite once the record is saved.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {activeFirms.length === 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              No active legal practice exists yet. Create one under the Legal Practices tab before adding portal users.
            </div>
          )}
          <div className="space-y-2">
            <Label>Legal practice *</Label>
            <Select value={firmId} onValueChange={setFirmId} disabled={activeFirms.length === 0}>
              <SelectTrigger><SelectValue placeholder="Select a practice..." /></SelectTrigger>
              <SelectContent>
                {activeFirms.map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.trading_name || f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>


          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Full name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Whitmore" />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOLICITOR_ROLES.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Email *</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@practice.com.au" />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Position</Label>
              <Input value={position} onChange={e => setPosition(e.target.value)} placeholder="Principal" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Internal notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || activeFirms.length === 0} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {user ? 'Save changes' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
