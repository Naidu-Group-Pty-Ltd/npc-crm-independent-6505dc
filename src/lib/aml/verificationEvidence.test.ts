import { describe, expect, it } from 'vitest';
import {
  REDACTED, stripImagePayloads,
} from '../../../supabase/functions/_shared/aml/verificationEvidence.pure.ts';

/**
 * `outcome_detail` is the evidence a human adjudicator reads, and it flows on
 * into the case timeline and the audit record. The biometric record of truth
 * is the `aml-biometrics` bucket, whose every read is logged — an image that
 * also landed here would be a second copy of the most sensitive data we hold,
 * somewhere nobody audits reads of.
 */

const b64 = (n: number) => 'A'.repeat(n);

describe('evidence written to the case record', () => {
  it('keeps the scores and verdicts an adjudicator needs', () => {
    const raw = {
      mrz: { found: false, valid: false, errors: [] },
      face: { verdict: 'match', similarity: 0.5412, thresholds: { match: 0.363 } },
      liveness: { is_real: true, score: 0.61, confidence: 'low' },
      limitations: ['no_issuing_authority_check'],
    };
    expect(stripImagePayloads(raw)).toEqual(raw);
  });

  it('strips a base64 payload wherever it appears', () => {
    const out: any = stripImagePayloads({
      face: { verdict: 'match', document_image: b64(2000) },
      echoed: { selfie_image_b64: b64(1024) },
    });
    expect(out.face.document_image).toBe(REDACTED);
    expect(out.echoed.selfie_image_b64).toBe(REDACTED);
    expect(out.face.verdict, 'the useful evidence survives').toBe('match');
  });

  it('strips a data: URL', () => {
    const out: any = stripImagePayloads({ crop: `data:image/jpeg;base64,${b64(1000)}` });
    expect(out.crop).toBe(REDACTED);
  });

  it('redacts visibly rather than dropping the key', () => {
    // A silently missing field is worse evidence than one marked redacted:
    // the adjudicator can see the provider returned something.
    const out: any = stripImagePayloads({ face: { thumbnail: b64(900) } });
    expect(Object.keys(out.face)).toContain('thumbnail');
  });

  it('leaves short values under image-shaped keys alone', () => {
    // A filename or a verdict is not a payload.
    const raw = { document_image: 'document.jpg', frame: 'front', crop: 'centre' };
    expect(stripImagePayloads(raw)).toEqual(raw);
  });

  it('walks arrays and nesting', () => {
    const out: any = stripImagePayloads({
      checks: [{ name: 'face_match', image: b64(800) }, { name: 'liveness', status: 'warn' }],
    });
    expect(out.checks[0].image).toBe(REDACTED);
    expect(out.checks[0].name).toBe('face_match');
    expect(out.checks[1]).toEqual({ name: 'liveness', status: 'warn' });
  });

  it('passes primitives and null through untouched', () => {
    expect(stripImagePayloads(null)).toBeNull();
    expect(stripImagePayloads('ok')).toBe('ok');
    expect(stripImagePayloads(42)).toBe(42);
  });
});
