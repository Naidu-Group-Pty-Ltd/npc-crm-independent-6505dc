import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import { Inbox, RefreshCw, Loader2, Mail, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { REFERRAL_STATUS_LABELS, type ReferralStatus } from '@/hooks/usePartnerReferrals';

const FN = 'manage-partner-referrals';

/** Statuses a partner may set themselves — mirrors the edge function's clamp. */
const PARTNER_SETTABLE: ReferralStatus[] = ['accepted', 'contacted', 'application', 'approved', 'settled', 'declined'];

const NEXT_FOR_PARTNER: Record<string, ReferralStatus[]> = {
  submitted: ['accepted', 'declined'],
  accepted: ['contacted', 'declined'],
  contacted: ['application', 'declined'],
  application: ['approved', 'declined'],
  approved: ['settled'],
};

interface PartnerReferralRow {
  id: string;
  reference: string;
  direction: string;
  status: ReferralStatus;
  status_reason: string | null;
  client_first_name: string | null;
  client_surname: string | null;
  client_email: string | null;
  client_phone: string | null;
  general_purpose: string | null;
  preferred_contact_method: string | null;
  preferred_contact_time: string | null;
  consent_obtained: boolean | null;
  benefit_disclosed: boolean | null;
  assigned_loan_writer_name: string | null;
  referring_entity_name: string | null;
  referring_individual_name: string | null;
  shared_notes: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PartnerEvent {
  id: string;
  event_type: string;
  summary: string | null;
  created_at: string;
  actor_surface: string | null;
}

function statusVariant(status: ReferralStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'settled') return 'default';
  if (status === 'declined' || status === 'withdrawn') return 'destructive';
  if (status === 'submitted') return 'outline';
  return 'secondary';
}

export default function PartnerReferralInbox() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [rows, setRows] = useState<PartnerReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'open' | 'all'>('open');

  const [selected, setSelected] = useState<PartnerReferralRow | null>(null);
  const [events, setEvents] = useState<PartnerEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await invokeFinanceFunction(FN, { action: 'partner_list' });
    if (error) toast.error(error.message || 'Failed to load referrals');
    setRows((data?.referrals as PartnerReferralRow[]) || []);
    setLoading(false);
  }, [invokeFinanceFunction]);

  useEffect(() => {
    document.title = 'Referrals | Finance Portal';
    void load();
  }, [load]);

  const openDetail = async (row: PartnerReferralRow) => {
    setSelected(row);
    setNote('');
    setReason('');
    setDetailLoading(true);
    const { data } = await invokeFinanceFunction(FN, { action: 'partner_get', id: row.id });
    if (data?.referral) setSelected(data.referral as PartnerReferralRow);
    setEvents((data?.events as PartnerEvent[]) || []);
    setDetailLoading(false);
  };

  const updateStatus = async (status: ReferralStatus) => {
    if (!selected) return;
    setBusy(true);
    const { data, error } = await invokeFinanceFunction(FN, {
      action: 'partner_update_status',
      id: selected.id,
      status,
      reason: reason || undefined,
    });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.message || error?.message || 'Could not update the referral');
      return;
    }
    toast.success(`Referral is now ${REFERRAL_STATUS_LABELS[status]}`);
    setSelected(data.referral as PartnerReferralRow);
    setReason('');
    await load();
  };

  const submitNote = async () => {
    if (!selected || !note.trim()) return;
    setBusy(true);
    const { error } = await invokeFinanceFunction(FN, { action: 'partner_add_note', id: selected.id, note });
    setBusy(false);
    if (error) {
      toast.error(error.message || 'Could not add the note');
      return;
    }
    setNote('');
    toast.success('Note added');
    void openDetail(selected);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (tab === 'all' ? true : !['settled', 'declined', 'withdrawn'].includes(r.status)))
      .filter((r) =>
        !q
          ? true
          : [r.reference, r.client_first_name, r.client_surname, r.client_email, r.client_phone]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q)),
      );
  }, [rows, search, tab]);

  const nextStatuses = selected ? (NEXT_FOR_PARTNER[selected.status] ?? []).filter((s) => PARTNER_SETTABLE.includes(s)) : [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Inbox className="h-6 w-6 text-primary" /> Referrals
          </h1>
          <p className="text-sm text-muted-foreground">
            Clients referred to you by NPC. Name, contact details and the general purpose of the referral only.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'open' | 'all')}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search referrals…"
          containerClassName="w-full sm:w-72"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Referral inbox</CardTitle>
          <CardDescription>Select a referral to update its progress or add a note.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No referrals yet</p>
              <p className="text-sm text-muted-foreground">New referrals from NPC will appear here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => void openDetail(r)}>
                    <TableCell className="font-medium">{r.reference}</TableCell>
                    <TableCell>
                      <div>{[r.client_first_name, r.client_surname].filter(Boolean).join(' ')}</div>
                      <div className="text-xs text-muted-foreground">{r.client_email || r.client_phone || '—'}</div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {r.general_purpose || '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(r.submitted_at || r.created_at), 'd MMM yyyy')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)}>{REFERRAL_STATUS_LABELS[r.status]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {selected.reference}
                  <Badge variant={statusVariant(selected.status)}>{REFERRAL_STATUS_LABELS[selected.status]}</Badge>
                </SheetTitle>
                <SheetDescription>
                  Referred by {selected.referring_entity_name || 'NPC'}
                  {selected.referring_individual_name ? ` · ${selected.referring_individual_name}` : ''}
                </SheetDescription>
              </SheetHeader>

              {detailLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="mt-6 space-y-6">
                  <section className="space-y-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</h3>
                    <p className="text-sm font-medium">
                      {[selected.client_first_name, selected.client_surname].filter(Boolean).join(' ')}
                    </p>
                    {selected.client_email && (
                      <a className="flex items-center gap-2 text-sm text-primary" href={`mailto:${selected.client_email}`}>
                        <Mail className="h-3.5 w-3.5" /> {selected.client_email}
                      </a>
                    )}
                    {selected.client_phone && (
                      <a className="flex items-center gap-2 text-sm text-primary" href={`tel:${selected.client_phone}`}>
                        <Phone className="h-3.5 w-3.5" /> {selected.client_phone}
                      </a>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Preferred: {[selected.preferred_contact_method, selected.preferred_contact_time].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </section>

                  <section className="space-y-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Purpose</h3>
                    <p className="text-sm">{selected.general_purpose || '—'}</p>
                    {selected.shared_notes && <p className="text-sm text-muted-foreground">{selected.shared_notes}</p>}
                  </section>

                  <section className="space-y-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Consent</h3>
                    <div className="flex gap-2">
                      <Badge variant={selected.consent_obtained ? 'secondary' : 'outline'}>
                        {selected.consent_obtained ? 'Consent obtained' : 'Consent pending'}
                      </Badge>
                      <Badge variant={selected.benefit_disclosed ? 'secondary' : 'outline'}>
                        {selected.benefit_disclosed ? 'Benefit disclosed' : 'Disclosure pending'}
                      </Badge>
                    </div>
                  </section>

                  {nextStatuses.length > 0 && (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Update progress</h3>
                      <Textarea rows={2} placeholder="Optional reason / context" value={reason} onChange={(e) => setReason(e.target.value)} />
                      <div className="flex flex-wrap gap-2">
                        {nextStatuses.map((s) => (
                          <Button
                            key={s}
                            size="sm"
                            variant={s === 'declined' ? 'outline' : 'default'}
                            disabled={busy}
                            onClick={() => void updateStatus(s)}
                          >
                            {REFERRAL_STATUS_LABELS[s]}
                          </Button>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h3>
                    <Textarea rows={2} placeholder="Add a note for NPC" value={note} onChange={(e) => setNote(e.target.value)} />
                    <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => void submitNote()}>
                      Add note
                    </Button>
                    <Separator className="my-3" />
                    <div className="space-y-3">
                      {events.map((event) => (
                        <div key={event.id} className="text-xs">
                          <p>{event.summary || event.event_type}</p>
                          <p className="text-muted-foreground">
                            {format(new Date(event.created_at), 'dd MMM yyyy HH:mm')}
                            {event.actor_surface ? ` · ${event.actor_surface.replace(/_/g, ' ')}` : ''}
                          </p>
                        </div>
                      ))}
                      {events.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
