import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('finance portal CRM pipeline security contract', () => {
  it('does not expose global GHL pipeline metadata through finance sessions', () => {
    expect(source).not.toContain("operation === 'list_ghl_pipelines'");
    expect(source).not.toContain("operation === 'list_ghl_pipeline_stages'");
    expect(source).not.toContain(".from('ghl_pipelines')");
    expect(source).not.toContain(".from('ghl_pipeline_stages')");
  });

  it('does not forward finance-controlled pipeline identifiers to the CRM sync', () => {
    expect(source).not.toContain('body?.pipeline_ghl_id');
    expect(source).not.toContain('body?.pipeline_stage_ghl_id');
    expect(source).not.toContain('syncBody.pipelineGhlId');
    expect(source).not.toContain('syncBody.pipelineStageGhlId');
  });
});
