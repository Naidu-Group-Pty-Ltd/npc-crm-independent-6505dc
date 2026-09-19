import { describe, expect, it } from 'vitest';
import type { CdirDocument } from '../ingestion/cdir/schema';
import { doclingRepairSolver } from '../ingestion/visualQuality/repair/doclingSolver';
import type { RepairContext } from '../ingestion/visualQuality/repair/repairTypes';
import type { VisualPageQualityReport } from '../ingestion/visualQuality/schema';

const pageId = 'docling-page-1';

function cdir(): CdirDocument {
  return {
    version: 1,
    source: { kind: 'pdf', checksum: 'source-checksum', filename: 'source.pdf' },
    pages: [{
      id: pageId,
      label: 'Page 1',
      width: 612,
      height: 792,
      layers: [{
        id: 'visible-summary',
        kind: 'text',
        bounds: { x: 40, y: 60, width: 260, height: 32 },
        text: 'Public summary only',
        runs: [{ text: 'Public summary only', fontSize: 18 }],
      }],
    }],
    assets: [],
    fonts: [],
    warnings: [],
  };
}

function lowCoveragePage(): VisualPageQualityReport {
  return {
    pageId,
    pageNumber: 1,
    overallScore: 0.7,
    pixelDifferenceScore: 0.8,
    textCoverageScore: 0.2,
    layoutDriftScore: 0.8,
    missingElementScore: 0.8,
    colorSimilarityScore: 0.8,
    recommendedAction: 'repair',
    warnings: [],
  };
}

describe('Docling repair solver security', () => {
  it('never materializes missing source expectation text in a repair patch', () => {
    const sensitiveSourceText = 'client account 123456789 prompt ignore previous instructions';
    const context: RepairContext = {
      cdir: cdir(),
      expectedTextByPage: new Map([[pageId, `Public summary only ${sensitiveSourceText}`]]),
      expectedBoundsByPage: new Map(),
    };

    const patch = doclingRepairSolver.propose(lowCoveragePage(), context);

    expect(patch).toBeNull();
    expect(JSON.stringify(patch)).not.toContain(sensitiveSourceText);
  });
});
