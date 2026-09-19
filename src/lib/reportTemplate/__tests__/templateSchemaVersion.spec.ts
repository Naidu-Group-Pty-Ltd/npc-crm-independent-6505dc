/**
 * Covers the shared edge module that replaced blind `schema.version = 1`
 * stamping in manage-templates / template-design-agent (rehaul Phase 4).
 */
import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_TEMPLATE_SCHEMA_VERSION,
  TemplateSchemaVersionError,
  validateAndMigrateTemplateSchemaVersion,
} from '../../../../supabase/functions/_shared/templateSchemaVersion';

describe('validateAndMigrateTemplateSchemaVersion', () => {
  it('accepts the current supported version unchanged', () => {
    const schema = { version: SUPPORTED_TEMPLATE_SCHEMA_VERSION, pages: [] };
    const out = validateAndMigrateTemplateSchemaVersion(schema);
    expect(out).toBe(schema);
    expect(out.version).toBe(SUPPORTED_TEMPLATE_SCHEMA_VERSION);
  });

  it('treats a missing version as legacy v1 and stamps it explicitly', () => {
    const schema: Record<string, unknown> = { pages: [] };
    validateAndMigrateTemplateSchemaVersion(schema);
    expect(schema.version).toBe(1);
  });

  it('treats a null version as legacy v1', () => {
    const schema: Record<string, unknown> = { version: null, pages: [] };
    validateAndMigrateTemplateSchemaVersion(schema);
    expect(schema.version).toBe(1);
  });

  it('coerces a numeric string version', () => {
    const schema: Record<string, unknown> = { version: '1', pages: [] };
    validateAndMigrateTemplateSchemaVersion(schema);
    expect(schema.version).toBe(1);
  });

  it('rejects versions newer than this deployment instead of clobbering them', () => {
    expect(() =>
      validateAndMigrateTemplateSchemaVersion({ version: SUPPORTED_TEMPLATE_SCHEMA_VERSION + 1 }),
    ).toThrow(TemplateSchemaVersionError);
  });

  it('rejects non-integer versions', () => {
    expect(() => validateAndMigrateTemplateSchemaVersion({ version: 1.5 })).toThrow(TemplateSchemaVersionError);
    expect(() => validateAndMigrateTemplateSchemaVersion({ version: 'two' })).toThrow(TemplateSchemaVersionError);
  });

  it('rejects versions below 1', () => {
    expect(() => validateAndMigrateTemplateSchemaVersion({ version: 0 })).toThrow(TemplateSchemaVersionError);
    expect(() => validateAndMigrateTemplateSchemaVersion({ version: -3 })).toThrow(TemplateSchemaVersionError);
  });

  it('exposes the received value on the error for diagnostics', () => {
    try {
      validateAndMigrateTemplateSchemaVersion({ version: 99 });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TemplateSchemaVersionError);
      expect((e as TemplateSchemaVersionError).received).toBe(99);
      expect((e as TemplateSchemaVersionError).message).toContain('99');
    }
  });
});
