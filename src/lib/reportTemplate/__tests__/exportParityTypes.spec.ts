import { describe, expect, it } from 'vitest';
import {
  EXPORT_PARITY_SUMMARY_VERSION,
  isValidExportParityMode,
  isValidExportParityStatus,
} from '../ingestion/exportParity';

describe('exportParityTypes', () => {
  it('pins the summary version tag', () => {
    expect(EXPORT_PARITY_SUMMARY_VERSION).toBe('export-parity-summary-v1');
  });

  it('accepts only known statuses', () => {
    for (const status of ['not_run', 'completed', 'manual_required', 'failed']) {
      expect(isValidExportParityStatus(status)).toBe(true);
    }
  });

  it('rejects unknown / malformed statuses', () => {
    for (const value of ['pending', 'COMPLETED', '', null, undefined, 3, {}]) {
      expect(isValidExportParityStatus(value)).toBe(false);
    }
  });

  it('accepts only known modes', () => {
    for (const mode of ['manual', 'automated', 'hybrid']) {
      expect(isValidExportParityMode(mode)).toBe(true);
    }
  });

  it('rejects unknown / malformed modes', () => {
    for (const value of ['auto', 'Manual', '', null, undefined, 1, []]) {
      expect(isValidExportParityMode(value)).toBe(false);
    }
  });
});
