import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ShieldCheck, Info } from 'lucide-react';
import {
  REFERRAL_DIRECTION_LABELS,
  useActiveAgreementOptions,
  useFinanceUserOptions,
  usePartnerReferralMutations,
  type PartnerReferral,
  type ReferralDirection,
} from '@/hooks/usePartnerReferrals';

const UNASSIGNED = '__unassigned__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referral?: PartnerReferral | null;
  defaultDirection?: ReferralDirection;
}

type FormState = Partial<PartnerReferral>;

const EMPTY: FormState = {
  direction: 'outbound_finance_referral',
  client_first_name: '',
  consent_obtained: false,
  benefit_disclosed: false,
  prior_client_check: 'unchecked',
};

export default function PartnerReferralDialog({ open, onOpenChange, referral, defaultDirection }: Props) {
  const isEdit = !!referral;
  const [form, setForm] = useState<FormState>(EMPTY);
  const { createReferral, updateReferral } = usePartnerReferralMutations();

  const direction = (form.direction ?? 'outbound_finance_referral') as ReferralDirection;
  const { data: agreements = [] } = useActiveAgreementOptions(direction);
  const { data: financeUsers = [] } = useFinanceUserOptions();

  useEffect(() => {
    if (!open) return;
    setForm(referral ? { ...referral } : { ...EMPTY, direction: defaultDirection ?? 'outbound_finance_referral' });
  }, [open, referral, defaultDirection]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const saving = createReferral.isPending || updateReferral.isPending;

  const gateMissing = useMemo(() => {
    const missing: string[] = [];
    if (!form.consent_obtained) missing.push('client consent');
    if (!form.benefit_disclosed) missing.push('benefit disclosure');
    if (!form.general_purpose) missing.push('general purpose');
    if (!form.client_email && !form.client_phone) missing.push('a contact detail');
    return missing;
  }, [form]);

  const submit = async () => {
    if (!form.client_first_name?.trim()) return;
    if (isEdit && referral) {
      await updateReferral.mutateAsync({ ...form, id: referral.id } as PartnerReferral & { id: string });
    } else {
      await createReferral.mutateAsync(form);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{isEdit ? `Referral ${referral?.reference}` : 'Register referral'}</DialogTitle>
          <DialogDescription>
            Annexure A registration. Only the client's name, contact details and general purpose may be
            recorded and shared — never credit, servicing or liability data.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="referral" className="flex-1 min-h-0 flex flex-col">
          <div className="px-6">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="referral">Referral</TabsTrigger>
              <TabsTrigger value="client">Client</TabsTrigger>
              <TabsTrigger value="compliance">Compliance</TabsTrigger>
              <TabsTrigger value="assignment">Assignment</TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-6 py-4">
              <TabsContent value="referral" className="mt-0 space-y-4">
                <Field label="Direction">
                  <Select
                    value={direction}
                    onValueChange={(v) => set('direction', v as ReferralDirection)}
                    disabled={isEdit}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(REFERRAL_DIRECTION_LABELS) as ReferralDirection[]).map((d) => (
                        <SelectItem key={d} value={d}>{REFERRAL_DIRECTION_LABELS[d]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Governing agreement" hint="Only active agreements for this direction can be attached.">
                  <Select
                    value={form.agreement_id ?? UNASSIGNED}
                    onValueChange={(v) => {
                      const chosen = agreements.find((a) => a.id === v);
                      set('agreement_id', v === UNASSIGNED ? null : v);
                      if (chosen?.finance_agent_contact_id) set('finance_agent_contact_id', chosen.finance_agent_contact_id);
                      if (chosen && !form.referring_entity_name && direction === 'inbound_property_referral') {
                        set('referring_entity_name', chosen.partner_legal_name);
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="No agreement attached" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>No agreement attached</SelectItem>
                      {agreements.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.partner_legal_name} · v{a.version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Referring entity">
                    <Input value={form.referring_entity_name ?? ''} onChange={(e) => set('referring_entity_name', e.target.value)} />
                  </Field>
                  <Field label="Referring individual">
                    <Input value={form.referring_individual_name ?? ''} onChange={(e) => set('referring_individual_name', e.target.value)} />
                  </Field>
                  <Field label="Credit rep number (CRN)">
                    <Input value={form.referring_individual_crn ?? ''} onChange={(e) => set('referring_individual_crn', e.target.value)} />
                  </Field>
                  <Field label="Referrer email">
                    <Input type="email" value={form.referring_contact_email ?? ''} onChange={(e) => set('referring_contact_email', e.target.value)} />
                  </Field>
                  <Field label="Referrer phone">
                    <Input value={form.referring_contact_phone ?? ''} onChange={(e) => set('referring_contact_phone', e.target.value)} />
                  </Field>
                  <Field label="Estimated value (AUD)">
                    <Input
                      type="number"
                      value={form.estimated_value ?? ''}
                      onChange={(e) => set('estimated_value', e.target.value === '' ? null : Number(e.target.value))}
                    />
                  </Field>
                </div>
              </TabsContent>

              <TabsContent value="client" className="mt-0 space-y-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Information boundary: name, contact details and a general statement of purpose only.
                  </AlertDescription>
                </Alert>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="First name *">
                    <Input value={form.client_first_name ?? ''} onChange={(e) => set('client_first_name', e.target.value)} />
                  </Field>
                  <Field label="Surname">
                    <Input value={form.client_surname ?? ''} onChange={(e) => set('client_surname', e.target.value)} />
                  </Field>
                  <Field label="Email">
                    <Input type="email" value={form.client_email ?? ''} onChange={(e) => set('client_email', e.target.value)} />
                  </Field>
                  <Field label="Phone">
                    <Input value={form.client_phone ?? ''} onChange={(e) => set('client_phone', e.target.value)} />
                  </Field>
                  <Field label="Preferred contact method">
                    <Input value={form.preferred_contact_method ?? ''} onChange={(e) => set('preferred_contact_method', e.target.value)} placeholder="Phone / Email / SMS" />
                  </Field>
                  <Field label="Preferred contact time">
                    <Input value={form.preferred_contact_time ?? ''} onChange={(e) => set('preferred_contact_time', e.target.value)} placeholder="Weekday mornings" />
                  </Field>
                </div>
                <Field label="General purpose of referral">
                  <Textarea
                    rows={3}
                    value={form.general_purpose ?? ''}
                    onChange={(e) => set('general_purpose', e.target.value)}
                    placeholder="e.g. General discussion regarding residential lending options."
                  />
                </Field>
                <Field label="Notes shared with the partner">
                  <Textarea rows={2} value={form.shared_notes ?? ''} onChange={(e) => set('shared_notes', e.target.value)} />
                </Field>
                <Field label="Internal notes (never shared)">
                  <Textarea rows={2} value={form.internal_notes ?? ''} onChange={(e) => set('internal_notes', e.target.value)} />
                </Field>
              </TabsContent>

              <TabsContent value="compliance" className="mt-0 space-y-4">
                {gateMissing.length > 0 && (
                  <Alert>
                    <ShieldCheck className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Submission gate outstanding: {gateMissing.join(', ')}.
                    </AlertDescription>
                  </Alert>
                )}
                <ToggleRow
                  label="Client consent obtained"
                  hint="Consent must be captured before any client detail is disclosed to the other party."
                  checked={!!form.consent_obtained}
                  onChange={(v) => set('consent_obtained', v)}
                />
                <Field label="Consent method">
                  <Input value={form.consent_method ?? ''} onChange={(e) => set('consent_method', e.target.value)} placeholder="Verbal / Written / Signed form" />
                </Field>
                <ToggleRow
                  label="Benefit disclosed to client"
                  hint="The client has been told a referral fee or commission may be payable."
                  checked={!!form.benefit_disclosed}
                  onChange={(v) => set('benefit_disclosed', v)}
                />
                <Field label="Prior-client check" hint="Run automatically on creation; re-run from the detail panel.">
                  <Select
                    value={form.prior_client_check ?? 'unchecked'}
                    onValueChange={(v) => set('prior_client_check', v as PartnerReferral['prior_client_check'])}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unchecked">Not yet checked</SelectItem>
                      <SelectItem value="new">New client</SelectItem>
                      <SelectItem value="existing">Existing client</SelectItem>
                      <SelectItem value="duplicate">Duplicate referral</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </TabsContent>

              <TabsContent value="assignment" className="mt-0 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Assigned consultant (NPC)">
                    <Input value={form.assigned_consultant_name ?? ''} onChange={(e) => set('assigned_consultant_name', e.target.value)} />
                  </Field>
                  <Field label="Loan writer name">
                    <Input value={form.assigned_loan_writer_name ?? ''} onChange={(e) => set('assigned_loan_writer_name', e.target.value)} />
                  </Field>
                </div>
                <Field label="Finance portal user" hint="Grants the partner visibility of this referral in their portal inbox.">
                  <Select
                    value={form.assigned_finance_user_id ?? UNASSIGNED}
                    onValueChange={(v) => set('assigned_finance_user_id', v === UNASSIGNED ? null : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {financeUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.finance_agent_contacts?.name || u.email}
                          {u.finance_agent_contacts?.company ? ` · ${u.finance_agent_contacts.company}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="px-6 pb-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !form.client_first_name?.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Register referral'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div className="space-y-0.5 pr-4">
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
