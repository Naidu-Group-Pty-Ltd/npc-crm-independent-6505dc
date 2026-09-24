/**
 * Commercial & Industrial Capacity Reports on the client's Reports tab.
 *
 * They were absent from it altogether (`docs/commercial/MODULE_STRUCTURE.md`
 * G5). They join as a sixth source, appended after the five, so no existing
 * row moves; they download through `manage-ci-assessments` rather than
 * `secure-storage`, so they carry no file reference; and they are not offered
 * for the portal — with a reason that is true, rather than the "nothing has
 * been generated" a missing file reference would otherwise have produced.
 */

import { describe, expect, it } from 'vitest';
import {
  buildClientReportInventory,
  publishVerdict,
  publishableReports,
  type InventorySources,
} from '../clientReportInventory.pure';
import type { ListedDocument } from '../../ciAssessment/issuedDocuments';

const DOC: ListedDocument = {
  ledger: 'template', id: 'j1', assessmentId: 'a1', state: 'ready',
  fileName: 'commercial_capacity-CI-1.pdf', createdAt: '2026-09-23T09:00:00Z',
  pageCount: 7, bytes: 90_000, hasAnalysis: null, analysisNote: null, templateName: 'Harbour',
  error: null, clientId: 'c1', downloadable: true,
  assessmentReference: 'CI-202609-K7Q2M', assessmentTitle: 'G12/25 Solent Circuit',
};

const EMPTY: InventorySources = {
  reportFiles: [], investmentReports: [], portfolioReports: [], bcAssessments: [], portalReports: [],
};

const formatDate = (iso: string) => iso.slice(0, 10);

describe('Commercial & Industrial reports in the client inventory', () => {
  it('are appended after the five existing sources, which keep their order', () => {
    const reports = buildClientReportInventory({
      ...EMPTY,
      portalReports: [{ id: 'p1', report_title: 'Published', storage_path: 'x/y.pdf', published_at: '2026-09-01T00:00:00Z' }],
      ciDocuments: [DOC],
    }, formatDate);
    expect(reports.map((r) => r.source)).toEqual(['portal_report', 'ci_document']);
  });

  it('are absent when the source is not given — a workspace without the module', () => {
    expect(buildClientReportInventory(EMPTY, formatDate)).toEqual([]);
  });

  it('carry their own identity per ledger, and no file reference', () => {
    const [row] = buildClientReportInventory({ ...EMPTY, ciDocuments: [DOC] }, formatDate);
    expect(row).toMatchObject({
      id: 'ci-template-j1',
      type: 'commercial',
      source: 'ci_document',
      fileUrl: null,
      status: 'completed',
      name: 'Commercial & Industrial Capacity – G12/25 Solent Circuit',
    });
    expect(row.ciDocument).toBe(DOC);
  });

  it('read a failed or unfinished render as the inventory’s own states', () => {
    const rows = buildClientReportInventory({
      ...EMPTY,
      ciDocuments: [
        { ...DOC, id: 'f', state: 'failed', downloadable: false },
        { ...DOC, id: 'd', state: 'did_not_finish', downloadable: false },
        { ...DOC, id: 'g', state: 'in_progress', downloadable: false },
      ],
    }, formatDate);
    expect(rows.map((r) => r.status)).toEqual(['failed', 'failed', 'pending']);
  });

  it('are not offered for the portal, and say so truthfully', () => {
    const [row] = buildClientReportInventory({ ...EMPTY, ciDocuments: [DOC] }, formatDate);
    const verdict = publishVerdict(row, new Map());
    expect(verdict.readiness).toBe('unavailable');
    expect(verdict.reason).toMatch(/not published to the portal/i);
    expect(verdict.reason).not.toMatch(/generated/i);
    expect(publishableReports([row], new Map())).toEqual([]);
  });
});
