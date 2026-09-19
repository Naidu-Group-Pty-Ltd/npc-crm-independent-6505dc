import { type GamePlanPhase } from '@/hooks/useGamePlans';

const phaseStatusColors: Record<string, string> = {
  not_started: 'bg-muted',
  in_progress: 'bg-primary',
  completed: 'bg-success',
  blocked: 'bg-destructive',
};

interface Props {
  phases: GamePlanPhase[];
  planColor: string;
}

export function TimelineBar({ phases }: Props) {
  return (
    <div className="relative">
      <div className="flex items-center gap-0.5">
        {phases.map((phase, i) => {
          const isLast = i === phases.length - 1;
          const colorClass = phaseStatusColors[phase.status] || 'bg-muted';
          return (
            <div key={phase.id} className="flex items-center flex-1 min-w-0">
              {/* Phase segment */}
              <div className="relative flex-1 group">
                <div className={`h-2.5 rounded-full ${colorClass} transition-all duration-500`} />
                {/* Phase label */}
                <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
                  <span className="text-[10px] text-muted-foreground font-medium">{phase.icon} {phase.name}</span>
                </div>
              </div>
              {/* Connector dot */}
              {!isLast && (
                <div className={`h-3.5 w-3.5 rounded-full border-2 border-background ${colorClass} shrink-0 z-10 -mx-1`} />
              )}
            </div>
          );
        })}
      </div>
      {/* Spacer for labels below */}
      <div className="h-6" />
    </div>
  );
}
