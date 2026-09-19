/**
 * OperatorPermissionStatusPanel — Phase 11B.
 *
 * Presentational panel showing the current PDF import role, its source, and
 * (optionally) grouped capability checks. It never surfaces raw JWT claims or
 * tokens and makes no network calls.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  getPdfImportRoleLabel,
  getPdfImportRoleTone,
  getPdfImportCapabilityLabel,
  getPdfImportPermissionDecisionLabel,
  getPdfImportPermissionDecisionTone,
  type PdfImportPermissionCheck,
  type PdfImportResolvedRole,
} from '@/lib/reportTemplate/ingestion/operatorPermissions';

interface OperatorPermissionStatusPanelProps {
  resolvedRole: PdfImportResolvedRole | null;
  checks?: PdfImportPermissionCheck[];
}

const SOURCE_LABELS: Record<string, string> = {
  jwt_app_metadata: 'App metadata',
  jwt_user_metadata: 'User metadata',
  profile: 'Profile',
  user_roles: 'User roles',
  admin_guard: 'Admin guard',
  system_service: 'Service context',
  fallback: 'Fallback',
  unknown: 'Unknown',
};

export function OperatorPermissionStatusPanel({ resolvedRole, checks }: OperatorPermissionStatusPanelProps) {
  if (!resolvedRole) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Permission role unresolved.
        </CardContent>
      </Card>
    );
  }

  const groups: Array<{ key: string; label: string }> = [
    { key: 'allowed', label: 'Allowed' },
    { key: 'requires_confirmation', label: 'Requires confirmation' },
    { key: 'manual_only', label: 'Manual only' },
    { key: 'denied', label: 'Denied' },
    { key: 'blocked', label: 'Blocked' },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          PDF import permissions
          <Badge variant={getPdfImportRoleTone(resolvedRole.role)}>{getPdfImportRoleLabel(resolvedRole.role)}</Badge>
          <Badge variant="outline">{SOURCE_LABELS[resolvedRole.source] ?? resolvedRole.source}</Badge>
          <Badge variant={resolvedRole.isAuthenticated ? 'secondary' : 'destructive'}>
            {resolvedRole.isAuthenticated ? 'Authenticated' : 'Not authenticated'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="text-xs text-muted-foreground">{resolvedRole.reason}</div>
        {checks && checks.length > 0 && (
          <div className="space-y-2">
            {groups.map((g) => {
              const items = checks.filter((c) => c.decision === g.key);
              if (items.length === 0) return null;
              return (
                <div key={g.key}>
                  <div className="text-xs font-semibold text-muted-foreground">{g.label} ({items.length})</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {items.map((c) => (
                      <Badge key={c.capability} variant={getPdfImportPermissionDecisionTone(c.decision)} className="text-[10px]">
                        {getPdfImportCapabilityLabel(c.capability)}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
          Frontend permission checks improve UX. Sensitive writes are also enforced by the backend
          (authentication, import ownership, RLS, and admin guards). {getPdfImportPermissionDecisionLabel('allowed')} does
          not bypass backend checks.
        </div>
      </CardContent>
    </Card>
  );
}

export default OperatorPermissionStatusPanel;
