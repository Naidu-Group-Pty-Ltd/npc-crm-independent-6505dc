/**
 * When an assessment may be deleted, and what restoring one returns it to.
 *
 * Deleting is permanent and cascades the calculation runs, scenarios, link
 * history and audit trail, so the rule is narrow on purpose: an assessment that
 * never left its owner's working set may go; anything that reached a client or
 * a report is kept and archiving is offered. These pin that boundary, the order
 * the reasons are reported in, and the restore defect this work found — a
 * completed assessment came back from the archive as a draft.
 */

import { describe, expect, it } from 'vitest';
import {
  ABANDONED_RENDER_AFTER_MS, decideDeletion, deletionNeedsTypedConfirmation, statusAfterRestore,
  type DeletionFacts, type RenderFact,
} from '../assessmentDeletion';

const NOW = Date.parse('2026-09-23T10:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function facts(overrides: Partial<DeletionFacts> = {}): DeletionFacts {
  return { status: 'draft', clientId: null, clientLinkCount: 0, renders: [], ...overrides };
}

function render(status: string, ledger: RenderFact['ledger'] = 'capacity_report', createdAt = minutesAgo(60)): RenderFact {
  return { status, ledger, createdAt };
}

describe('what may be deleted', () => {
  it('allows a draft that never left its owner', () => {
    const verdict = decideDeletion(facts(), NOW);
    expect(verdict.allowed).toBe(true);
    expect(verdict.block).toBeNull();
    expect(verdict.message).toMatch(/no client record, property record or document is affected/);
  });

  it('allows an incomplete or completed assessment that was never linked and never reported', () => {
    for (const status of ['data_entry', 'calculated', 'requires_review', 'completed', 'archived']) {
      expect(decideDeletion(facts({ status }), NOW).allowed, status).toBe(true);
    }
  });

  it('ignores a template render that failed — no document, no foreign key', () => {
    expect(decideDeletion(facts({ renders: [render('failed', 'template')] }), NOW).allowed).toBe(true);
  });
});

describe('what is kept, and why', () => {
  it('keeps an assessment linked to a client', () => {
    const verdict = decideDeletion(facts({ status: 'linked', clientId: 'c1', clientLinkCount: 1 }), NOW);
    expect(verdict).toMatchObject({ allowed: false, block: 'linked_to_client', archiveOffered: true });
    expect(verdict.message).toMatch(/Commercial & Industrial file/);
  });

  it('keeps one that was linked before — the link history records what it wrote', () => {
    const verdict = decideDeletion(facts({ status: 'completed', clientLinkCount: 1 }), NOW);
    expect(verdict).toMatchObject({ allowed: false, block: 'client_history', archiveOffered: true });
  });

  it('keeps one a report was issued from, whichever route drew it', () => {
    for (const ledger of ['capacity_report', 'template'] as const) {
      const verdict = decideDeletion(facts({ status: 'completed', renders: [render('succeeded', ledger)] }), NOW);
      expect(verdict.block, ledger).toBe('report_issued');
      expect(verdict.archiveOffered).toBe(true);
    }
  });

  it('keeps one a report was requested from, even where it failed', () => {
    // The ledger's foreign key is RESTRICT on any row, and a failed row cannot
    // prove no file was stored: the path is written before the upload.
    const verdict = decideDeletion(facts({ status: 'completed', renders: [render('failed')] }), NOW);
    expect(verdict).toMatchObject({ allowed: false, block: 'report_requested', archiveOffered: true });
  });

  it('asks the operator to wait while a report is being drawn', () => {
    const verdict = decideDeletion(facts({ status: 'completed', renders: [render('running', 'capacity_report', minutesAgo(1))] }), NOW);
    expect(verdict).toMatchObject({ allowed: false, block: 'report_in_progress', archiveOffered: false });
  });

  it('does not ask anyone to wait for a render that died', () => {
    const abandoned = new Date(NOW - ABANDONED_RENDER_AFTER_MS - 1000).toISOString();
    const verdict = decideDeletion(facts({ status: 'completed', renders: [render('running', 'capacity_report', abandoned)] }), NOW);
    expect(verdict.block).toBe('report_requested');
  });

  it('reports the permanent reason before the passing one', () => {
    const verdict = decideDeletion(facts({
      status: 'linked', clientId: 'c1', clientLinkCount: 1,
      renders: [render('running', 'capacity_report', minutesAgo(1)), render('succeeded')],
    }), NOW);
    expect(verdict.block).toBe('linked_to_client');
  });

  it('does not offer to archive what is already archived', () => {
    const verdict = decideDeletion(facts({ status: 'archived', clientLinkCount: 1 }), NOW);
    expect(verdict.archiveOffered).toBe(false);
    expect(verdict.message).toMatch(/stays archived/);
  });
});

describe('the typed confirmation', () => {
  it('is asked for a finished position, not for a stray draft', () => {
    expect(deletionNeedsTypedConfirmation('completed')).toBe(true);
    expect(deletionNeedsTypedConfirmation('linked')).toBe(true);
    expect(deletionNeedsTypedConfirmation('draft')).toBe(false);
    expect(deletionNeedsTypedConfirmation('data_entry')).toBe(false);
    expect(deletionNeedsTypedConfirmation('archived')).toBe(false);
  });
});

describe('restoring from the archive', () => {
  it('returns to the status recorded when it was archived', () => {
    expect(statusAfterRestore({ recordedStatus: 'completed', clientId: null, currentCalculationId: 'run-1' })).toBe('completed');
    expect(statusAfterRestore({ recordedStatus: 'requires_review', clientId: null, currentCalculationId: 'run-1' })).toBe('requires_review');
    expect(statusAfterRestore({ recordedStatus: 'linked', clientId: 'c1', currentCalculationId: 'run-1' })).toBe('linked');
  });

  it('never restores a completed assessment as a draft — the defect it replaces', () => {
    // An archive written before the status was recorded: derive what the record can prove.
    expect(statusAfterRestore({ recordedStatus: undefined, clientId: null, currentCalculationId: 'run-1' })).toBe('calculated');
    expect(statusAfterRestore({ recordedStatus: undefined, clientId: 'c1', currentCalculationId: 'run-1' })).toBe('linked');
    expect(statusAfterRestore({ recordedStatus: undefined, clientId: null, currentCalculationId: null })).toBe('data_entry');
  });

  it('does not restore a claim the record no longer supports', () => {
    expect(statusAfterRestore({ recordedStatus: 'linked', clientId: null, currentCalculationId: 'run-1' })).toBe('completed');
    expect(statusAfterRestore({ recordedStatus: 'completed', clientId: null, currentCalculationId: null })).toBe('data_entry');
    expect(statusAfterRestore({ recordedStatus: 'archived', clientId: null, currentCalculationId: null })).toBe('data_entry');
    expect(statusAfterRestore({ recordedStatus: 42, clientId: null, currentCalculationId: 'run-1' })).toBe('calculated');
  });
});

describe('the server enforces what the dialog shows', () => {
  it('routes deletion through the shared rule, the owner scope and the delete permission', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'supabase/functions/manage-ci-assessments/index.ts'), 'utf8');
    const deleteCase = source.slice(source.indexOf("case 'delete': {"), source.indexOf("case 'audit': {"));

    expect(deleteCase).toContain('loadOwned(body.assessmentId)');
    expect(deleteCase).toContain('await mayDelete()');
    expect(deleteCase).toContain('decideDeletion(facts)');
    expect(deleteCase).toContain('deletionNeedsTypedConfirmation');
    // Scoped by owner AND version, so a record that changed underneath is kept.
    expect(deleteCase).toMatch(/\.eq\('user_id', userId\)\s*\.eq\('version', existing\.version\)/);
    // Nothing in the report ledger is deleted to make room for a delete.
    expect(deleteCase).not.toMatch(/commercial_industrial_report_renders[\s\S]*\.delete\(\)/);
    expect(source).toMatch(/requireModulePermission\(supabase, auth, DELETE_PERMISSION_MODULE, 'can_delete'\)/);
    expect(source).toContain("const DELETE_PERMISSION_MODULE = 'commercial';");
  });

  it('checks the template ledger, which has no foreign key to refuse anything', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'supabase/functions/manage-ci-assessments/index.ts'), 'utf8');
    expect(source).toMatch(/from\('template_render_jobs'\)[\s\S]{0,200}\.eq\('metadata->>report_id', existing\.id\)/);
  });
});
