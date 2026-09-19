/**
 * The catalog, arranged the way people look for things.
 *
 * The palette used to group its 252 steps by the category the *registry*
 * assigns an integration — "Communications", "Property & Market Data",
 * "Productivity". That is a sound way to organise a directory of integrations
 * and a poor way to find a step, because nobody arrives wanting a
 * communications step. They arrive wanting *Twilio*, and Twilio's three
 * operations were scattered under a heading that also held Slack, Resend and
 * eleven others.
 *
 * So the unit of browsing here is the app. `appGroups()` returns one group per
 * integration with its operations attached, plus two pseudo-apps for the steps
 * that have no vendor behind them at all:
 *
 *   • **Triggers** — every native way a run can start: this dashboard's own
 *     events, plus a schedule, an inbound webhook and a manual run.
 *   • **Core steps** — branch, filter, loop, delay, HTTP, notify: the steps
 *     that need no vendor behind them.
 *
 * They are modelled as apps rather than special-cased in the UI because they
 * are what a person reaches for most, and a list where the first two entries
 * follow different rules from the rest is a list with a bug in it.
 *
 * Kept pure and out of the component so the arrangement can be asserted
 * directly — a renamed integration or an operation that loses its
 * `integrationId` changes what this returns, and that should fail a test rather
 * than quietly empty a section of the palette.
 */

import { CATALOG, nodeSearchIndex } from './index.pure.ts';
import type { CatalogNode } from '../types.pure.ts';

/** Steps with no vendor are grouped under these ids rather than left loose. */
export const TRIGGER_APP_ID = '__triggers__';
export const CORE_APP_ID = '__core__';

export interface AppGroup {
  /** Integration id, or one of the two pseudo-app ids above. */
  id: string;
  /** Display name. Resolved from the registry for real integrations. */
  name: string;
  /** True for the two pseudo-apps, which have no brand mark and no credential. */
  native: boolean;
  nodes: CatalogNode[];
  triggerCount: number;
  actionCount: number;
}

/** Names for the pseudo-apps; real integrations are named by the registry. */
const NATIVE_NAMES: Record<string, string> = {
  [TRIGGER_APP_ID]: 'Triggers',
  [CORE_APP_ID]: 'Core steps',
};

/**
 * Which app a step belongs to.
 *
 * A step's `integrationId` is the answer whenever it has one. Without one the
 * split is by `kind`, NOT by the category the catalog assigns — `core.schedule`,
 * `core.webhook` and `core.manual` are all declared under the `logic` category
 * because they are not events from this dashboard's own data, but they are the
 * three commonest ways a workflow starts. Filing them under control flow would
 * put "Run manually" in the same drawer as "Deduplicate", which is where nobody
 * would look for it.
 */
export function appIdFor(node: CatalogNode): string {
  if (node.integrationId) return node.integrationId;
  return node.kind === 'trigger' ? TRIGGER_APP_ID : CORE_APP_ID;
}

export interface AppGroupOptions {
  /** Resolves an integration id to its display name. */
  nameFor?: (integrationId: string) => string;
  /** Restrict to one kind, as the palette's Triggers/Actions/Logic tabs do. */
  kind?: CatalogNode['kind'];
  /** Free-text filter, matched against both the app name and each step. */
  query?: string;
}

/**
 * Every app that has at least one matching step, ordered for browsing.
 *
 * The two native groups come first because every workflow needs both: one to
 * start it and one to shape it. The rest are alphabetical, which is the only
 * order a person can predict when there are 150 of them.
 */
export function appGroups(options: AppGroupOptions = {}): AppGroup[] {
  const nameFor = options.nameFor ?? ((id: string) => id);
  const tokens = (options.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);

  const byApp = new Map<string, CatalogNode[]>();
  for (const node of CATALOG) {
    if (options.kind && node.kind !== options.kind) continue;
    const appId = appIdFor(node);

    // A query matches a step either directly or through its app's name, so
    // searching "airtable" returns all of Airtable's operations even though
    // most of their names never mention it.
    if (tokens.length) {
      const appName = (byAppName(appId, nameFor)).toLowerCase();
      const haystack = `${nodeSearchIndex(node)} ${appName}`;
      if (!tokens.every((t) => haystack.includes(t))) continue;
    }

    const list = byApp.get(appId) ?? [];
    list.push(node);
    byApp.set(appId, list);
  }

  const groups: AppGroup[] = [];
  for (const [id, nodes] of byApp) {
    groups.push({
      id,
      name: byAppName(id, nameFor),
      native: id === TRIGGER_APP_ID || id === CORE_APP_ID,
      nodes: nodes.slice().sort(byKindThenName),
      triggerCount: nodes.filter((n) => n.kind === 'trigger').length,
      actionCount: nodes.filter((n) => n.kind !== 'trigger').length,
    });
  }

  return groups.sort(nativeFirstThenAlphabetical);
}

const byAppName = (id: string, nameFor: (id: string) => string): string =>
  NATIVE_NAMES[id] ?? nameFor(id);

/** Triggers lead: a step's usefulness depends on whether it can start a run. */
const byKindThenName = (a: CatalogNode, b: CatalogNode): number => {
  if (a.kind !== b.kind) {
    if (a.kind === 'trigger') return -1;
    if (b.kind === 'trigger') return 1;
  }
  return a.name.localeCompare(b.name);
};

const NATIVE_ORDER = [TRIGGER_APP_ID, CORE_APP_ID];

const nativeFirstThenAlphabetical = (a: AppGroup, b: AppGroup): number => {
  const ai = NATIVE_ORDER.indexOf(a.id);
  const bi = NATIVE_ORDER.indexOf(b.id);
  if (ai !== -1 || bi !== -1) {
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  }
  return a.name.localeCompare(b.name);
};

/** Every step of one app, in the same order `appGroups` would present it. */
export function appOperations(appId: string, kind?: CatalogNode['kind']): CatalogNode[] {
  return CATALOG.filter((n) => appIdFor(n) === appId && (!kind || n.kind === kind)).sort(byKindThenName);
}
