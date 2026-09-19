/**
 * The step library.
 *
 * Browsing is app-first. 252 steps grouped by the registry's abstract
 * categories meant Twilio's operations sat under "Communications" alongside
 * Slack's and Resend's, and finding one meant knowing which bucket somebody
 * else had filed it in. People arrive knowing the app, so the list is apps, and
 * choosing one shows its operations.
 *
 * Three things carry over from the flat list because they earned their place:
 * search covers integration ids and hand-written keywords as well as names, the
 * kind tabs still narrow to triggers/actions/logic, and every row states whether
 * its credentials are in place — so you find out an integration is unconfigured
 * while choosing it, not after wiring it up.
 *
 * Search flattens the hierarchy deliberately. Someone typing "send sms" wants
 * the operation, not the app that owns it, so results are steps — but a query
 * that matches an *app* name returns all of that app's steps, which is how
 * "airtable" finds operations whose own names never mention Airtable.
 */

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, KeyRound, Search, Zap } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BrandMark } from '@/components/integrations/BrandMark';
import { cn } from '@/lib/utils';
import { CATALOG } from '@/lib/workflow/catalog';
import { appGroups, appOperations, type AppGroup } from '@/lib/workflow/catalogApps';
import { getIntegrationName } from '@/lib/workflow/integrationNames';
import type { CatalogNode } from '@/lib/workflow/types';
import { accentClass } from './nodeAccents';
import { NodeGlyph } from './nodeVisuals';

interface NodePaletteProps {
  configuredIntegrations: Set<string>;
  credentialsLoaded: boolean;
  /** Adds the step at a sensible spot — used for click-to-add. */
  onAddNode: (catalogId: string) => void;
  /** True once the canvas has a trigger, which changes what we suggest first. */
  hasTrigger: boolean;
}

type KindFilter = 'all' | 'trigger' | 'action' | 'logic';

const KIND_TABS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'trigger', label: 'Triggers' },
  { value: 'action', label: 'Actions' },
  { value: 'logic', label: 'Logic' },
];

export function NodePalette({
  configuredIntegrations,
  credentialsLoaded,
  onAddNode,
  hasTrigger,
}: NodePaletteProps) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  /** The app being browsed, or null at the top level. */
  const [openApp, setOpenApp] = useState<AppGroup | null>(null);

  // With no trigger yet, triggers are the only useful next step, so lead with
  // them. A query means the person knows what they want; do not second-guess it.
  const effectiveKind: KindFilter = kind === 'all' && !hasTrigger && !query ? 'trigger' : kind;
  const kindFilter = effectiveKind === 'all' ? undefined : effectiveKind;

  const groups = useMemo(
    () => appGroups({ nameFor: getIntegrationName, kind: kindFilter, query }),
    [kindFilter, query],
  );

  /** Search results are steps, not apps — see the module header. */
  const searchResults = useMemo(
    () => (query.trim() ? groups.flatMap((g) => g.nodes) : []),
    [groups, query],
  );

  const drilled = useMemo(
    () => (openApp ? appOperations(openApp.id, kindFilter) : []),
    [kindFilter, openApp],
  );

  const needsCredential = (node: CatalogNode) =>
    credentialsLoaded && Boolean(node.integrationId) && !configuredIntegrations.has(node.integrationId as string);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border/60 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Step library</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{CATALOG.length} steps</span>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // A search is a fresh start; staying inside one app would hide
              // most of what the query just matched.
              setOpenApp(null);
            }}
            placeholder="Search apps, steps or keywords"
            aria-label="Search the step library"
            // The canvas's empty state focuses this when the library is
            // already docked; see openStepLibrary in WorkflowPlayground.
            data-step-library-search
            className="pl-8"
          />
        </div>

        <Tabs value={effectiveKind} onValueChange={(value) => setKind(value as KindFilter)}>
          <TabsList className="grid w-full grid-cols-4">
            {KIND_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {!hasTrigger && !query && !openApp && (
          <p className="flex items-start gap-1.5 rounded-md border border-primary/25 bg-primary/5 p-2 text-xs text-muted-foreground">
            <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            Start with a trigger — it decides when the workflow runs.
          </p>
        )}
      </div>

      {/* Breadcrumb, shown only inside an app. */}
      {openApp && !query && (
        <button
          type="button"
          onClick={() => setOpenApp(null)}
          className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          All apps
          <span className="ml-auto flex items-center gap-1.5 text-foreground">
            <span className="inline-flex h-4 w-4 items-center justify-center">
              <AppMark app={openApp} />
            </span>
            {openApp.name}
          </span>
        </button>
      )}

      <ScrollArea className="wf-scroll flex-1">
        <div className="space-y-1 p-2">
          {query.trim() ? (
            searchResults.length === 0 ? (
              <EmptyResult query={query} />
            ) : (
              <ul className="space-y-0.5" aria-label={`Steps matching ${query}`}>
                {searchResults.map((node) => (
                  <StepRow
                    key={node.id}
                    node={node}
                    showApp
                    needsCredential={needsCredential(node)}
                    onAdd={() => onAddNode(node.id)}
                  />
                ))}
              </ul>
            )
          ) : openApp ? (
            <ul className="space-y-0.5" aria-label={`${openApp.name} steps`}>
              {drilled.map((node) => (
                <StepRow
                  key={node.id}
                  node={node}
                  needsCredential={needsCredential(node)}
                  onAdd={() => onAddNode(node.id)}
                />
              ))}
            </ul>
          ) : (
            <ul className="space-y-0.5" aria-label="Apps">
              {groups.map((group) => (
                <AppRow
                  key={group.id}
                  app={group}
                  credentialsLoaded={credentialsLoaded}
                  configured={group.native || configuredIntegrations.has(group.id)}
                  onOpen={() => setOpenApp(group)}
                />
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function EmptyResult({ query }: { query: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm font-medium text-foreground">No steps match “{query}”.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Try an app name such as Airtable, or a task such as “send sms”.
      </p>
    </div>
  );
}

/** The brand mark for an app, or the glyph of its first step for the natives. */
function AppMark({ app }: { app: AppGroup }) {
  const fallback = <NodeGlyph node={app.nodes[0]} size={15} />;
  if (app.native) return fallback;
  return <BrandMark integrationId={app.id} fallback={fallback} size={15} />;
}

interface AppRowProps {
  app: AppGroup;
  configured: boolean;
  credentialsLoaded: boolean;
  onOpen: () => void;
}

function AppRow({ app, configured, credentialsLoaded, onOpen }: AppRowProps) {
  const parts = [
    app.triggerCount ? `${app.triggerCount} trigger${app.triggerCount === 1 ? '' : 's'}` : '',
    app.actionCount ? `${app.actionCount} action${app.actionCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${app.name}. ${parts.join(', ')}.`}
        className="wf-palette-item flex w-full items-center gap-2.5 p-2 text-left"
      >
        <span className="wf-node-icon !h-7 !w-7 shrink-0">
          <AppMark app={app} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[13px] font-medium leading-tight text-foreground">
              {app.name}
            </span>
            {credentialsLoaded && !configured && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 text-warning" aria-label="Needs credentials">
                    <KeyRound className="h-3 w-3" aria-hidden="true" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[14rem]">
                  You can build with {app.name}, but it needs credentials on the Integrations page
                  before the workflow can run.
                </TooltipContent>
              </Tooltip>
            )}
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
            {parts.join(' · ')}
          </span>
        </span>

        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  );
}

interface StepRowProps {
  node: CatalogNode;
  needsCredential: boolean;
  /** Search results name the app, since the heading no longer does. */
  showApp?: boolean;
  onAdd: () => void;
}

function StepRow({ node, needsCredential, showApp, onAdd }: StepRowProps) {
  const [dragging, setDragging] = useState(false);

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        draggable
        data-dragging={dragging}
        aria-label={`Add ${node.name}. ${node.summary}`}
        className={cn(
          'wf-palette-item flex w-full cursor-grab items-start gap-2.5 p-2 text-left active:cursor-grabbing',
          accentClass(node.category),
        )}
        onClick={onAdd}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onAdd();
          }
        }}
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-workflow-node', node.id);
          event.dataTransfer.effectAllowed = 'copy';
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
      >
        <span className="wf-node-icon !h-7 !w-7 shrink-0">
          <NodeGlyph node={node} size={15} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[13px] font-medium leading-tight text-foreground">
              {node.name}
            </span>
            {node.kind === 'trigger' && (
              <span className="wf-chip shrink-0 rounded px-1 text-[9px] font-semibold uppercase tracking-wide">
                Trigger
              </span>
            )}
            {needsCredential && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 text-warning" aria-label="Needs credentials">
                    <KeyRound className="h-3 w-3" aria-hidden="true" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[14rem]">
                  You can add this step, but it needs credentials on the Integrations page before the
                  workflow can run.
                </TooltipContent>
              </Tooltip>
            )}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
            {showApp && node.integrationId ? (
              <span className="text-foreground/70">{getIntegrationName(node.integrationId)} · </span>
            ) : null}
            {node.summary}
          </span>
        </span>
      </div>
    </li>
  );
}
