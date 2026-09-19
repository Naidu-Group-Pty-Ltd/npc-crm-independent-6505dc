import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const brokerSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const runnerSource = readFileSync(new URL('../agent-task-runner/index.ts', import.meta.url), 'utf8');

describe('checklist recurrence security contract', () => {
  it('reserves cron recurrence metadata from service-role broker callers', () => {
    expect(brokerSource).toContain("row?.generated_by === 'cron'");
    expect(brokerSource).toContain("startsWith('cron:')");
    expect(brokerSource).toContain('Cron checklist metadata is managed by the scheduled runner.');
  });

  it('only accepts a fully matching cron occurrence for idempotency', () => {
    expect(runnerSource).toContain('const recurrenceKey = `cron:${tmpl.id}:${occurrenceDate}:${ownerContext}`');
    expect(runnerSource).toContain(".eq('template_id', tmpl.id)");
    expect(runnerSource).toContain(".eq('due_date', occurrenceDate)");
    expect(runnerSource).toContain(".eq('generated_by', 'cron')");
  });
});
