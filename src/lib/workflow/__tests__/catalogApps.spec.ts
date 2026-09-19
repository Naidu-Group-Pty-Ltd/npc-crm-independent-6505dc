/**
 * The palette's arrangement.
 *
 * Grouping is the difference between "252 steps" and "the app I came for", so
 * the properties that make it findable are asserted here rather than left to a
 * visual check: every step reaches exactly one group, the two native groups
 * lead, an app query returns that app's whole surface even when its operations
 * never say its name, and the kind tabs narrow groups without emptying them.
 */

import { describe, expect, it } from 'vitest';
import { INTEGRATIONS } from '@/lib/integrations/registry';
import { CATALOG } from '../catalog';
import {
  CORE_APP_ID,
  TRIGGER_APP_ID,
  appGroups,
  appIdFor,
  appOperations,
} from '../catalogApps';
import { getIntegrationName } from '../integrationNames';

const named = () => appGroups({ nameFor: getIntegrationName });

describe('app grouping', () => {
  it('files every step into exactly one app, losing none', () => {
    const grouped = named().flatMap((g) => g.nodes);
    expect(grouped).toHaveLength(CATALOG.length);
    expect(new Set(grouped.map((n) => n.id)).size).toBe(CATALOG.length);
  });

  it('leads with triggers and core steps, then goes alphabetical', () => {
    const groups = named();
    expect(groups[0].id).toBe(TRIGGER_APP_ID);
    expect(groups[1].id).toBe(CORE_APP_ID);

    const rest = groups.slice(2).map((g) => g.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  it('names real apps from the registry rather than their id', () => {
    const airtable = named().find((g) => g.id === 'airtable');
    expect(airtable?.name).toBe('Airtable');
    expect(airtable?.native).toBe(false);
  });

  /**
   * The catalog declares `core.schedule`, `core.webhook` and `core.manual`
   * under the `logic` category — they are not events from this dashboard's own
   * data. They are still the three commonest ways to start a workflow, so the
   * native split is by kind, and this is the assertion that keeps it that way.
   */
  it('files every native trigger under Triggers, whatever its category', () => {
    const byId = (id: string) => CATALOG.find((n) => n.id === id)!;
    expect(appIdFor(byId('platform.client_created'))).toBe(TRIGGER_APP_ID);
    expect(appIdFor(byId('core.schedule'))).toBe(TRIGGER_APP_ID);
    expect(appIdFor(byId('core.webhook'))).toBe(TRIGGER_APP_ID);
    expect(appIdFor(byId('core.manual'))).toBe(TRIGGER_APP_ID);

    expect(appIdFor(byId('core.branch'))).toBe(CORE_APP_ID);
    expect(appIdFor(byId('core.notify_team'))).toBe(CORE_APP_ID);
  });

  it('puts triggers before actions inside an app', () => {
    for (const group of named()) {
      const kinds = group.nodes.map((n) => (n.kind === 'trigger' ? 0 : 1));
      expect(kinds).toEqual([...kinds].sort());
    }
  });

  it('counts triggers and actions to what the rows claim', () => {
    for (const group of named()) {
      expect(group.triggerCount + group.actionCount).toBe(group.nodes.length);
      expect(group.triggerCount).toBe(group.nodes.filter((n) => n.kind === 'trigger').length);
    }
  });
});

describe('searching', () => {
  /**
   * The property that makes app-first browsing searchable: Airtable's
   * operations are called things like "Find records", which contains neither
   * "airtable" nor anything else a person would type to find them.
   */
  it('returns an app’s whole surface when the query is its name', () => {
    const matched = appGroups({ nameFor: getIntegrationName, query: 'airtable' });
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe('airtable');
    expect(matched[0].nodes).toEqual(appOperations('airtable'));
  });

  it('still finds a step by what it does', () => {
    const hits = appGroups({ nameFor: getIntegrationName, query: 'send email' }).flatMap((g) => g.nodes);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('matches every token, not any of them', () => {
    const none = appGroups({ nameFor: getIntegrationName, query: 'airtable zzzznope' });
    expect(none).toEqual([]);
  });
});

describe('the kind tabs', () => {
  it('narrows to one kind without inventing or dropping steps', () => {
    const triggers = appGroups({ nameFor: getIntegrationName, kind: 'trigger' });
    const all = triggers.flatMap((g) => g.nodes);
    expect(all.every((n) => n.kind === 'trigger')).toBe(true);
    expect(all).toHaveLength(CATALOG.filter((n) => n.kind === 'trigger').length);
  });

  it('drops an app entirely when it has no step of that kind', () => {
    // Core steps are never triggers, so the Triggers tab must not list them.
    const triggerApps = appGroups({ nameFor: getIntegrationName, kind: 'trigger' }).map((g) => g.id);
    expect(triggerApps).not.toContain(CORE_APP_ID);
    expect(triggerApps).toContain(TRIGGER_APP_ID);
  });
});

describe('the app list and the integration registry', () => {
  /**
   * Every app row offers to open something. A group whose id is not a known
   * integration would render with its raw id as a name and no brand mark.
   */
  it('names only integrations the registry knows', () => {
    const known = new Set(INTEGRATIONS.map((i) => i.id));
    const unknown = named()
      .filter((g) => !g.native)
      .map((g) => g.id)
      .filter((id) => !known.has(id));
    expect(unknown).toEqual([]);
  });

  it('never produces an empty group', () => {
    expect(named().every((g) => g.nodes.length > 0)).toBe(true);
  });
});
