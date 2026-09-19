import { useCallback, useEffect, useMemo, useState } from 'react';
import { PartnerAgreementsPanel } from '@/components/admin/PartnerAgreementsPanel';
import { useAgreementDownload } from '@/components/admin/useAgreementDownload';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import {
  Briefcase, Building2, Gavel, History, Link2, Loader2, Mail, MoreHorizontal, Plus, RefreshCw, Scale, Search,
  Settings2, Shield, Trash2, Unlock, UserCheck, Users, UserX,
  FileSignature,
} from 'lucide-react';
import { IntegrationHealthPanel } from '@/components/admin/solicitor-portal/IntegrationHealthPanel';
import { CollaborationHealthPanel } from '@/components/admin/solicitor-portal/CollaborationHealthPanel';
import { TransactionCasesPanel } from '@/components/admin/solicitor-portal/TransactionCasesPanel';
import { AdminLegalMattersPanel } from '@/components/admin/solicitor-portal/AdminLegalMattersPanel';
import { SolicitorFirmDialog, type SolicitorFirm } from '@/components/admin/solicitor-portal/SolicitorFirmDialog';
import { SolicitorUserDialog, type SolicitorUserRow } from '@/components/admin/solicitor-portal/SolicitorUserDialog';
import { SolicitorAssignmentsDialog } from '@/components/admin/solicitor-portal/SolicitorAssignmentsDialog';
import { SolicitorGlobalPermissionsDialog } from '@/components/admin/solicitor-portal/SolicitorGlobalPermissionsDialog';
import { SolicitorActivityLogDialog } from '@/components/admin/solicitor-portal/SolicitorActivityLogDialog';
import { FirmAiPolicyDialog } from '@/components/admin/solicitor-portal/FirmAiPolicyDialog';
import { OperationalObservabilityPanel } from '@/components/admin/solicitor-portal/OperationalObservabilityPanel';
import { CrossPortalCutoverPanel } from '@/components/admin/solicitor-portal/CrossPortalCutoverPanel';

const STATUS_META: Record<SolicitorUserRow['status'], { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  active: { label: 'Active', variant: 'default' },
  invited: { label: 'Invited', variant: 'secondary' },
  invite_expired: { label: 'Invite expired', variant: 'outline' },
  no_access: { label: 'No access', variant: 'outline' },
  inactive: { label: 'Inactive', variant: 'outline' },
  revoked: { label: 'Revoked', variant: 'destructive' },
};

export default function SolicitorPortalAdmin() {
  const { downloadForUser, downloadingUserId } = useAgreementDownload();
  const [loading, setLoading] = useState(true);
  const [firms, setFirms] = useState<SolicitorFirm[]>([]);
  const [aiPolicyFirm,setAiPolicyFirm]=useState<{id:string;name:string}|null>(null);
  const [users, setUsers] = useState<SolicitorUserRow[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [firmSearch, setFirmSearch] = useState('');
  const [firmFilter, setFirmFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [firmDialog, setFirmDialog] = useState<{ open: boolean; firm: SolicitorFirm | null }>({ open: false, firm: null });
  const [userDialog, setUserDialog] = useState<{ open: boolean; user: SolicitorUserRow | null }>({ open: false, user: null });
  const [assignDialog, setAssignDialog] = useState<{ open: boolean; user: SolicitorUserRow | null }>({ open: false, user: null });
  const [permsDialog, setPermsDialog] = useState<{ open: boolean; user: SolicitorUserRow | null }>({ open: false, user: null });
  const [activityDialog, setActivityDialog] = useState<{ open: boolean; user: SolicitorUserRow | null }>({ open: false, user: null });
  const [confirm, setConfirm] = useState<
    | { kind: 'revoke_user'; user: SolicitorUserRow }
    | { kind: 'delete_user'; user: SolicitorUserRow }
    | { kind: 'delete_firm'; firm: SolicitorFirm }
    | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, u] = await Promise.all([
        invokeSecureFunction('solicitor-portal-admin', { operation: 'list_firms' }),
        invokeSecureFunction('solicitor-portal-admin', { operation: 'list_users' }),
      ]);
      if (f.error) throw new Error(f.error.message);
      if (u.error) throw new Error(u.error.message);
      if (f.data?.error) throw new Error(f.data.error);
      if (u.data?.error) throw new Error(u.data.error);
      setFirms(f.data?.records || []);
      setUsers(u.data?.records || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load Solicitor Portal data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const call = async (payload: Record<string, unknown>, successMessage: string, id: string) => {
    setBusyId(id);
    try {
      const { data, error } = await invokeSecureFunction('solicitor-portal-admin', payload);
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(successMessage);
      await load();
      return data;
    } catch (e: any) {
      toast.error(e.message || 'Action failed');
      return null;
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const sendInvite = async (user: SolicitorUserRow) => {
    setBusyId(user.id);
    try {
      const { data, error } = await invokeSecureFunction('solicitor-portal-invite', {
        action: 'invite',
        solicitor_user_id: user.id,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(data?.email_sent ? `Invite emailed to ${user.email}` : 'Invite created — email delivery is not configured');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to send invite');
    } finally {
      setBusyId(null);
    }
  };

  const restoreAccess = async (user: SolicitorUserRow) => {
    setBusyId(user.id);
    try {
      const { data, error } = await invokeSecureFunction('solicitor-portal-invite', {
        action: 'restore',
        solicitor_user_id: user.id,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success('Access restored — send a fresh invite so they can set a password');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to restore access');
    } finally {
      setBusyId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const s = userSearch.trim().toLowerCase();
    return users.filter(u => {
      if (firmFilter !== 'all' && u.firm_id !== firmFilter) return false;
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (!s) return true;
      return (
        u.name.toLowerCase().includes(s) ||
        u.email.toLowerCase().includes(s) ||
        (u.firm_name || '').toLowerCase().includes(s)
      );
    });
  }, [users, userSearch, firmFilter, statusFilter]);

  const filteredFirms = useMemo(() => {
    const s = firmSearch.trim().toLowerCase();
    if (!s) return firms;
    return firms.filter(f =>
      f.name.toLowerCase().includes(s) ||
      (f.trading_name || '').toLowerCase().includes(s) ||
      (f.suburb || '').toLowerCase().includes(s),
    );
  }, [firms, firmSearch]);

  const stats = useMemo(() => ({
    firms: firms.length,
    activeFirms: firms.filter(f => f.is_active).length,
    users: users.length,
    activeUsers: users.filter(u => u.status === 'active').length,
    pendingInvites: users.filter(u => u.status === 'invited' || u.status === 'invite_expired').length,
    assignments: users.reduce((n, u) => n + (u.assignment_count || 0), 0),
  }), [firms, users]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Scale className="h-6 w-6 text-primary" />
            Solicitor Portal
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage legal practices, explicit matter access, roles and effective permission policies.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setActivityDialog({ open: true, user: null })} className="gap-2">
            <History className="h-4 w-4" /> Activity
          </Button>
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Legal practices', value: `${stats.activeFirms}/${stats.firms}`, hint: 'active', icon: Building2 },
          { label: 'Portal users', value: `${stats.activeUsers}/${stats.users}`, hint: 'with live access', icon: Users },
          { label: 'Pending invites', value: stats.pendingInvites, hint: 'awaiting acceptance', icon: Mail },
          { label: 'Matter access', value: stats.assignments, hint: 'explicit solicitor ↔ matter grants', icon: Gavel },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-primary/10 p-2">
                <s.icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="text-xl font-semibold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label} · {s.hint}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" className="gap-2"><Users className="h-4 w-4" /> Portal Users</TabsTrigger>
          <TabsTrigger value="firms" className="gap-2"><Building2 className="h-4 w-4" /> Legal Practices</TabsTrigger>
          <TabsTrigger value="matters" className="gap-2"><Briefcase className="h-4 w-4" /> Matters</TabsTrigger>
          <TabsTrigger value="cases" className="gap-2"><Link2 className="h-4 w-4" /> Transaction Cases</TabsTrigger>
          <TabsTrigger value="integrations" className="gap-2"><RefreshCw className="h-4 w-4" /> Integration Health</TabsTrigger>
          <TabsTrigger value="agreements" className="gap-2"><FileSignature className="h-4 w-4" /> Agreements</TabsTrigger>
        </TabsList>

        {/* ───────────── AGREEMENTS ───────────── */}
        <TabsContent value="agreements" className="mt-4">
          <PartnerAgreementsPanel portal="solicitor" partnerNoun="legal practice" />
        </TabsContent>

        {/* ───────────── USERS ───────────── */}
        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-base">Portal Users</CardTitle>
                <CardDescription>Solicitors, conveyancers and practice staff with Solicitor Portal access.</CardDescription>
              </div>
              <Button
                onClick={() => {
                  if (firms.filter(f => f.is_active).length === 0) {
                    toast.info('Create an active legal practice first — portal users must belong to one.');
                    setFirmDialog({ open: true, firm: null });
                    return;
                  }
                  setUserDialog({ open: true, user: null });
                }}
                className="gap-2"
              >
                <Plus className="h-4 w-4" /> New User
              </Button>

            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search name, email or practice..." className="pl-9" />
                </div>
                <Select value={firmFilter} onValueChange={setFirmFilter}>
                  <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All practices</SelectItem>
                    {firms.map(f => <SelectItem key={f.id} value={f.id}>{f.trading_name || f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {Object.entries(STATUS_META).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : filteredUsers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-10 text-center">
                  <Scale className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">No portal users yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {firms.filter(f => f.is_active).length === 0
                      ? 'You need an active legal practice before a portal user can be created.'
                      : 'Add the solicitors, conveyancers and practice staff who will work your matters.'}
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4 gap-2"
                    onClick={() => {
                      if (firms.filter(f => f.is_active).length === 0) {
                        setFirmDialog({ open: true, firm: null });
                      } else {
                        setUserDialog({ open: true, user: null });
                      }
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    {firms.filter(f => f.is_active).length === 0 ? 'Create legal practice' : 'New user'}
                  </Button>
                </div>

              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Practice</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Matters</TableHead>
                        <TableHead>Last login</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map(u => {
                        const meta = STATUS_META[u.status] ?? STATUS_META.no_access;
                        const locked = !!u.locked_until && new Date(u.locked_until) > new Date();
                        return (
                          <TableRow key={u.id}>
                            <TableCell>
                              <div className="font-medium">{u.name}</div>
                              <div className="text-xs text-muted-foreground">{u.email}</div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{u.firm_name || '—'}</div>
                              {!u.firm_is_active && <div className="text-xs text-destructive">Practice inactive</div>}
                            </TableCell>
                            <TableCell className="text-sm capitalize">{u.portal_role.replace(/_/g, ' ')}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                <Badge variant={meta.variant} className="text-xs">{meta.label}</Badge>
                                {locked && <Badge variant="destructive" className="text-xs">Locked</Badge>}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{u.assignment_count}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {u.last_login_at ? formatDistanceToNow(new Date(u.last_login_at), { addSuffix: true }) : 'Never'}
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" disabled={busyId === u.id}>
                                    {busyId === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56">
                                  <DropdownMenuItem onClick={() => setUserDialog({ open: true, user: u })}>
                                    <Settings2 className="mr-2 h-4 w-4" /> Edit details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setAssignDialog({ open: true, user: u })}>
                                    <Users className="mr-2 h-4 w-4" /> Matter access
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setPermsDialog({ open: true, user: u })}>
                                    <Shield className="mr-2 h-4 w-4" /> Baseline permissions
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setActivityDialog({ open: true, user: u })}>
                                    <History className="mr-2 h-4 w-4" /> Activity
                                  </DropdownMenuItem>
                                  {/* Where the question is asked: a partner rings
                                      up wanting their agreement and the staff
                                      user is looking at this row. */}
                                  <DropdownMenuItem
                                    disabled={downloadingUserId === u.id}
                                    onClick={() => void downloadForUser('solicitor', u.id, u.name)}
                                  >
                                    <FileSignature className="mr-2 h-4 w-4" />
                                    {downloadingUserId === u.id ? 'Preparing agreement…' : 'Download agreement'}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {u.status !== 'revoked' && (
                                    <DropdownMenuItem onClick={() => sendInvite(u)}>
                                      <Mail className="mr-2 h-4 w-4" />
                                      {u.invite_accepted_at ? 'Resend invite' : 'Send invite'}
                                    </DropdownMenuItem>
                                  )}
                                  {locked && (
                                    <DropdownMenuItem onClick={() => call({ operation: 'update_user', solicitor_user_id: u.id, unlock: true }, 'Account unlocked', u.id)}>
                                      <Unlock className="mr-2 h-4 w-4" /> Unlock account
                                    </DropdownMenuItem>
                                  )}
                                  {u.status === 'revoked' ? (
                                    <DropdownMenuItem onClick={() => restoreAccess(u)}>
                                      <UserCheck className="mr-2 h-4 w-4" /> Restore access
                                    </DropdownMenuItem>
                                  ) : u.is_active ? (
                                    <DropdownMenuItem onClick={() => call({ operation: 'set_user_active', solicitor_user_id: u.id, is_active: false }, 'User deactivated', u.id)}>
                                      <UserX className="mr-2 h-4 w-4" /> Deactivate
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem onClick={() => call({ operation: 'set_user_active', solicitor_user_id: u.id, is_active: true }, 'User activated', u.id)}>
                                      <UserCheck className="mr-2 h-4 w-4" /> Activate
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  {u.status !== 'revoked' && (
                                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirm({ kind: 'revoke_user', user: u })}>
                                      <UserX className="mr-2 h-4 w-4" /> Revoke access
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirm({ kind: 'delete_user', user: u })}>
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete permanently
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───────────── FIRMS ───────────── */}
        <TabsContent value="firms" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-base">Legal Practices</CardTitle>
                <CardDescription>Conveyancing firms your clients instruct. Deactivating a practice ends every live session it owns.</CardDescription>
              </div>
              <Button onClick={() => setFirmDialog({ open: true, firm: null })} className="gap-2">
                <Plus className="h-4 w-4" /> New Practice
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={firmSearch} onChange={e => setFirmSearch(e.target.value)} placeholder="Search practices..." className="pl-9" />
              </div>

              {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : filteredFirms.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-10 text-center">
                  <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">No legal practices yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Add the first conveyancing firm to start issuing portal access.</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Practice</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>States</TableHead>
                        <TableHead>Users</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredFirms.map(f => (
                        <TableRow key={f.id}>
                          <TableCell>
                            <div className="font-medium">{f.trading_name || f.name}</div>
                            <div className="text-xs text-muted-foreground">{f.contact_email || f.abn || '—'}</div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {[f.suburb, f.state, f.postcode].filter(Boolean).join(', ') || '—'}
                          </TableCell>
                          <TableCell className="text-xs">
                            {(f.practising_states || []).length ? (f.practising_states || []).join(' · ') : '—'}
                          </TableCell>
                          <TableCell className="text-sm">{f.active_user_count ?? 0}/{f.user_count ?? 0}</TableCell>
                          <TableCell>
                            <Badge variant={f.is_active ? 'default' : 'outline'} className="text-xs">
                              {f.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" disabled={busyId === f.id}>
                                  {busyId === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setFirmDialog({ open: true, firm: f })}>
                                  <Settings2 className="mr-2 h-4 w-4" /> Edit practice
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { setFirmFilter(f.id); }}>
                                  <Users className="mr-2 h-4 w-4" /> Filter users by practice
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setAiPolicyFirm({id:f.id,name:f.trading_name||f.name})}>
                                  <Shield className="mr-2 h-4 w-4" /> Contract AI policy
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => call({ operation: 'set_firm_active', firm_id: f.id, is_active: !f.is_active }, f.is_active ? 'Practice deactivated' : 'Practice activated', f.id)}
                                >
                                  {f.is_active ? <UserX className="mr-2 h-4 w-4" /> : <UserCheck className="mr-2 h-4 w-4" />}
                                  {f.is_active ? 'Deactivate' : 'Activate'}
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirm({ kind: 'delete_firm', firm: f })}>
                                  <Trash2 className="mr-2 h-4 w-4" /> Delete practice
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-4">
          <div className="space-y-4"><CrossPortalCutoverPanel firms={firms}/><OperationalObservabilityPanel /><IntegrationHealthPanel />{import.meta.env.VITE_FINANCE_SOLICITOR_COLLABORATION === 'true' ? <CollaborationHealthPanel /> : null}</div>
        </TabsContent>

        <TabsContent value="cases" className="mt-4">
          <TransactionCasesPanel />
        </TabsContent>

        {/* ───────────── MATTERS ───────────── */}
        <TabsContent value="matters" className="mt-4">
          <AdminLegalMattersPanel />
        </TabsContent>
      </Tabs>

      <SolicitorFirmDialog
        open={firmDialog.open}
        onOpenChange={o => setFirmDialog(s => ({ ...s, open: o }))}
        firm={firmDialog.firm}
        onSaved={load}
      />
      <SolicitorUserDialog
        open={userDialog.open}
        onOpenChange={o => setUserDialog(s => ({ ...s, open: o }))}
        user={userDialog.user}
        firms={firms}
        defaultFirmId={firmFilter !== 'all' ? firmFilter : null}
        onSaved={load}
      />
      <SolicitorAssignmentsDialog
        open={assignDialog.open}
        onOpenChange={o => setAssignDialog(s => ({ ...s, open: o }))}
        user={assignDialog.user ? { id: assignDialog.user.id, name: assignDialog.user.name } : null}
        onChanged={load}
      />
      <SolicitorGlobalPermissionsDialog
        open={permsDialog.open}
        onOpenChange={o => setPermsDialog(s => ({ ...s, open: o }))}
        user={permsDialog.user ? { id: permsDialog.user.id, name: permsDialog.user.name } : null}
      />
      <SolicitorActivityLogDialog
        open={activityDialog.open}
        onOpenChange={o => setActivityDialog(s => ({ ...s, open: o }))}
        user={activityDialog.user ? { id: activityDialog.user.id, name: activityDialog.user.name } : null}
      />

      <FirmAiPolicyDialog firm={aiPolicyFirm} onClose={()=>setAiPolicyFirm(null)}/>
      <AlertDialog open={!!confirm} onOpenChange={o => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'revoke_user' && 'Revoke portal access?'}
              {confirm?.kind === 'delete_user' && 'Permanently delete this user?'}
              {confirm?.kind === 'delete_firm' && 'Delete this legal practice?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'revoke_user' && (
                <>This immediately ends {confirm.user.name}&apos;s session and invalidates any outstanding invite. Access can be restored later.</>
              )}
              {confirm?.kind === 'delete_user' && (
                <>{confirm.user.name}, their matter access grants, legacy client assignments and baseline permissions will be removed for good. This cannot be undone.</>
              )}
              {confirm?.kind === 'delete_firm' && (
                <>{confirm.firm.name} will be removed. Practices with portal users must have those users removed or reassigned first.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === 'revoke_user') {
                  void call({ operation: 'delete_user', solicitor_user_id: confirm.user.id }, 'Access revoked', confirm.user.id);
                } else if (confirm.kind === 'delete_user') {
                  void call({ operation: 'delete_user', solicitor_user_id: confirm.user.id, hard_delete: true }, 'User deleted', confirm.user.id);
                } else {
                  void call({ operation: 'delete_firm', firm_id: confirm.firm.id }, 'Practice deleted', confirm.firm.id);
                }
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
