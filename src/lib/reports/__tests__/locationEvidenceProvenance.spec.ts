import { describe, expect, it } from 'vitest';

import corpus from '@/lib/reports/__tests__/fixtures/locationEvidenceCorpus.json';
import {
  classifyLocationEvidence,
  commuteIsMisdirected,
  FABRICATED_COMMUTE_MODE,
  NON_EVIDENCE_PROVENANCE,
  PLACES_PAGE_CEILING,
  TEMPLATED_STOP_LABELS,
  TEMPLATED_TRANSPORT_KEYS,
  TRANSPORT_TEMPLATE_DEFAULT_LABEL,
  usesTransportTemplate,
  type GeographyContext,
  type LocationProvenance,
} from '@/lib/reports/location/locationEvidenceProvenance.pure';

/**
 * ME-5 item 6 — the Location contamination audit.
 *
 * The fixture is 23 VERBATIM `investment_reports.location_intelligence` objects
 * taken from production on 8 September 2026, stratified over the four shapes the
 * corpus actually contains. The `bucket` label on each row is how the database
 * query classified it; the module reaches its verdict by a different route (the
 * object's shape plus the resolved geography), so agreement between them is a
 * real check rather than a restatement.
 */

interface Row {
  reportId: string;
  bucket: string;
  geography: { status: string; state: string | null; suburb: string | null };
  locationIntelligence: Record<string, unknown>;
  /** What `report_location_provenance` holds for this report, read back from production. */
  storedProvenance: {
    transportShape: string;
    walkScore: string;
    commute: string;
    wholeObjectNonEvidence: boolean;
  };
}

const rows = corpus as unknown as Row[];
const geo = (r: Row): GeographyContext => ({
  status: r.geography.status as GeographyContext['status'],
  state: r.geography.state,
});
const provenanceOf = (r: Row, field: string): LocationProvenance | undefined =>
  classifyLocationEvidence(r.locationIntelligence, geo(r)).fields
    .find((f) => f.field === field)?.provenance;

describe('location evidence provenance', () => {
  it('has a stratified fixture of real production objects', () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(new Set(rows.map((r) => r.bucket))).toEqual(new Set([
      'offshore', 'templated_and_misdirected', 'templated_own_capital', 'google_branch',
    ]));
  });

  describe('the transport template is detected by shape, not by date', () => {
    it('agrees with the database on every row', () => {
      for (const r of rows) {
        const expected = r.bucket.startsWith('templated') || r.bucket === 'offshore'
          ? r.locationIntelligence.transport !== undefined
            && 'distanceToStop' in (r.locationIntelligence.transport as object)
          : false;
        expect(usesTransportTemplate(r.locationIntelligence)).toBe(expected);
      }
    });

    it('marks every templated transport key as non-evidence, not just distanceToStop', () => {
      const templated = rows.filter((r) => usesTransportTemplate(r.locationIntelligence));
      expect(templated.length).toBeGreaterThan(0);
      for (const r of templated) {
        for (const key of TEMPLATED_TRANSPORT_KEYS) {
          if ((r.locationIntelligence.transport as Record<string, unknown>)[key] === undefined) continue;
          expect(provenanceOf(r, `transport.${key}`)).toBe('legacy_non_evidence');
        }
      }
    });

    it('names the five per-state labels and the one that is the fallback', () => {
      expect(TEMPLATED_STOP_LABELS).toContain(TRANSPORT_TEMPLATE_DEFAULT_LABEL);
      expect(TEMPLATED_STOP_LABELS).toHaveLength(5);
    });
  });

  describe('a template and a misdirected measurement are different faults', () => {
    it('calls a REAL commute sent to Sydney misdirected and recoverable', () => {
      const misdirected = rows.filter((r) => r.bucket === 'templated_and_misdirected');
      expect(misdirected.length).toBeGreaterThan(0);
      let seen = 0;
      for (const r of misdirected) {
        expect(commuteIsMisdirected(r.locationIntelligence, geo(r))).toBe(true);
        const li = r.locationIntelligence as Record<string, Record<string, unknown>>;
        if (li.commute?.mode === FABRICATED_COMMUTE_MODE) continue;
        const commute = classifyLocationEvidence(r.locationIntelligence, geo(r))
          .fields.find((f) => f.field === 'commute.distanceKm');
        expect(commute?.provenance).toBe('measured_misdirected');
        // The distinction that matters: this one can be repaired from the coordinate.
        expect(commute?.recoverable).toBe(true);
        seen += 1;
      }
      expect(seen).toBeGreaterThan(0);
    });

    it('a fabricated commute outranks the misdirection — nothing was measured to misdirect', () => {
      const fabricated = rows.filter((r) =>
        (r.locationIntelligence as Record<string, Record<string, unknown>>)
          .commute?.mode === FABRICATED_COMMUTE_MODE
        && r.bucket !== 'offshore');
      expect(fabricated.length).toBeGreaterThan(0);
      for (const r of fabricated) {
        const commute = classifyLocationEvidence(r.locationIntelligence, geo(r))
          .fields.find((f) => f.field === 'commute.distanceKm');
        expect(commute?.provenance).toBe('legacy_non_evidence');
        // There is no route to recompute a route from.
        expect(commute?.recoverable).toBe(false);
        expect(commute?.reason).toMatch(/straight-line/);
      }
    });

    it('never calls a template recoverable — there is nothing to recompute it from', () => {
      for (const r of rows) {
        for (const f of classifyLocationEvidence(r.locationIntelligence, geo(r)).fields) {
          if (f.provenance === 'legacy_non_evidence') expect(f.recoverable).toBe(false);
        }
      }
    });

    it('leaves a commute to the property’s own capital as measured', () => {
      const own = rows.filter((r) => r.bucket === 'templated_own_capital');
      expect(own.length).toBeGreaterThan(0);
      for (const r of own) {
        expect(commuteIsMisdirected(r.locationIntelligence, geo(r))).toBe(false);
      }
    });
  });

  describe('an offshore coordinate makes the whole object non-evidence', () => {
    it('classifies every field of an offshore object as offshore', () => {
      const offshore = rows.filter((r) => r.bucket === 'offshore');
      expect(offshore.length).toBeGreaterThan(0);
      for (const r of offshore) {
        const report = classifyLocationEvidence(r.locationIntelligence, geo(r));
        expect(report.wholeObjectIsNonEvidence).toBe(true);
        expect(report.walkScore.provenance).toBe('offshore');
        for (const f of report.fields) {
          expect(NON_EVIDENCE_PROVENANCE.has(f.provenance)).toBe(true);
        }
      }
    });

    it('takes precedence over the template — an offshore row is not merely templated', () => {
      const offshoreTemplated = rows.filter(
        (r) => r.bucket === 'offshore' && usesTransportTemplate(r.locationIntelligence));
      expect(offshoreTemplated.length).toBeGreaterThan(0);
      for (const r of offshoreTemplated) {
        expect(provenanceOf(r, 'coordinates')).toBe('offshore');
      }
    });
  });

  describe('the walk score', () => {
    it('is non-evidence wherever the transport template fed it', () => {
      const templated = rows.filter(
        (r) => usesTransportTemplate(r.locationIntelligence) && r.bucket !== 'offshore');
      expect(templated.length).toBeGreaterThan(0);
      for (const r of templated) {
        expect(classifyLocationEvidence(r.locationIntelligence, geo(r)).walkScore.provenance)
          .toBe('legacy_non_evidence');
      }
    });

    it('is capped rather than fabricated on the Google branch', () => {
      const google = rows.filter((r) => r.bucket === 'google_branch');
      expect(google.length).toBeGreaterThan(0);
      for (const r of google) {
        expect(classifyLocationEvidence(r.locationIntelligence, geo(r)).walkScore.provenance)
          .toBe('measured_capped');
      }
    });

    it('is always classified, on every row, present or not', () => {
      for (const r of rows) {
        expect(classifyLocationEvidence(r.locationIntelligence, geo(r)).walkScore.field)
          .toBe('walkScore');
      }
    });
  });

  describe('a ceiling is disclosed, and a failed read is not an empty area', () => {
    it('calls a non-zero radius count capped rather than measured', () => {
      const onshore = rows.filter((r) => r.bucket !== 'offshore');
      const seen = onshore.map((r) => provenanceOf(r, 'schools.schoolsWithin3km'))
        .filter(Boolean);
      expect(seen.length).toBeGreaterThan(0);
      for (const p of seen) expect(['measured_capped', 'read_failed']).toContain(p);
      expect(PLACES_PAGE_CEILING).toBe(10);
    });

    it('never reports a zero distance beside an “N/A” name as a measurement', () => {
      for (const r of rows) {
        const li = r.locationIntelligence as Record<string, Record<string, unknown>>;
        if (li.schools?.nearestSchool !== 'N/A') continue;
        expect(provenanceOf(r, 'schools.nearestSchool')).toBe('read_failed');
        expect(provenanceOf(r, 'schools.distanceToSchool')).toBe('read_failed');
      }
    });
  });

  describe('the vocabulary keeps the kinds apart', () => {
    it('treats only the four unusable kinds as non-evidence', () => {
      expect([...NON_EVIDENCE_PROVENANCE].sort()).toEqual([
        'legacy_non_evidence', 'measured_misdirected', 'offshore', 'read_failed',
      ]);
      // A capped or unverified-class measurement is disclosed, not discarded.
      expect(NON_EVIDENCE_PROVENANCE.has('measured_capped')).toBe(false);
      expect(NON_EVIDENCE_PROVENANCE.has('measured_unverified_class')).toBe(false);
    });

    it('gives every field a reason a reader can act on', () => {
      for (const r of rows) {
        for (const f of classifyLocationEvidence(r.locationIntelligence, geo(r)).fields) {
          expect(f.reason.trim().length).toBeGreaterThan(20);
        }
      }
    });
  });

  describe('the stored quarantine and this module agree', () => {
    /**
     * `report_location_provenance` is materialised in SQL and this module is
     * TypeScript, so the two are independent implementations of one rule. These
     * assertions are what stops them drifting: they compare the module's verdict
     * against the row production actually holds, for all 23 real reports.
     */
    it('reproduces the stored transport shape', () => {
      for (const r of rows) {
        const templated = usesTransportTemplate(r.locationIntelligence);
        const shape = templated
          ? 'state_template'
          : (r.locationIntelligence.transport as Record<string, unknown> | undefined)
              ?.distanceToStation !== undefined
            ? 'places_measured'
            : 'absent';
        expect(shape).toBe(r.storedProvenance.transportShape);
      }
    });

    it('reproduces the stored walk-score and commute verdicts', () => {
      for (const r of rows) {
        const report = classifyLocationEvidence(r.locationIntelligence, geo(r));
        expect(report.walkScore.provenance).toBe(r.storedProvenance.walkScore);
        const commute = report.fields.find((f) => f.field === 'commute.distanceKm');
        expect(commute?.provenance).toBe(r.storedProvenance.commute);
      }
    });

    it('reproduces the stored whole-object verdict', () => {
      for (const r of rows) {
        expect(classifyLocationEvidence(r.locationIntelligence, geo(r)).wholeObjectIsNonEvidence)
          .toBe(r.storedProvenance.wholeObjectNonEvidence);
      }
    });
  });
});
