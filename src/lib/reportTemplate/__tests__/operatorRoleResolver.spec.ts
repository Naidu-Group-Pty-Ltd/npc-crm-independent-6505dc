import { describe, expect, it } from 'vitest';
import {
  resolvePdfImportOperatorRole,
  normalizePdfImportRole,
  mapRawRoleToPdfImportRole,
  extractRawRolesFromJwtClaims,
  extractRawRolesFromProfile,
} from '../ingestion/operatorPermissions';

describe('raw role mapping', () => {
  it('maps admin family', () => {
    expect(mapRawRoleToPdfImportRole('admin')).toBe('pdf_admin');
    expect(mapRawRoleToPdfImportRole('sub_admin')).toBe('pdf_admin');
    expect(mapRawRoleToPdfImportRole('ops_admin')).toBe('pdf_admin');
  });
  it('maps developer family', () => {
    expect(mapRawRoleToPdfImportRole('super_admin')).toBe('developer_admin');
    expect(mapRawRoleToPdfImportRole('superadmin')).toBe('developer_admin');
    expect(mapRawRoleToPdfImportRole('owner')).toBe('developer_admin');
  });
  it('maps qa/operator/viewer families', () => {
    expect(mapRawRoleToPdfImportRole('qa')).toBe('pdf_qa_operator');
    expect(mapRawRoleToPdfImportRole('operator')).toBe('pdf_operator');
    expect(mapRawRoleToPdfImportRole('viewer')).toBe('pdf_viewer');
  });
  it('maps client/user families to no_access', () => {
    expect(mapRawRoleToPdfImportRole('client')).toBe('no_access');
    expect(mapRawRoleToPdfImportRole('user')).toBe('no_access');
    expect(mapRawRoleToPdfImportRole('guest')).toBe('no_access');
  });
  it('normalizes case/spacing and returns null for unknown', () => {
    expect(normalizePdfImportRole('PDF Admin')).toBe('pdf_admin');
    expect(normalizePdfImportRole('unknown-thing')).toBeNull();
    expect(normalizePdfImportRole(42)).toBeNull();
  });
  it('extracts raw roles from jwt claims', () => {
    const roles = extractRawRolesFromJwtClaims({ app_metadata: { role: 'admin', roles: ['qa'] }, user_metadata: { roles: ['viewer'] } });
    expect(roles).toEqual(expect.arrayContaining(['admin', 'qa', 'viewer']));
  });
  it('extracts raw roles from profile incl is_admin', () => {
    expect(extractRawRolesFromProfile({ role: 'operator', is_admin: true })).toEqual(expect.arrayContaining(['operator', 'admin']));
  });
});

describe('resolvePdfImportOperatorRole', () => {
  it('service context → system_service', () => {
    expect(resolvePdfImportOperatorRole({ serviceContext: true }).role).toBe('system_service');
  });
  it('unauthenticated → no_access', () => {
    const r = resolvePdfImportOperatorRole({ isAuthenticated: false });
    expect(r.role).toBe('no_access');
    expect(r.source).toBe('fallback');
  });
  it('authenticated with admin role → pdf_admin', () => {
    const r = resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'admin' } });
    expect(r.role).toBe('pdf_admin');
  });
  it('authenticated with super_admin → developer_admin', () => {
    expect(resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'super_admin' } }).role).toBe('developer_admin');
  });
  it('chooses the highest role across sources', () => {
    const r = resolvePdfImportOperatorRole({
      isAuthenticated: true,
      jwtClaims: { app_metadata: { roles: ['viewer', 'admin'] } },
      profile: { role: 'operator' },
    });
    expect(r.role).toBe('pdf_admin');
  });
  it('existing admin guard maps to pdf_admin (not developer_admin) when no stronger role', () => {
    const r = resolvePdfImportOperatorRole({ isAuthenticated: true, existingAdminGuard: true });
    expect(r.role).toBe('pdf_admin');
    expect(r.source).toBe('admin_guard');
  });
  it('admin guard does not downgrade a developer_admin role', () => {
    const r = resolvePdfImportOperatorRole({ isAuthenticated: true, existingAdminGuard: true, profile: { role: 'super_admin' } });
    expect(r.role).toBe('developer_admin');
  });
  it('authenticated with only client role → no_access', () => {
    expect(resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'client' } }).role).toBe('no_access');
  });
  it('authenticated with unmappable role → no_access fallback', () => {
    const r = resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'zzz' } });
    expect(r.role).toBe('no_access');
    expect(r.source).toBe('fallback');
  });
  it('never resolves system_service from JWT/profile', () => {
    const r = resolvePdfImportOperatorRole({ isAuthenticated: true, profile: { role: 'system_service' } });
    expect(r.role).toBe('no_access');
  });
});
