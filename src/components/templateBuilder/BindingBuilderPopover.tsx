/**
 * BindingBuilderPopover — Phase 7
 *
 * Visual binding chain builder. Pick a data path or computed field, then
 * append filters (currency, round, default, etc.) with arguments. Live preview
 * resolves against the current sample data + tokens. Result is inserted as a
 * `{{...}}` expression via the onInsert callback.
 */
import { useMemo, useState } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Wand2, Plus, X } from 'lucide-react';
import { FILTER_NAMES, resolveBindable } from '@/lib/reportTemplate/bindingResolver';
import { flattenPaths } from '@/lib/reportTemplate/sampleDataPresets';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface FilterStep { name: string; args: string[]; }

interface Props {
  template: ReportTemplate;
  sampleData: Record<string, any>;
  onInsert: (text: string) => void;
  triggerLabel?: string;
}

const FILTER_ARG_HINTS: Record<string, string[]> = {
  currency: ['decimals'],
  number: ['decimals'],
  percent: ['decimals'],
  fixed: ['decimals'],
  add: ['x'], sub: ['x'], mul: ['x'], div: ['x'], mod: ['x'], min: ['x'], max: ['x'],
  date: ['format (short|long|iso)'],
  default: ['fallback'], fallback: ['fallback'],
  if: ['truthy', 'falsy'],
  eq: ['x'], neq: ['x'], gt: ['x'], lt: ['x'], gte: ['x'], lte: ['x'],
  truncate: ['length', 'suffix'],
  replace: ['find', 'replace'],
  slice: ['start', 'end'],
  pluralize: ['singular', 'plural'],
  join: ['separator'],
  sum: ['path'], avg: ['path'],
};

export function BindingBuilderPopover({ template, sampleData, onInsert, triggerLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [head, setHead] = useState<string>('');
  const [steps, setSteps] = useState<FilterStep[]>([]);

  const paths = useMemo(() => flattenPaths(sampleData), [sampleData]);
  const computed = template.tokens.computed ?? [];

  const expression = useMemo(() => {
    if (!head) return '';
    const filterStr = steps
      .filter((s) => s.name)
      .map((s) => {
        const args = s.args.filter((a) => a !== '').map((a) => /\s|:/.test(a) ? `'${a}'` : a).join(':');
        return args ? `${s.name}:${args}` : s.name;
      })
      .join(' | ');
    return filterStr ? `{{${head} | ${filterStr}}}` : `{{${head}}}`;
  }, [head, steps]);

  const preview = useMemo(() => {
    if (!expression) return '—';
    try {
      return resolveBindable(expression, { data: sampleData, tokens: template.tokens }) || '∅';
    } catch (e: any) { return `⚠ ${e?.message}`; }
  }, [expression, sampleData, template.tokens]);

  const reset = () => { setHead(''); setSteps([]); };

  const insert = () => {
    if (!expression) return;
    onInsert(expression);
    setOpen(false);
    reset();
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" title="Visual binding builder">
          <Wand2 className="h-3.5 w-3.5 mr-1" /> {triggerLabel ?? 'Build'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[460px] p-3 space-y-3">
        <div>
          <Label className="text-[10px] uppercase tracking-wider">Source</Label>
          <Select value={head} onValueChange={setHead}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick a data path or computed field…" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {computed.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">Computed</div>
                  {computed.map((c) => (
                    <SelectItem key={`@${c.name}`} value={`=${c.name}`}>
                      <span className="font-mono">@{c.name}</span>
                    </SelectItem>
                  ))}
                </>
              )}
              <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">Data paths</div>
              {paths.map((p) => (
                <SelectItem key={p.path} value={p.path}>
                  <span className="font-mono">{p.path}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{p.preview}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-[10px] uppercase tracking-wider">Filters</Label>
            <Button
              size="sm" variant="ghost" className="h-6 px-2"
              onClick={() => setSteps([...steps, { name: 'currency', args: [] }])}
            >
              <Plus className="h-3 w-3 mr-1" /> Filter
            </Button>
          </div>
          <ScrollArea className="max-h-44">
            <div className="space-y-1.5">
              {steps.map((s, i) => {
                const hints = FILTER_ARG_HINTS[s.name] ?? [];
                return (
                  <div key={i} className="flex items-center gap-1.5 border rounded p-1.5 bg-muted/30">
                    <Select
                      value={s.name}
                      onValueChange={(v) => setSteps(steps.map((st, idx) => idx === i ? { ...st, name: v, args: [] } : st))}
                    >
                      <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {FILTER_NAMES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {hints.map((hint, ai) => (
                      <Input
                        key={ai}
                        value={s.args[ai] ?? ''}
                        onChange={(e) => {
                          const next = [...s.args]; next[ai] = e.target.value;
                          setSteps(steps.map((st, idx) => idx === i ? { ...st, args: next } : st));
                        }}
                        placeholder={hint}
                        className="h-7 text-xs w-24"
                      />
                    ))}
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
              {steps.length === 0 && (
                <div className="text-[11px] text-muted-foreground italic px-1">No filters — value rendered as-is.</div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="border rounded p-2 bg-muted/40 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Expression</div>
          <code className="text-[11px] font-mono break-all block">{expression || '—'}</code>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">Preview</div>
          <div className="text-xs font-medium">{preview}</div>
        </div>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
          <Button size="sm" onClick={insert} disabled={!expression}>Insert</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
