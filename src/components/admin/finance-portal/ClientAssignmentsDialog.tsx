import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { Loader2, Trash2, Wand2, Save } from 'lucide-react';
import { FinancePermissionMatrixEditor, normalizeMatrix, type FinancePermissionMatrix } from './FinancePermissionMatrix';

interface Assignment {
  id: string;
  client_id: string;
  permissions: any;
  auto_linked: boolean;
  auto_link_source: string | null;
  client: {
    id: string;
    primary_contact_name: string | null;
    secondary_contact_name: string | null;
    primary_contact_email: string | null;
    status: string | null;
  } | null;
}

interface ClientOption {
  id: string;
  primary_contact_name: string | null;
  secondary_contact_name: string | null;
  primary_contact_email: string | null;
  finance_contact_id: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  financeUser: {
    portal_user_id: string;
    contact_name: string;
    contact_email: string;
  } | null;
  defaultPermissions: FinancePermissionMatrix;
}

export function ClientAssignmentsDialog({ open, onOpenChange, financeUser, defaultPermissions }: Props) {
  const [loading, setLoading] = useState(false);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [search, setSearch] = useState('');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<FinancePermissionMatrix>(defaultPermissions);
  const [saving, setSaving] = useState(false);
  const [bulkSource, setBulkSource] = useState<'assigned_contact' | 'deal_pipeline' | 'both'>('both');
  const [bulkRunning, setBulkRunning] = useState(false);

  useEffect(() => {
    if (!open || !financeUser) return;
    void loadAll();
    setSearch('');
    setSelectedAssignmentId(null);
    setMatrix(defaultPermissions);
  }, [open, financeUser?.portal_user_id]);

  const loadAll = async () => {
    if (!financeUser) return;
    setLoading(true);
    try {
      const [aRes, cRes] = await Promise.all([
        invokeSecureFunction('finance-portal-admin', {
          operation: 'get_assignments',
          finance_user_id: financeUser.portal_user_id,
        }),
        invokeSecureFunction('finance-portal-admin', { operation: 'list_clients' }),
      ]);
      if (aRes.error) throw new Error(aRes.error.message);
      if (cRes.error) throw new Error(cRes.error.message);
      setAssignments(aRes.data?.records || []);
      setClients(cRes.data?.records || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };

  const selectedAssignment = assignments.find(a => a.id === selectedAssignmentId) || null;

  useEffect(() => {
    if (selectedAssignment) {
      setMatrix(normalizeMatrix(selectedAssignment.permissions));
    }
  }, [selectedAssignmentId]);

  // Auto-select the first assignment so the matrix is immediately visible
  useEffect(() => {
    if (!selectedAssignmentId && assignments.length > 0) {
      setSelectedAssignmentId(assignments[0].id);
    }
  }, [assignments, selectedAssignmentId]);

  const assignedClientIds = new Set(assignments.map(a => a.client_id));
  const filteredAvailable = clients
    .filter(c => !assignedClientIds.has(c.id))
    .filter(c => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (
        (c.primary_contact_name || '').toLowerCase().includes(s) ||
        (c.secondary_contact_name || '').toLowerCase().includes(s) ||
        (c.primary_contact_email || '').toLowerCase().includes(s)
      );
    })
    .slice(0, 100);

  const addClient = async (clientId: string) => {
    if (!financeUser) return;
    setSaving(true);
    try {
      const { error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'upsert_assignment',
        finance_user_id: financeUser.portal_user_id,
        client_id: clientId,
        permissions: defaultPermissions,
      });
      if (error) throw new Error(error.message);
      toast.success('Client assigned');
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || 'Failed to assign client');
    } finally {
      setSaving(false);
    }
  };

  const saveMatrix = async () => {
    if (!financeUser || !selectedAssignment) return;
    setSaving(true);
    try {
      const { error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'upsert_assignment',
        finance_user_id: financeUser.portal_user_id,
        client_id: selectedAssignment.client_id,
        permissions: matrix,
      });
      if (error) throw new Error(error.message);
      toast.success('Permissions saved');
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const removeAssignment = async (assignmentId: string) => {
    if (!confirm('Remove this client assignment? The portal user will lose access immediately.')) return;
    setSaving(true);
    try {
      const { error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'delete_assignment',
        assignment_id: assignmentId,
      });
      if (error) throw new Error(error.message);
      toast.success('Assignment removed');
      if (selectedAssignmentId === assignmentId) setSelectedAssignmentId(null);
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || 'Failed to remove');
    } finally {
      setSaving(false);
    }
  };

  const runBulkAutoLink = async () => {
    if (!financeUser) return;
    setBulkRunning(true);
    try {
      const { data, error } = await invokeSecureFunction('finance-portal-admin', {
        operation: 'bulk_assign',
        finance_user_id: financeUser.portal_user_id,
        source: bulkSource,
      });
      if (error) throw new Error(error.message);
      toast.success(`Auto-linked ${data?.created ?? 0} new client(s)`);
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || 'Auto-link failed');
    } finally {
      setBulkRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Client Assignments</DialogTitle>
          <DialogDescription>
            {financeUser ? (
              <>Configure which clients <span className="font-semibold">{financeUser.contact_name}</span> ({financeUser.contact_email}) can access via the Finance Portal, and the per-table CRUD permissions.</>
            ) : 'Loading...'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 overflow-hidden">
            {/* Left column: assignments + add */}
            <div className="flex flex-col gap-3 min-h-0">
              <div className="border rounded-lg p-3 space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Auto-link from sources</div>
                <div className="flex flex-wrap gap-2">
                  {(['assigned_contact', 'deal_pipeline', 'both'] as const).map(s => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant={bulkSource === s ? 'default' : 'outline'}
                      className="h-7 text-xs"
                      onClick={() => setBulkSource(s)}
                    >
                      {s === 'assigned_contact' ? 'Client Profile' : s === 'deal_pipeline' ? 'Deal Pipeline' : 'Both'}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={runBulkAutoLink}
                    disabled={bulkRunning}
                  >
                    {bulkRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    Run
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Auto-link assigns clients where this finance contact is set as the assigned finance contact (Client Profile or Deal Pipeline). Default permissions are applied.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Assigned ({assignments.length})
                </div>
                {assignments.length > 0 && (
                  <span className="text-[10px] text-muted-foreground italic">click a client to edit permissions →</span>
                )}
              </div>
              <ScrollArea className="flex-1 min-h-[180px] border rounded-lg">
                <div className="p-2 space-y-1">
                  {assignments.length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-6">No clients assigned yet.</div>
                  )}
                  {assignments.map(a => {
                    const isSelected = selectedAssignmentId === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setSelectedAssignmentId(a.id)}
                        className={`w-full text-left p-2 rounded-md border transition-colors cursor-pointer ${
                          isSelected ? 'bg-primary/10 border-primary' : 'border-transparent hover:bg-muted'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">
                              {a.client?.primary_contact_name || 'Unknown client'}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {a.client?.primary_contact_email || '—'}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {a.auto_linked && (
                              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">auto</Badge>
                            )}
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={e => { e.stopPropagation(); void removeAssignment(a.id); }}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>

              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add a client</div>
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search clients..."
                className="h-8 text-sm"
                iconClassName="left-2"
              />
              <ScrollArea className="h-40 border rounded-lg">
                <div className="p-2 space-y-1">
                  {filteredAvailable.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-4">
                      {search ? 'No matches.' : 'All clients are assigned.'}
                    </div>
                  )}
                  {filteredAvailable.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => addClient(c.id)}
                      disabled={saving}
                      className="w-full text-left p-2 rounded-md hover:bg-muted text-sm disabled:opacity-50"
                    >
                      <div className="font-medium truncate">{c.primary_contact_name || 'Unnamed'}</div>
                      <div className="text-xs text-muted-foreground truncate">{c.primary_contact_email || '—'}</div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Right column: permission matrix */}
            <div className="flex flex-col gap-3 min-h-0">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Permission Matrix
              </div>
              {selectedAssignment ? (
                <>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Client:</span>{' '}
                    <span className="font-semibold">{selectedAssignment.client?.primary_contact_name || 'Unknown'}</span>
                  </div>
                  <ScrollArea className="flex-1">
                    <FinancePermissionMatrixEditor
                      matrix={matrix}
                      onChange={setMatrix}
                      disabled={saving}
                    />
                  </ScrollArea>
                  <Button onClick={saveMatrix} disabled={saving} className="gap-2 self-end">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Permissions
                  </Button>
                </>
              ) : (
                <div className="flex-1 border rounded-lg flex items-center justify-center text-sm text-muted-foreground">
                  Select an assignment to edit permissions.
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
