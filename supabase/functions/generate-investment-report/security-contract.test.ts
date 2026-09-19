import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('generate-investment-report Compass privacy contract', () => {
  it('strips financial overrides based on the report tier, including the default tier', () => {
    expect(functionSource).toContain(
      "const __compassReport = ['compass', 'compass-40'].includes(propertyDetails?.reportTier || 'compass');",
    );
    expect(functionSource).toContain('if (__compassReport && manualOverrides)');
    expect(functionSource).not.toContain(
      "const __compass40Mode = propertyDetails?.generationEngine === 'compass-40';",
    );
  });
});
