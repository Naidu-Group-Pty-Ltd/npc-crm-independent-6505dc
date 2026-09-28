import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const brokerSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const runnerSource = readFileSync(new URL('../agent-task-runner/index.ts', import.meta.url), 'utf8');

describe('checklist recurrence security contract', () => {
  // The first form of this guard refused only a `cron:` key. The broker now
  // refuses ANY recurrence key, because every key is an idempotency boundary a
  // trusted flow owns, so the contract follows the stricter rule.
  it('reserves cron recurrence metadata from service-role broker callers', () => {
    const guardStart = brokerSource.indexOf('function containsReservedChecklistGenerationMetadata(');
    const guard = brokerSource.slice(guardStart, brokerSource.indexOf('\n}\n', guardStart));
    expect(guardStart).toBeGreaterThan(-1);
    expect(guard).toContain("table !== 'checklist_instances'");
    expect(guard).toContain("row?.generated_by === 'cron'");
    expect(guard).toContain("Object.prototype.hasOwnProperty.call(row ?? {}, 'recurrence_key')");

    const handler = brokerSource.indexOf('Deno.serve(');
    const refusal = brokerSource.indexOf(
      "if (['insert', 'update', 'upsert'].includes(operation) && containsReservedChecklistGenerationMetadata(table, data))",
      handler,
    );
    expect(refusal).toBeGreaterThan(handler);
    expect(brokerSource).toContain('Checklist generation metadata is managed by trusted generation flows.');
    // Refused before the broker writes anything with its service role.
    for (const write of ['.insert(data)', '.update(updateData)', '.upsert(data, upsertOptions)']) {
      const at = brokerSource.indexOf(write, handler);
      expect(at).toBeGreaterThan(refusal);
    }
  });

  it('only accepts a fully matching cron occurrence for idempotency', () => {
    expect(runnerSource).toContain('const recurrenceKey = `cron:${tmpl.id}:${occurrenceDate}:${ownerContext}`');
    expect(runnerSource).toContain(".eq('template_id', tmpl.id)");
    expect(runnerSource).toContain(".eq('due_date', occurrenceDate)");
    expect(runnerSource).toContain(".eq('generated_by', 'cron')");
  });
});
