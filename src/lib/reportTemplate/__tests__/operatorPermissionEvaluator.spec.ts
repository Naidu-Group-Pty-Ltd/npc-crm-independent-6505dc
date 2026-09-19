import { describe, expect, it } from 'vitest';
import {
  evaluatePdfImportPermission,
  evaluatePdfImportPermissions,
  requirePdfImportCapability,
  getPdfImportPermissionDeniedMessage,
  resolvePdfImportOperatorRole,
} from '../ingestion/operatorPermissions';

const adminRole = resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'admin' } });
const operatorRole = resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'operator' } });
const noAccessRole = resolvePdfImportOperatorRole({ isAuthenticated: false });

describe('evaluatePdfImportPermission', () => {
  it('allows a capability the role has', () => {
    const c = evaluatePdfImportPermission({ resolvedRole: adminRole, capability: 'pdf_import.persist_import_intelligence' });
    expect(c.decision).toBe('allowed');
    expect(c.allowed).toBe(true);
  });
  it('denies a capability the role lacks', () => {
    const c = evaluatePdfImportPermission({ resolvedRole: operatorRole, capability: 'pdf_import.persist_golden_summary' });
    expect(c.decision).toBe('denied');
    expect(c.allowed).toBe(false);
  });
  it('denies everything for no_access', () => {
    const c = evaluatePdfImportPermission({ resolvedRole: noAccessRole, capability: 'pdf_import.evaluate_only' });
    expect(c.decision).toBe('denied');
  });
  it('denies when no context/role is provided (deny by default)', () => {
    const c = evaluatePdfImportPermission({ capability: 'pdf_import.evaluate_only' });
    expect(c.decision).toBe('denied');
    expect(c.role).toBe('no_access');
  });
  it('blocked overrides capability', () => {
    const c = evaluatePdfImportPermission({ resolvedRole: adminRole, capability: 'pdf_import.persist_import_intelligence', blocked: true, blockedReason: 'safety' });
    expect(c.decision).toBe('blocked');
    expect(c.allowed).toBe(false);
  });
  it('manual_only when role has capability but action is manual-only', () => {
    const c = evaluatePdfImportPermission({ resolvedRole: adminRole, capability: 'pdf_import.manual.run_ai_reconciliation', manualOnly: true });
    expect(c.decision).toBe('manual_only');
    expect(c.allowed).toBe(true);
    expect(c.manualOnly).toBe(true);
  });
  it('manual_only denied when role lacks capability', () => {
    const c = evaluatePdfImportPermission({ resolvedRole: operatorRole, capability: 'pdf_import.manual.run_ai_reconciliation', manualOnly: true });
    expect(c.decision).toBe('denied');
  });
  it('requires_confirmation when flagged', () => {
    const c = evaluatePdfImportPermission({ resolvedRole: adminRole, capability: 'pdf_import.operator.mark_accepted', requiresConfirmation: true });
    expect(c.decision).toBe('requires_confirmation');
    expect(c.allowed).toBe(true);
    expect(c.requiresConfirmation).toBe(true);
  });
  it('uses context when resolvedRole not given', () => {
    const c = evaluatePdfImportPermission({ context: { isAuthenticated: true, profile: { role: 'admin' } }, capability: 'pdf_import.persist_golden_summary' });
    expect(c.decision).toBe('allowed');
  });
});

describe('evaluatePdfImportPermissions / require / message', () => {
  it('evaluates a batch', () => {
    const checks = evaluatePdfImportPermissions({ resolvedRole: operatorRole, capabilities: ['pdf_import.evaluate_only', 'pdf_import.persist_golden_summary'] });
    expect(checks[0].decision).toBe('allowed');
    expect(checks[1].decision).toBe('denied');
  });
  it('require ok for allowed, not ok for manual/denied', () => {
    expect(requirePdfImportCapability({ resolvedRole: adminRole, capability: 'pdf_import.evaluate_only' }).ok).toBe(true);
    expect(requirePdfImportCapability({ resolvedRole: operatorRole, capability: 'pdf_import.persist_golden_summary' }).ok).toBe(false);
  });
  it('denied message is descriptive', () => {
    const c = evaluatePdfImportPermission({ resolvedRole: operatorRole, capability: 'pdf_import.persist_golden_summary' });
    expect(getPdfImportPermissionDeniedMessage(c)).toContain('does not have');
  });
  it('empty message for allowed', () => {
    const c = evaluatePdfImportPermission({ resolvedRole: adminRole, capability: 'pdf_import.evaluate_only' });
    expect(getPdfImportPermissionDeniedMessage(c)).toBe('');
  });
});
