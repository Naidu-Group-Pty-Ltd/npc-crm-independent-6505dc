import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { Command as CommandIcon, ExternalLink } from 'lucide-react';
import { useAmlNavEntry } from '@/hooks/useAmlNavEntry';
import { useNavigationVisibility } from '@/hooks/useNavigation';
import type { NavItemDef } from '@/lib/navigation/registry';

/**
 * GlobalCommandPalette.
 *
 * ⌘K / Ctrl-K opens a fuzzy nav palette across every route the user can
 * see. Also surfaces "Recent" navigations from localStorage.
 *
 * Entries come from the shared navigation registry, filtered by the same
 * capability rule as both sidebars — the palette can never advertise a route
 * the workspace has not bought or the user cannot reach.
 */

const RECENT_KEY = 'aurixa.commandPalette.recent';
const MAX_RECENT = 6;

function readRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function writeRecent(url: string) {
  if (typeof window === 'undefined') return;
  try {
    const current = readRecent().filter((v) => v !== url);
    const next = [url, ...current].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/** Palette display groups keyed off the registry's sidebar groups. */
const PALETTE_GROUP: Record<string, string> = {
  'Main Dashboard': 'Main',
  'Reports & Analysis': 'Reports',
  'Client & CRM': 'Clients & CRM',
  Operations: 'Operations',
  'Help & Usage': 'Help',
  Administration: 'Admin',
};

export function GlobalCommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [recent, setRecent] = React.useState<string[]>(() => readRecent());
  const navigate = useNavigate();
  const { paletteNavItems, paletteAdminItems } = useNavigationVisibility();

  // Keyboard: ⌘K / Ctrl-K to toggle. `/` opens when nothing else has focus.
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (event.key === '/' && !isMod) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  React.useEffect(() => {
    if (open) setRecent(readRecent());
  }, [open]);

  /* One definition, shared with both sidebars. This copy called the same
     module "AML / CTF Compliance" and filed it under a group called
     "Compliance" that no other surface used — which is what two copies of a
     navigation entry become. */
  const amlEntry = useAmlNavEntry();

  const allEntries = React.useMemo(() => {
    const list = [...paletteNavItems];
    if (amlEntry) list.push(amlEntry);
    return [...list, ...paletteAdminItems];
  }, [amlEntry, paletteAdminItems, paletteNavItems]);

  const entriesByUrl = React.useMemo(() => new Map(allEntries.map((e) => [e.url, e])), [allEntries]);

  const recentResolved = React.useMemo(
    () => recent.map((url) => entriesByUrl.get(url)).filter((e): e is NavItemDef => Boolean(e)),
    [entriesByUrl, recent]
  );

  const grouped = React.useMemo(() => {
    const map = new Map<string, NavItemDef[]>();
    for (const entry of allEntries) {
      const group = PALETTE_GROUP[entry.group] ?? entry.group;
      const list = map.get(group) ?? [];
      list.push(entry);
      map.set(group, list);
    }
    return map;
  }, [allEntries]);

  const handleSelect = React.useCallback(
    (url: string) => {
      writeRecent(url);
      setOpen(false);
      // Defer navigation so the dialog closes cleanly.
      setTimeout(() => navigate(url), 10);
    },
    [navigate]
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search commands, pages, and shortcuts…" />
      <CommandList>
        <CommandEmpty>No matches. Try a page name, module, or keyword.</CommandEmpty>

        {recentResolved.length > 0 && (
          <>
            <CommandGroup heading="Recent">
              {recentResolved.map((entry) => (
                <CommandItem
                  key={`recent-${entry.url}`}
                  value={`recent ${entry.title} ${entry.url}`}
                  onSelect={() => handleSelect(entry.url)}
                >
                  <entry.icon className="mr-2 h-4 w-4 text-primary" />
                  <span>{entry.title}</span>
                  <CommandShortcut>{PALETTE_GROUP[entry.group] ?? entry.group}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {Array.from(grouped.entries()).map(([group, list]) => (
          <CommandGroup key={group} heading={group}>
            {list.map((entry) => (
              <CommandItem
                key={entry.url}
                value={[entry.title, entry.url, group, ...(entry.keywords ?? [])].join(' ')}
                onSelect={() => handleSelect(entry.url)}
              >
                <entry.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{entry.title}</span>
                <CommandShortcut>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        <CommandSeparator />
        <CommandGroup heading="Tips">
          <CommandItem value="tip-shortcut" disabled>
            <CommandIcon className="mr-2 h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Press ⌘K or / to open this palette from anywhere.</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export default GlobalCommandPalette;
