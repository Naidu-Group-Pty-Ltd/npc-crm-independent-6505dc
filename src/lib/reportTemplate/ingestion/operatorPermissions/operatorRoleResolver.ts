/**
 * operatorRoleResolver — Phase 11B.
 *
 * Deny-by-default role resolution. Resolves the highest PDF import role from a
 * permission context (service context → JWT claims → profile → existing admin
 * guard), falling back to `no_access` for unauthenticated/unknown users. No real
 * emails are hardcoded; role mapping is by role string only.
 */
import type {
  PdfImportOperatorRole,
  PdfImportPermissionContext,
  PdfImportPermissionSource,
  PdfImportResolvedRole,
} from './operatorPermissionTypes';

const RANK: Record<PdfImportOperatorRole, number> = {
  no_access: 0,
  pdf_viewer: 1,
  pdf_operator: 2,
  pdf_qa_operator: 3,
  pdf_admin: 4,
  developer_admin: 5,
  system_service: 6,
};

const RAW_ROLE_MAP: Record<string, PdfImportOperatorRole> = {
  // developer_admin
  developer_admin: 'developer_admin',
  super_admin: 'developer_admin',
  superadmin: 'developer_admin',
  owner: 'developer_admin',
  developer: 'developer_admin',
  system_admin: 'developer_admin',
  // pdf_admin
  pdf_admin: 'pdf_admin',
  admin: 'pdf_admin',
  sub_admin: 'pdf_admin',
  product_admin: 'pdf_admin',
  operations_admin: 'pdf_admin',
  ops_admin: 'pdf_admin',
  // pdf_qa_operator
  pdf_qa_operator: 'pdf_qa_operator',
  qa: 'pdf_qa_operator',
  qa_operator: 'pdf_qa_operator',
  reviewer: 'pdf_qa_operator',
  // pdf_operator
  pdf_operator: 'pdf_operator',
  operator: 'pdf_operator',
  staff: 'pdf_operator',
  // pdf_viewer
  pdf_viewer: 'pdf_viewer',
  viewer: 'pdf_viewer',
  read_only: 'pdf_viewer',
  readonly: 'pdf_viewer',
  // no_access
  client: 'no_access',
  customer: 'no_access',
  user: 'no_access',
  guest: 'no_access',
  none: 'no_access',
  blocked: 'no_access',
};

export function mapRawRoleToPdfImportRole(rawRole: string): PdfImportOperatorRole | null {
  if (typeof rawRole !== 'string') return null;
  const key = rawRole.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return RAW_ROLE_MAP[key] ?? null;
}

export function normalizePdfImportRole(rawRole: unknown): PdfImportOperatorRole | null {
  if (typeof rawRole !== 'string') return null;
  return mapRawRoleToPdfImportRole(rawRole);
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string' && value.trim() !== '') out.push(value.trim());
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
}

export function extractRawRolesFromJwtClaims(
  claims: Record<string, unknown> | null | undefined,
): string[] {
  if (!claims || typeof claims !== 'object') return [];
  const out: string[] = [];
  const app = (claims as any).app_metadata;
  const usr = (claims as any).user_metadata;
  if (app && typeof app === 'object') {
    collectStrings((app as any).role, out);
    collectStrings((app as any).roles, out);
  }
  if (usr && typeof usr === 'object') {
    collectStrings((usr as any).role, out);
    collectStrings((usr as any).roles, out);
  }
  // Some tokens carry a top-level role/roles too.
  collectStrings((claims as any).role, out);
  collectStrings((claims as any).roles, out);
  return Array.from(new Set(out));
}

export function extractRawRolesFromProfile(
  profile: Record<string, unknown> | null | undefined,
): string[] {
  if (!profile || typeof profile !== 'object') return [];
  const out: string[] = [];
  collectStrings((profile as any).role, out);
  collectStrings((profile as any).roles, out);
  collectStrings((profile as any).app_role, out);
  if ((profile as any).is_admin === true) out.push('admin');
  if ((profile as any).is_superadmin === true) out.push('superadmin');
  return Array.from(new Set(out));
}

export function resolvePdfImportOperatorRole(
  context: PdfImportPermissionContext,
): PdfImportResolvedRole {
  // 1. Service context (trusted backend only).
  if (context.serviceContext === true) {
    return {
      role: 'system_service',
      source: 'system_service',
      rawRoles: [],
      isAuthenticated: true,
      userId: context.userId ?? null,
      reason: 'Resolved from trusted service context.',
    };
  }

  const isAuthenticated = context.isAuthenticated === true;

  // 2. Unauthenticated → no_access.
  if (!isAuthenticated) {
    return {
      role: 'no_access',
      source: 'fallback',
      rawRoles: [],
      isAuthenticated: false,
      userId: context.userId ?? null,
      reason: 'User is not authenticated.',
    };
  }

  // 3. Gather raw roles with their source.
  const candidates: Array<{ role: PdfImportOperatorRole; source: PdfImportPermissionSource; raw: string }> = [];
  const rawAll: string[] = [];

  const app = (context.jwtClaims as any)?.app_metadata;
  const jwtAppRoles: string[] = [];
  if (app && typeof app === 'object') { collectStrings(app.role, jwtAppRoles); collectStrings(app.roles, jwtAppRoles); }
  const jwtUsrRoles: string[] = [];
  const usr = (context.jwtClaims as any)?.user_metadata;
  if (usr && typeof usr === 'object') { collectStrings(usr.role, jwtUsrRoles); collectStrings(usr.roles, jwtUsrRoles); }
  const profileRoles = extractRawRolesFromProfile(context.profile);

  const add = (raws: string[], source: PdfImportPermissionSource) => {
    for (const raw of raws) {
      rawAll.push(raw);
      const mapped = mapRawRoleToPdfImportRole(raw);
      if (mapped) candidates.push({ role: mapped, source, raw });
    }
  };
  add(jwtAppRoles, 'jwt_app_metadata');
  add(jwtUsrRoles, 'jwt_user_metadata');
  add(profileRoles, 'profile');

  // 4. Choose the highest-ranked mapped role (excluding system_service, which is
  //    only reachable via service context).
  let best: { role: PdfImportOperatorRole; source: PdfImportPermissionSource; raw: string } | null = null;
  for (const c of candidates) {
    if (c.role === 'system_service') continue;
    if (!best || RANK[c.role] > RANK[best.role]) best = c;
  }

  // 5. Existing admin guard → pdf_admin (never developer_admin) unless a stronger
  //    explicit role was found.
  if (context.existingAdminGuard === true) {
    if (!best || RANK[best.role] < RANK.pdf_admin) {
      return {
        role: 'pdf_admin',
        source: 'admin_guard',
        rawRoles: Array.from(new Set(rawAll)),
        isAuthenticated: true,
        userId: context.userId ?? null,
        reason: 'Mapped from existing admin guard to pdf_admin.',
      };
    }
  }

  if (best) {
    return {
      role: best.role,
      source: best.source,
      rawRoles: Array.from(new Set(rawAll)),
      isAuthenticated: true,
      userId: context.userId ?? null,
      reason: `Resolved role ${best.role} from raw role "${best.raw}".`,
    };
  }

  // 6. Authenticated but no mappable role → no_access (deny by default).
  return {
    role: 'no_access',
    source: 'fallback',
    rawRoles: Array.from(new Set(rawAll)),
    isAuthenticated: true,
    userId: context.userId ?? null,
    reason: 'No recognized PDF import role; denied by default.',
  };
}
