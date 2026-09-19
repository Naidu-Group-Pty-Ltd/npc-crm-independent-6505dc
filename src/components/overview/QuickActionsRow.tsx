import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useCapabilityResolver } from '@/hooks/useCapability';
import { OVERVIEW_QUICK_ACTIONS } from '@/lib/overview/quickActions';

/**
 * Capability-aware quick actions for the Overview. Only actions the
 * workspace is entitled to AND the user is permitted to use render; there
 * are no disabled premium buttons.
 */
export function QuickActionsRow() {
  const navigate = useNavigate();
  const { resolve } = useCapabilityResolver();

  const actions = useMemo(
    () =>
      OVERVIEW_QUICK_ACTIONS.filter((action) => {
        const decision = resolve(action.capability ?? action.permissionKey ?? '__always__');
        return decision.enabled;
      }),
    [resolve],
  );

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Quick actions">
      {actions.map((action) => (
        <Button
          key={action.id}
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => navigate(action.route)}
        >
          <action.icon className="h-4 w-4" aria-hidden="true" />
          {action.label}
        </Button>
      ))}
    </div>
  );
}
