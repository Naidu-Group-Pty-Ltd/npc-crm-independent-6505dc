import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const PHASE_ICONS = ['📌', '🔬', '🛠️', '🚀', '📦', '🎯', '📣', '🧪', '📋', '⚙️', '💡', '🏆', '🔥', '📈', '🗺️'];
const PHASE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#64748b'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  nextOrder: number;
  onCreate: (data: any) => Promise<void>;
}

export function AddPhaseDialog({ open, onOpenChange, planId, nextOrder, onCreate }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📌');
  const [color, setColor] = useState('#6366f1');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onCreate({
        plan_id: planId,
        name: name.trim(),
        description: description.trim() || null,
        icon,
        color,
        start_date: startDate ? startDate.toISOString() : null,
        end_date: endDate ? endDate.toISOString() : null,
        display_order: nextOrder,
      });
      setName(''); setDescription(''); setIcon('📌'); setColor('#6366f1');
      setStartDate(undefined); setEndDate(undefined);
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:overflow-y-auto is load-bearing: the dialog base sets
          sm:overflow-visible, which let the form spill past the frame and
          re-anchored the sticky footer mid-dialog instead of at its foot. */}
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain border-primary/20 bg-[linear-gradient(145deg,hsl(var(--card)),hsl(var(--background)/0.94)_55%,hsl(var(--primary)/0.08))] p-0 shadow-2xl shadow-sm dark:shadow-black/20 sm:max-h-[88dvh] sm:max-w-md sm:overflow-y-auto sm:p-0 dark:border-white/10 dark:bg-background dark:shadow-black/40">
        <DialogHeader className="border-b border-border/60 px-5 py-4 dark:border-white/10">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">Add Phase</DialogTitle>
          <p className="text-sm text-muted-foreground">Create the next step in this strategic playbook.</p>
        </DialogHeader>
        <div className="space-y-4 px-5 py-5">
          <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
            <Label htmlFor="game-plan-phase-name">Phase Name</Label>
            <Input id="game-plan-phase-name" value={name} onChange={e => setName(e.target.value)} placeholder="Discovery & Research" className="mt-1.5 h-10 rounded-xl bg-card/80 focus-visible:ring-primary/35" />
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
            <Label htmlFor="game-plan-phase-description">Description (optional)</Label>
            <Textarea id="game-plan-phase-description" value={description} onChange={e => setDescription(e.target.value)} placeholder="What happens in this phase..." rows={2} className="mt-1.5 rounded-xl bg-card/80 focus-visible:ring-primary/35" />
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
            <Label>Icon</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {PHASE_ICONS.map(i => (
                <button key={i} onClick={() => setIcon(i)}
                  type="button"
                  aria-label={`Use ${i} phase icon`}
                  className={cn('flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-lg transition-all hover:border-primary/20 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 motion-reduce:transition-none',
                    icon === i ? 'scale-110 border-primary/30 bg-primary/15 ring-2 ring-primary/30' : 'hover:bg-muted')}>
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
            <Label>Color</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {PHASE_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  type="button"
                  aria-label={`Use phase accent colour ${c}`}
                  className={cn('h-8 w-8 rounded-full border border-border dark:border-white/40 shadow-sm transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 motion-reduce:transition-none motion-reduce:hover:scale-100',
                    color === c ? 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-110' : 'hover:scale-105')}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('mt-1.5 h-10 w-full justify-start rounded-xl bg-card/80 text-left text-sm font-normal focus-visible:ring-primary/35', !startDate && 'text-muted-foreground')} aria-label="Select phase start date">
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {startDate ? format(startDate, 'MMM d, yyyy') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('mt-1.5 h-10 w-full justify-start rounded-xl bg-card/80 text-left text-sm font-normal focus-visible:ring-primary/35', !endDate && 'text-muted-foreground')} aria-label="Select phase end date">
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {endDate ? format(endDate, 'MMM d, yyyy') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={endDate} onSelect={setEndDate}
                    disabled={d => startDate ? d < startDate : false} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
        <DialogFooter className="sticky bottom-0 flex-col gap-2 border-t border-border/60 bg-background/90 px-5 py-4 backdrop-blur dark:border-white/10 dark:bg-background/85 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl focus-visible:ring-primary/35">Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim() || loading} className="rounded-xl shadow-lg shadow-primary/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/25 focus-visible:ring-primary/35 motion-reduce:transition-none motion-reduce:hover:translate-y-0">{loading ? 'Adding...' : 'Add Phase'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
