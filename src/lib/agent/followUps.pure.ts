/**
 * Follow-ups — the next question, offered before the user has to think of it.
 *
 * After a reply, a colleague would usually say "want me to…?". These chips do
 * that, chosen from the areas of the business the reply actually touched (the
 * tools it ran), so a pipeline answer offers pipeline next steps rather than
 * a generic "tell me more". They are suggestions sent as ordinary messages:
 * anything that would change data still goes through the agent's own
 * approval step.
 */
import { toolDomain, type ToolDomain } from './toolNarration.pure';

const BY_DOMAIN: Partial<Record<ToolDomain, string[]>> = {
  deals: ['Which deals are most at risk?', 'Show stale deals', 'Chart deals by stage'],
  calendar: ['What’s free tomorrow?', 'Prep me for my next meeting'],
  reminders: ['What’s due this week?', 'Draft follow-ups for overdue items'],
  clients: ['Show their deals', 'Draft a follow-up email', 'What’s their borrowing capacity?'],
  email: ['Summarise the thread', 'Draft a reply'],
  financial: ['What-if: rates +0.5%', 'Compare lender rates'],
  analytics: ['Turn this into a chart', 'What should I focus on today?'],
  reports: ['Summarise the key findings', 'Which reports are still pending?'],
  calls: ['Any flagged calls?', 'Summarise the latest call'],
  listings: ['Show the newest listings', 'Summarise the listings market'],
  plans: ['What’s off track?', 'Show this week’s digest'],
  operations: ['Show my playbooks', 'What checklists are open?'],
};

const GENERAL = ['Tell me more', 'Turn this into a checklist', 'Draft an email from this'];

export function suggestFollowUps(toolNames: readonly string[], max = 3): string[] {
  const out: string[] = [];
  const seenDomains = new Set<ToolDomain>();
  for (const name of toolNames) {
    const domain = toolDomain(name);
    if (domain === 'tools' || domain === 'memory' || seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    for (const s of BY_DOMAIN[domain] ?? []) {
      if (!out.includes(s)) out.push(s);
    }
  }
  if (out.length === 0) out.push(...GENERAL);
  // Interleave so two domains each get a voice rather than the first taking all three.
  if (seenDomains.size > 1) {
    const lists = [...seenDomains].map((d) => [...(BY_DOMAIN[d] ?? [])]);
    const mixed: string[] = [];
    while (mixed.length < max && lists.some((l) => l.length)) {
      for (const l of lists) {
        const next = l.shift();
        if (next && !mixed.includes(next)) mixed.push(next);
        if (mixed.length >= max) break;
      }
    }
    return mixed;
  }
  return out.slice(0, max);
}

/** Tool names a persisted message records, in call order, without duplicates. */
export function toolNamesFromCalls(toolCalls: unknown): string[] {
  if (!Array.isArray(toolCalls)) return [];
  const names: string[] = [];
  for (const tc of toolCalls) {
    const name = (tc as { function?: { name?: string }; name?: string })?.function?.name ?? (tc as { name?: string })?.name;
    if (typeof name === 'string' && name && !names.includes(name)) names.push(name);
  }
  return names;
}
