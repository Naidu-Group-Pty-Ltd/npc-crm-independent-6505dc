import { describe, expect, it } from 'vitest';
import {
  formatGoldenRegressionScore,
  getGoldenRegressionDisplayState,
} from '../ingestion/goldenCorpus';

describe('getGoldenRegressionDisplayState', () => {
  it('pass status → Pass / success / none', () => {
    const s = getGoldenRegressionDisplayState({ qualityGateStatus: 'pass', operatorDecision: 'accepted' });
    expect(s).toMatchObject({ label: 'Pass', tone: 'success', actionRequired: 'none' });
  });

  it('warning status → Warning / warning / review', () => {
    const s = getGoldenRegressionDisplayState({ qualityGateStatus: 'warning' });
    expect(s).toMatchObject({ label: 'Warning', tone: 'warning', actionRequired: 'review' });
  });

  it('fail status → Fail / destructive / fix', () => {
    const s = getGoldenRegressionDisplayState({ qualityGateStatus: 'fail' });
    expect(s).toMatchObject({ label: 'Fail', tone: 'destructive', actionRequired: 'fix' });
  });

  it('blocked status → Blocked / destructive / rerun', () => {
    const s = getGoldenRegressionDisplayState({ qualityGateStatus: 'blocked' });
    expect(s).toMatchObject({ label: 'Blocked', tone: 'destructive', actionRequired: 'rerun' });
  });

  it('failureCount > 0 overrides a passing gate status', () => {
    const s = getGoldenRegressionDisplayState({ qualityGateStatus: 'pass', failureCount: 2 });
    expect(s).toMatchObject({ label: 'Fail', actionRequired: 'fix' });
  });

  it('needs_rerun decision → rerun', () => {
    const s = getGoldenRegressionDisplayState({ qualityGateStatus: 'warning', operatorDecision: 'needs_rerun' });
    expect(s.actionRequired).toBe('rerun');
  });

  it('rejected decision → fix', () => {
    const s = getGoldenRegressionDisplayState({ operatorDecision: 'rejected' });
    expect(s.actionRequired).toBe('fix');
  });

  it.each(['not_reviewed', 'accepted_with_warnings'])(
    '%s decision overrides a passing gate status and requires review',
    (operatorDecision) => {
      const s = getGoldenRegressionDisplayState({ qualityGateStatus: 'pass', operatorDecision });
      expect(s).toMatchObject({ label: 'Review', tone: 'warning', actionRequired: 'review' });
    },
  );

  it('accepted decision does not override a not-evaluated gate status', () => {
    const s = getGoldenRegressionDisplayState({
      qualityGateStatus: 'not_evaluated',
      operatorDecision: 'accepted',
    });
    expect(s).toMatchObject({ label: 'Not evaluated', tone: 'outline', actionRequired: 'review' });
  });

  it('export parity manual_required → review', () => {
    const s = getGoldenRegressionDisplayState({ qualityGateStatus: 'pass', exportParityStatus: 'manual_required' });
    expect(s).toMatchObject({ label: 'Review', actionRequired: 'review' });
  });

  it('manualReviewRequired true → review', () => {
    const s = getGoldenRegressionDisplayState({ qualityGateStatus: 'pass', manualReviewRequired: true });
    expect(s).toMatchObject({ label: 'Review', actionRequired: 'review' });
  });

  it('not_evaluated → Not evaluated', () => {
    const s = getGoldenRegressionDisplayState({ qualityGateStatus: 'not_evaluated' });
    expect(s).toMatchObject({ label: 'Not evaluated', tone: 'outline', actionRequired: 'review' });
  });

  it('empty input → Not run', () => {
    const s = getGoldenRegressionDisplayState({});
    expect(s).toMatchObject({ label: 'Not run', tone: 'outline', actionRequired: 'review' });
  });
});

describe('formatGoldenRegressionScore', () => {
  it('formats 0.91 as 91%', () => {
    expect(formatGoldenRegressionScore(0.91)).toBe('91%');
  });

  it('returns — for null/undefined/NaN', () => {
    expect(formatGoldenRegressionScore(null)).toBe('—');
    expect(formatGoldenRegressionScore(undefined)).toBe('—');
    expect(formatGoldenRegressionScore(Number.NaN)).toBe('—');
  });
});
