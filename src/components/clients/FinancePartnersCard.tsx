import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import {
  Briefcase, Plus, Trash2, Save, Loader2, Settings2, ShieldCheck,
} from 'lucide-react';
import {
  FinancePermissionMatrixEditor,
  normalizeMatrix,
  EMPTY_MATRIX,
  type FinancePermissionMatrix,
} from '@/components/admin/finance-portal/FinancePermissionMatrix';

interface Props {
  clientId: string;
  clientName: string;
}

interface PartnerOption {
  portal_user_id: string;
  contact_id: string;
  contact_name: string;
  contact_email: string;
  status: string;
}

interface ClientAssignment {
  assignment_id: string;
  finance_user_id: string;
  permissions: FinancePermissionMatrix;
  partner_name: string;
  partner_email: string;
  partner_status: string;
  auto_linked: boolean;
  assigned_at: string;
}

/**
 * Client-first finance partner assignment card.
 * Shown on the Client Detail → Overview tab.
 * Lets superadmins assign / unassign / edit permissions for any finance portal partner
 * directly from the client record (mirror of the partner-first dialog at /admin/finance-portal).
 */
export function FinancePartnersCard({ clientId, clientName }: Props) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [permEditor, setPermEditor] = useState<ClientAssignment | null>(null);
  const [matrix, setMatrix] = useState<FinancePermissionMatrix>(EMPTY_MATRIX);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // Load all finance portal partners (active accounts only)
  const { data: partnersData, isLoading: partnersLoading } = useQuery({
    queryKey: ['finance-portal-users-for-client-assignment'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'list_users',
      });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  // Load the default permission template (used when assigning a new partner)
  const { data: defaultsData } = useQuery({
    queryKey: ['finance-portal-default-permissions'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'get_default_permissions',
      });
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const defaultPermissions: FinancePermissionMatrix = useMemo(
    () => normalizeMatrix(defaultsData?.permissions),
    [defaultsData]
  );

  // Load assignments for THIS client across all partners
  const allPartners: PartnerOption[] = useMemo(() => {
    const records = partnersData?.records || [];
    return records
      .filter((u: any) => u.portal_user?.id && !u.portal_user?.revoked_at)
      .map((u: any) => ({
        portal_user_id: u.portal_user.id,
        contact_id: u.id,
        contact_name: u.name,
        contact_email: u.email || u.portal_user?.email || '',
        status: u.status,
      }));
  }, [partnersData]);

  const { data: clientAssignmentsData, isLoading: assignmentsLoading, refetch } = useQuery({
    queryKey: ['client-finance-partner-assignments', clientId, allPartners.length],
    enabled: allPartners.length > 0,
    queryFn: async () => {
      // Fetch assignments per partner; small N (typically <20)
      const results = await Promise.all(
        allPartners.map(async (p) => {
          const { data, error } = await invokeSecureFunction('finance-portal-admin', {
            operation: 'get_assignments',
            finance_user_id: p.portal_user_id,
          });
          if (error) return null;
          const a = (data?.records || []).find((r: any) => r.client_id === clientId);
          if (!a) return null;
          return {
            assignment_id: a.id,
            finance_user_id: p.portal_user_id,
            permissions: normalizeMatrix(a.permissions),
            partner_name: p.contact_name,
            partner_email: p.contact_email,
            partner_status: p.status,
            auto_linked: !!a.auto_linked,
            assigned_at: a.assigned_at,
          } as ClientAssignment;
        })
      );
      return results.filter(Boolean) as ClientAssignment[];
    },
  });

  const assignments = clientAssignmentsData || [];
  const assignedPartnerIds = new Set(assignments.map((a) => a.finance_user_id));
  const availablePartners = allPartners.filter((p) => !assignedPartnerIds.has(p.portal_user_id));

  const filteredAvailable = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return availablePartners;
    return availablePartners.filter(
      (p) =>
        p.contact_name.toLowerCase().includes(s) ||
        p.contact_email.toLowerCase().includes(s)
    );
  }, [availablePartners, search]);

  useEffect(() => {
    if (permEditor) setMatrix(permEditor.permissions);
  }, [permEditor]);

  const invalidateAll = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['client-finance-partner-assignments', clientId] });
  };

  const assignPartner = async (partner: PartnerOption) => {
    setSaving(true);
    try {
      const { error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'upsert_assignment',
        finance_user_id: partner.portal_user_id,
        client_id: clientId,
        permissions: defaultPermissions,
      });
      if (error) throw new Error(error.message);
      toast.success(`Assigned ${partner.contact_name} with default permissions`);
      setAddOpen(false);
      setSearch('');
      invalidateAll();
    } catch (e: any) {
      toast.error(e.message || 'Failed to assign partner');
    } finally {
      setSaving(false);
    }
  };

  const savePermissions = async () => {
    if (!permEditor) return;
    setSaving(true);
    try {
      const { error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'upsert_assignment',
        finance_user_id: permEditor.finance_user_id,
        client_id: clientId,
        permissions: matrix,
      });
      if (error) throw new Error(error.message);
      toast.success('Permissions updated');
      setPermEditor(null);
      invalidateAll();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const removeAssignment = async (a: ClientAssignment) => {
    if (!confirm(`Remove ${a.partner_name}'s access to ${clientName}? They will lose all access immediately.`)) return;
    setSaving(true);
    try {
      const { error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'delete_assignment',
        assignment_id: a.assignment_id,
      });
      if (error) throw new Error(error.message);
      toast.success(`${a.partner_name} unassigned`);
      invalidateAll();
    } catch (e: any) {
      toast.error(e.message || 'Failed to remove');
    } finally {
      setSaving(false);
    }
  };

  const grantedCount = (perms: FinancePermissionMatrix) =>
    Object.values(perms).filter((p) => p?.view).length;

  const loading = partnersLoading || assignmentsLoading;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-muted-foreground" />
            Finance Partners
          </CardTitle>
          <CardDescription className="text-xs mt-0.5">
            Finance officers with portal access to this client
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs shrink-0"
          onClick={() => setAddOpen(true)}
          disabled={loading}
        >
          <Plus className="h-3.5 w-3.5" />
          Assign Partner
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-md">
            No finance partners assigned yet.
          </div>
        ) : (
          assignments.map((a) => (
            <div
              key={a.assignment_id}
              className="flex items-center justify-between gap-3 p-2.5 border rounded-md hover:bg-muted/40 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{a.partner_name}</span>
                  {a.auto_linked && (
                    <Badge variant="secondary" className="h-4 text-[10px] px-1.5">auto</Badge>
                  )}
                  <Badge variant="outline" className="h-4 text-[10px] px-1.5">
                    {grantedCount(a.permissions)}/12 sections
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate">{a.partner_email}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setPermEditor(a)}
                  title="Edit permissions"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => removeAssignment(a)}
                  title="Unassign"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      {/* Add partner dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Finance Partner</DialogTitle>
            <DialogDescription>
              Grant a finance portal partner access to <span className="font-semibold">{clientName}</span>.
              Default permissions will be applied — you can refine them after.
            </DialogDescription>
          </DialogHeader>
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search partners..."
            className="h-9"
            iconClassName="left-2"
          />
          <ScrollArea className="h-72 border rounded-md">
            <div className="p-2 space-y-1">
              {filteredAvailable.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">
                  {availablePartners.length === 0
                    ? 'All active partners are already assigned to this client.'
                    : 'No matches.'}
                </div>
              ) : (
                filteredAvailable.map((p) => (
                  <button
                    key={p.portal_user_id}
                    type="button"
                    disabled={saving}
                    onClick={() => assignPartner(p)}
                    className="w-full text-left p-2 rounded-md hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{p.contact_name}</div>
                        <div className="text-xs text-muted-foreground truncate">{p.contact_email}</div>
                      </div>
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">
                        {p.status}
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit permissions dialog */}
      <Dialog open={!!permEditor} onOpenChange={(o) => { if (!o) setPermEditor(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Edit Permissions
            </DialogTitle>
            <DialogDescription>
              {permEditor && (
                <>Configure what <span className="font-semibold">{permEditor.partner_name}</span> can see and do for <span className="font-semibold">{clientName}</span>.</>
              )}
            </DialogDescription>
          </DialogHeader>
          {permEditor && (
            <ScrollArea className="max-h-[60vh]">
              <FinancePermissionMatrixEditor
                matrix={matrix}
                onChange={setMatrix}
                disabled={saving}
              />
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermEditor(null)}>Cancel</Button>
            <Button onClick={savePermissions} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Permissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
