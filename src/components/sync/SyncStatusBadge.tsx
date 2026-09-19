import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Copy, GitBranch } from 'lucide-react';
import { getSyncStatusLabel } from '@/lib/syncDisplay';

interface SyncStatusBadgeProps {
  status?: string | null;
}

export function SyncStatusBadge({ status }: SyncStatusBadgeProps) {
  if (!status) return null;

  const config = {
    synced: { icon: CheckCircle2, className: 'border-success/20 bg-success/10 text-success' },
    duplicate: { icon: Copy, className: 'border-border/70 bg-muted text-muted-foreground' },
    conflict: { icon: AlertTriangle, className: 'border-warning/20 bg-warning/10 text-warning' },
    superseded: { icon: GitBranch, className: 'border-border/70 bg-muted text-muted-foreground' },
    local: { icon: GitBranch, className: 'border-primary/20 bg-primary/10 text-primary' },
  }[status] || { icon: GitBranch, className: 'border-border/70 bg-muted text-muted-foreground' };

  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`text-xs gap-1 ${config.className}`}>
      <Icon className="h-3 w-3" />
      {getSyncStatusLabel(status)}
    </Badge>
  );
}