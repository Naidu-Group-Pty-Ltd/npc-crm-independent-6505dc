import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Crown, Key, Mail, Settings, ShieldOff, Trash2, Shield, Copy, LogOut, ShieldCheck } from 'lucide-react';
import { Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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

const AML_ROLE_LABELS: Record<AmlRole, string> = {
  analyst: 'Analyst',
  reviewer: 'Reviewer',
  mlro: 'MLRO',
  auditor: 'Auditor',
};

interface UserTableRowProps {
  u: User;
  isSelf: boolean;
  onToggleActive: (userId: string, isActive: boolean) => void;
  onEditPermissions: (userId: string) => void;
  onResetPassword: (user: { id: string; username: string }) => void;
  onPromote: (userId: string) => void;
  onDemote: (userId: string) => void;
  onDelete: (userId: string) => void;
  onEditMailbox: (userId: string, currentMailbox: string | null) => void;
  onClonePermissions: (userId: string) => void;
  onManageAmlRoles: (userId: string) => void;
  onForceLogout?: (userId: string) => void;
  selected?: boolean;
  onToggleSelect?: (userId: string) => void;
}

export function UserTableRow({
  u, isSelf, onToggleActive, onEditPermissions, onResetPassword,
  onPromote, onDemote, onDelete, onEditMailbox, onClonePermissions, onManageAmlRoles, onForceLogout, selected, onToggleSelect,
}: UserTableRowProps) {
  const hasSuperadmin = u.user_roles?.some(r => r.role === 'superadmin');
  const hasAdmin = u.user_roles?.some(r => r.role === 'admin');
  const amlRoles = u.aml_roles ?? [];
  const actionButtonClass = 'h-9 w-9 rounded-xl border-border/70 bg-background/80 p-0 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/40 motion-reduce:transform-none motion-reduce:transition-none';
  const cautionActionButtonClass = 'h-9 w-9 rounded-xl border-brand-300/40 bg-brand-500/10 p-0 text-brand-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-brand-500/15 focus-visible:ring-brand-400/40 motion-reduce:transform-none motion-reduce:transition-none dark:text-brand-200';
  const destructiveActionButtonClass = 'h-9 w-9 rounded-xl p-0 shadow-sm transition-all hover:-translate-y-0.5 focus-visible:ring-destructive/40 motion-reduce:transform-none motion-reduce:transition-none';
  // Bound work on stored usernames before allocating token arrays.
  const userInitials = u.username
    .slice(0, 256)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <TableRow className={selected ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-primary/5'}>
      <TableCell className="pl-5">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect?.(u.id)}
          aria-label={`Select ${u.username}`}
        />
      </TableCell>
      <TableCell className="max-w-[260px] py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-xs font-bold uppercase tracking-wide text-primary shadow-inner">
            {userInitials}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 items-center gap-2 font-semibold text-foreground">
              <span className="truncate" title={u.username}>{u.username}</span>
              {isSelf && (
                <Badge variant="outline" className="border-primary/30 bg-primary/10 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary">
                  You
                </Badge>
              )}
            </div>
            <div className="truncate text-sm text-muted-foreground" title={u.email || 'No email'}>{u.email || 'No email'}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="py-4">
        <div className="flex flex-wrap gap-1.5">
          {hasSuperadmin && (
            <Badge className="border border-brand-300/50 bg-brand-500/15 text-brand-700 shadow-sm shadow-brand-500/10 hover:bg-brand-500/20 dark:text-brand-200">
              <Crown className="h-3 w-3 mr-1" />Superadmin
            </Badge>
          )}
          {hasAdmin && !hasSuperadmin && (
            <Badge variant="secondary" className="border border-primary/20 bg-primary/10 text-primary">
              <Shield className="h-3 w-3 mr-1" />Admin
            </Badge>
          )}
          {!hasSuperadmin && !hasAdmin && <Badge variant="outline" className="border-border/70 bg-muted/40 text-muted-foreground">User</Badge>}
        </div>
      </TableCell>
      <TableCell className="py-4">
        <div className="flex max-w-[220px] flex-wrap gap-1.5">
          {amlRoles.length > 0 ? amlRoles.map((role) => (
            <Badge key={role} variant="outline" className="border-primary/25 bg-primary/10 text-primary">
              {AML_ROLE_LABELS[role] ?? role}
            </Badge>
          )) : (
            <span className="rounded-full border border-dashed border-border/70 bg-muted/25 px-2.5 py-1 text-xs text-muted-foreground">Not assigned</span>
          )}
        </div>
      </TableCell>
      <TableCell className="max-w-[260px] py-4">
        <div className="flex min-w-0 items-center gap-2">
          {u.personal_mailbox ? (
            <span className="min-w-0 truncate rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-sm text-foreground" title={u.personal_mailbox}>{u.personal_mailbox}</span>
          ) : (
            <span className="rounded-full border border-dashed border-border/70 bg-muted/25 px-2.5 py-1 text-sm text-muted-foreground italic">Not set</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEditMailbox(u.id, u.personal_mailbox)}
            className="h-8 w-8 shrink-0 rounded-xl p-0 text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/40 motion-reduce:transition-none"
            aria-label={`Edit mailbox for ${u.username}`}
          >
            <Mail className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
      <TableCell className="py-4">
        <div className="flex items-center gap-2">
          <Switch
            checked={u.is_active}
            onCheckedChange={(v) => onToggleActive(u.id, v)}
            disabled={isSelf}
            aria-label={`${u.is_active ? 'Deactivate' : 'Activate'} ${u.username}`}
          />
          <span className={u.is_active ? 'inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success dark:text-success' : 'inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/35 px-2.5 py-1 text-xs font-semibold text-muted-foreground'}>
            <span className={u.is_active ? 'h-1.5 w-1.5 rounded-full bg-success' : 'h-1.5 w-1.5 rounded-full bg-muted-foreground/60'} />
            {u.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </TableCell>
      <TableCell className="py-4">
        {u.last_login_at ? (
          <div className="flex items-center gap-1 text-sm text-muted-foreground" title={new Date(u.last_login_at).toLocaleString('en-AU')}>
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(new Date(u.last_login_at), { addSuffix: true })}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">Never</span>
        )}
      </TableCell>
      <TableCell className="py-4 text-sm text-muted-foreground">
        {new Date(u.created_at).toLocaleDateString('en-AU')}
      </TableCell>
      <TableCell className="py-4 pr-5 text-right">
        <TooltipProvider>
          <div className="flex items-center justify-end gap-1.5">
            {/* Editing permissions is available on every row, including your
                own and other superadmins'. The self-guards further down cover
                the actions that can strand an account — deactivate, delete,
                demote, force-logout — and permission editing is not one of
                them: the superadmin role carries its own access, so a
                superadmin editing their own grid cannot lock themselves out.
                Hiding it made the role unable to administer the very thing it
                exists to administer. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEditPermissions(u.id)}
                  className={actionButtonClass}
                  aria-label={`Edit permissions for ${u.username}`}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isSelf ? 'Edit Your Permissions' : 'Edit Permissions'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onClonePermissions(u.id)}
                  className={actionButtonClass}
                  aria-label={`Clone permissions from ${u.username}`}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clone Permissions To Another User</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onManageAmlRoles(u.id)}
                  className={actionButtonClass}
                  aria-label={`Manage AML roles for ${u.username}`}
                >
                  <ShieldCheck className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Manage AML Roles</TooltipContent>
            </Tooltip>
            {!isSelf && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onResetPassword({ id: u.id, username: u.username })}
                    className={actionButtonClass}
                    aria-label={`Reset password for ${u.username}`}
                  >
                    <Key className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset Password</TooltipContent>
              </Tooltip>
            )}
            {!hasSuperadmin && !isSelf && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPromote(u.id)}
                    className={cautionActionButtonClass}
                    aria-label={`Promote ${u.username} to superadmin`}
                  >
                    <Crown className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Promote to Superadmin</TooltipContent>
              </Tooltip>
            )}
            {hasSuperadmin && !isSelf && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    title="Demote to Admin"
                    className={cautionActionButtonClass}
                    aria-label={`Demote ${u.username} to admin`}
                  >
                    <ShieldOff className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Demote from Superadmin?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove superadmin privileges from <strong>{u.username}</strong>. They will become a regular admin.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDemote(u.id)}>Demote</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {!isSelf && onForceLogout && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onForceLogout(u.id)}
                    className={actionButtonClass}
                    aria-label={`Force logout for ${u.username}`}
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Force Logout</TooltipContent>
              </Tooltip>
            )}
            {!isSelf && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    title="Delete User"
                    className={destructiveActionButtonClass}
                    aria-label={`Delete ${u.username}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete User?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will soft-delete <strong>{u.username}</strong>. They will be deactivated and can be restored later or permanently purged.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(u.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </TooltipProvider>
      </TableCell>
    </TableRow>
  );
}
