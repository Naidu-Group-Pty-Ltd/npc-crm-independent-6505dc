import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Loader2, MessagesSquare, Plus, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { AdminMatterCommsDialog } from '@/components/admin/solicitor-portal/AdminMatterCommsDialog';
import {
  AU_STATE_OPTIONS, MATTER_STATUS_CLASSES, MATTER_STATUS_LABELS, MATTER_STATUS_ORDER,
  MATTER_TYPE_LABELS, formatMatterDate, formatPropertyAddress,
  type LegalMatter, type LegalMatterStatus, type LegalMatterType,
} from '@/lib/legalMatters';

interface ClientOption { id: string; name: string }
interface FirmOption { id: string; name: string }
interface SolicitorOption { id: string; name: string; firm_id: string }

const BLANK = {
  client_id: '',
  firm_id: '__unassigned__',
  assigned_solicitor_user_id: '__unassigned__',
  title: '',
  matter_reference: '',
  matter_type: 'purchase' as LegalMatterType,
  status: 'instructed' as LegalMatterStatus,
  property_address: '',
  property_suburb: '',
  property_state: '__unassigned__',
  property_postcode: '',
  settlement_date: '',
};

/**
 * Command Centre oversight of every legal matter, plus matter creation and
 * firm/solicitor assignment. Portal-side editing lives in the Solicitor Portal.
 */
export function AdminLegalMattersPanel() {
  const [matters, setMatters] = useState<LegalMatter[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [firms, setFirms] = useState<FirmOption[]>([]);
  const [solicitors, setSolicitors] = useState<SolicitorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [commsMatter, setCommsMatter] = useState<{ id: string; title: string } | null>(null);
  const [form, setForm] = useState({ ...BLANK });

  const load = useCallback(async () => {
    setLoading(true);
    const [matterRes, firmRes, clientRes] = await Promise.all([
      invokeSecureFunction('legal-matters-admin', { operation: 'list_matters' }),
      invokeSecureFunction('solicitor-portal-admin', { operation: 'list_users' }),
      invokeSecureFunction('legal-matters-admin', { operation: 'list_workspace_options' }),
    ]);
    if (matterRes.error) toast.error(matterRes.error.message || 'Could not load matters');
    else setMatters((matterRes.data?.records || []) as LegalMatter[]);

    if (!firmRes.error) {
      const users = (firmRes.data?.records || firmRes.data?.users || []) as any[];
      setSolicitors(users
        .filter((u) => u.is_active && !u.revoked_at)
        .map((u) => ({ id: u.id, name: u.name, firm_id: u.firm_id })));
      const seen = new Map<string, string>();
      for (const u of users) if (u.firm_id && u.firm_name) seen.set(u.firm_id, u.firm_name);
      setFirms([...seen].map(([id, name]) => ({ id, name })));
    }
    if (!clientRes.error) setClients(clientRes.data?.clients || []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return matters.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (!q) return true;
      return [m.title, m.matter_reference, m.property_address, m.client_name, m.firm_name]
        .some((v) => v && String(v).toLowerCase().includes(q));
    });
  }, [matters, search, statusFilter]);

  const firmSolicitors = useMemo(
    () => solicitors.filter((s) => form.firm_id === '__unassigned__' || s.firm_id === form.firm_id),
    [solicitors, form.firm_id],
  );

  const createMatter = async () => {
    if (!form.client_id) { toast.error('Select a client'); return; }
    if (!form.title.trim()) { toast.error('Matter title is required'); return; }
    setSaving(true);
    const unwrap = (v: string) => (v === '__unassigned__' ? null : v || null);
    const { error } = await invokeSecureFunction('legal-matters-admin', {
      operation: 'create_matter',
      client_id: form.client_id,
      firm_id: unwrap(form.firm_id),
      assigned_solicitor_user_id: unwrap(form.assigned_solicitor_user_id),
      title: form.title,
      matter_reference: form.matter_reference || null,
      matter_type: form.matter_type,
      status: form.status,
      property_address: form.property_address || null,
      property_suburb: form.property_suburb || null,
      property_state: unwrap(form.property_state),
      property_postcode: form.property_postcode || null,
      settlement_date: form.settlement_date || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message || 'Could not create matter'); return; }
    toast.success('Matter created');
    setDialogOpen(false);
    setForm({ ...BLANK });
    void load();
  };

  const assign = async (matterId: string, expectedVersion: number, field: 'firm_id' | 'assigned_solicitor_user_id', value: string) => {
    const { error } = await invokeSecureFunction('legal-matters-admin', {
      operation: 'update_matter',
      matter_id: matterId,
      expected_version: expectedVersion,
      [field]: value === '__unassigned__' ? null : value,
    });
    if (error) { toast.error(error.message || 'Could not update matter'); return; }
    toast.success('Matter updated');
    void load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Briefcase className="h-4 w-4 text-primary" aria-hidden /> Legal matters
          </CardTitle>
          <CardDescription>Every conveyancing matter and the practice acting on it.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New matter
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search matters, clients, or practices"
            aria-label="Search legal matters"
            containerClassName="flex-1"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-56" aria-label="Filter matters by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {MATTER_STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>{MATTER_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 px-4 py-12 text-center">
            <p className="text-sm font-medium text-foreground">No legal matters yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a matter and assign it to a practice to give solicitors portal access to the file.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Matter</TableHead>
                  <TableHead className="hidden md:table-cell">Client</TableHead>
                  <TableHead>Practice</TableHead>
                  <TableHead className="hidden lg:table-cell">Solicitor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Settlement</TableHead>
                  <TableHead className="text-right">Comms</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="max-w-[20rem]">
                      <span className="block font-medium text-foreground">{m.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.matter_reference ? `${m.matter_reference} · ` : ''}{formatPropertyAddress(m)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {m.client_name || '—'}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={m.firm_id ?? '__unassigned__'}
                        onValueChange={(v) => void assign(m.id, m.row_version, 'firm_id', v)}
                      >
                        <SelectTrigger className="h-8 w-44" aria-label={`Practice for ${m.title}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unassigned__">Unassigned</SelectItem>
                          {firms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Select
                        value={m.assigned_solicitor_user_id ?? '__unassigned__'}
                        onValueChange={(v) => void assign(m.id, m.row_version, 'assigned_solicitor_user_id', v)}
                      >
                        <SelectTrigger className="h-8 w-44" aria-label={`Solicitor for ${m.title}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unassigned__">Unassigned</SelectItem>
                          {solicitors
                            .filter((s) => !m.firm_id || s.firm_id === m.firm_id)
                            .map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('font-medium', MATTER_STATUS_CLASSES[m.status])}>
                        {MATTER_STATUS_LABELS[m.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {formatMatterDate(m.settlement_date)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => setCommsMatter({ id: m.id, title: m.title })}
                        aria-label={`Open conversation for ${m.title}`}
                      >
                        <MessagesSquare className="h-4 w-4" aria-hidden />
                        <span className="hidden lg:inline">Messages</span>
                      </Button>
                    </TableCell>
                  </TableRow>

                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New legal matter</DialogTitle>
            <DialogDescription>
              Assigning a practice grants that firm's solicitors portal access to this matter.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="matter_client">Client</Label>
                <Select value={form.client_id} onValueChange={(v) => setForm((f) => ({ ...f, client_id: v }))}>
                  <SelectTrigger id="matter_client"><SelectValue placeholder="Select a client" /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="matter_title">Matter title</Label>
                <Input
                  id="matter_title" value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Purchase — 12 Smith St, Parramatta"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="matter_ref">Reference</Label>
                  <Input
                    id="matter_ref" value={form.matter_reference}
                    onChange={(e) => setForm((f) => ({ ...f, matter_reference: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="matter_type">Matter type</Label>
                  <Select
                    value={form.matter_type}
                    onValueChange={(v) => setForm((f) => ({ ...f, matter_type: v as LegalMatterType }))}
                  >
                    <SelectTrigger id="matter_type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(MATTER_TYPE_LABELS) as LegalMatterType[]).map((t) => (
                        <SelectItem key={t} value={t}>{MATTER_TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="matter_firm">Legal practice</Label>
                <Select
                  value={form.firm_id}
                  onValueChange={(v) => setForm((f) => ({ ...f, firm_id: v, assigned_solicitor_user_id: '__unassigned__' }))}
                >
                  <SelectTrigger id="matter_firm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {firms.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="matter_solicitor">Assigned solicitor</Label>
                <Select
                  value={form.assigned_solicitor_user_id}
                  onValueChange={(v) => setForm((f) => ({ ...f, assigned_solicitor_user_id: v }))}
                >
                  <SelectTrigger id="matter_solicitor"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">Unassigned</SelectItem>
                    {firmSolicitors.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="matter_address">Property address</Label>
                <Input
                  id="matter_address" value={form.property_address}
                  onChange={(e) => setForm((f) => ({ ...f, property_address: e.target.value }))}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="matter_suburb">Suburb</Label>
                  <Input
                    id="matter_suburb" value={form.property_suburb}
                    onChange={(e) => setForm((f) => ({ ...f, property_suburb: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="matter_state">State</Label>
                  <Select
                    value={form.property_state}
                    onValueChange={(v) => setForm((f) => ({ ...f, property_state: v }))}
                  >
                    <SelectTrigger id="matter_state"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned__">—</SelectItem>
                      {AU_STATE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="matter_postcode">Postcode</Label>
                  <Input
                    id="matter_postcode" inputMode="numeric" value={form.property_postcode}
                    onChange={(e) => setForm((f) => ({ ...f, property_postcode: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="matter_settlement">Settlement date</Label>
                <Input
                  id="matter_settlement" type="date" value={form.settlement_date}
                  onChange={(e) => setForm((f) => ({ ...f, settlement_date: e.target.value }))}
                />
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void createMatter()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create matter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminMatterCommsDialog
        matterId={commsMatter?.id ?? null}
        matterTitle={commsMatter?.title}
        open={!!commsMatter}
        onOpenChange={(next) => { if (!next) setCommsMatter(null); }}
      />
    </Card>
  );
}
