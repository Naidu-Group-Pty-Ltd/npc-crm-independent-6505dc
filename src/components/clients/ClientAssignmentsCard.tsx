import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useFinanceContacts } from '@/hooks/useFinanceContacts';
import { useTeamUsers } from '@/hooks/useTeamUsers';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { UserCog, Save, Loader2, Briefcase, Users } from 'lucide-react';
import { invalidateClientQueries } from '@/lib/clients/invalidateClientQueries';

interface Props {
  clientId: string;
  financeContactId?: string | null;
  assignedTeamUserId?: string | null;
  onSaved?: () => void;
}

const UNASSIGNED = 'unassigned';

/**
 * Assigns a client to (a) a Finance Contact and (b) an Internal Team Member.
 * Two independent fields persisted on `clients` row via manage-client-data edge function.
 */
export function ClientAssignmentsCard({
  clientId,
  financeContactId,
  assignedTeamUserId,
  onSaved,
}: Props) {
  const queryClient = useQueryClient();
  const { contacts: financeContacts, isLoading: financeLoading } = useFinanceContacts();
  const { data: teamUsers = [], isLoading: teamLoading } = useTeamUsers();

  const [financeId, setFinanceId] = useState<string>(financeContactId || UNASSIGNED);
  const [teamId, setTeamId] = useState<string>(assignedTeamUserId || UNASSIGNED);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFinanceId(financeContactId || UNASSIGNED);
  }, [financeContactId]);

  useEffect(() => {
    setTeamId(assignedTeamUserId || UNASSIGNED);
  }, [assignedTeamUserId]);

  const dirty =
    (financeContactId || UNASSIGNED) !== financeId ||
    (assignedTeamUserId || UNASSIGNED) !== teamId;

  const save = async () => {
    setSaving(true);
    try {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'clients',
        clientId,
        data: {
          finance_contact_id: financeId === UNASSIGNED ? null : financeId,
          assigned_team_user_id: teamId === UNASSIGNED ? null : teamId,
        },
      });
      if (error) throw new Error(error.message);
      if (data && data.success === false) throw new Error(data.error || 'Failed to save');
      toast.success('Assignments updated');
      invalidateClientQueries(queryClient, clientId, {
        also: [['client', clientId], ['full-client', clientId]],
      });
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save assignments');
    } finally {
      setSaving(false);
    }
  };

  const loading = financeLoading || teamLoading;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <UserCog className="h-4 w-4 text-muted-foreground" />
          Client Assignments
        </CardTitle>
        <CardDescription className="text-xs">
          Assign this client to a finance contact and an internal team member.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
              Finance Contact
            </Label>
            <Select value={financeId} onValueChange={setFinanceId} disabled={loading || saving}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={loading ? 'Loading...' : 'Select finance contact'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>
                  <span className="text-muted-foreground">Unassigned</span>
                </SelectItem>
                {financeContacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <div className="flex flex-col">
                      <span>{c.name}{c.is_default ? ' ★' : ''}</span>
                      <span className="text-xs text-muted-foreground">{c.email}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              Internal Team Member
            </Label>
            <Select value={teamId} onValueChange={setTeamId} disabled={loading || saving}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={loading ? 'Loading...' : 'Select team member'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>
                  <span className="text-muted-foreground">Unassigned</span>
                </SelectItem>
                {teamUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    <div className="flex flex-col">
                      <span>{u.username}</span>
                      {u.email && <span className="text-xs text-muted-foreground">{u.email}</span>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={save}
            disabled={!dirty || saving || loading}
            className="gap-2"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save Assignments
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
