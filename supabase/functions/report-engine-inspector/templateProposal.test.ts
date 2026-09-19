import { describe, expect, it } from 'vitest';
import { buildNewTemplateRow } from './templateProposal.ts';

describe('buildNewTemplateRow', () => {
  it('supplies required file metadata for an agent-created template', () => {
    const row = buildNewTemplateRow(
      { name: 'Investment summary', template_type: 'ai_structure', parsed_content: '# Summary' },
      'user-1',
      'proposal-1',
    );

    expect(row).toMatchObject({
      file_path: 'agent-generated/proposal-1.md',
      file_name: 'proposal-1.md',
      is_active: true,
      created_by: 'user-1',
    });
  });

  it('preserves explicitly supplied file metadata and activation state', () => {
    const row = buildNewTemplateRow(
      { file_path: 'ai_structure/source.md', file_name: 'source.md', is_active: false },
      'user-1',
      'proposal-1',
    );

    expect(row).toMatchObject({
      file_path: 'ai_structure/source.md',
      file_name: 'source.md',
      is_active: false,
    });
  });
});
