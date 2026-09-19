/**
 * SolutionOptionCards — Audit-fix #1
 *
 * Renders up to 3 clickable, ranked "Solution Option" cards above the manual
 * lever stack. Each card runs the scenario engine in isolation, projects the
 * capacity uplift, and on click dispatches a typed `apply` payload back to the
 * parent so the existing strategy state setters take over. The cards are
 * intentionally read-only previews — the actual lever toggles still live in
 * AdditionalStrategyLevers and the equity-release/sell blocks.
 */
import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Wand2 } from 'lucide-react';
import {
  recommendSolutions,
  type ScenarioContext,
  type SolutionApply,
  type SolutionRecommendation,
} from '@/utils/scenarioDeltaEngine';

interface SolutionOptionCardsProps {
  context: ScenarioContext | null;
  onApply: (apply: SolutionApply) => void;
  formatCurrency: (n: number) => string;
}

export function SolutionOptionCards({ context, onApply, formatCurrency }: SolutionOptionCardsProps) {
  const recommendations: SolutionRecommendation[] = useMemo(() => {
    if (!context) return [];
    try {
      return recommendSolutions(context);
    } catch (e) {
      console.warn('[SolutionOptionCards] recommendSolutions failed:', e);
      return [];
    }
  }, [context]);

  if (!context || recommendations.length === 0) return null;

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Wand2 className="h-4 w-4 text-primary" />
          Suggested Solutions
          <span className="text-xs font-normal text-muted-foreground">
            — one-click strategies ranked by projected uplift
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {recommendations.map(rec => (
            <button
              key={rec.id}
              type="button"
              onClick={() => onApply(rec.apply)}
              className="text-left border border-border rounded-lg p-3 hover:border-primary hover:bg-primary/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="font-semibold text-sm">{rec.title}</div>
                <Badge variant="secondary" className="text-xs gap-1 shrink-0">
                  <TrendingUp className="h-3 w-3" />
                  +{formatCurrency(rec.capacityDelta)}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mb-2 line-clamp-2">
                {rec.description}
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">Projected capacity: </span>
                <span className="font-medium">{formatCurrency(rec.projectedCapacity)}</span>
              </div>
              <Button size="sm" variant="ghost" className="mt-2 h-7 text-xs w-full">
                Apply this strategy
              </Button>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
