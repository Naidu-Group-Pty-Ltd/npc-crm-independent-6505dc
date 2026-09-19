/**
 * CommandPalette — ⌘K spotlight for the Template Builder.
 *
 * Surfaces every meaningful action in one keystroke:
 *   • Insert any block (with type-ahead)
 *   • Jump to any page (with page name + index)
 *   • Add page from starter preset
 *   • Apply theme preset
 *   • Switch sample-data preset
 *   • Run editor actions (save, snapshot, undo/redo, export, import,
 *     toggle preview, copy JSON, jump to first binding/lint issue)
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator, CommandShortcut,
} from '@/components/ui/command';
import {
  Plus, FileText, Layers, Palette, Database, Save, History, Undo2, Redo2,
  Download, Upload, Copy as CopyIcon, Eye, ShieldAlert, AlertTriangle, Sparkles,
} from 'lucide-react';
import { BLOCK_DEFS } from '@/lib/reportTemplate/blocks';
import { THEME_PRESETS } from '@/lib/reportTemplate/themePresets';
import { STARTER_PAGE_PRESETS } from '@/lib/reportTemplate/starterTemplates';
import { SAMPLE_DATA_PRESETS } from '@/lib/reportTemplate/sampleDataPresets';
import { SNIPPETS } from '@/lib/reportTemplate/snippetLibrary';
import type { Page, ReportTemplate } from '@/lib/reportTemplate/templateSchema';
import { Library, Wand2 } from 'lucide-react';

export interface CommandPaletteAction {
  insertBlock: (type: string) => void;
  jumpToPage: (pageId: string) => void;
  addStarterPage: (presetId: string) => void;
  applyTheme: (presetId: string) => void;
  applySampleData: (presetId: string) => void;
  jumpToFirstBindingIssue: () => void;
  jumpToFirstLintIssue: () => void;
  save: () => void;
  saveSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  togglePreview: () => void;
  exportJson: () => void;
  importJson: () => void;
  copyJson: () => void;
  syncBrand: () => void;
  insertSnippet: (snippetId: string) => void;
  openSnippetLibrary: () => void;
  openBindingFixer: () => void;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ReportTemplate;
  pages: Page[];
  bindingIssueCount: number;
  lintIssueCount: number;
  actions: CommandPaletteAction;
}

export function CommandPalette({
  open, onOpenChange, pages, bindingIssueCount, lintIssueCount, actions,
}: Props) {
  const [query, setQuery] = useState('');
  useEffect(() => { if (!open) setQuery(''); }, [open]);

  const blockDefs = useMemo(() => Object.values(BLOCK_DEFS).filter((d) => d.type !== 'free'), []);

  const run = (fn: () => void) => () => { onOpenChange(false); fn(); };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Type a command, block, page, theme…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={run(actions.save)}>
            <Save /> Save template
            <CommandShortcut>⌘S</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(actions.saveSnapshot)}>
            <History /> Save as new version
          </CommandItem>
          <CommandItem onSelect={run(actions.undo)}>
            <Undo2 /> Undo
            <CommandShortcut>⌘Z</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(actions.redo)}>
            <Redo2 /> Redo
            <CommandShortcut>⌘⇧Z</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(actions.togglePreview)}>
            <Eye /> Toggle live preview
          </CommandItem>
          <CommandItem onSelect={run(actions.exportJson)}>
            <Download /> Export template JSON
          </CommandItem>
          <CommandItem onSelect={run(actions.importJson)}>
            <Upload /> Import template JSON
          </CommandItem>
          <CommandItem onSelect={run(actions.copyJson)}>
            <CopyIcon /> Copy template JSON
          </CommandItem>
          <CommandItem onSelect={run(actions.syncBrand)}>
            <Sparkles /> Sync tokens from brand
          </CommandItem>
          {bindingIssueCount > 0 && (
            <CommandItem onSelect={run(actions.jumpToFirstBindingIssue)}>
              <AlertTriangle /> Jump to binding issue
              <CommandShortcut>{bindingIssueCount}</CommandShortcut>
            </CommandItem>
          )}
          {lintIssueCount > 0 && (
            <CommandItem onSelect={run(actions.jumpToFirstLintIssue)}>
              <ShieldAlert /> Jump to lint issue
              <CommandShortcut>{lintIssueCount}</CommandShortcut>
            </CommandItem>
          )}
          <CommandItem onSelect={run(actions.openBindingFixer)}>
            <Wand2 /> Open AI binding fixer
          </CommandItem>
          <CommandItem onSelect={run(actions.openSnippetLibrary)}>
            <Library /> Open snippet library
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Insert snippet">
          {SNIPPETS.map((s) => (
            <CommandItem
              key={s.id}
              value={`snippet ${s.label} ${s.category} ${s.tags.join(' ')}`}
              onSelect={run(() => actions.insertSnippet(s.id))}
            >
              <Library /> {s.label}
              <CommandShortcut className="text-[10px] truncate max-w-[200px]">
                {s.category} · {s.tags.slice(0, 3).join(', ')}
              </CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Insert block">
          {blockDefs.map((def) => (
            <CommandItem
              key={def.type}
              value={`insert ${def.label} ${def.type}`}
              onSelect={run(() => actions.insertBlock(def.type))}
            >
              <Plus /> Insert {def.label}
              <CommandShortcut className="font-mono">{def.type}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Add page from preset">
          {STARTER_PAGE_PRESETS.map((p) => (
            <CommandItem
              key={p.id}
              value={`page preset ${p.label}`}
              onSelect={run(() => actions.addStarterPage(p.id))}
            >
              <Layers /> {p.label}
              <CommandShortcut className="text-[10px] truncate max-w-[180px]">{p.description}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Jump to page">
          {pages.map((p, i) => (
            <CommandItem
              key={p.id}
              value={`page ${i + 1} ${p.name}`}
              onSelect={run(() => actions.jumpToPage(p.id))}
            >
              <FileText /> {i + 1}. {p.name || 'Untitled'}
              <CommandShortcut>{p.blocks.length} blocks</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Apply theme">
          {THEME_PRESETS.map((t) => (
            <CommandItem
              key={t.id}
              value={`theme ${t.label}`}
              onSelect={run(() => actions.applyTheme(t.id))}
            >
              <Palette />
              <span className="flex-1">{t.label}</span>
              <span className="flex gap-0.5 mr-2">
                {t.swatch.map((c) => (
                  <span key={c} className="h-3 w-3 rounded-sm border border-border/40" style={{ background: c }} />
                ))}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Sample data">
          {SAMPLE_DATA_PRESETS.map((d) => (
            <CommandItem
              key={d.id}
              value={`data ${d.label}`}
              onSelect={run(() => actions.applySampleData(d.id))}
            >
              <Database /> {d.label}
              <CommandShortcut className="text-[10px] truncate max-w-[180px]">{d.description}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
