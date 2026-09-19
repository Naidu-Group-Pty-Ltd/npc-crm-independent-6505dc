/**
 * SlotsEditor — manage reusable component slots (Header / Footer / etc).
 * A slot is just a Block definition stored on the template; pages reference
 * it via a `slot` block with props.slotKey matching the slot's key.
 *
 * Extracted from TemplateBuilderEdit (rehaul Phase 2 / file split).
 */
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BLOCK_DEFS } from '@/lib/reportTemplate/blocks';
import type { Block, ReportTemplate } from '@/lib/reportTemplate/templateSchema';

export function SlotsEditor({
  template,
  onChange,
}: {
  template: ReportTemplate;
  onChange: (slots: Record<string, Block>) => void;
}) {
  const slots = template.slots ?? {};
  const entries = Object.entries(slots);

  const addSlot = () => {
    const key = window.prompt('New slot key (e.g. "header", "footer")')?.trim();
    if (!key) return;
    if (slots[key]) { toast.error(`Slot "${key}" already exists`); return; }
    const block: Block = {
      id: crypto.randomUUID(),
      type: 'footer',
      props: { text: 'Edit this slot in the Slots tab', bg: 'token:bg', color: 'token:muted', align: 'center', height: 28 },
      overlays: [],
    };
    onChange({ ...slots, [key]: block });
    toast.success(`Slot "${key}" created`);
  };

  const renameSlot = (oldKey: string) => {
    const newKey = window.prompt('Rename slot key', oldKey)?.trim();
    if (!newKey || newKey === oldKey) return;
    if (slots[newKey]) { toast.error(`Slot "${newKey}" already exists`); return; }
    const next = { ...slots };
    next[newKey] = next[oldKey];
    delete next[oldKey];
    onChange(next);
  };

  const removeSlot = (key: string) => {
    if (!confirm(`Delete slot "${key}"? Pages referencing it will show a missing-slot warning.`)) return;
    const next = { ...slots };
    delete next[key];
    onChange(next);
  };

  const setSlotType = (key: string, type: string) => {
    onChange({ ...slots, [key]: { ...slots[key], type, props: BLOCK_DEFS[type]?.defaultProps() ?? {} } });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Reusable component slots</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Define a Header / Footer / etc. once, then drop a <code className="font-mono">slot</code> block on any page
            with the matching key. Editing here updates every page that references it.
          </p>
        </div>
        <Button size="sm" variant="default" onClick={addSlot}>
          <Plus className="h-3.5 w-3.5 mr-1" /> New slot
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground italic text-center py-6">
          No slots yet. Click "New slot" to create your first reusable component.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map(([key, block]) => (
            <li key={key} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{`{{slot:${key}}}`}</code>
                <span className="text-[10px] text-muted-foreground">key:</span>
                <code className="text-xs font-mono">{key}</code>
                <div className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => renameSlot(key)}>Rename</Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeSlot(key)} title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-muted-foreground w-16">Block type</Label>
                <select
                  value={block.type}
                  onChange={(e) => setSlotType(key, e.target.value)}
                  className="h-8 text-xs border rounded px-2 bg-background flex-1"
                >
                  {Object.values(BLOCK_DEFS)
                    .filter((d) => d.type !== 'free' && d.type !== 'slot')
                    .map((d) => (
                      <option key={d.type} value={d.type}>{d.label} ({d.type})</option>
                    ))}
                </select>
              </div>
              <Textarea
                value={JSON.stringify(block.props, null, 2)}
                onChange={(e) => {
                  try {
                    const props = JSON.parse(e.target.value);
                    onChange({ ...slots, [key]: { ...block, props } });
                  } catch { /* keep typing */ }
                }}
                spellCheck={false}
                className="font-mono text-[11px] h-32 resize-none"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
