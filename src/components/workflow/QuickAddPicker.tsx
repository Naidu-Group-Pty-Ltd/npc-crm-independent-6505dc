/**
 * The picker that opens where a connection was dropped on empty canvas.
 *
 * This is the fast path for building a flow: drag out of a port, let go, type
 * two letters, press Enter. The step is created already wired to the port you
 * dragged from, so a five-step workflow never requires touching the palette.
 *
 * Triggers are excluded — a trigger starts a run and cannot have anything
 * feeding it, so offering one here would only ever produce an invalid graph.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, KeyRound, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { searchCatalog } from '@/lib/workflow/catalog';
import type { CatalogNode } from '@/lib/workflow/types';
import { accentClass } from './nodeAccents';
import { NodeGlyph } from './nodeVisuals';

interface QuickAddPickerProps {
  /** Screen position of the drop, used to place the panel. */
  at: { x: number; y: number };
  configuredIntegrations: Set<string>;
  credentialsLoaded: boolean;
  onChoose: (catalogId: string) => void;
  onDismiss: () => void;
}

const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 380;
const RESULT_LIMIT = 60;

export function QuickAddPicker({
  at,
  configuredIntegrations,
  credentialsLoaded,
  onChoose,
  onDismiss,
}: QuickAddPickerProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const matches = searchCatalog({ query }).filter((n) => n.kind !== 'trigger');
    // With no query, lead with logic — the steps most often chained mid-flow.
    if (!query.trim()) {
      const logic = matches.filter((n) => n.kind === 'logic');
      const rest = matches.filter((n) => n.kind !== 'logic');
      return [...logic, ...rest].slice(0, RESULT_LIMIT);
    }
    return matches.slice(0, RESULT_LIMIT);
  }, [query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => inputRef.current?.focus(), []);

  // Keep the highlighted row in view as the arrows move through the list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Keep the panel on screen when the drop lands near an edge.
  const style = {
    left: Math.min(at.x, Math.max(8, window.innerWidth - PANEL_WIDTH - 8)),
    top: Math.min(at.y, Math.max(8, window.innerHeight - PANEL_HEIGHT - 8)),
    width: PANEL_WIDTH,
  };

  const choose = (node: CatalogNode | undefined) => {
    if (node) onChoose(node.id);
  };

  return (
    <>
      {/* Click-away. Pointer-down rather than click so it beats the canvas. */}
      <div className="fixed inset-0 z-40" onPointerDown={onDismiss} aria-hidden="true" />

      <div
        className="fixed z-50 overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
        style={style}
        role="dialog"
        aria-label="Add a connected step"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="What happens next?"
            aria-label="Search for the next step"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(results[active]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onDismiss();
              }
            }}
          />
        </div>

        <ul ref={listRef} className="max-h-[19rem] overflow-y-auto p-1" role="listbox" aria-label="Steps">
          {results.length === 0 && (
            <li className="px-2 py-6 text-center text-xs text-muted-foreground">
              Nothing matches “{query}”.
            </li>
          )}

          {results.map((node, index) => {
            const needsCredential =
              credentialsLoaded &&
              Boolean(node.integrationId) &&
              !configuredIntegrations.has(node.integrationId as string);

            return (
              <li key={node.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(node)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
                    accentClass(node.category),
                    index === active ? 'bg-muted' : 'hover:bg-muted/60',
                  )}
                >
                  <span className="wf-node-icon !h-6 !w-6 shrink-0">
                    <NodeGlyph node={node} size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-foreground">{node.name}</span>
                      {needsCredential && (
                        <KeyRound className="h-3 w-3 shrink-0 text-warning" aria-label="Needs credentials" />
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">{node.summary}</span>
                  </span>
                  {index === active && (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="border-t border-border/60 px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> to move ·{' '}
          <kbd className="font-mono">Enter</kbd> to add · <kbd className="font-mono">Esc</kbd> to cancel
        </p>
      </div>
    </>
  );
}
