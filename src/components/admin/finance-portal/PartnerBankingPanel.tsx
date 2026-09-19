/**
 * Phase 5 — Partner banking verification register (Doc 2 §9.3).
 *
 * Bank details are restricted and versioned: any change to BSB, account number
 * or account name resets the record to pending verification, and payouts are
 * blocked until an independent verification (e.g. callback to a known number)
 * is recorded here.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { BadgeCheck, Landmark, Loader2, ShieldQuestion } from 'lucide-react';
import { format } from 'date-fns';

const label = (s: any) => String(s ?? '').replace(/_/g, ' ');

const STATUS_META: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; text: string }> = {
  verified: { variant: 'default', text: 'Verified' },
  pending_verification: { variant: 'secondary', text: 'Pending verification' },
  rejected: { variant: 'destructive', text: 'Rejected' },
  superseded: { variant: 'outline', text: 'Superseded' },
};

interface Props {
  partners: { id: string; name: string; company: string | null }[];
  onChanged?: () => void;
}

export function PartnerBankingPanel({ partners, onChanged }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<any | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await invokeSecureFunction('finance-portal-commissions', { operation: 'list_bank_details' });
    if (error) toast.error(error.message);
    setRows(data?.bank_details || []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const unverified = useMemo(() => rows.filter(r => r.status === 'pending_verification').length, [rows]);

  return (
    <Card className="border-0 bg-transparent shadow-none">
      <CardHeader className="border-b border-border/60 bg-gradient-to-r from-card/80 to-muted/25 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-primary" />Partner banking
          </CardTitle>
          {unverified > 0 && (
            <Badge variant="secondary" className="gap-1">
              <ShieldQuestion className="h-3 w-3" />{unverified} awaiting verification
            </Badge>
          )}
          <Button className="ml-auto rounded-xl" onClick={() => setShowEdit(true)}>Record bank details</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Payment is blocked until details are independently verified. Changing the BSB, account number or account name resets verification.
        </p>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading banking records…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No banking details on file. Record and verify details before issuing any remittance.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Account name</TableHead>
                  <TableHead>BSB</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const meta = STATUS_META[r.status] || { variant: 'outline' as const, text: label(r.status) };
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.partner_name_snapshot || '—'}</TableCell>
                      <TableCell className="text-sm">{r.account_name || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.bsb_masked || r.bsb || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.account_number_masked || '—'}</TableCell>
                      <TableCell className="text-sm">v{r.version ?? 1}</TableCell>
                      <TableCell className="text-xs">
                        {r.verified_at ? (
                          <>
                            <div>{format(new Date(r.verified_at), 'dd MMM yyyy')}</div>
                            <div className="text-muted-foreground">{r.verification_method ? label(r.verification_method) : ''}</div>
                          </>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={meta.variant} className="gap-1">
                          {r.status === 'verified' && <BadgeCheck className="h-3 w-3" />}{meta.text}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === 'pending_verification' && (
                          <Button size="sm" variant="outline" onClick={() => setVerifyTarget(r)}>Verify</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {showEdit && (
        <BankDetailsDialog
          partners={partners}
          onClose={(changed) => { setShowEdit(false); if (changed) { void load(); onChanged?.(); } }}
        />
      )}
      {verifyTarget && (
        <VerifyDialog
          record={verifyTarget}
          onClose={(changed) => { setVerifyTarget(null); if (changed) { void load(); onChanged?.(); } }}
        />
      )}
    </Card>
  );
}

function BankDetailsDialog({ partners, onClose }: {
  partners: { id: string; name: string; company: string | null }[];
  onClose: (changed: boolean) => void;
}) {
  const [partnerId, setPartnerId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [bsb, setBsb] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!partnerId || !accountName.trim() || !bsb.trim() || !accountNumber.trim()) {
      toast.error('Partner, account name, BSB and account number are required');
      return;
    }
    setSaving(true);
    const { data, error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: 'upsert_bank_details',
      finance_contact_id: partnerId,
      account_name: accountName.trim(),
      bsb: bsb.replace(/\s|-/g, ''),
      account_number: accountNumber.replace(/\s/g, ''),
      bank_name: bankName.trim() || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success('Bank details recorded — independent verification required before payment');
    onClose(true);
  };

  return (
    <Dialog open onOpenChange={() => onClose(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record bank details</DialogTitle>
          <DialogDescription>
            Saving new details creates a new version and resets verification to pending.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Partner</Label>
            <Select value={partnerId} onValueChange={setPartnerId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select partner" /></SelectTrigger>
              <SelectContent>
                {partners.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.company ? ` · ${p.company}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="bank-account-name">Account name</Label>
            <Input id="bank-account-name" className="mt-1" value={accountName} onChange={e => setAccountName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="bank-bsb">BSB</Label>
              <Input id="bank-bsb" className="mt-1" inputMode="numeric" maxLength={7} value={bsb} onChange={e => setBsb(e.target.value)} placeholder="123-456" />
            </div>
            <div>
              <Label htmlFor="bank-acct">Account number</Label>
              <Input id="bank-acct" className="mt-1" inputMode="numeric" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="bank-name">Financial institution</Label>
            <Input id="bank-name" className="mt-1" value={bankName} onChange={e => setBankName(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VerifyDialog({ record, onClose }: { record: any; onClose: (changed: boolean) => void }) {
  const [method, setMethod] = useState('callback_known_number');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (approve: boolean) => {
    if (!approve && !notes.trim()) { toast.error('Add a note explaining the rejection'); return; }
    setSaving(true);
    const { data, error } = await invokeSecureFunction('finance-portal-commissions', {
      operation: approve ? 'verify_bank_details' : 'reject_bank_details',
      id: record.id,
      verification_method: method,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success(approve ? 'Banking details verified' : 'Banking details rejected');
    onClose(true);
  };

  return (
    <Dialog open onOpenChange={() => onClose(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Verify banking details</DialogTitle>
          <DialogDescription>
            Confirm the account independently — never using contact details supplied in the change request itself.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
            <div className="font-medium">{record.partner_name_snapshot}</div>
            <div className="text-muted-foreground">{record.account_name} · {record.bsb_masked || record.bsb} · {record.account_number_masked}</div>
          </div>
          <div>
            <Label>Verification method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="callback_known_number">Callback to known number</SelectItem>
                <SelectItem value="in_person">In person</SelectItem>
                <SelectItem value="bank_statement">Bank statement sighted</SelectItem>
                <SelectItem value="penny_test">Penny test</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="verify-notes">Notes</Label>
            <Textarea id="verify-notes" className="mt-1" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Called 02 …, spoke with …, confirmed BSB and account number." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => submit(false)} disabled={saving}>Reject</Button>
          <Button onClick={() => submit(true)} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Mark verified
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
