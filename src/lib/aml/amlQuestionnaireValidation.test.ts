import { describe, expect, it } from 'vitest';
import { validateQuestionnaireSection } from '../../../supabase/functions/aml-client-portal/questionnaireValidation';

describe('AML client questionnaire server validation', () => {
  it('rejects noncanonical values used to derive conditional sections', () => {
    expect(validateQuestionnaireSection('purchasing_structure', { entity_type: 'company' }))
      .toContain('entity_type');
    expect(validateQuestionnaireSection('funding', {
      sources: ['gift'], deposit: '100000', narrative: 'Savings', overseas: 'no',
    })).toContain('sources');
  });

  it('rejects empty conditional entity and related-party submissions', () => {
    expect(validateQuestionnaireSection('entity_details', {})).toEqual([
      'entity_name', 'abn_acn', 'registration_place', 'registered_address',
    ]);
    expect(validateQuestionnaireSection('related_parties', { parties: [] })).toEqual(['parties']);
  });

  it('requires a canonical role and legal name for every related party', () => {
    expect(validateQuestionnaireSection('related_parties', {
      parties: [{ role: 'director', full_name: '' }],
    })).toEqual(['parties.0.role', 'parties.0.full_name']);
    expect(validateQuestionnaireSection('related_parties', {
      parties: [{ role: 'Director', full_name: 'Ada Example' }],
    })).toEqual([]);
  });

  it('accepts canonical conditional payloads', () => {
    expect(validateQuestionnaireSection('purchasing_structure', { entity_type: 'Company' })).toEqual([]);
    expect(validateQuestionnaireSection('entity_details', {
      entity_name: 'Example Pty Ltd', abn_acn: '123456789',
      registration_place: 'Australia — NSW', registered_address: '1 Example Street',
    })).toEqual([]);
  });

  it('enforces structure-specific trust and SMSF fields', () => {
    const common = {
      entity_name: 'Example Super Fund', abn_acn: '12345678901',
      registration_place: 'Australia — NSW', registered_address: '1 Example Street',
    };
    expect(validateQuestionnaireSection('entity_details', common, { entity_type: 'SMSF' }))
      .toEqual(['deed_date', 'trustee_type', 'lrba']);
    expect(validateQuestionnaireSection('entity_details', {
      ...common, deed_date: '2024-01-01', trustee_type: 'corporate', lrba: 'no',
    }, { entity_type: 'SMSF' })).toContain('corporate_trustee');
  });
});
