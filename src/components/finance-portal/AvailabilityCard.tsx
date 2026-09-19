import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const FN = 'finance-portal-batch6';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Window = {
  id: string; weekday: number; start_time: string; end_time: string;
  slot_duration_min: number; timezone: string; is_active: boolean;
};

export function AvailabilityCard() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Partial<Window>>({ weekday: 1, start_time: '09:00', end_time: '17:00', slot_duration_min: 30 });

  const { data, isLoading } = useQuery({
    queryKey: ['fp-availability'],
    queryFn: async () => {
      const res = await invokeFinanceFunction(FN, { operation: 'availability_list' });
      if (res.error) throw new Error(res.error);
      return res.data?.windows as Window[];
    },
  });

  const add = async () => {
    if (!draft.start_time || !draft.end_time) return toast.error('Start and end times required');
    if (!Number.isInteger(draft.slot_duration_min) || draft.slot_duration_min < 1 || draft.slot_duration_min > 32767) {
      return toast.error('Slot duration must be a whole number between 1 and 32767 minutes');
    }
    const res = await invokeFinanceFunction(FN, { operation: 'availability_upsert', window: draft });
    if (res.error) return toast.error(res.error);
    toast.success('Availability added');
    qc.invalidateQueries({ queryKey: ['fp-availability'] });
  };
  const toggle = async (w: Window) => {
    const res = await invokeFinanceFunction(FN, { operation: 'availability_upsert', window: { ...w, is_active: !w.is_active } });
    if (res.error) return toast.error(res.error);
    qc.invalidateQueries({ queryKey: ['fp-availability'] });
  };
  const remove = async (id: string) => {
    if (!confirm('Remove this window?')) return;
    const res = await invokeFinanceFunction(FN, { operation: 'availability_delete', window_id: id });
    if (res.error) return toast.error(res.error);
    qc.invalidateQueries({ queryKey: ['fp-availability'] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" />Booking availability</CardTitle>
        <CardDescription className="text-xs">Define recurring weekly windows clients can book through their portal.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end p-3 rounded border border-border/60 bg-muted/30">
          <div>
            <Label className="text-xs">Weekday</Label>
            <Select value={String(draft.weekday)} onValueChange={v => setDraft({ ...draft, weekday: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Start</Label><Input type="time" value={draft.start_time} onChange={e => setDraft({ ...draft, start_time: e.target.value })} /></div>
          <div><Label className="text-xs">End</Label><Input type="time" value={draft.end_time} onChange={e => setDraft({ ...draft, end_time: e.target.value })} /></div>
          <div><Label htmlFor="slot-duration-min" className="text-xs">Slot (min)</Label><Input id="slot-duration-min" type="number" min={1} max={32767} step={1} value={draft.slot_duration_min} onChange={e => setDraft({ ...draft, slot_duration_min: Number(e.target.value) })} /></div>
          <Button onClick={add}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>
        </div>

        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> :
          !data?.length ? <p className="text-xs text-muted-foreground">No availability defined yet.</p> :
          <div className="space-y-1.5">
            {data.map(w => (
              <div key={w.id} className="flex items-center justify-between p-2 rounded border border-border/60">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium w-12">{DAYS[w.weekday]}</span>
                  <span className="text-sm">{w.start_time.slice(0, 5)} – {w.end_time.slice(0, 5)}</span>
                  <span className="text-xs text-muted-foreground">{w.slot_duration_min}m slots</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={w.is_active} onCheckedChange={() => toggle(w)} />
                  <Button size="icon" variant="ghost" onClick={() => remove(w.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </div>
            ))}
          </div>
        }
      </CardContent>
    </Card>
  );
}
