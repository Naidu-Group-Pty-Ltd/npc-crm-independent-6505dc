import { describe, expect, it } from 'vitest';
import { shouldAutoRunVisualQa } from '../ingestion/visualQuality';

describe('Phase 6C — shouldAutoRunVisualQa gate', () => {
  it('runs when the import produced source rasters to diff against', () => {
    expect(shouldAutoRunVisualQa({ renderArtifactManifest: { sourceRasterCount: 4 } })).toBe(true);
    expect(shouldAutoRunVisualQa({ renderArtifactManifest: { sourceRasterCount: 1 } })).toBe(true);
  });

  it('skips when there are no source rasters (diff impossible)', () => {
    expect(shouldAutoRunVisualQa({ renderArtifactManifest: { sourceRasterCount: 0 } })).toBe(false);
    expect(shouldAutoRunVisualQa({ renderArtifactManifest: { sourceRasterCount: null } })).toBe(false);
    expect(shouldAutoRunVisualQa({ renderArtifactManifest: {} })).toBe(false);
  });

  it('is null-safe for missing manifests', () => {
    expect(shouldAutoRunVisualQa(null)).toBe(false);
    expect(shouldAutoRunVisualQa(undefined)).toBe(false);
    expect(shouldAutoRunVisualQa({ renderArtifactManifest: null })).toBe(false);
  });
});
