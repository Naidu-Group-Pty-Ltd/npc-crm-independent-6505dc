import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Keyboard } from 'lucide-react';

const SHORTCUTS = [
  { keys: ['?'], desc: 'Show this cheat sheet' },
  { keys: ['⌘', 'K'], desc: 'Open command palette / search' },
  { keys: ['g', 'd'], desc: 'Go to Dashboard' },
  { keys: ['g', 'p'], desc: 'Go to Purchase Files' },
  { keys: ['g', 'c'], desc: 'Go to Clients' },
  { keys: ['g', 'm'], desc: 'Go to Messages' },
  { keys: ['g', 'r'], desc: 'Go to Reports' },
  { keys: ['c'], desc: 'Create new purchase file' },
  { keys: ['s'], desc: 'Smart Snooze current view' },
  { keys: ['/'], desc: 'Focus search input' },
  { keys: ['Esc'], desc: 'Close dialogs / clear selection' },
];

function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable || tag === 'SELECT';
}

/** Global keyboard navigation + ? cheat sheet for the finance portal. */
export function KeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const navigate = useNavigate();
  const lastKeyRef = useRef<{ k: string; t: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // mod-key combos handled elsewhere (⌘K)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // `?` opens dialog (shift+/)
      if (e.key === '?') {
        e.preventDefault();
        setOpen(true);
        return;
      }

      if (e.key === '/') {
        const search = document.querySelector<HTMLInputElement>('input[placeholder*="earch" i]');
        if (search) { e.preventDefault(); search.focus(); }
        return;
      }

      if (e.key === 'c') { navigate('/finance/purchase-files?new=1'); return; }
      if (e.key === 's') { window.dispatchEvent(new CustomEvent('finance:open-snooze')); return; }

      // two-key "g <x>" navigation
      const now = Date.now();
      const prev = lastKeyRef.current;
      if (prev && prev.k === 'g' && now - prev.t < 1500) {
        const map: Record<string, string> = {
          d: '/finance',
          p: '/finance/purchase-files',
          c: '/finance/clients',
          m: '/finance/messages',
          r: '/finance/reports',
          e: '/finance/earnings',
          l: '/finance/lender-intelligence',
        };
        if (map[e.key]) {
          e.preventDefault();
          navigate(map[e.key]);
          lastKeyRef.current = null;
          return;
        }
      }
      if (e.key === 'g') {
        lastKeyRef.current = { k: 'g', t: now };
      } else {
        lastKeyRef.current = null;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>Power-user navigation. Press <kbd className="px-1 text-xs border rounded">?</kbd> anytime to see this.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent/40">
              <span className="text-sm">{s.desc}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((k, j) => (
                  <kbd key={j} className="px-1.5 py-0.5 text-[11px] font-mono border border-border rounded bg-muted">
                    {k}
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
