import { Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['←', '→'], description: 'Previous/Next day' },
      { keys: ['↑', '↓'], description: 'Previous/Next week' },
      { keys: ['Shift', '+', '←', '→'], description: 'Previous/Next month/week view' },
      { keys: ['T'], description: 'Go to today' },
      { keys: ['Esc'], description: 'Clear selection' },
    ],
  },
  {
    title: 'Sidebar Tabs',
    shortcuts: [
      { keys: ['1'], description: 'Events' },
      { keys: ['2'], description: 'Availability' },
      { keys: ['3'], description: 'Templates' },
      { keys: ['4'], description: 'Heatmap' },
      { keys: ['5'], description: 'Analytics' },
      { keys: ['6'], description: 'Summary' },
      { keys: ['7'], description: 'Conflicts' },
      { keys: ['8'], description: 'Optimize' },
      { keys: ['9'], description: 'Overlay' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['N', '/', 'A'], description: 'Quick add event' },
      { keys: ['Enter'], description: 'View selected date events' },
    ],
  },
];

export function KeyboardShortcutsHint() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-10 gap-1.5 rounded-xl border border-border bg-white/[0.03] px-3 text-xs font-medium text-muted-foreground transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98]"
        >
          <Keyboard className="h-3 w-3" />
          <span className="hidden sm:inline">Shortcuts</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 pt-2">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h4 className="text-sm font-medium mb-2 text-muted-foreground">{group.title}</h4>
              <div className="space-y-1.5">
                {group.shortcuts.map((shortcut, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{shortcut.description}</span>
                    <div className="flex items-center gap-0.5">
                      {shortcut.keys.map((key, j) => (
                        <span key={j}>
                          {key === '+' ? (
                            <span className="text-muted-foreground mx-0.5">+</span>
                          ) : key === '/' ? (
                            <span className="text-muted-foreground mx-0.5">/</span>
                          ) : (
                            <kbd className="px-2 py-0.5 text-xs bg-muted rounded border font-mono">
                              {key}
                            </kbd>
                          )}
                        </span>
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
