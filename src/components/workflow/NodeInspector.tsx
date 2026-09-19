/**
 * Configuration for the selected step.
 *
 * The token picker is the part that matters: it lists what every upstream step
 * actually emits, so wiring `{{step_1.email}}` into a field is a click rather
 * than something you have to memorise or guess.
 */

import { useMemo, useState } from 'react';
import { ExternalLink, KeyRound, Plus, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getCatalogNode } from '@/lib/workflow/catalog';
import { isFieldVisible, nodeLabel, upstreamOf } from '@/lib/workflow/graph';
import type { NodeField, WorkflowGraph, WorkflowNode } from '@/lib/workflow/types';
import { CATEGORY_LABELS, accentClass } from './nodeAccents';
import { NodeGlyph } from './nodeVisuals';

interface NodeInspectorProps {
  node: WorkflowNode | null;
  graph: WorkflowGraph;
  configured: boolean;
  credentialsLoaded: boolean;
  onChange: (key: string, value: unknown) => void;
  onRename: (label: string) => void;
  onClose: () => void;
}

export function NodeInspector({
  node,
  graph,
  configured,
  credentialsLoaded,
  onChange,
  onRename,
  onClose,
}: NodeInspectorProps) {
  const definition = node ? getCatalogNode(node.type) : undefined;

  /** Every `{{step.key}}` the selected step is allowed to reference. */
  const tokens = useMemo(() => {
    if (!node) return [];
    return upstreamOf(graph, node.id).flatMap((upstream) => {
      const upstreamDefinition = getCatalogNode(upstream.type);
      return (upstreamDefinition?.outputs ?? []).map((output) => ({
        token: `{{${upstream.id}.${output.key}}}`,
        label: output.label,
        type: output.type,
        from: nodeLabel(upstream),
      }));
    });
  }, [graph, node]);

  if (!node || !definition) {
    return (
      <aside className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium text-foreground">Nothing selected</p>
        <p className="max-w-[15rem] text-xs text-muted-foreground">
          Pick a step on the canvas to set it up, or drag one in from the library.
        </p>
      </aside>
    );
  }

  const visibleFields = definition.fields.filter((field) => isFieldVisible(field, node.config));

  return (
    <aside className="flex h-full flex-col" aria-label="Step settings">
      <header className={cn('border-b border-border/60 p-3', accentClass(definition.category))}>
        <div className="flex items-start gap-2.5">
          <span className="wf-node-icon shrink-0">
            <NodeGlyph node={definition} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{definition.name}</p>
            <p className="text-[11px] text-muted-foreground">{CATEGORY_LABELS[definition.category]}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose} aria-label="Close settings">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <p className="mt-2 text-xs leading-snug text-muted-foreground">{definition.summary}</p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-mono text-[10px]">
            {node.id}
          </Badge>
          {definition.docsUrl && (
            <a
              href={definition.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              API reference
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>

        {credentialsLoaded && definition.integrationId && !configured && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-foreground">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
            <span>
              This step has no saved credentials.{' '}
              <a href="/integrations" className="font-medium text-primary underline underline-offset-2">
                Add them on the Integrations page
              </a>
              .
            </span>
          </p>
        )}
      </header>

      <ScrollArea className="wf-scroll flex-1">
        <div className="space-y-4 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="wf-step-name" className="text-xs">
              Step name
            </Label>
            <Input
              id="wf-step-name"
              value={node.label ?? ''}
              placeholder={definition.name}
              onChange={(event) => onRename(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              A clear name makes the canvas readable when the workflow grows.
            </p>
          </div>

          {visibleFields.length === 0 && (
            <p className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
              This step has nothing to configure.
            </p>
          )}

          {visibleFields.map((field) => (
            <FieldEditor
              key={field.key}
              field={field}
              value={node.config[field.key]}
              tokens={tokens}
              onChange={(value) => onChange(field.key, value)}
            />
          ))}

          {definition.outputs.length > 0 && (
            <section className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <h3 className="text-xs font-semibold text-foreground">What this step produces</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Later steps can reference these values.
              </p>
              <ul className="mt-2 space-y-1">
                {definition.outputs.map((output) => (
                  <li key={output.key} className="flex items-center justify-between gap-2">
                    <code className="wf-token truncate">{`{{${node.id}.${output.key}}}`}</code>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{output.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

interface TokenOption {
  token: string;
  label: string;
  type: string;
  from: string;
}

interface FieldEditorProps {
  field: NodeField;
  value: unknown;
  tokens: TokenOption[];
  onChange: (value: unknown) => void;
}

function FieldEditor({ field, value, tokens, onChange }: FieldEditorProps) {
  const id = `wf-field-${field.key}`;
  const asString = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  const supportsTokens = field.type === 'expression' || field.type === 'textarea' || field.type === 'text';

  const describedBy = field.help ? `${id}-help` : undefined;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          {field.label}
          {field.required && (
            <span className="ml-1 text-destructive" aria-label="required">
              *
            </span>
          )}
        </Label>
        {supportsTokens && tokens.length > 0 && (
          <TokenPicker tokens={tokens} onInsert={(token) => onChange(`${asString}${token}`)} />
        )}
      </div>

      {field.type === 'textarea' || field.type === 'json' ? (
        <Textarea
          id={id}
          value={asString}
          rows={field.type === 'json' ? 4 : 3}
          placeholder={field.placeholder}
          aria-describedby={describedBy}
          className={field.type === 'json' ? 'font-mono text-xs' : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.type === 'boolean' ? (
        <div className="flex items-center gap-2 pt-0.5">
          <Switch id={id} checked={Boolean(value)} onCheckedChange={onChange} aria-describedby={describedBy} />
          <span className="text-xs text-muted-foreground">{value ? 'Yes' : 'No'}</span>
        </div>
      ) : field.type === 'select' ? (
        <Select value={asString} onValueChange={onChange}>
          <SelectTrigger id={id} aria-describedby={describedBy}>
            <SelectValue placeholder={field.placeholder ?? 'Choose one'} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="flex flex-col items-start">
                  <span>{option.label}</span>
                  {option.hint && <span className="text-[11px] text-muted-foreground">{option.hint}</span>}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === 'multiselect' ? (
        <MultiSelectField field={field} value={value} onChange={onChange} />
      ) : field.type === 'keyValue' ? (
        <KeyValueField value={value} onChange={onChange} />
      ) : (
        <Input
          id={id}
          type={field.type === 'number' ? 'number' : 'text'}
          value={asString}
          placeholder={field.placeholder}
          aria-describedby={describedBy}
          className={field.type === 'cron' ? 'font-mono' : undefined}
          onChange={(event) =>
            onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)
          }
        />
      )}

      {field.help && (
        <p id={describedBy} className="text-[11px] leading-snug text-muted-foreground">
          {field.help}
        </p>
      )}
    </div>
  );
}

function TokenPicker({ tokens, onInsert }: { tokens: TokenOption[]; onInsert: (token: string) => void }) {
  const grouped = useMemo(() => {
    const map = new Map<string, TokenOption[]>();
    for (const token of tokens) {
      map.set(token.from, [...(map.get(token.from) ?? []), token]);
    }
    return [...map.entries()];
  }, [tokens]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground">
          <Plus className="h-3 w-3" aria-hidden="true" />
          Insert data
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-border/60 p-2">
          <p className="text-xs font-semibold text-foreground">Data from earlier steps</p>
          <p className="text-[11px] text-muted-foreground">Click to add it to this field.</p>
        </div>
        <ScrollArea className="wf-scroll max-h-64">
          <div className="p-1.5">
            {grouped.map(([from, options]) => (
              <div key={from} className="mb-2 last:mb-0">
                <p className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {from}
                </p>
                {options.map((option) => (
                  <button
                    key={option.token}
                    type="button"
                    onClick={() => onInsert(option.token)}
                    className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate text-xs text-foreground">{option.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{option.type}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function MultiSelectField({
  field,
  value,
  onChange,
}: {
  field: NodeField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const selected = Array.isArray(value) ? (value as string[]) : typeof value === 'string' && value ? [value] : [];

  const toggle = (option: string) =>
    onChange(selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option]);

  return (
    <div className="flex flex-wrap gap-1.5">
      {field.options?.map((option) => {
        const isOn = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isOn}
            onClick={() => toggle(option.value)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isOn
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:border-primary/30',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function KeyValueField({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const pairs = Array.isArray(value) ? (value as { key: string; value: string }[]) : [];

  const update = (index: number, patch: Partial<{ key: string; value: string }>) =>
    onChange(pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)));

  return (
    <div className="space-y-1.5">
      {pairs.map((pair, index) => (
        // Rows are positional; a key built from the value would remount on typing.
        <div key={index} className="flex items-center gap-1.5">
          <Input
            value={pair.key}
            placeholder="Name"
            aria-label={`Name for row ${index + 1}`}
            className="h-8 flex-1 text-xs"
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <Input
            value={pair.value}
            placeholder="Value"
            aria-label={`Value for row ${index + 1}`}
            className="h-8 flex-1 text-xs"
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={`Remove row ${index + 1}`}
            onClick={() => onChange(pairs.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-full text-xs"
        onClick={() => onChange([...pairs, { key: '', value: '' }])}
      >
        <Plus className="mr-1 h-3 w-3" aria-hidden="true" />
        Add row
      </Button>
    </div>
  );
}
