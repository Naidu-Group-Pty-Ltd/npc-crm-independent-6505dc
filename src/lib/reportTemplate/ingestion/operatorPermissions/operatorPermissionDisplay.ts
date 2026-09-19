/**
 * operatorPermissionDisplay — Phase 11B.
 *
 * UI-safe labels and Badge tones for roles, capabilities, and permission
 * decisions. Pure; no network; never surfaces raw JWT claims or tokens.
 */
import type {
  PdfImportCapability,
  PdfImportOperatorRole,
  PdfImportPermissionCheck,
  PdfImportPermissionDecision,
} from './operatorPermissionTypes';

export type PdfImportPermissionDisplayTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

const ROLE_LABELS: Record<string, string> = {
  no_access: 'No access',
  pdf_viewer: 'PDF Viewer',
  pdf_operator: 'PDF Operator',
  pdf_qa_operator: 'PDF QA Operator',
  pdf_admin: 'PDF Admin',
  developer_admin: 'Developer Admin',
  system_service: 'System Service',
};

const DECISION_LABELS: Record<string, string> = {
  allowed: 'Allowed',
  requires_confirmation: 'Requires confirmation',
  manual_only: 'Manual only',
  denied: 'Denied',
  blocked: 'Blocked',
};

export function getPdfImportRoleLabel(
  role: PdfImportOperatorRole | string | null | undefined,
): string {
  if (!role) return 'No access';
  return ROLE_LABELS[role] ?? 'No access';
}

export function getPdfImportRoleTone(
  role: PdfImportOperatorRole | string | null | undefined,
): PdfImportPermissionDisplayTone {
  switch (role) {
    case 'developer_admin':
    case 'pdf_admin':
      return 'default';
    case 'pdf_qa_operator':
    case 'pdf_operator':
      return 'secondary';
    case 'pdf_viewer':
      return 'outline';
    case 'system_service':
      return 'secondary';
    case 'no_access':
    default:
      return 'destructive';
  }
}

export function getPdfImportCapabilityLabel(
  capability: PdfImportCapability | string | null | undefined,
): string {
  if (!capability) return 'Unknown capability';
  // Turn "pdf_import.operator.mark_accepted" → "Operator · Mark accepted".
  const raw = String(capability).replace(/^pdf_import\./, '');
  const parts = raw.split('.');
  const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return parts.map(humanize).join(' · ');
}

export function getPdfImportPermissionDecisionLabel(
  decision: PdfImportPermissionDecision | string | null | undefined,
): string {
  if (!decision) return 'Denied';
  return DECISION_LABELS[decision] ?? 'Denied';
}

export function getPdfImportPermissionDecisionTone(
  decision: PdfImportPermissionDecision | string | null | undefined,
): PdfImportPermissionDisplayTone {
  switch (decision) {
    case 'allowed':
      return 'default';
    case 'requires_confirmation':
      return 'secondary';
    case 'manual_only':
      return 'outline';
    case 'denied':
    case 'blocked':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function summarizePdfImportPermissionCheck(
  check: PdfImportPermissionCheck | null | undefined,
): {
  label: string;
  tone: PdfImportPermissionDisplayTone;
  reason: string;
} {
  if (!check) {
    return { label: 'Denied', tone: 'destructive', reason: 'No permission check available.' };
  }
  return {
    label: getPdfImportPermissionDecisionLabel(check.decision),
    tone: getPdfImportPermissionDecisionTone(check.decision),
    reason: check.reason,
  };
}
