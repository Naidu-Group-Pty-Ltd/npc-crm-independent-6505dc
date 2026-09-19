import { describe, expect, it } from 'vitest';
import {
  documentMetaLine,
  documentStatus,
  formatDocumentSize,
  formatDocumentType,
  formatUploadedDate,
  groupDocuments,
} from './documentPresentation';
import type { AmlPortalDocument } from './amlPortalApi';

/**
 * How an uploaded document reads to the customer.
 *
 * Pure formatting, tested on its own because this is where the small
 * embarrassing failures live: a nullable `size_bytes` rendered as "NaN MB", an
 * `application/octet-stream` shown verbatim to somebody wondering whether
 * their passport uploaded correctly, a raw `rejected` enum accusing them of
 * something.
 */

const doc = (over: Partial<AmlPortalDocument> = {}): AmlPortalDocument => ({
  id: 'doc-1',
  requirement_id: null,
  filename: 'passport.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1_887_437,
  status: 'uploaded',
  uploaded_at: '2026-08-11T02:00:00.000Z',
  rejection_reason: null,
  ...over,
});

describe('file size', () => {
  it('reads the way a person would say it', () => {
    expect(formatDocumentSize(1_887_437)).toBe('1.8 MB');
    expect(formatDocumentSize(655_360)).toBe('640 KB');
    expect(formatDocumentSize(24 * 1024 * 1024)).toBe('24 MB');
    expect(formatDocumentSize(512)).toBe('512 B');
  });

  it('omits the size rather than inventing one', () => {
    // `size_bytes` is nullable on the row. "0 B" would tell the customer their
    // file is empty, which is a different and alarming claim.
    for (const missing of [null, undefined, Number.NaN, -1]) {
      expect(formatDocumentSize(missing as number)).toBeNull();
    }
  });

  it('has a floor for a genuinely tiny file', () => {
    // A real 0-byte upload is a real thing; it just should not read as absent.
    expect(formatDocumentSize(0)).toBe('0 KB');
  });
});

describe('file type', () => {
  it('names the formats the portal accepts', () => {
    expect(formatDocumentType('application/pdf', 'a.pdf')).toBe('PDF');
    expect(formatDocumentType('image/jpeg', 'a.jpg')).toBe('JPEG');
    expect(formatDocumentType('image/png', 'a.png')).toBe('PNG');
  });

  it('tolerates a charset parameter and casing', () => {
    expect(formatDocumentType('APPLICATION/PDF; charset=binary', 'a.pdf')).toBe('PDF');
  });

  it('falls back to the extension, then to a plain word', () => {
    // `application/octet-stream` is what a browser sends when it does not
    // recognise the file. Showing it reads as "something is wrong with this".
    expect(formatDocumentType('application/octet-stream', 'statement.pdf')).toBe('PDF');
    expect(formatDocumentType(null, 'scan.tiff')).toBe('TIFF');
    expect(formatDocumentType('image/x-exotic', 'noextension')).toBe('Image');
    expect(formatDocumentType(null, 'noextension')).toBe('Document');
    expect(formatDocumentType(null, null)).toBe('Document');
  });
});

describe('upload time', () => {
  const now = new Date('2026-08-11T02:00:30.000Z');

  it('says "just now" in the minute that matters most', () => {
    // The second after an upload is exactly when the customer is looking for
    // confirmation; a date stamp there reads as though it has been sitting.
    expect(formatUploadedDate('2026-08-11T02:00:00.000Z', now)).toBe('Uploaded just now');
  });

  it('counts minutes for the first hour, then shows the date', () => {
    expect(formatUploadedDate('2026-08-11T01:58:00.000Z', now)).toBe('Uploaded 2 minutes ago');
    expect(formatUploadedDate('2026-08-11T01:59:20.000Z', now)).toBe('Uploaded 1 minute ago');
    expect(formatUploadedDate('2026-08-09T01:00:00.000Z', now)).toMatch(/^Uploaded \d+ \w+ 2026$/);
  });

  it('never reports an upload in the future', () => {
    // Clock skew between the browser and the server must not put "in 3
    // minutes" on a compliance record.
    const skewed = formatUploadedDate('2026-08-11T02:05:00.000Z', now);
    expect(skewed).toMatch(/^Uploaded \d+ \w+ 2026$/);
  });

  it('omits the date rather than printing Invalid Date', () => {
    expect(formatUploadedDate(null)).toBeNull();
    expect(formatUploadedDate('not-a-date')).toBeNull();
  });
});

describe('status language', () => {
  it('translates every stored value into something a customer can act on', () => {
    // Stored vocabulary: uploaded | accepted | rejected | superseded
    // (`deleted` is filtered server-side and never arrives).
    expect(documentStatus('uploaded').label).toBe('Received');
    expect(documentStatus('accepted').label).toBe('Accepted');
    expect(documentStatus('rejected').label).toBe('Needs attention');
    expect(documentStatus('superseded').label).toBe('Replaced');
  });

  it('never accuses the customer', () => {
    expect(documentStatus('rejected').label).not.toMatch(/reject|fail|invalid/i);
    expect(documentStatus('rejected').needsAttention).toBe(true);
  });

  it('falls back safely for a value a future migration adds', () => {
    // A raw enum on the page is worse than a slightly vague word.
    expect(documentStatus('quarantined').label).toBe('Received');
    expect(documentStatus(null).label).toBe('Received');
  });
});

describe('the metadata line', () => {
  it('reads as one sentence of facts', () => {
    expect(documentMetaLine(doc(), new Date('2026-08-12T02:00:00.000Z')))
      .toBe('PDF · 1.8 MB · Uploaded 11 Aug 2026');
  });

  it('drops parts it does not know instead of printing a placeholder', () => {
    expect(documentMetaLine(doc({ size_bytes: null, uploaded_at: '' as unknown as string })))
      .toBe('PDF');
  });
});

describe('grouping', () => {
  const requirementDoc = doc({ id: 'a', requirement_id: 'req-1', filename: 'licence.pdf' });
  const olderRequirementDoc = doc({ id: 'b', requirement_id: 'req-1', filename: 'old.pdf' });
  const freeform = doc({ id: 'c', requirement_id: null, filename: 'bank.pdf' });

  it('puts requirement-linked documents under their requirement', () => {
    const { byRequirement, additional } = groupDocuments(
      [requirementDoc, olderRequirementDoc, freeform], ['req-1']);
    expect(byRequirement.get('req-1')?.map((d) => d.id)).toEqual(['a', 'b']);
    expect(additional.map((d) => d.id)).toEqual(['c']);
  });

  it('preserves the server order, so the current document is first', () => {
    // `list_documents` orders by `uploaded_at` descending, and replacing a
    // document inserts a row rather than rewriting one — so "newest first" is
    // what makes the top entry the current one. Re-sorting here would be a
    // second opinion about which document counts.
    const { byRequirement } = groupDocuments([requirementDoc, olderRequirementDoc], ['req-1']);
    expect(byRequirement.get('req-1')?.[0].id).toBe('a');
  });

  it('never loses a document whose requirement this case does not have', () => {
    /*
     * A requirement can be deleted (`ON DELETE SET NULL`) or belong elsewhere.
     * Sweeping the document into "additional" keeps it visible; filtering on
     * requirement membership would make it disappear, which is the exact
     * failure this screen exists to fix.
     */
    const orphan = doc({ id: 'd', requirement_id: 'req-gone' });
    const { additional } = groupDocuments([orphan], ['req-1']);
    expect(additional.map((d) => d.id)).toEqual(['d']);
  });

  it('handles a case with no requirements at all', () => {
    const { byRequirement, additional } = groupDocuments([freeform]);
    expect(byRequirement.size).toBe(0);
    expect(additional).toHaveLength(1);
  });
});
