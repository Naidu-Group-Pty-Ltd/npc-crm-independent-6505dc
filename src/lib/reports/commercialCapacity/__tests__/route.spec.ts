/**
 * The request, the filename and the path.
 *
 * Small, and the parts with a contract to keep. The filename lands in somebody's
 * downloads folder and the path decides whether a second render can overwrite a
 * file a client already holds a link to.
 */

import { describe, expect, it } from 'vitest';
import {
  capacityFileName,
  capacityStoragePath,
  isReportable,
  parseCapacityRequest,
  REPORTABLE_STATUSES,
} from '../route.pure';

const UUID = '4f2c9a1e-8b7d-4c3a-9e51-2d6f8a0b1c34';

describe('parseCapacityRequest', () => {
  it('accepts an assessment id and nothing else it was not asked for', () => {
    const parsed = parseCapacityRequest({
      assessmentId: UUID,
      // Everything the document says is read server-side. A caller that sends
      // these is a caller trying to write its own report.
      clientName: 'Somebody Else',
      capacity: 9_999_999,
      html: '<h1>hello</h1>',
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request).toEqual({
      assessmentId: UUID,
      includeAnalysis: true,
      refreshAnalysis: false,
      edition: null,
    });
    expect(Object.keys(parsed.request)).not.toContain('clientName');
  });

  it.each([
    ['no body', null],
    ['a string', 'hello'],
    ['no id', {}],
    ['a non-uuid id', { assessmentId: 'not-a-uuid' }],
    ['an empty id', { assessmentId: '   ' }],
  ])('refuses %s', (_label, body) => {
    expect(parseCapacityRequest(body).ok).toBe(false);
  });

  it('treats a silent caller as wanting the whole document', () => {
    const parsed = parseCapacityRequest({ assessmentId: UUID });
    expect(parsed.ok && parsed.request.includeAnalysis).toBe(true);
  });

  it('turns the analysis off only on an explicit false', () => {
    for (const value of [0, '', 'false', null, undefined]) {
      const parsed = parseCapacityRequest({ assessmentId: UUID, includeAnalysis: value });
      expect(parsed.ok && parsed.request.includeAnalysis, String(value)).toBe(true);
    }
    const off = parseCapacityRequest({ assessmentId: UUID, includeAnalysis: false });
    expect(off.ok && off.request.includeAnalysis).toBe(false);
  });

  it('bounds the edition string', () => {
    const parsed = parseCapacityRequest({ assessmentId: UUID, edition: 'x'.repeat(500) });
    expect(parsed.ok && parsed.request.edition!.length).toBe(40);
  });
});

describe('capacityFileName', () => {
  it('is built from the assessment reference, not a client name', () => {
    // A folder of `..._Client_2026-08-05.pdf` files that are all different
    // assessments is a folder nobody can use — and this document's subject may
    // be a standalone assessment with no client at all.
    expect(capacityFileName('CI-2026-0184', '2026-08-05T01:02:00.000Z'))
      .toBe('Commercial_Capacity_Report_CI_2026_0184_2026-08-05.pdf');
  });

  it('replaces every non-alphanumeric character, one for one', () => {
    // The Snapshot's rule, kept exactly, so the two documents sort together.
    expect(capacityFileName('A. & J.', '2026-08-05')).toContain('A____J_');
  });

  it('names something even with nothing to name it after', () => {
    expect(capacityFileName('', '2026-08-05')).toBe('Commercial_Capacity_Report_Assessment_2026-08-05.pdf');
    expect(capacityFileName('CI-1', 'not a date')).toBe('Commercial_Capacity_Report_CI_1_.pdf');
  });
});

describe('capacityStoragePath', () => {
  it('files under the assessment, the day and a unique segment', () => {
    expect(capacityStoragePath(UUID, 'report.pdf', '2026-08-05T01:02:00.000Z', 'abc123'))
      .toBe(`commercial-capacity/${UUID}/2026-08-05/abc123-report.pdf`);
  });

  it('never produces the same path twice for the same day', () => {
    // Without the unique segment a second render either overwrites the first or
    // needs `upsert`, and overwriting a document somebody may already have a
    // link to is not a thing to do quietly.
    const a = capacityStoragePath(UUID, 'r.pdf', '2026-08-05', 'one');
    const b = capacityStoragePath(UUID, 'r.pdf', '2026-08-05', 'two');
    expect(a).not.toBe(b);
  });

  it('files an undated render somewhere findable rather than at the root', () => {
    expect(capacityStoragePath(UUID, 'r.pdf', '', 'x')).toContain('/undated/');
  });
});

describe('isReportable', () => {
  it('admits a completed assessment, and one completed then linked', () => {
    // `linked` is completion plus a client, not a step before it.
    expect(REPORTABLE_STATUSES).toEqual(['completed', 'linked']);
    expect(isReportable('completed')).toBe(true);
    expect(isReportable('linked')).toBe(true);
  });

  it.each(['draft', 'data_entry', 'ready_to_calculate', 'calculated', 'requires_review', 'archived'])(
    'refuses %s',
    (status) => {
      // A draft's figures change under the reader's feet, and a PDF of them is
      // a document that was never true for longer than a moment. Enforced here
      // as well as in the UI, so a stale tab cannot get round it.
      expect(isReportable(status)).toBe(false);
    },
  );

  it('refuses anything that is not a status at all', () => {
    expect(isReportable(undefined)).toBe(false);
    expect(isReportable(null)).toBe(false);
    expect(isReportable(1)).toBe(false);
  });
});
