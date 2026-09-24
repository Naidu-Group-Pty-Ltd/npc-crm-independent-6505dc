/**
 * Whether to offer "Delete" on an assessment at all.
 *
 * Hidden only where it is known to be refused: a user whose permissions for
 * the Commercial & Industrial module are managed and do not include delete.
 * Anywhere else the server decides — and `DeleteAssessmentDialog` says what it
 * decided — because an unmanaged module is one the owner may delete their own
 * assessments in, and hiding the button there would hide a real ability.
 */

import { usePermissions } from '@/hooks/usePermissions';

export function useMayOfferAssessmentDelete(): boolean {
  const { isSuperadmin, permissions } = usePermissions();
  if (isSuperadmin) return true;
  const managed = permissions.find((permission) => permission.module_key === 'commercial');
  return managed ? managed.can_delete : true;
}
