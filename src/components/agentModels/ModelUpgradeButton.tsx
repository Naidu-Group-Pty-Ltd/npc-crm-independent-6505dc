/**
 * Inline "Change model" affordance. On click, deep-links the user into
 * the Model Hub with the target agent_key preselected. Falls back to
 * the base Model Hub route if the query string is stripped downstream.
 *
 * The button is intentionally lightweight — real editing/rating lives
 * in the Model Hub itself so we never duplicate write logic.
 */

import { Link } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isClientFacingDeployment, isPathVisibleInDeployment } from '@/lib/clientFacing';
import type { AgentSurfaceId } from '@/lib/agentModels/agentKeys';
import { AGENT_SURFACES } from '@/lib/agentModels/agentKeys';

export type ModelUpgradeButtonProps = Omit<ButtonProps, 'asChild'> & {
  /** Either an explicit agent_key or a surface id whose primary key is used. */
  agentKey?: string;
  surfaceId?: AgentSurfaceId;
  /** Show all slot keys as a comma list so Model Hub can open the group tab. */
  includeAllSlots?: boolean;
  label?: string;
};

export function ModelUpgradeButton({
  agentKey,
  surfaceId,
  includeAllSlots = false,
  label = 'Change model',
  className,
  variant = 'ghost',
  size = 'sm',
  ...rest
}: ModelUpgradeButtonProps) {
  // Every destination this button has is inside the Model Hub; when the
  // deployment hides that route, an affordance that deep-links into it is a
  // dead end, so it disappears with the page.
  if (!isPathVisibleInDeployment('/model-hub', isClientFacingDeployment())) return null;

  const surface = surfaceId ? AGENT_SURFACES[surfaceId] : null;
  const primaryKey = agentKey ?? surface?.slots[0]?.key;
  const allKeys = includeAllSlots && surface ? surface.slots.map((s) => s.key).join(',') : null;

  const search = new URLSearchParams();
  if (primaryKey) search.set('agent', primaryKey);
  if (allKeys) search.set('group', allKeys);
  const href = `/model-hub${search.toString() ? `?${search.toString()}` : ''}`;

  return (
    <Button
      asChild
      variant={variant}
      size={size}
      className={cn('gap-1.5 text-xs', className)}
      {...rest}
    >
      <Link to={href}>
        <Settings2 className="h-3.5 w-3.5" />
        {label}
      </Link>
    </Button>
  );
}
