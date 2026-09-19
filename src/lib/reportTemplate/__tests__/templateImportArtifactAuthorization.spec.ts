import { describe, expect, it } from 'vitest';

import {
  isAllowedTemplateImportMetaPatch,
  isTemplateImportArtifactPathOwnedByImport,
} from '../../../../supabase/functions/_shared/templateImportArtifactAuthorization.pure';

describe('template import artifact authorization', () => {
  it('allows supported audit metadata without allowing artifact path mutation', () => {
    expect(isAllowedTemplateImportMetaPatch({ provider_attempts: [] })).toBe(true);
    expect(isAllowedTemplateImportMetaPatch({ repair_pattern_analysis: { version: 1 } })).toBe(true);
    expect(isAllowedTemplateImportMetaPatch({ cdir_artifact_path: 'victim/cdir.json' })).toBe(false);
    expect(isAllowedTemplateImportMetaPatch({ provider_attempts: [], status: 'completed' })).toBe(false);
    expect(isAllowedTemplateImportMetaPatch([])).toBe(false);
  });

  it('accepts only artifacts nested under the requested import prefix', () => {
    expect(isTemplateImportArtifactPathOwnedByImport('import-1/cdir.json', 'import-1')).toBe(true);
    expect(isTemplateImportArtifactPathOwnedByImport('import-1/visual-quality.json', 'import-1')).toBe(true);
    expect(isTemplateImportArtifactPathOwnedByImport('victim-import/cdir.json', 'import-1')).toBe(false);
    expect(isTemplateImportArtifactPathOwnedByImport('victim-import/visual-quality.json', 'import-1')).toBe(false);
    expect(isTemplateImportArtifactPathOwnedByImport('import-1-attacker/cdir.json', 'import-1')).toBe(false);
  });

  it('rejects traversal and malformed artifact paths', () => {
    expect(isTemplateImportArtifactPathOwnedByImport('import-1/../victim/cdir.json', 'import-1')).toBe(false);
    expect(isTemplateImportArtifactPathOwnedByImport('import-1\\..\\victim\\cdir.json', 'import-1')).toBe(false);
    expect(isTemplateImportArtifactPathOwnedByImport('import-1//cdir.json', 'import-1')).toBe(false);
  });
});
