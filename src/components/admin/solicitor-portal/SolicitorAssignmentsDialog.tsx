import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { Loader2, Plus, Search, Settings2, ShieldX, Users } from 'lucide-react';
import { SOLICITOR_PERMISSION_AREAS } from './SolicitorPermissionMatrix';

type Decision = 'inherit' | 'allow' | 'deny';
type TriStateMatrix = Record<string, Record<'view' | 'edit' | 'delete', Decision>>;
interface MatterSummary { id: string; client_id: string; client_name: string | null; matter_reference: string | null; title: string; property_address: string | null; property_suburb: string | null; firm_id: string; assigned_solicitor_user_id: string | null; status: string }
interface AccessRow { id: string; legal_matter_id: string; access_role: string; permissions: unknown; effective_permissions: unknown; valid_from: string; valid_until: string | null; revoked_at: string | null; revocation_reason: string | null; client_name: string | null; matter: MatterSummary | null }
interface Props { open: boolean; onOpenChange: (open: boolean) => void; user: { id: string; name: string; firm_name?: string | null } | null; onChanged?: () => void }

const emptyMatrix = (): TriStateMatrix => Object.fromEntries(SOLICITOR_PERMISSION_AREAS.map(({ key }) => [key, { view: 'inherit', edit: 'inherit', delete: 'inherit' }]));
const normalize = (value: unknown): TriStateMatrix => {
  const matrix = emptyMatrix();
  if (!value || typeof value !== 'object') return matrix;
  for (const { key } of SOLICITOR_PERMISSION_AREAS) for (const level of ['view', 'edit', 'delete'] as const) {
    const decision = (value as any)?.[key]?.[level];
    matrix[key][level] = decision === 'allow' || decision === 'deny' ? decision : 'inherit';
  }
  return matrix;
};

export function SolicitorAssignmentsDialog({ open, onOpenChange, user, onChanged }: Props) {
  const [loading, setLoading] = useState(false);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [matters, setMatters] = useState<MatterSummary[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<AccessRow | null>(null);
  const [matrix, setMatrix] = useState<TriStateMatrix>(emptyMatrix);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [accessResult, matterResult] = await Promise.all([
        invokeSecureFunction('solicitor-portal-admin', { operation: 'get_matter_access', solicitor_user_id: user.id }),
        invokeSecureFunction('solicitor-portal-admin', { operation: 'list_matter_access_candidates', solicitor_user_id: user.id }),
      ]);
      if (accessResult.error || matterResult.error) throw new Error(accessResult.error?.message || matterResult.error?.message);
      setAccess(accessResult.data?.records || []);
      setMatters(matterResult.data?.records || []);
    } catch (error: any) { toast.error(error.message || 'Failed to load matter access'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (open && user) { setEditing(null); setSearch(''); void load(); } }, [open, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeMatterIds = useMemo(() => new Set(access.filter(row => !row.revoked_at).map(row => row.legal_matter_id)), [access]);
  const candidates = useMemo(() => matters.filter(matter => !activeMatterIds.has(matter.id)).filter(matter => {
    const query = search.trim().toLowerCase();
    return !query || [matter.client_name, matter.matter_reference, matter.title, matter.property_address].some(value => value?.toLowerCase().includes(query));
  }).slice(0, 60), [matters, activeMatterIds, search]);

  const mutate = async (body: Record<string, unknown>, success: string) => {
    setBusy(String(body.legal_matter_id || body.access_id || body.client_id || 'save'));
    try {
      const { data, error } = await invokeSecureFunction('solicitor-portal-admin', body);
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success(success); setEditing(null); await load(); onChanged?.();
    } catch (error: any) { toast.error(error.message || 'Matter access update failed'); }
    finally { setBusy(null); }
  };

  const updateDecision = (key: string, level: 'view' | 'edit' | 'delete', decision: Decision) =>
    setMatrix(current => ({ ...current, [key]: { ...current[key], [level]: decision } }));

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[90vh] max-w-5xl flex-col">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" />Matter Access</DialogTitle>
        <DialogDescription>{user ? <>Explicit matters accessible to <span className="font-medium text-foreground">{user.name}</span>. Client identity never grants access to future matters.</> : null}</DialogDescription>
      </DialogHeader>
      {loading ? <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : editing ? <>
        <ScrollArea className="flex-1 pr-3"><div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3"><p className="font-medium">{editing.matter?.title || editing.legal_matter_id}</p><p className="text-xs text-muted-foreground">Matter decisions override the baseline. Deny always reduces a baseline allow.</p></div>
          {SOLICITOR_PERMISSION_AREAS.map(area => <div key={area.key} className="grid grid-cols-[1fr_repeat(3,120px)] items-center gap-2 border-b pb-2">
            <div><p className="text-sm font-medium">{area.label}</p><p className="text-xs text-muted-foreground">{area.hint}</p></div>
            {(['view','edit','delete'] as const).map(level => <Select key={level} value={matrix[area.key][level]} onValueChange={value => updateDecision(area.key, level, value as Decision)}><SelectTrigger aria-label={`${area.label} ${level}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">Inherit</SelectItem><SelectItem value="allow">Allow</SelectItem><SelectItem value="deny">Deny</SelectItem></SelectContent></Select>)}</div>)}
        </div></ScrollArea>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setEditing(null)}>Back</Button><Button disabled={!!busy} onClick={() => void mutate({ operation: 'upsert_matter_access', solicitor_user_id: user?.id, legal_matter_id: editing.legal_matter_id, access_role: editing.access_role, valid_from: editing.valid_from, valid_until: editing.valid_until, permissions: matrix }, 'Matter permissions saved')}>Save policy</Button></div>
      </> : <ScrollArea className="flex-1 pr-3"><div className="space-y-6">
        <section className="space-y-2"><div className="text-sm font-semibold">Granted matters <Badge variant="secondary">{access.filter(row => !row.revoked_at).length}</Badge></div>
          {access.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No matter access. Grant an existing matter below; future matters are never included automatically.</div> : access.map(row => <div key={row.id} className="flex items-center justify-between rounded-lg border p-3">
            <div><div className="flex items-center gap-2"><span className="font-medium">{row.matter?.matter_reference || row.matter?.title || 'Unknown matter'}</span>{row.revoked_at && <Badge variant="destructive">Revoked</Badge>}<Badge variant="outline">{row.access_role}</Badge></div><p className="text-xs text-muted-foreground">{row.client_name || 'Unknown client'} · {row.matter?.property_address || 'No property'} · Practice: {user?.firm_name || row.matter?.firm_id || '—'}</p><p className="text-xs text-muted-foreground">Responsible: {row.matter?.assigned_solicitor_user_id || 'Unassigned'} · From {new Date(row.valid_from).toLocaleDateString('en-AU')} {row.valid_until ? `to ${new Date(row.valid_until).toLocaleDateString('en-AU')}` : 'without expiry'} · Policy: matter override + baseline</p></div>
            {!row.revoked_at && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { setEditing(row); setMatrix(normalize(row.permissions)); }}><Settings2 className="mr-1 h-3 w-3" />Policy</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => void mutate({ operation: 'revoke_matter_access', access_id: row.id, reason: 'Revoked in Command Centre' }, 'Matter access revoked')}><ShieldX className="h-3 w-3" /></Button></div>}
          </div>)}</section>
        <section className="space-y-2"><div className="text-sm font-semibold">Grant an existing matter</div><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search client, matter reference or property" /></div>
          {candidates.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No matching ungranted matters.</p> : candidates.map(matter => <div key={matter.id} className="flex items-center justify-between rounded-lg border p-3"><div><p className="font-medium">{matter.matter_reference || matter.title}</p><p className="text-xs text-muted-foreground">{matter.client_name} · {matter.property_address || 'No property'} · Responsible: {matter.assigned_solicitor_user_id || 'Unassigned'}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void mutate({ operation: 'grant_all_current_client_matters', solicitor_user_id: user?.id, client_id: matter.client_id }, 'Access granted to all current client matters')}>Current client matters</Button><Button size="sm" onClick={() => void mutate({ operation: 'upsert_matter_access', solicitor_user_id: user?.id, legal_matter_id: matter.id, permissions: emptyMatrix() }, 'Matter access granted')}><Plus className="mr-1 h-3 w-3" />Grant matter</Button></div></div>)}
        </section>
      </div></ScrollArea>}
    </DialogContent>
  </Dialog>;
}
