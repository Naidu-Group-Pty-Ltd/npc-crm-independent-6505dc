import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OverrideSectionDividerProps {
  icon?: LucideIcon;
  title: string;
  action?: React.ReactNode;
  className?: string;
}

export function OverrideSectionDivider({
  icon: Icon,
  title,
  action,
  className
}: OverrideSectionDividerProps) {
  return (
    <div className={cn("flex items-center justify-between py-3 border-b border-border/50", className)}>
      <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4" />}
        <span className="w-1.5 h-1.5 bg-primary rounded-full" />
        {title}
      </h4>
      {action}
    </div>
  );
}
