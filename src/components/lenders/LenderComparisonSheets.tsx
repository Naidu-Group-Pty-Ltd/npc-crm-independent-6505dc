import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Scale, Trash2, Share2, EyeOff } from 'lucide-react';
import { useComparisonSheets } from '@/hooks/useLenderSubmissions';
import { useBankLendingRates } from '@/hooks/useBankLendingRates';
import { cn } from '@/lib/utils';

interface Props { clientId?: string; dealId?: string; }

export function LenderComparisonSheets({ clientId, dealId }: Props) {
  const { sheets, isLoading, create, update, remove } = useComparisonSheets({ clientId, dealId });
  const { ratesSummary } = useBankLendingRates();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const handleCreate = () => {
    if (!name || selected.length === 0) return;
    const snapshot = (ratesSummary ?? [])
      .filter(s => selected.includes(s.lenderId))
      .map(s => ({
        lender_id: s.lenderId,
        lender_name: s.lenderName,
        lowest_rate: s.lowestRate,
      }));
    create({
      client_id: clientId ?? null,
      deal_id: dealId ?? null,
      name,
      lender_ids: selected,
      rate_snapshot: snapshot,
      notes: notes || null,
    });
    setOpen(false);
    setName(''); setNotes(''); setSelected([]);
  };

  const sortedRates = useMemo(
    () => [...(ratesSummary ?? [])].sort((a, b) => a.lenderName.localeCompare(b.lenderName)),
    [ratesSummary],
  );

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" /> Lender Comparison Sheets
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New comparison</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New lender comparison</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Top 3 IO investor lenders" />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
              <div>
                <Label className="text-xs mb-2 block">Select lenders ({selected.length})</Label>
                <ScrollArea className="h-56 rounded border border-border">
                  <div className="p-2 space-y-1">
                    {sortedRates.map(s => (
                      <label key={s.lenderId} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/40 cursor-pointer text-sm">
                        <Checkbox
                          checked={selected.includes(s.lenderId)}
                          onCheckedChange={(c) => setSelected(prev => c ? [...prev, s.lenderId] : prev.filter(x => x !== s.lenderId))}
                        />
                        <span className="flex-1 truncate">{s.lenderName}</span>
                        {s.lowestRate != null && (
                          <span className="text-xs tabular-nums text-muted-foreground">{s.lowestRate.toFixed(2)}%</span>
                        )}
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!name || selected.length === 0}>Create snapshot</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading...</div>
        ) : sheets.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No comparison sheets yet. Snapshot the best lenders for this {dealId ? 'deal' : 'client'}.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sheets.map((sheet) => (
              <div key={sheet.id} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{sheet.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {sheet.lender_ids.length} lenders · {new Date(sheet.created_at).toLocaleDateString('en-AU')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      title={sheet.shared_with_client ? 'Unshare from client' : 'Share with client'}
                      onClick={() => update({ id: sheet.id, data: { shared_with_client: !sheet.shared_with_client } })}
                    >
                      {sheet.shared_with_client
                        ? <Share2 className="h-3.5 w-3.5 text-primary" />
                        : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(sheet.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(sheet.rate_snapshot as any[]).map((r, i) => (
                    <Badge key={i} variant="outline" className={cn("text-[10px] tabular-nums",
                      i === 0 && "border-primary/50 text-primary"
                    )}>
                      {r.lender_name}{r.lowest_rate ? ` · ${Number(r.lowest_rate).toFixed(2)}%` : ''}
                    </Badge>
                  ))}
                </div>
                {sheet.notes && (
                  <div className="text-xs text-muted-foreground italic">{sheet.notes}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
