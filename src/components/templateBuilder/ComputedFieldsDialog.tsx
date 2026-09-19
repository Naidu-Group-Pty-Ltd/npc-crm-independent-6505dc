/**
 * ComputedFieldsDialog — Phase 7
 *
 * Manages template-level computed fields (tokens.computed[]). Each field is a
 * named expression that can reference any data path. Once defined, it's
 * available in bindings as `{{=name}}` and gets a live preview.
 */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Sigma, Plus, Trash2, Copy as CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { resolveBindable } from '@/lib/reportTemplate/bindingResolver';
import type { ReportTemplate, ComputedField } from '@/lib/reportTemplate/templateSchema';

interface Props {
  template: ReportTemplate;
  sampleData: Record<string, any>;
  onChange: (next: ReportTemplate) => void;
}

const STARTER_FIELDS: Array<Pick<ComputedField, 'name' | 'expr' | 'description' | 'format'>> = [
  { name: 'grossYield', expr: '(financials.weeklyRent * 52) / financials.purchasePrice * 100', description: 'Annual rent ÷ price × 100', format: 'percent' },
  { name: 'annualRent', expr: 'financials.weeklyRent * 52', description: 'Weekly rent × 52', format: 'currency' },
  { name: 'monthlyRent', expr: 'financials.weeklyRent * 52 / 12', description: 'Weekly rent × 4.333', format: 'currency' },
  { name: 'depositPct', expr: '(financials.deposit || 0) / financials.purchasePrice * 100', description: 'Deposit as % of price', format: 'percent' },
  { name: 'priceBucket', expr: "financials.purchasePrice > 2000000 ? 'Premium' : financials.purchasePrice > 1000000 ? 'Mid' : 'Entry'", description: 'Price tier label', format: 'raw' },
];

export function ComputedFieldsDialog({ template, sampleData, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const fields = template.tokens.computed ?? [];

  const update = (next: ComputedField[]) => {
    onChange({
      ...template,
      tokens: { ...template.tokens, computed: next.length ? next : undefined },
    });
  };

  const add = (preset?: Partial<ComputedField>) => {
    const base: ComputedField = { name: `field${fields.length + 1}`, expr: '0', format: 'raw', ...preset };
    update([...fields, base]);
  };
  const remove = (i: number) => update(fields.filter((_, idx) => idx !== i));
  const edit = (i: number, patch: Partial<ComputedField>) => update(fields.map((f, idx) => idx === i ? { ...f, ...patch } : f));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" title="Computed fields & expressions">
          <Sigma className="h-3.5 w-3.5 mr-1" /> Computed
          {fields.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 text-[10px] px-1">{fields.length}</Badge>}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sigma className="h-4 w-4" /> Computed Fields</DialogTitle>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-[1fr_auto] gap-3 overflow-hidden">
          <ScrollArea className="border rounded-md">
            <div className="p-3 space-y-3">
              {fields.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <Sigma className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>No computed fields yet.</p>
                  <p className="text-xs mt-1">Add an expression or pick a starter below.</p>
                </div>
              )}
              {fields.map((f, i) => (
                <FieldRow
                  key={i}
                  field={f}
                  sampleData={sampleData}
                  template={template}
                  onChange={(patch) => edit(i, patch)}
                  onDelete={() => remove(i)}
                />
              ))}
            </div>
          </ScrollArea>

          <div className="w-56 border rounded-md p-2 flex flex-col gap-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1">Starters</div>
            <ScrollArea className="flex-1">
              <div className="space-y-1">
                {STARTER_FIELDS.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => add(s)}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-xs"
                  >
                    <div className="font-mono font-medium">{s.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{s.description}</div>
                  </button>
                ))}
              </div>
            </ScrollArea>
            <Button size="sm" variant="outline" onClick={() => add()}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Blank
            </Button>
          </div>
        </div>

        <DialogFooter>
          <div className="text-[11px] text-muted-foreground mr-auto">
            Use in bindings as <code className="font-mono">{'{{=name}}'}</code> or inline <code className="font-mono">{'{{= price * 0.06 | currency}}'}</code>
          </div>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({
  field, template, sampleData, onChange, onDelete,
}: {
  field: ComputedField;
  template: ReportTemplate;
  sampleData: Record<string, any>;
  onChange: (patch: Partial<ComputedField>) => void;
  onDelete: () => void;
}) {
  const preview = useMemo(() => {
    try {
      return resolveBindable(`{{=${field.name}}}`, { data: sampleData, tokens: template.tokens });
    } catch (e: any) {
      return `⚠ ${e?.message ?? 'error'}`;
    }
  }, [field, sampleData, template.tokens]);

  const nameValid = /^[a-zA-Z_]\w*$/.test(field.name);

  return (
    <div className="border rounded-md p-3 space-y-2 bg-card">
      <div className="grid grid-cols-[1fr_140px_auto] gap-2">
        <div>
          <Label className="text-[10px] uppercase tracking-wider">Name</Label>
          <Input
            value={field.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={`h-8 font-mono text-xs ${!nameValid ? 'border-destructive' : ''}`}
            placeholder="grossYield"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider">Format</Label>
          <Select value={field.format ?? 'raw'} onValueChange={(v) => onChange({ format: v as any })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="raw">Raw</SelectItem>
              <SelectItem value="currency">Currency</SelectItem>
              <SelectItem value="number">Number</SelectItem>
              <SelectItem value="percent">Percent</SelectItem>
              <SelectItem value="date">Date</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-1">
          <Button
            size="icon" variant="ghost" className="h-8 w-8"
            onClick={() => { navigator.clipboard.writeText(`{{=${field.name}}}`); toast.success('Copied'); }}
            title="Copy binding"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div>
        <Label className="text-[10px] uppercase tracking-wider">Expression</Label>
        <Textarea
          value={field.expr}
          onChange={(e) => onChange({ expr: e.target.value })}
          rows={2}
          className="font-mono text-xs"
          placeholder="financials.weeklyRent * 52 / financials.purchasePrice * 100"
        />
      </div>

      <div>
        <Label className="text-[10px] uppercase tracking-wider">Description</Label>
        <Input
          value={field.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value })}
          className="h-7 text-xs"
          placeholder="What does this calculate?"
        />
      </div>

      <div className="flex items-center gap-2 text-xs pt-1 border-t">
        <span className="text-muted-foreground">Preview:</span>
        <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">{preview || '—'}</code>
      </div>
    </div>
  );
}
