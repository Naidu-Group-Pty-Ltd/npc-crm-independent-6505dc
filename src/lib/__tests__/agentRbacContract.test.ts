/**
 * Contract tests for the Aurixa Agent RBAC audit.
 *
 * The agent runs every tool on a service-role client, so RLS is not underneath
 * it — `authorizeAgentTool` is the only thing standing between a prompt and the
 * database. That makes two failure modes worth pinning:
 *
 *   1. An identifier that escapes the ownership loop. The gate fails closed on
 *      unknown `*_id` args, but `NON_OWNERSHIP_ID_ARGS` is an explicit
 *      exemption list, and two entries on it (`contact_id`, `task_id`) named
 *      real user-owned rows. Their executors filtered on `.eq('id', ...)` with
 *      no user scope, so one user could edit another user's co-borrower record
 *      or delete their scheduled task.
 *   2. An agent surface that authenticates but never checks the `agent` module.
 *      `agent` is the licensed Aurixa Agent (`aurixa-agent`); ai-dashboard-agent
 *      gates on it specifically so the agent is not a way around the workspace
 *      model, and the planner and skill marketplace were skipping it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const AUTHZ = 'supabase/functions/_shared/agentToolAuthz.ts';
const AGENT = 'supabase/functions/ai-dashboard-agent/index.ts';

/** Module keys that exist in dashboard_modules, from the shared registry. */
function registeredModuleKeys(): Set<string> {
  const src = read('supabase/functions/_shared/moduleRegistry.ts');
  const body = src.slice(src.indexOf('DASHBOARD_MODULE_KEYS'), src.indexOf('] as const'));
  return new Set([...body.matchAll(/^\s{2}'([a-z0-9_]+)',$/gm)].map((m) => m[1]));
}

/** Parse the minified 217-row policy table. */
function policies(): Record<string, { mod?: string; perm?: string }> {
  const src = read(AUTHZ);
  const block = src.slice(
    src.indexOf('TOOL_SECURITY_POLICIES'),
    src.indexOf('export function requireToolPolicy'),
  );
  const out: Record<string, { mod?: string; perm?: string }> = {};
  for (const m of block.matchAll(/'([a-z0-9_]+)':\{([^}]*)\}/g)) {
    out[m[1]] = {
      mod: (m[2].match(/moduleKey:'([^']+)'/) || [])[1],
      perm: (m[2].match(/permission:'([^']+)'/) || [])[1],
    };
  }
  return out;
}

describe('every dispatched tool has a policy', () => {
  it('policy table and tool dispatch agree in both directions', () => {
    const dispatched = new Set(
      [...read(AGENT).matchAll(/case '([a-z0-9_]+)':\s*return execute/g)].map((m) => m[1]),
    );
    const pol = policies();
    expect(dispatched.size).toBeGreaterThan(200);

    const noPolicy = [...dispatched].filter((t) => !pol[t]);
    // A missing policy fails closed, so this is availability rather than a hole
    // — but a silently dead tool is still a defect.
    expect(noPolicy, `dispatched with no policy: ${noPolicy.join(', ')}`).toEqual([]);

    const orphan = Object.keys(pol).filter((t) => !dispatched.has(t));
    expect(orphan, `policy rows for tools that do not exist: ${orphan.join(', ')}`).toEqual([]);
  });
});

describe('ownership-exempt identifiers name nothing user-owned', () => {
  const src = read(AUTHZ);
  const exemptBlock = src.slice(
    src.indexOf('const NON_OWNERSHIP_ID_ARGS'),
    src.indexOf(']);', src.indexOf('const NON_OWNERSHIP_ID_ARGS')),
  );

  it('contact_id is ownership-resolved, not exempt', () => {
    // update_additional_contact / remove_additional_contact take contact_id as
    // their only resource arg and mutate client PII.
    expect(exemptBlock).not.toMatch(/'contact_id'/);
    expect(src).toContain('contact_id: async (sb, userId, id)');
    expect(src).toContain("from('client_additional_contacts')");
  });

  it('task_id is ownership-resolved, not exempt', () => {
    expect(exemptBlock).not.toMatch(/(^|[^_])'task_id'/m);
    expect(src).toContain('task_id: async (sb, userId, id)');
  });

  it('keeps genuinely external identifiers exempt', () => {
    // These are provider-side ids with no row in this database; gating them
    // would fail closed on every call.
    for (const key of ['ghl_contact_id', 'external_id', 'place_id', 'thread_id']) {
      expect(exemptBlock, `${key} should stay exempt`).toContain(`'${key}'`);
    }
  });

  it('resolvers fail closed on a missing row', () => {
    const contact = src.slice(src.indexOf('contact_id: async'), src.indexOf('task_id: async'));
    expect(contact).toContain('if (!contact?.client_id) return false;');
  });
});

describe('scheduled-task executors scope by owner', () => {
  const src = read(AGENT);

  it('toggle and delete filter on user_id, not just the row id', () => {
    // Service-role client: this filter IS the row-level scope.
    for (const fn of ['executeToggleScheduledTask', 'executeDeleteScheduledTask']) {
      const body = src.slice(src.indexOf(`async function ${fn}`), src.indexOf(`async function ${fn}`) + 900);
      expect(body, `${fn} must take the acting user`).toMatch(/args: any, userId: string/);
      expect(body, `${fn} must filter by user_id`).toContain(".eq('user_id', userId)");
    }
  });

  it('the dispatcher passes the acting user through', () => {
    expect(src).toContain("case 'toggle_scheduled_task': return executeToggleScheduledTask(sb, args, userId);");
    expect(src).toContain("case 'delete_scheduled_task': return executeDeleteScheduledTask(sb, args, userId);");
  });
});

describe('tool permissions match what the tool does', () => {
  const pol = policies();

  it('mutating tools never settle for can_view', () => {
    const MUTATES = /^(create_|update_|delete_|remove_|add_|send_|toggle_|set_|link_|generate_|trigger_|save_|bulk_|revoke_|cancel_|reschedule_|complete_|share_|log_)/;
    const offenders = Object.entries(pol)
      .filter(([name, p]) => MUTATES.test(name) && p.perm === 'can_view')
      .map(([name]) => name);
    expect(offenders, `mutating tools gated on can_view: ${offenders.join(', ')}`).toEqual([]);
  });

  it('reschedule_appointment matches its create/cancel siblings', () => {
    expect(pol.reschedule_appointment?.perm).toBe('can_edit');
    expect(pol.create_appointment?.perm).toBe('can_edit');
    expect(pol.cancel_appointment?.perm).toBe('can_edit');
  });

  it('share_conversation matches its revoke counterpart', () => {
    // Sharing grants another user access; it is not a read.
    expect(pol.share_conversation?.perm).toBe('can_edit');
    expect(pol.revoke_conversation_share?.perm).toBe('can_edit');
  });
});

describe('resolved business modules are grantable', () => {
  it('marketing attribution tools resolve to a registered module', () => {
    const src = read(AUTHZ);
    expect(src).toContain("if (has('attribution', 'campaign', 'marketing_funnel')) return 'marketing_analytics';");
    expect(registeredModuleKeys().has('marketing_analytics')).toBe(true);
  });

  it('the marketing rule does not shadow the report rules', () => {
    // get_marketing_reports must keep resolving to `reports`.
    const src = read(AUTHZ);
    const reportRule = src.indexOf("'marketing_report'");
    const marketingRule = src.indexOf("if (has('attribution', 'campaign', 'marketing_funnel'))");
    expect(reportRule).toBeGreaterThan(-1);
    expect(marketingRule).toBeGreaterThan(reportRule);
  });
});

describe('every agent surface enforces the licensed agent module', () => {
  const surfaces: Array<[string, string]> = [
    ['supabase/functions/agent-planner/index.ts', 'agent-planner'],
    ['supabase/functions/agent-skill-marketplace/index.ts', 'agent-skill-marketplace'],
  ];

  for (const [path, label] of surfaces) {
    it(`${label} gates on the agent module, not merely authentication`, () => {
      const src = read(path);
      expect(src, `${label} does not import the deny-by-default helper`).toContain(
        "import { requireModulePermission } from '../_shared/authz.ts'",
      );
      expect(src, `${label} does not gate on 'agent'`).toMatch(/requireModulePermission\([\s\S]{0,200}'agent'/);
    });

    it(`${label} denies when the gate fails`, () => {
      expect(read(path)).toMatch(/if \(!\w*[Gg]ate\.ok\) return json\(\{ error: 'forbidden' \}, 403\)/);
    });
  }

  it('the planner still lets the cron path through without a user', () => {
    // run-scheduled authenticates with the cron secret and has no user to
    // authorize; gating it would silently stop every scheduled plan.
    const src = read('supabase/functions/agent-planner/index.ts');
    const cron = src.indexOf("if (action === 'run-scheduled')");
    const gate = src.indexOf('requireModulePermission(');
    expect(cron).toBeGreaterThan(-1);
    expect(gate, 'the module gate must come after the cron branch returns').toBeGreaterThan(cron);
  });
});

describe('agent routes are guarded in the UI too', () => {
  it('every agent page sits behind ModuleGuard moduleKey="agent"', () => {
    const app = read('src/App.tsx');
    for (const route of ['agent/plans', 'agent/skills', 'agent-insights', 'agent/memories']) {
      const line = app.split('\n').find((l) => l.includes(`path="${route}"`));
      expect(line, `route ${route} missing`).toBeDefined();
      expect(line, `route ${route} is not behind ModuleGuard`).toContain('<ModuleGuard moduleKey="agent">');
    }
  });
});
