/**
 * TemplateShortcutsDialog — cheat sheet of every keyboard shortcut wired
 * up in the template builder. Triggered by pressing `?` outside an input.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Keyboard } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUPS: { title: string; items: { keys: string[]; desc: string }[] }[] = [
  {
    title: 'File & History',
    items: [
      { keys: ['⌘/Ctrl', 'S'], desc: 'Save template' },
      { keys: ['⌘/Ctrl', 'Z'], desc: 'Undo' },
      { keys: ['⌘/Ctrl', '⇧', 'Z'], desc: 'Redo' },
      { keys: ['⌘/Ctrl', 'Y'], desc: 'Redo (alternate)' },
      { keys: ['⌘/Ctrl', 'K'], desc: 'Command palette' },
      { keys: ['⌘/Ctrl', 'R'], desc: 'Refresh preview' },
      { keys: ['⌘/Ctrl', 'N'], desc: 'New page' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { keys: ['⌘/Ctrl', 'A'], desc: 'Select all on page' },
      { keys: ['Click'], desc: 'Select element' },
      { keys: ['⇧', 'Click'], desc: 'Add to selection' },
      { keys: ['Esc'], desc: 'Clear selection' },
      { keys: ['?'], desc: 'Show this dialog' },
    ],
  },
  {
    title: 'Clipboard',
    items: [
      { keys: ['⌘/Ctrl', 'C'], desc: 'Copy elements' },
      { keys: ['⌘/Ctrl', 'X'], desc: 'Cut elements' },
      { keys: ['⌘/Ctrl', 'V'], desc: 'Paste elements' },
      { keys: ['⌘/Ctrl', 'D'], desc: 'Duplicate' },
      { keys: ['⌥/Alt', 'C'], desc: 'Copy style only' },
      { keys: ['⌥/Alt', 'V'], desc: 'Paste style only' },
    ],
  },
  {
    title: 'Text formatting',
    items: [
      { keys: ['⌘/Ctrl', 'B'], desc: 'Bold' },
      { keys: ['⌘/Ctrl', 'I'], desc: 'Italic' },
      { keys: ['⌘/Ctrl', 'U'], desc: 'Underline' },
      { keys: ['Dbl-click'], desc: 'Edit text inline' },
    ],
  },
  {
    title: 'Arrange',
    items: [
      { keys: ['⌘/Ctrl', ']'], desc: 'Bring forward' },
      { keys: ['⌘/Ctrl', '['], desc: 'Send backward' },
      { keys: ['⌘/Ctrl', '⇧', ']'], desc: 'Bring to front' },
      { keys: ['⌘/Ctrl', '⇧', '['], desc: 'Send to back' },
      { keys: ['Delete'], desc: 'Delete selection' },
    ],
  },
  {
    title: 'Move & transform',
    items: [
      { keys: ['Drag'], desc: 'Move' },
      { keys: ['⌥/Alt', 'Drag'], desc: 'Duplicate while dragging' },
      { keys: ['Arrows'], desc: 'Nudge 1pt' },
      { keys: ['⇧', 'Arrows'], desc: 'Nudge 10pt' },
      { keys: ['⇧', 'Resize'], desc: 'Lock aspect ratio' },
      { keys: ['Space', 'Drag'], desc: 'Pan canvas' },
      { keys: ['⌘/Ctrl', 'Wheel'], desc: 'Zoom in/out' },
    ],
  },
];

export function TemplateShortcutsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Speed up the builder. Press <kbd className="px-1 text-xs border rounded">?</kbd> anytime to reopen this list.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 pt-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{g.title}</h4>
              <div className="space-y-1">
                {g.items.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-1 px-1 rounded hover:bg-accent/40">
                    <span className="text-sm">{s.desc}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {s.keys.map((k, j) => (
                        <kbd key={j} className="px-1.5 py-0.5 text-[11px] font-mono border border-border rounded bg-muted">
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
