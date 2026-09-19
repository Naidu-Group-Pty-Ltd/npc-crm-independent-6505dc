import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Keyboard } from 'lucide-react';

const shortcuts = [
  { keys: ['⌘/Ctrl', 'K'], description: 'Open history search' },
  { keys: ['⌘/Ctrl', 'N'], description: 'New chat' },
  { keys: ['⌘/Ctrl', '/'], description: 'Focus message input' },
  { keys: ['⌘/Ctrl', '⇧', 'C'], description: 'Copy last response' },
  { keys: ['⌘/Ctrl', 'J'], description: 'Scroll to bottom' },
  { keys: ['⌘/Ctrl', 'B'], description: 'Toggle reports panel' },
  { keys: ['⌘/Ctrl', 'Enter'], description: 'Toggle full screen' },
  { keys: ['Enter'], description: 'Send message' },
  { keys: ['Shift', 'Enter'], description: 'New line in message' },
  { keys: ['Esc'], description: 'Close dialogs / Exit full screen' },
];

export function KeyboardShortcutsHelp() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="report-qa-toolbar-control h-8 gap-1.5 px-3 text-xs font-medium" title="Keyboard shortcuts">
          <Keyboard className="h-3 w-3" />
          Shortcuts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Quick actions for power users
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {shortcuts.map((shortcut, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between py-2 border-b border-border last:border-0"
            >
              <span className="text-sm text-muted-foreground">
                {shortcut.description}
              </span>
              <div className="flex gap-1">
                {shortcut.keys.map((key, keyIdx) => (
                  <kbd
                    key={keyIdx}
                    className="px-2 py-1 text-xs font-semibold text-muted-foreground bg-muted rounded border border-border"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
