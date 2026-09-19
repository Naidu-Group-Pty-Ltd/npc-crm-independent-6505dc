import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildRetentionRecord,
  cleanupStatusFor,
  mayDeleteObject,
  parseRetentionDays,
  retentionVerdict,
  CAPTURE_RETENTION_ENV,
  DELETABLE_BUCKETS,
  type RetentionCandidate,
} from '../../../supabase/functions/_shared/aml/captureRetention.pure.ts';

/**
 * When a customer's identity document and face may be destroyed.
 *
 * Every test here is a case where deleting would be wrong. The mechanism has
 * exactly one path to a deletion and a dozen paths to a retain, and that
 * asymmetry is the design: the cost of keeping evidence a week too long is
 * storage, and the cost of destroying it a week too early is a compliance
 * record that cannot be reconstructed.
 */

const CASE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHECK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STANDALONE = new Set(['didit_standalone']);

const NOW = Date.parse('2026-08-11T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

/** A candidate that is eligible in every respect, for one field to be broken. */
function candidate(over: Partial<RetentionCandidate> = {}): RetentionCandidate {
  return {
    checkId: CHECK_ID,
    caseId: CASE_ID,
    provider: 'didit_standalone',
    processingStatus: 'completed',
    status: 'passed',
    settledAt: daysAgo(400),
    supersededAt: null,
    captureDeletedAt: null,
    objects: [
      { bucket: 'aml-documents', path: `${CASE_ID}/verification/att-1/document-front.jpg` },
      { bucket: 'aml-biometrics', path: `${CASE_ID}/verification/att-1/selfie.jpg` },
    ],
    // §18 satisfied: the case's AML clock ran out yesterday.
    minimumRetentionDate: daysAgo(1),
    legalHoldActive: false,
    ...over,
  };
}

const verdictFor = (over: Partial<RetentionCandidate> = {}, days: number | null = 90) =>
  retentionVerdict(candidate(over), days, NOW, STANDALONE);

/* ───────────────────────── configuration ───────────────────────────────── */

describe('the retention window is configuration, never a default', () => {
  it('accepts a positive integer only', () => {
    expect(parseRetentionDays('90')).toBe(90);
    expect(parseRetentionDays(2555)).toBe(2555);
    expect(parseRetentionDays('0')).toBeNull();
    expect(parseRetentionDays('-1')).toBeNull();
    expect(parseRetentionDays('30.5')).toBeNull();
    expect(parseRetentionDays('ninety')).toBeNull();
    expect(parseRetentionDays('')).toBeNull();
    expect(parseRetentionDays(undefined)).toBeNull();
    expect(parseRetentionDays(null)).toBeNull();
  });

  it('refuses zero as firmly as a negative', () => {
    // "Delete immediately on settlement" is not a policy anybody expresses by
    // leaving a variable at 0, so reading it that way would turn a typo into
    // the destruction of evidence.
    expect(parseRetentionDays('0')).toBeNull();
    expect(parseRetentionDays(0)).toBeNull();
  });

  it('deletes NOTHING when the policy is not configured', () => {
    const verdict = verdictFor({}, null);
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('not_configured');
    expect(verdict.reason).toContain(CAPTURE_RETENTION_ENV);
  });

  it('reports "not configured" even when everything else would allow it', () => {
    // The absence of a policy is not an invitation to apply somebody else's.
    expect(retentionVerdict(candidate(), null, NOW, STANDALONE).decision)
      .toBe('not_configured');
  });
});

/* ─────────────────────────── the two clocks ────────────────────────────── */

describe('§18: the AML retention trigger governs', () => {
  it('never deletes a case with no recorded retention trigger', () => {
    /*
     * The programme's own words (20260726140000): "A record with no recorded
     * trigger has not started its clock and is never disposal-eligible."
     * A day-counter from upload is precisely what §18 was written to forbid.
     */
    const verdict = verdictFor({ minimumRetentionDate: null });
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('awaiting_retention_trigger');
  });

  it('never deletes inside the case minimum retention period', () => {
    const verdict = verdictFor({ minimumRetentionDate: daysAhead(365) });
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('within_aml_retention');
  });

  it('deletes once both clocks have run out', () => {
    const verdict = verdictFor();
    expect(verdict.deletable).toBe(true);
    expect(verdict.decision).toBe('delete');
  });
});

describe('the capture window is a floor, never a ceiling', () => {
  it('keeps a capture younger than the configured window', () => {
    const verdict = verdictFor({ settledAt: daysAgo(10) }, 90);
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('within_capture_window');
  });

  it('can only make the rule stricter — a long window overrides a passed §18 clock', () => {
    // §18 satisfied a day ago, but the capture floor is 10 years.
    const verdict = verdictFor({ settledAt: daysAgo(400) }, 3650);
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('within_capture_window');
  });

  it('refuses to age a capture with no settlement timestamp', () => {
    const verdict = verdictFor({ settledAt: null });
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('not_eligible');
  });

  it('refuses an unparseable settlement timestamp rather than treating it as zero', () => {
    // `Date.parse` returns NaN, and NaN comparisons are false — which without
    // an explicit guard reads as "infinitely old" and deletes immediately.
    const verdict = verdictFor({ settledAt: 'not a date' });
    expect(verdict.deletable).toBe(false);
  });
});

/* ────────────────────── nothing in flight is touched ───────────────────── */

describe('an attempt that is still in use is never cleaned', () => {
  for (const processingStatus of
    ['draft', 'submitted', 'queued', 'processing', 'retry_scheduled']) {
    it(`keeps a "${processingStatus}" attempt`, () => {
      const verdict = verdictFor({ processingStatus });
      expect(verdict.deletable).toBe(false);
      expect(verdict.decision).toBe('in_flight');
    });
  }

  it('keeps an attempt whose processing state it does not recognise', () => {
    const verdict = verdictFor({ processingStatus: 'something_new' });
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('in_flight');
  });

  it('keeps an attempt with no processing state at all', () => {
    expect(verdictFor({ processingStatus: null }).deletable).toBe(false);
  });

  it('cleans the settled states, including the ones that produced no outcome', () => {
    // A technical failure and an unusable capture consumed no attempt, but
    // their photographs are still a customer's face sitting in a bucket.
    for (const processingStatus of
      ['completed', 'capture_unusable', 'technical_failure', 'cancelled', 'dead_lettered']) {
      expect(verdictFor({ processingStatus }).deletable, processingStatus).toBe(true);
    }
  });
});

describe('evidence a person may still be reading is never cleaned', () => {
  it('keeps a referred check', () => {
    // `referred` is where a document-classification mismatch and every
    // indeterminate provider answer land. It means somebody was asked a
    // question, and the photographs are the only evidence they have.
    const verdict = verdictFor({ status: 'referred' });
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('under_review');
  });

  it('keeps a check still marked pending or in progress', () => {
    expect(verdictFor({ status: 'pending' }).decision).toBe('under_review');
    expect(verdictFor({ status: 'in_progress' }).decision).toBe('under_review');
  });

  it('cleans a settled pass, fail or exhaustion', () => {
    for (const status of ['passed', 'failed', 'exhausted']) {
      expect(verdictFor({ status }).deletable, status).toBe(true);
    }
  });
});

describe('a legal hold outranks every clock', () => {
  it('keeps everything on a case under hold', () => {
    const verdict = verdictFor({ legalHoldActive: true });
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('legal_hold');
  });

  it('holds even when both retention clocks have long expired', () => {
    expect(verdictFor({
      legalHoldActive: true,
      minimumRetentionDate: daysAgo(3000),
      settledAt: daysAgo(3000),
    }).deletable).toBe(false);
  });
});

/* ───────────────────────── scope and idempotency ───────────────────────── */

describe('what this worker has a mandate over', () => {
  it('ignores a hosted-session check', () => {
    // A hosted attempt put nothing in NPC's buckets.
    const verdict = verdictFor({ provider: 'didit' });
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('not_eligible');
  });

  it('ignores the self-hosted capture provider', () => {
    expect(verdictFor({ provider: 'selfhosted' }).decision).toBe('not_eligible');
  });

  it('ignores a row with no provider', () => {
    expect(verdictFor({ provider: null }).decision).toBe('not_eligible');
  });

  it('does nothing for an attempt already cleaned', () => {
    const verdict = verdictFor({ captureDeletedAt: daysAgo(2) });
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('already_deleted');
  });

  it('does nothing for an attempt that records no objects', () => {
    const verdict = verdictFor({ objects: [] });
    expect(verdict.deletable).toBe(false);
    expect(verdict.decision).toBe('no_captures');
  });
});

/* ────────────────────── which objects may be removed ───────────────────── */

describe('an object may be removed only from this case, in an AML bucket', () => {
  it('allows the two private AML capture buckets', () => {
    expect([...DELETABLE_BUCKETS].sort()).toEqual(['aml-biometrics', 'aml-documents']);
    for (const bucket of ['aml-documents', 'aml-biometrics']) {
      expect(mayDeleteObject(
        { bucket, path: `${CASE_ID}/verification/a/x.jpg` }, CASE_ID).allowed).toBe(true);
    }
  });

  it('refuses any other bucket', () => {
    for (const bucket of ['report-templates', 'public', 'aml-documents-backup', '']) {
      const result = mayDeleteObject(
        { bucket, path: `${CASE_ID}/verification/a/x.jpg` }, CASE_ID);
      expect(result.allowed, bucket).toBe(false);
      expect(result.reason).toContain('bucket');
    }
  });

  it('refuses an object belonging to another case', () => {
    const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const result = mayDeleteObject(
      { bucket: 'aml-documents', path: `${other}/verification/a/x.jpg` }, CASE_ID);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('does not belong to this case');
  });

  it('refuses traversal rather than normalising it', () => {
    // A path containing `..` is not something to repair. It is something to
    // refuse and report.
    for (const path of [
      `${CASE_ID}/../${'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}/selfie.jpg`,
      `${CASE_ID}/verification/../../other/selfie.jpg`,
      `/${CASE_ID}/verification/a/x.jpg`,
    ]) {
      expect(mayDeleteObject({ bucket: 'aml-documents', path }, CASE_ID).allowed, path)
        .toBe(false);
    }
  });

  it('refuses a malformed reference', () => {
    expect(mayDeleteObject({ bucket: 'aml-documents', path: '' }, CASE_ID).allowed).toBe(false);
    expect(mayDeleteObject(null as any, CASE_ID).allowed).toBe(false);
    expect(mayDeleteObject(
      { bucket: 'aml-documents', path: 'x.jpg' } as any, '').allowed).toBe(false);
  });

  it('refuses a prefix that merely starts with the case id', () => {
    // `{caseId}-other/...` starts with the id but is not under its prefix.
    const result = mayDeleteObject(
      { bucket: 'aml-documents', path: `${CASE_ID}-other/selfie.jpg` }, CASE_ID);
    expect(result.allowed).toBe(false);
  });
});

/* ───────────────────── partial failure and the record ──────────────────── */

describe('a run that could not remove everything', () => {
  const object = (removed: boolean, n: number) => ({
    bucket: 'aml-documents', path: `${CASE_ID}/verification/a/${n}.jpg`, removed,
  });

  it('reports `deleted` only when every object went', () => {
    expect(cleanupStatusFor([object(true, 1), object(true, 2)])).toBe('deleted');
  });

  it('reports `partial` when some went', () => {
    expect(cleanupStatusFor([object(true, 1), object(false, 2)])).toBe('partial');
  });

  it('reports `failed` when none went', () => {
    expect(cleanupStatusFor([object(false, 1), object(false, 2)])).toBe('failed');
  });

  it('reports `failed` rather than success for an empty result', () => {
    expect(cleanupStatusFor([])).toBe('failed');
  });

  it('records what an auditor needs and nothing that could recover the image', () => {
    const record = buildRetentionRecord({
      retentionDays: 90,
      minimumRetentionDate: daysAgo(1),
      decidedAt: new Date(NOW).toISOString(),
      outcomes: [object(true, 1), object(false, 2)],
      reason: 'AML retention satisfied',
    });

    expect(record.policy_env).toBe(CAPTURE_RETENTION_ENV);
    expect(record.retention_days_used).toBe(90);
    expect(record.minimum_retention_date).toBeTruthy();
    expect(record.status).toBe('partial');
    expect(record.objects).toHaveLength(2);

    // A reference, never content: no base64, no signed URL, no name.
    const serialised = JSON.stringify(record);
    expect(serialised).not.toMatch(/base64|data:image|token=|signature=/i);
    expect(serialised.length).toBeLessThan(2000);
  });
});

/* ───────────────────────── the worker's boundaries ─────────────────────── */

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const WORKER = read('supabase/functions/aml-idv-retention/index.ts');
const MIGRATION = read('supabase/migrations/20260911000200_aml_idv_capture_retention.sql');

describe('only the server can destroy evidence', () => {
  it('accepts signed internal callers only', () => {
    expect(WORKER).toContain('verifySignedInternal');
    expect(WORKER).toContain("['pg_cron', 'aml-verification', 'aml-records']");
    // No portal session, no human auth, no browser route.
    expect(WORKER).not.toContain('x-portal-session-token');
    expect(WORKER).not.toContain('verifyPortalSession');
    expect(WORKER).not.toContain('verifyHuman');
  });

  it('takes no object, bucket, path or case from the request body', () => {
    // The ONLY thing read off the body is the dry-run flag. A caller cannot
    // name what to delete, which is what makes an arbitrary deletion request
    // unrepresentable rather than merely refused.
    const bodyReads = [...WORKER.matchAll(/body\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(bodyReads)]).toEqual(['dry_run']);
  });

  it('re-checks every object against the case before removing it', () => {
    expect(WORKER).toContain('mayDeleteObject(object, candidate.caseId)');
    const destroy = WORKER.slice(WORKER.indexOf('async function destroyCaptures'));
    expect(destroy.indexOf('mayDeleteObject'))
      .toBeLessThan(destroy.indexOf('.remove('));
  });

  it('removes only paths read off the verification row', () => {
    expect(WORKER).toContain('readCapturePlan(row)');
    expect(WORKER).toContain('candidate.objects');
  });

  it('offers a dry run that deletes nothing', () => {
    expect(WORKER).toContain('const dryRun = body.dry_run === true');
    expect(WORKER).toMatch(/if \(dryRun\) continue;/);
    // And the dry-run check sits before the destruction, not after it.
    expect(WORKER.indexOf('if (dryRun) continue;'))
      .toBeLessThan(WORKER.indexOf('await destroyCaptures('));
  });
});

describe('the schedule', () => {
  it('is daily and is not the verification processor', () => {
    expect(MIGRATION).toContain("'aml-idv-retention-daily'");
    expect(MIGRATION).toContain('cron_invoke_signed_function');
    // Daily, not the processor's every-minute cadence.
    expect(MIGRATION).toMatch(/'\d+ \d+ \* \* \*'/);
    expect(MIGRATION).not.toContain("'* * * * *'");
  });

  it('is idempotent and carries a rollback', () => {
    expect(MIGRATION).toContain('cron.unschedule');
    expect(MIGRATION).toContain('ADD COLUMN IF NOT EXISTS');
    expect(MIGRATION).toContain('ROLLBACK:');
  });

  it('fails loudly if the §18 table it depends on is absent', () => {
    expect(MIGRATION).toContain('retention_triggers');
    expect(MIGRATION).toContain('RAISE EXCEPTION');
  });
});
