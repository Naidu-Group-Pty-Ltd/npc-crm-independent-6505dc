import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Plus, Trash2, Loader2, Crown } from 'lucide-react';
import { toast } from 'sonner';

const FN = 'finance-portal-batch6';

type Applicant = {
  id: string; display_name: string; role: string;
  email: string | null; phone: string | null; date_of_birth: string | null;
  is_primary: boolean; position: number;
};

export function ApplicantsCard({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Applicant> | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pf-applicants', fileId],
    queryFn: async () => {
      const res = await invokeFinanceFunction(FN, { operation: 'applicants_list', purchase_file_id: fileId });
      if (res.error) throw new Error(res.error);
      return res.data?.applicants as Applicant[];
    },
  });

  const save = async () => {
    if (!editing?.display_name) return toast.error('Name is required');
    const res = await invokeFinanceFunction(FN, { operation: 'applicants_upsert', purchase_file_id: fileId, applicant: editing });
    if (res.error) return toast.error(res.error);
    toast.success('Applicant saved'); setOpen(false); setEditing(null);
    qc.invalidateQueries({ queryKey: ['pf-applicants', fileId] });
  };
  const remove = async (id: string) => {
    if (!confirm('Remove this applicant?')) return;
    const res = await invokeFinanceFunction(FN, { operation: 'applicants_delete', applicant_id: id });
    if (res.error) return toast.error(res.error);
    qc.invalidateQueries({ queryKey: ['pf-applicants', fileId] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-primary" />Applicants ({data?.length ?? 0})</CardTitle>
        <Button size="sm" variant="outline" onClick={() => { setEditing({ role: 'co_borrower' }); setOpen(true); }}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> :
          !data?.length ? <p className="text-xs text-muted-foreground">No applicants captured yet. Add the primary applicant + any co-borrowers / guarantors.</p> :
          data.map(a => (
            <div key={a.id} className="flex items-center justify-between p-2 rounded border border-border/60 hover:bg-accent/30">
              <div className="flex items-center gap-2 min-w-0">
                {a.is_primary && <Crown className="h-3.5 w-3.5 text-brand-500 flex-shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{a.display_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.email || a.phone || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs capitalize">{a.role.replace(/_/g, ' ')}</Badge>
                <Button size="icon" variant="ghost" onClick={() => { setEditing(a); setOpen(true); }}>✎</Button>
                <Button size="icon" variant="ghost" onClick={() => remove(a.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </div>
            </div>
          ))
        }
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit' : 'Add'} applicant</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Display name</Label><Input value={editing?.display_name || ''} onChange={e => setEditing({ ...editing, display_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input value={editing?.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={editing?.phone || ''} onChange={e => setEditing({ ...editing, phone: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date of birth</Label><Input type="date" value={editing?.date_of_birth || ''} onChange={e => setEditing({ ...editing, date_of_birth: e.target.value })} /></div>
              <div>
                <Label>Role</Label>
                <Select value={editing?.role || 'co_borrower'} onValueChange={v => setEditing({ ...editing, role: v, is_primary: v === 'primary' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Primary</SelectItem>
                    <SelectItem value="co_borrower">Co-borrower</SelectItem>
                    <SelectItem value="guarantor">Guarantor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
