import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const ICONS = ['🎯', '🚀', '📈', '💡', '⚡', '🏆', '🗺️', '🔥', '💎', '🌟'];
const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#64748b'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: { name: string; description: string; icon: string; color: string; status?: 'planning' | 'active' | 'completed' | 'archived'; start_date?: string | null; end_date?: string | null }) => Promise<void>;
}

export function CreatePlanDialog({ open, onOpenChange, onCreate }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('🎯');
  const [color, setColor] = useState('#6366f1');
  const [status, setStatus] = useState<'planning' | 'active' | 'completed' | 'archived'>('planning');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim(),
        icon,
        color,
        status,
        start_date: startDate ? startDate.toISOString() : null,
        end_date: endDate ? endDate.toISOString() : null,
      });
      setName(''); setDescription(''); setIcon('🎯'); setColor('#6366f1');
      setStatus('planning'); setStartDate(undefined); setEndDate(undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden border-primary/20 bg-[linear-gradient(145deg,hsl(var(--card)),hsl(var(--background)/0.94)_55%,hsl(var(--primary)/0.08))] p-0 shadow-2xl sm:h-auto sm:max-h-[90dvh] sm:max-w-xl dark:border-white/10 dark:bg-background dark:shadow-black/40">
        <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-2xl shadow-inner shadow-primary/10">
              {icon}
            </div>
            <div>
              <DialogTitle className="text-xl font-bold tracking-tight text-foreground">Create Game Plan</DialogTitle>
              <p className="text-sm text-muted-foreground">Set up the strategic playbook details.</p>
            </div>
          </div>
        </DialogHeader>
        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5">
          <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
            <Label htmlFor="game-plan-name">Name</Label>
            <Input id="game-plan-name" value={name} onChange={e => setName(e.target.value)} placeholder="Q2 Growth Strategy" className="mt-1.5 h-11 rounded-xl bg-card/80 focus-visible:ring-primary/35" />
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
            <Label htmlFor="game-plan-description">Description</Label>
            <Textarea id="game-plan-description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Key objectives and strategy..." rows={3} className="mt-1.5 rounded-xl bg-card/80 focus-visible:ring-primary/35" />
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
            <Label>Initial Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as 'planning' | 'active' | 'completed' | 'archived')}>
              <SelectTrigger className="mt-1.5 h-11 rounded-xl bg-card/80 focus:ring-primary/35" aria-label="Select initial game plan status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="planning">📋 Planning</SelectItem>
                <SelectItem value="active">🟢 Active</SelectItem>
                <SelectItem value="completed">✅ Completed</SelectItem>
                <SelectItem value="archived">📦 Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('mt-1.5 h-10 w-full justify-start rounded-xl bg-card/80 text-left text-sm font-normal focus-visible:ring-primary/35', !startDate && 'text-muted-foreground')} aria-label="Select game plan start date">
                    <CalendarIcon className="mr-2 h-3.5 w-3.5 text-primary" />
                    {startDate ? format(startDate, 'MMM d, yyyy') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus className={cn('p-3 pointer-events-auto')} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('mt-1.5 h-10 w-full justify-start rounded-xl bg-card/80 text-left text-sm font-normal focus-visible:ring-primary/35', !endDate && 'text-muted-foreground')} aria-label="Select game plan end date">
                    <CalendarIcon className="mr-2 h-3.5 w-3.5 text-primary" />
                    {endDate ? format(endDate, 'MMM d, yyyy') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={endDate} onSelect={setEndDate}
                    disabled={d => startDate ? d < startDate : false} initialFocus className={cn('p-3 pointer-events-auto')} />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
            <Label>Icon</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {ICONS.map(i => (
                <button key={i} onClick={() => setIcon(i)}
                  className={cn('flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-xl transition-all hover:border-primary/20 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 motion-reduce:transition-none',
                    icon === i ? 'scale-110 border-primary/30 bg-primary/15 ring-2 ring-primary/30' : 'hover:bg-muted')}
                  type="button"
                  aria-label={`Use ${i} icon`}>
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
            <Label>Accent Color</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className={cn('h-8 w-8 rounded-full border border-border dark:border-white/40 shadow-sm transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 motion-reduce:transition-none motion-reduce:hover:scale-100',
                    color === c ? 'scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background' : '')}
                  style={{ backgroundColor: c }}
                  type="button"
                  aria-label={`Use accent colour ${c}`} />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="shrink-0 flex-col gap-2 border-t border-border/60 bg-background/90 px-5 py-4 backdrop-blur dark:border-white/10 dark:bg-background/85 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl focus-visible:ring-primary/35">Cancel</Button>
          <Button onClick={handleCreate} disabled={!name.trim() || loading} className="rounded-xl shadow-lg shadow-primary/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/25 focus-visible:ring-primary/35 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
            {loading ? 'Creating...' : 'Create Plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
