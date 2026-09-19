import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Users, Mail, Plus, Key, AlertCircle, UserPlus, ShieldCheck, Crown } from 'lucide-react';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { useNotifications } from '@/contexts/NotificationsContext';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { PermissionsGrid } from '@/components/admin/PermissionsGrid';
import { ResetPasswordDialog } from '@/components/admin/ResetPasswordDialog';
import { SoftDeletedUsersPanel } from '@/components/admin/SoftDeletedUsersPanel';
import { UserTableRow } from '@/components/admin/UserTableRow';
import { BulkUserActions } from '@/components/admin/BulkUserActions';
import { ClonePermissionsDialog } from '@/components/admin/ClonePermissionsDialog';

interface User {
  id: string;
  username: string;
  email: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  deleted_at: string | null;
  user_roles: Array<{ role: string }>;
  personal_mailbox: string | null;
  aml_roles?: AmlRole[];
}

type AmlRole = 'analyst' | 'reviewer' | 'mlro' | 'auditor';

const AML_ROLE_OPTIONS: Array<{ value: AmlRole; label: string; description: string }> = [
  { value: 'analyst', label: 'Analyst', description: 'Can view AML surfaces and work investigations.' },
  { value: 'reviewer', label: 'Reviewer', description: 'Can review and progress AML investigation work.' },
  { value: 'mlro', label: 'MLRO', description: 'Full AML access, including AUSTRAC reporting and configuration.' },
  { value: 'auditor', label: 'Auditor', description: 'Read-only AML/CTF access for audit review.' },
];

interface Module {
  id: string;
  module_key: string;
  module_name: string;
  description: string;
  category: string;
}

interface PermissionSetting {
  module_key: string;
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export default function UserManagement() {
  const { user } = useAuth();
  const { isSuperadmin, loading: permLoading, refreshPermissions } = usePermissions();
  const { addNotification } = useNotifications();
  
  const [users, setUsers] = useState<User[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [modulesState, setModulesState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [modulesError, setModulesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Invite state
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteType, setInviteType] = useState<'magic_link' | 'temp_password'>('magic_link');
  const [invitePermissions, setInvitePermissions] = useState<PermissionSetting[]>([]);
  const [inviteSending, setInviteSending] = useState(false);

  // Create sub-admin state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createMailbox, setCreateMailbox] = useState('');
  const [createPermissions, setCreatePermissions] = useState<PermissionSetting[]>([]);
  const [creating, setCreating] = useState(false);

  // Edit permissions state
  const [editPermDialogOpen, setEditPermDialogOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editPermissions, setEditPermissions] = useState<PermissionSetting[]>([]);
  const [previousPermissions, setPreviousPermissions] = useState<PermissionSetting[]>([]);
  const [savingPermissions, setSavingPermissions] = useState(false);
  /** Whether the account being edited holds the superadmin role — the grid
   * means something different for them, and the dialog says so. */
  const [editingUserIsSuperadmin, setEditingUserIsSuperadmin] = useState(false);

  // Mailbox editing state
  const [mailboxDialogOpen, setMailboxDialogOpen] = useState(false);
  const [editingMailboxUserId, setEditingMailboxUserId] = useState<string | null>(null);
  const [editingMailboxValue, setEditingMailboxValue] = useState('');
  const [savingMailbox, setSavingMailbox] = useState(false);

  // Reset password state
  const [resetPwDialogOpen, setResetPwDialogOpen] = useState(false);
  const [resetPwUser, setResetPwUser] = useState<{ id: string; username: string } | null>(null);

  // Bulk selection state
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());

  // Clone permissions state
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [cloneSourceUserId, setCloneSourceUserId] = useState('');

  // AML role assignment state
  const [amlRoleDialogOpen, setAmlRoleDialogOpen] = useState(false);
  const [editingAmlUserId, setEditingAmlUserId] = useState<string | null>(null);
  const [editingAmlRoles, setEditingAmlRoles] = useState<AmlRole[]>([]);
  const [savingAmlRoles, setSavingAmlRoles] = useState(false);

  useEffect(() => {
    if (isSuperadmin) {
      fetchUsers();
      fetchModules();
    }
  }, [isSuperadmin]);

  const fetchUsers = async () => {
    try {
      const { data, error } = await invokeSecureFunction('admin-user-management', { action: 'list_users' });
      if (data?.success) setUsers(data.users ?? []);
      else toast.error(data?.error || error?.message || 'Failed to fetch users');
    } catch { toast.error('Failed to fetch users'); }
    finally { setLoading(false); }
  };

  /**
   * The module list, and why it is empty when it is.
   *
   * This used to swallow every failure into `console.error` and leave
   * `modules` at `[]`, so a 403 from `list_modules` — which requires
   * superadmin, and an ADMIN can reach this page — drew an empty permission
   * grid with no explanation. That is the 19 Sep 2026 clone audit's "it
   * doesn't allow to modify any module permissions. None of it is clickable
   * and there is no list of permission that appears below."
   *
   * Three readings, not one: loading, loaded, and could-not-be-read with the
   * server's own reason.
   */
  const fetchModules = async () => {
    setModulesState('loading');
    setModulesError(null);
    try {
      const { data, error } = await invokeSecureFunction('admin-user-management', { action: 'list_modules' });
      if (error || !data?.success) {
        setModules([]);
        setModulesState('unavailable');
        setModulesError(data?.error || error?.message || null);
        return;
      }
      setModules(data.modules);
      setModulesState('ready');
      const defaultPerms = (data.modules as Module[]).map((m: Module) => ({
        module_key: m.module_key, can_view: true, can_edit: false, can_delete: false,
      }));
      setInvitePermissions(defaultPerms);
      setCreatePermissions(defaultPerms);
    } catch (err: any) {
      console.error('Failed to fetch modules:', err);
      setModules([]);
      setModulesState('unavailable');
      setModulesError(err?.message || null);
    }
  };

  const fetchUserPermissions = async (userId: string) => {
    try {
      const { data } = await invokeSecureFunction('admin-user-management', {
        action: 'get_user_permissions', user_id: userId
      });
      if (data?.success) {
        setEditingUserIsSuperadmin(data.target_is_superadmin === true);
        const perms = data.permissions.map((p: any) => ({
          module_key: p.dashboard_modules?.module_key,
          can_view: p.can_view, can_edit: p.can_edit, can_delete: p.can_delete,
        })).filter((p: any) => p.module_key);

        const allPerms = modules.map(m => {
          const existing = perms.find((p: any) => p.module_key === m.module_key);
          return existing || { module_key: m.module_key, can_view: false, can_edit: false, can_delete: false };
        });
        setEditPermissions(allPerms);
        setPreviousPermissions(allPerms.map(p => ({ ...p })));
      }
    } catch { toast.error('Failed to fetch permissions'); }
  };

  /** Build granular diff of permission changes for audit logging */
  const buildPermissionDiffs = (before: PermissionSetting[], after: PermissionSetting[]) => {
    const diffs: Array<{ module: string; field: string; from: boolean; to: boolean }> = [];
    for (const a of after) {
      const b = before.find(p => p.module_key === a.module_key);
      if (!b) continue;
      for (const field of ['can_view', 'can_edit', 'can_delete'] as const) {
        if (b[field] !== a[field]) {
          const mod = modules.find(m => m.module_key === a.module_key);
          diffs.push({ module: mod?.module_name || a.module_key, field, from: b[field], to: a[field] });
        }
      }
    }
    return diffs;
  };

  const handleSendInvite = async () => {
    if (!inviteEmail) { toast.error('Email is required'); return; }
    setInviteSending(true);
    try {
      const { data } = await invokeSecureFunction('admin-user-management', {
        action: 'send_invite',
        invite_data: {
          email: inviteEmail, username: inviteUsername || undefined,
          invite_type: inviteType, permissions: invitePermissions.filter(p => p.can_view),
        }
      });
      if (data?.success) {
        toast.success('Invite sent successfully!');
        if (data.temporary_password) toast.info(`Temporary password: ${data.temporary_password}`, { duration: 10000 });
        logActivityDirect({ actionType: 'user_invited', entityType: 'user', entityName: inviteEmail, metadata: { invite_type: inviteType } });
        addNotification({ type: 'new_user_invited', title: 'User Invite Sent', message: `Invitation sent to ${inviteEmail}` });
        setInviteDialogOpen(false); setInviteEmail(''); setInviteUsername('');
      } else toast.error(data?.error || 'Failed to send invite');
    } catch { toast.error('Failed to send invite'); }
    finally { setInviteSending(false); }
  };

  const handleSavePermissions = async () => {
    if (!editingUserId) return;
    const targetUser = users.find(u => u.id === editingUserId);
    setSavingPermissions(true);
    try {
      const { data } = await invokeSecureFunction('admin-user-management', {
        action: 'update_permissions', user_id: editingUserId,
        permissions: editPermissions.filter(p => p.can_view),
      });
      if (data?.success) {
        const diffs = buildPermissionDiffs(previousPermissions, editPermissions);
        toast.success('Permissions updated');
        logActivityDirect({
          actionType: 'user_permissions_changed', entityType: 'user',
          entityId: editingUserId, entityName: targetUser?.username,
          metadata: {
            permissions_count: editPermissions.filter(p => p.can_view).length,
            changes: diffs.length > 0 ? diffs : undefined,
            change_summary: diffs.map(d => `${d.module}: ${d.field} ${d.from}→${d.to}`).join(', ') || 'no changes',
          }
        });
        addNotification({ type: 'user_role_updated', title: 'User Permissions Updated', message: `Permissions for ${targetUser?.username || 'user'} have been updated`, entityId: editingUserId });
        setEditPermDialogOpen(false);
        fetchUsers();
        // Editing your own grid keeps your session (the server skips the
        // revocation that would otherwise sign you out), so nothing else
        // re-reads it — pull the new grants into this tab directly.
        if (editingUserId === user?.id) void refreshPermissions();
      } else toast.error(data?.error || 'Failed to update permissions');
    } catch { toast.error('Failed to update permissions'); }
    finally { setSavingPermissions(false); }
  };

  const handleForceLogout = async (userId: string) => {
    const targetUser = users.find(u => u.id === userId);
    try {
      const { data } = await invokeSecureFunction('admin-user-management', { action: 'force_logout', user_id: userId });
      if (data?.success) {
        toast.success(data.message || `${targetUser?.username} has been logged out`);
        logActivityDirect({ actionType: 'user_deactivated', entityType: 'user', entityId: userId, entityName: targetUser?.username, metadata: { action: 'force_logout' } });
      } else toast.error(data?.error || 'Failed to force logout');
    } catch { toast.error('Failed to force logout'); }
  };
  const handleToggleActive = async (userId: string, isActive: boolean) => {
    try {
      const { data } = await invokeSecureFunction('admin-user-management', {
        action: 'update_user', user_id: userId, is_active: isActive,
      });
      if (data?.success) {
        const targetUser = users.find(u => u.id === userId);
        toast.success(isActive ? 'User activated' : 'User deactivated');
        logActivityDirect({ actionType: isActive ? 'user_activated' : 'user_deactivated', entityType: 'user', entityId: userId, entityName: targetUser?.username, metadata: { is_active: isActive } });
        fetchUsers();
      } else toast.error(data?.error || 'Failed to update user');
    } catch { toast.error('Failed to update user'); }
  };

  const handlePromoteToSuperadmin = async (userId: string) => {
    const targetUser = users.find(u => u.id === userId);
    try {
      const { data } = await invokeSecureFunction('admin-user-management', { action: 'promote_to_superadmin', user_id: userId });
      if (data?.success) {
        toast.success('User promoted to superadmin');
        logActivityDirect({ actionType: 'user_invited', entityType: 'user', entityId: userId, entityName: targetUser?.username, metadata: { action: 'promoted_to_superadmin' } });
        addNotification({ type: 'user_role_updated', title: 'User Promoted to Superadmin', message: `${targetUser?.username || 'User'} has been promoted to superadmin`, entityId: userId });
        fetchUsers();
      } else toast.error(data?.error || 'Failed to promote user');
    } catch { toast.error('Failed to promote user'); }
  };

  const handleDemoteFromSuperadmin = async (userId: string) => {
    const targetUser = users.find(u => u.id === userId);
    try {
      const { data } = await invokeSecureFunction('admin-user-management', { action: 'demote_from_superadmin', user_id: userId });
      if (data?.success) {
        toast.success('User demoted to admin');
        logActivityDirect({ actionType: 'user_deactivated', entityType: 'user', entityId: userId, entityName: targetUser?.username, metadata: { action: 'demoted_from_superadmin' } });
        fetchUsers();
      } else toast.error(data?.error || 'Failed to demote user');
    } catch { toast.error('Failed to demote user'); }
  };

  const handleDeleteUser = async (userId: string) => {
    const targetUser = users.find(u => u.id === userId);
    try {
      const { data } = await invokeSecureFunction('admin-user-management', { action: 'delete_user', user_id: userId });
      if (data?.success) {
        toast.success('User moved to deleted');
        logActivityDirect({ actionType: 'user_deactivated', entityType: 'user', entityId: userId, entityName: targetUser?.username, metadata: { action: 'soft_deleted' } });
        fetchUsers();
      } else toast.error(data?.error || 'Failed to delete user');
    } catch { toast.error('Failed to delete user'); }
  };

  const openEditPermissions = (userId: string) => {
    setEditingUserId(userId);
    fetchUserPermissions(userId);
    setEditPermDialogOpen(true);
  };

  const updatePermission = (setter: React.Dispatch<React.SetStateAction<PermissionSetting[]>>) =>
    (moduleKey: string, field: 'can_view' | 'can_edit' | 'can_delete', value: boolean) => {
      setter(prev => prev.map(p => p.module_key === moduleKey ? { ...p, [field]: value } : p));
    };

  const handleCreateSubAdmin = async () => {
    if (!createUsername || !createPassword) { toast.error('Username and password are required'); return; }
    if (createPassword.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    const trimmedEmail = createEmail.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error('A valid email address is required for every account');
      return;
    }
    setCreating(true);
    try {
      const { data } = await invokeSecureFunction('admin-user-management', {
        action: 'create_subadmin',
        subadmin_data: {
          username: createUsername, password: createPassword,
          email: createEmail || undefined, personal_mailbox: createMailbox || undefined,
          permissions: createPermissions.filter(p => p.can_view),
        }
      });
      if (data?.success) {
        toast.success('Sub-admin created successfully!');
        logActivityDirect({ actionType: 'user_invited', entityType: 'user', entityId: data.user_id, entityName: createUsername, metadata: { action: 'created_subadmin' } });
        addNotification({ type: 'new_user_invited', title: 'New Sub-Admin Created', message: `${createUsername} has been added as a sub-admin`, entityId: data.user_id });
        setCreateDialogOpen(false);
        setCreateUsername(''); setCreatePassword(''); setCreateEmail(''); setCreateMailbox('');
        setCreatePermissions(modules.map(m => ({ module_key: m.module_key, can_view: true, can_edit: false, can_delete: false })));
        fetchUsers();
      } else toast.error(data?.error || 'Failed to create sub-admin');
    } catch { toast.error('Failed to create sub-admin'); }
    finally { setCreating(false); }
  };

  const openMailboxDialog = (userId: string, currentMailbox: string | null) => {
    setEditingMailboxUserId(userId);
    setEditingMailboxValue(currentMailbox || '');
    setMailboxDialogOpen(true);
  };

  const openAmlRoleDialog = (userId: string) => {
    const targetUser = users.find((entry) => entry.id === userId);
    setEditingAmlUserId(userId);
    setEditingAmlRoles(targetUser?.aml_roles ?? []);
    setAmlRoleDialogOpen(true);
  };

  const toggleAmlRole = (role: AmlRole, checked: boolean) => {
    setEditingAmlRoles((current) => {
      if (checked) return current.includes(role) ? current : [...current, role];
      return current.filter((entry) => entry !== role);
    });
  };

  const handleSaveAmlRoles = async () => {
    if (!editingAmlUserId) return;
    const targetUser = users.find((entry) => entry.id === editingAmlUserId);
    setSavingAmlRoles(true);
    try {
      const { data, error } = await invokeSecureFunction('admin-user-management', {
        action: 'set_aml_roles',
        user_id: editingAmlUserId,
        aml_roles: editingAmlRoles,
      });

      if (data?.success) {
        const nextRoles = (data.aml_roles ?? editingAmlRoles) as AmlRole[];
        setUsers((current) => current.map((entry) => (
          entry.id === editingAmlUserId ? { ...entry, aml_roles: nextRoles } : entry
        )));
        toast.success('AML roles updated');
        logActivityDirect({
          actionType: 'user_permissions_changed',
          entityType: 'user',
          entityId: editingAmlUserId,
          entityName: targetUser?.username,
          metadata: { action: 'aml_roles_updated', aml_roles: nextRoles },
        });
        setAmlRoleDialogOpen(false);
        await fetchUsers();
      } else {
        toast.error(data?.error || error?.message || 'Failed to update AML roles');
      }
    } catch (err) {
      console.error('[UserManagement] Failed to update AML roles:', err);
      toast.error('Failed to update AML roles');
    } finally {
      setSavingAmlRoles(false);
    }
  };

  const handleSaveMailbox = async () => {
    if (!editingMailboxUserId) return;
    setSavingMailbox(true);
    try {
      const trimmed = editingMailboxValue.trim();
      // Basic email validation when a value is provided (empty = clear)
      if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        toast.error('Please enter a valid email address');
        setSavingMailbox(false);
        return;
      }

      const { data, error } = await invokeSecureFunction('admin-user-management', {
        action: 'update_user',
        user_id: editingMailboxUserId,
        personal_mailbox: trimmed || null,
      });
      if (data?.success) {
        // Optimistically update the row so the UI reflects the new value
        // immediately, even before the list refetch resolves.
        setUsers(prev => prev.map(u =>
          u.id === editingMailboxUserId
            ? { ...u, personal_mailbox: trimmed || null }
            : u
        ));
        toast.success(trimmed ? 'Mailbox updated' : 'Mailbox cleared');
        setMailboxDialogOpen(false);
        await fetchUsers();
      } else {
        toast.error(data?.error || error?.message || 'Failed to update mailbox');
      }
    } catch (err) {
      console.error('[UserManagement] Failed to update mailbox:', err);
      toast.error('Failed to update mailbox');
    }
    finally { setSavingMailbox(false); }
  };

  const toggleSelectUser = (userId: string) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedUserIds.size === users.length) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(users.map(u => u.id)));
    }
  };

  if (permLoading) {
    return <div className="p-6 flex items-center justify-center"><div className="text-muted-foreground">Loading...</div></div>;
  }

  if (!isSuperadmin) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>You don't have permission to access this page. Superadmin access required.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <DashboardThemeFrame
      as="main"
      variant="page"
      className="space-y-6 p-4 pb-8 sm:p-6"
    >
      {/* Header */}
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="flex flex-col gap-5 border-primary/20 bg-card/90 p-5 shadow-lg shadow-primary/5 sm:p-6 lg:flex-row lg:items-center lg:justify-between"
      >
        <div className="min-w-0 space-y-1">
          <h1 className="flex min-w-0 items-center gap-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-inner">
              <Users className="h-6 w-6" />
            </span>
            <span className="truncate">User Management</span>
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Manage users, roles, and permissions
          </p>
        </div>
        
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
          {/* Create Sub-Admin Button */}
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="w-full border-primary/25 bg-background/70 shadow-sm transition-all hover:border-primary/45 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/40 sm:w-auto"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Sub-Admin
              </Button>
            </DialogTrigger>
            <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 overflow-hidden border-primary/15 bg-card/95 p-0 shadow-2xl shadow-primary/10 sm:h-auto sm:max-h-[88vh]">
              <DialogHeader className="shrink-0 border-b border-border/60 bg-gradient-to-r from-primary/10 via-card to-card px-6 py-5">
                <DialogTitle className="flex items-center gap-2 text-xl">
                  <Plus className="h-5 w-5 text-primary" />
                  Create Sub-Admin
                </DialogTitle>
                <DialogDescription>Create a new sub-admin account with specific permissions.</DialogDescription>
              </DialogHeader>
              <div className="flex-1 min-h-0 space-y-5 overflow-y-auto p-6">
                <div className="space-y-4 rounded-2xl border border-border/60 bg-muted/20 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Account details</h3>
                    <p className="text-xs text-muted-foreground">Set the required sign-in details and mailbox routing for this sub-admin.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Username *</Label>
                      <Input value={createUsername} onChange={(e) => setCreateUsername(e.target.value)} placeholder="username" />
                    </div>
                    <div className="space-y-2">
                      <Label>Password *</Label>
                      <Input type="password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} placeholder="Min 6 characters" />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Email <span className="text-destructive">*</span></Label>
                      <Input type="email" required value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} placeholder="user@example.com" />
                    </div>
                    <div className="space-y-2">
                      <Label>Personal Mailbox (optional)</Label>
                      <Input type="email" value={createMailbox} onChange={(e) => setCreateMailbox(e.target.value)} placeholder="mailbox@example.com" />
                    </div>
                  </div>
                </div>
                <div className="space-y-3 rounded-2xl border border-border/60 bg-background/60 p-4">
                  <div>
                    <Label>Module Permissions</Label>
                    <p className="text-xs text-muted-foreground">Choose the modules this sub-admin can access. Existing permission logic is unchanged.</p>
                  </div>
                  <PermissionsGrid
                    modules={modules}
                    permissions={createPermissions}
                    onUpdate={updatePermission(setCreatePermissions)}
                    onApplyPreset={setCreatePermissions}
                    loadState={modulesState}
                    loadError={modulesError}
                  />
                </div>
              </div>
              <div className="shrink-0 border-t border-border/60 bg-background/90 px-6 py-4 backdrop-blur">
                <Button onClick={handleCreateSubAdmin} disabled={creating} className="w-full shadow-lg shadow-primary/15">
                  {creating ? 'Creating...' : 'Create Sub-Admin'}
                </Button>
              </div>
            </DialogContent>

          </Dialog>

          {/* Invite User Button */}
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-primary/30 focus-visible:ring-primary/40 sm:w-auto">
                <UserPlus className="h-4 w-4 mr-2" />
                Invite User
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto border-primary/15 bg-card/95 p-0 shadow-2xl shadow-primary/10">
              <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-primary/10 via-card to-card px-6 py-5">
                <DialogTitle className="flex items-center gap-2 text-xl">
                  <UserPlus className="h-5 w-5 text-primary" />
                  Invite New User
                </DialogTitle>
                <DialogDescription>Send an invitation to join the dashboard with specific permissions.</DialogDescription>
              </DialogHeader>
              <div className="space-y-5 p-6">
                <div className="space-y-4 rounded-2xl border border-border/60 bg-muted/20 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Invitation details</h3>
                    <p className="text-xs text-muted-foreground">Enter the recipient and choose the existing invite delivery method.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Email *</Label>
                      <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="user@example.com" />
                    </div>
                    <div className="space-y-2">
                      <Label>Username (optional)</Label>
                      <Input value={inviteUsername} onChange={(e) => setInviteUsername(e.target.value)} placeholder="Leave blank to use email" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Invite Method</Label>
                    <Select value={inviteType} onValueChange={(v: 'magic_link' | 'temp_password') => setInviteType(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="magic_link"><div className="flex items-center gap-2"><Mail className="h-4 w-4" />Magic Link</div></SelectItem>
                        <SelectItem value="temp_password"><div className="flex items-center gap-2"><Key className="h-4 w-4" />Temporary Password</div></SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-3 rounded-2xl border border-border/60 bg-background/60 p-4">
                  <div>
                    <Label>Module Permissions</Label>
                    <p className="text-xs text-muted-foreground">Assign starting module access for the invited user. Existing permission logic is unchanged.</p>
                  </div>
                  <PermissionsGrid
                    modules={modules}
                    permissions={invitePermissions}
                    onUpdate={updatePermission(setInvitePermissions)}
                    onApplyPreset={setInvitePermissions}
                    loadState={modulesState}
                    loadError={modulesError}
                  />
                </div>
                <Button onClick={handleSendInvite} disabled={inviteSending} className="w-full shadow-lg shadow-primary/15">
                  {inviteSending ? 'Sending...' : 'Send Invitation'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </DashboardThemeFrame>

      {/* Bulk Actions */}
      <BulkUserActions
        selectedIds={selectedUserIds}
        currentUserId={user?.id || ''}
        onToggleSelect={toggleSelectUser}
        onSelectAll={() => handleSelectAll()}
        onClearSelection={() => setSelectedUserIds(new Set())}
        onRefresh={fetchUsers}
      />

      {/* Users List */}
      <Card className="overflow-hidden rounded-[1.5rem] border-border/70 bg-card/90 shadow-lg shadow-primary/5 ring-1 ring-primary/5 dark:border-white/10">
        <CardHeader className="border-b border-border/60 bg-muted/25 px-5 py-5 dark:border-white/10 sm:px-6">
          <CardTitle className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">All Users</CardTitle>
          <CardDescription className="text-sm leading-6">Manage user accounts and their access levels</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-5" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Loading users...</p>
                  <p className="text-xs text-muted-foreground">Fetching user accounts and access levels.</p>
                </div>
                <div className="h-9 w-24 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
              </div>
              <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/60">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="grid min-w-[1120px] grid-cols-[48px_220px_150px_170px_220px_150px_160px_130px_280px] items-center gap-0 border-b border-border/50 px-5 py-4 last:border-b-0">
                    <div className="h-4 w-4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                    <div className="space-y-2">
                      <div className="h-4 w-36 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                      <div className="h-3 w-44 animate-pulse rounded bg-muted/80 motion-reduce:animate-none" />
                    </div>
                    <div className="h-6 w-24 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
                    <div className="h-6 w-40 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
                    <div className="h-7 w-24 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
                    <div className="h-4 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                    <div className="h-4 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                    <div className="ml-auto flex gap-2">
                      <div className="h-9 w-9 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
                      <div className="h-9 w-9 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
                      <div className="h-9 w-9 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : users.length === 0 ? (
            <div className="flex min-h-[18rem] flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                <Users className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">No users found</h3>
                <p className="max-w-md text-sm text-muted-foreground">
                  User accounts will appear here when they are returned by the existing user-management service.
                </p>
              </div>
            </div>
          ) : (
            <Table className="min-w-[1120px]" aria-label="All users">
              <TableHeader>
                <TableRow className="border-border/70 bg-muted/45 hover:bg-muted/45 dark:border-white/10">
                  <TableHead className="w-12 pl-5">
                    <Checkbox
                      checked={selectedUserIds.size === users.length && users.length > 0}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all users"
                    />
                  </TableHead>
                  <TableHead className="min-w-[220px] text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">User</TableHead>
                  <TableHead className="min-w-[150px] text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Role</TableHead>
                  <TableHead className="min-w-[170px] text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">AML Roles</TableHead>
                  <TableHead className="min-w-[220px] text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mailbox</TableHead>
                  <TableHead className="min-w-[150px] text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Status</TableHead>
                  <TableHead className="min-w-[160px] text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Last Login</TableHead>
                  <TableHead className="min-w-[130px] text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Created</TableHead>
                  <TableHead className="min-w-[280px] pr-5 text-right text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <UserTableRow
                    key={u.id}
                    u={u}
                    isSelf={u.id === user?.id}
                    onToggleActive={handleToggleActive}
                    onEditPermissions={openEditPermissions}
                    onResetPassword={(usr) => { setResetPwUser(usr); setResetPwDialogOpen(true); }}
                    onPromote={handlePromoteToSuperadmin}
                    onDemote={handleDemoteFromSuperadmin}
                    onDelete={handleDeleteUser}
                    onEditMailbox={openMailboxDialog}
                    onClonePermissions={(userId) => { setCloneSourceUserId(userId); setCloneDialogOpen(true); }}
                    onManageAmlRoles={openAmlRoleDialog}
                    onForceLogout={handleForceLogout}
                    selected={selectedUserIds.has(u.id)}
                    onToggleSelect={toggleSelectUser}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Soft-Deleted Users */}
      <SoftDeletedUsersPanel />

      {/* Edit Permissions Dialog */}
      <Dialog open={editPermDialogOpen} onOpenChange={setEditPermDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingUserId === user?.id ? 'Edit Your Permissions' : 'Edit Permissions'}</DialogTitle>
            <DialogDescription>
              Update module access for {users.find(u => u.id === editingUserId)?.username || 'this user'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {editingUserIsSuperadmin && (
              <Alert>
                <Crown className="h-4 w-4" />
                <AlertTitle>
                  {editingUserId === user?.id ? 'You hold the superadmin role' : 'This account holds the superadmin role'}
                </AlertTitle>
                <AlertDescription>
                  The superadmin role grants every module on its own, so these checkboxes do not
                  restrict {editingUserId === user?.id ? 'you' : 'them'} while the role is held. They
                  are the access that takes effect if the role is ever removed — worth setting
                  deliberately rather than leaving empty.
                </AlertDescription>
              </Alert>
            )}
            <PermissionsGrid
              modules={modules}
              permissions={editPermissions}
              onUpdate={updatePermission(setEditPermissions)}
              onApplyPreset={setEditPermissions}
              loadState={modulesState}
              loadError={modulesError}
            />
            <Button onClick={handleSavePermissions} disabled={savingPermissions} className="w-full">
              {savingPermissions ? 'Saving...' : 'Save Permissions'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      {resetPwUser && (
        <ResetPasswordDialog
          open={resetPwDialogOpen}
          onOpenChange={setResetPwDialogOpen}
          userId={resetPwUser.id}
          username={resetPwUser.username}
        />
      )}

      {/* Clone Permissions Dialog */}
      <ClonePermissionsDialog
        open={cloneDialogOpen}
        onOpenChange={setCloneDialogOpen}
        sourceUserId={cloneSourceUserId}
        users={users}
        onSuccess={fetchUsers}
      />

      {/* AML Role Assignment Dialog */}
      <Dialog open={amlRoleDialogOpen} onOpenChange={setAmlRoleDialogOpen}>
        <DialogContent className="max-w-xl border-primary/15 bg-card/95 p-0 shadow-2xl shadow-primary/10">
          <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-primary/10 via-card to-card px-6 py-5">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Assign AML Roles
            </DialogTitle>
            <DialogDescription>
              Select the AML/CTF roles for {users.find((entry) => entry.id === editingAmlUserId)?.username || 'this user'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 p-6">
            {AML_ROLE_OPTIONS.map((role) => (
              <label key={role.value} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/60 bg-background/60 p-4 transition-colors hover:border-primary/30 hover:bg-primary/5">
                <Checkbox
                  checked={editingAmlRoles.includes(role.value)}
                  onCheckedChange={(checked) => toggleAmlRole(role.value, checked === true)}
                  aria-label={`Toggle ${role.label} AML role`}
                />
                <span className="min-w-0 space-y-1">
                  <span className="block text-sm font-semibold text-foreground">{role.label}</span>
                  <span className="block text-xs leading-5 text-muted-foreground">{role.description}</span>
                </span>
              </label>
            ))}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setAmlRoleDialogOpen(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleSaveAmlRoles} disabled={savingAmlRoles} className="flex-1">
                {savingAmlRoles ? 'Saving...' : 'Save AML Roles'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Mailbox Dialog */}
      <Dialog open={mailboxDialogOpen} onOpenChange={setMailboxDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure Personal Mailbox</DialogTitle>
            <DialogDescription>Set the personal email mailbox for this user.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Personal Mailbox Email</Label>
              <Input type="email" value={editingMailboxValue} onChange={(e) => setEditingMailboxValue(e.target.value)} placeholder="user@example.com" />
              <p className="text-xs text-muted-foreground">This mailbox will be used for this user's email communications.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMailboxDialogOpen(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleSaveMailbox} disabled={savingMailbox} className="flex-1">
                {savingMailbox ? 'Saving...' : 'Save Mailbox'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardThemeFrame>
  );
}
