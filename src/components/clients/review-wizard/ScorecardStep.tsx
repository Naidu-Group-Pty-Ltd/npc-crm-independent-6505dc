import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Star, 
  ThumbsUp, 
  Minus, 
  ThumbsDown,
  Shield,
  Activity,
  AlertTriangle,
  Heart,
  Target,
  TrendingUp
} from 'lucide-react';
import type { PropertyScore } from './types';

// Extended interface to include isRental from the hook
interface ExtendedPropertyScore extends PropertyScore {
  isRental?: boolean;
}

interface ScorecardStepProps {
  overallScore: number;
  portfolioHealth: number;
  cashFlowScore: number;
  growthPotential: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskFactors: string[];
  propertyScores: ExtendedPropertyScore[];
}

export function ScorecardStep({
  overallScore,
  portfolioHealth,
  cashFlowScore,
  growthPotential,
  riskLevel,
  riskFactors,
  propertyScores
}: ScorecardStepProps) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-success';
    if (score >= 60) return 'text-brand-600';
    if (score >= 40) return 'text-warning';
    return 'text-destructive';
  };

  const getProgressColor = (score: number) => {
    if (score >= 80) return 'bg-success';
    if (score >= 60) return 'bg-brand-500';
    if (score >= 40) return 'bg-warning';
    return 'bg-destructive';
  };

  const getRiskBadge = (level: string) => {
    switch (level) {
      case 'low':
        return <Badge className="bg-success/10 text-success border-success/20"><Shield className="h-3 w-3 mr-1" />Low Risk</Badge>;
      case 'medium':
        return <Badge className="bg-brand-500/10 text-brand-600 border-brand-500/20"><Activity className="h-3 w-3 mr-1" />Medium Risk</Badge>;
      case 'high':
        return <Badge className="bg-warning/10 text-warning border-warning/20"><AlertTriangle className="h-3 w-3 mr-1" />High Risk</Badge>;
      case 'critical':
        return <Badge className="bg-destructive/10 text-destructive border-destructive/20"><AlertTriangle className="h-3 w-3 mr-1" />Critical Risk</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getClassificationIcon = (classification: string) => {
    switch (classification) {
      case 'Star':
        return <Star className="h-4 w-4 text-brand-500 fill-brand-500" />;
      case 'Good':
        return <ThumbsUp className="h-4 w-4 text-success" />;
      case 'Average':
        return <Minus className="h-4 w-4 text-muted-foreground" />;
      case 'Underperformer':
        return <ThumbsDown className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  const getClassificationBadge = (classification: string, isRental?: boolean) => {
    // Rental properties get a special badge
    if (isRental) {
      return <Badge className="bg-info/10 text-info border-info/20">Living Expense</Badge>;
    }
    switch (classification) {
      case 'Star':
        return <Badge className="bg-brand-500/10 text-brand-700 border-brand-500/20">Star Performer</Badge>;
      case 'Good':
        return <Badge className="bg-success/10 text-success border-success/20">Good</Badge>;
      case 'Average':
        return <Badge className="bg-muted/10 text-muted-foreground border-border/20">Average</Badge>;
      case 'Underperformer':
        return <Badge className="bg-destructive/10 text-destructive border-destructive/20">Underperformer</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Portfolio Score */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Portfolio Scorecard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-center">
              <div className={`text-5xl font-bold ${getScoreColor(overallScore)}`}>
                {overallScore}
              </div>
              <p className="text-sm text-muted-foreground mt-1">Overall Score</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {getRiskBadge(riskLevel)}
            </div>
          </div>

          {/* Score Breakdown */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Heart className="h-4 w-4 text-muted-foreground" />
                <span>Portfolio Health</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${getProgressColor(portfolioHealth)} transition-all`}
                    style={{ width: `${portfolioHealth}%` }}
                  />
                </div>
                <span className={`text-sm font-medium ${getScoreColor(portfolioHealth)}`}>
                  {portfolioHealth}%
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span>Cash Flow</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${getProgressColor(cashFlowScore)} transition-all`}
                    style={{ width: `${cashFlowScore}%` }}
                  />
                </div>
                <span className={`text-sm font-medium ${getScoreColor(cashFlowScore)}`}>
                  {Math.round(cashFlowScore)}%
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Target className="h-4 w-4 text-muted-foreground" />
                <span>Growth Potential</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${getProgressColor(growthPotential)} transition-all`}
                    style={{ width: `${growthPotential}%` }}
                  />
                </div>
                <span className={`text-sm font-medium ${getScoreColor(growthPotential)}`}>
                  {Math.round(growthPotential)}%
                </span>
              </div>
            </div>
          </div>

          {/* Risk Factors */}
          {riskFactors.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-sm font-medium mb-2">Risk Factors</p>
              <div className="space-y-1">
                {riskFactors.map((factor, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-warning">
                    <AlertTriangle className="h-4 w-4" />
                    {factor}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Property Scores */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Property Rankings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {propertyScores
            .sort((a, b) => b.overallScore - a.overallScore)
            .map((prop, index) => (
            <div key={prop.propertyId} className="min-w-0 border rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-sm font-medium">
                    #{index + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm break-words">{prop.address}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {!prop.isRental && getClassificationIcon(prop.classification)}
                      {getClassificationBadge(prop.classification, prop.isRental)}
                    </div>
                  </div>
                </div>
                <div className={`text-2xl font-bold ${getScoreColor(prop.overallScore)}`}>
                  {prop.overallScore}
                </div>
              </div>

              {/* Mini score bars */}
              <div className="grid gap-2 text-xs sm:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">Health: </span>
                  <span className="font-medium">{prop.healthScore}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Cash Flow: </span>
                  <span className="font-medium">{Math.round(prop.cashFlowScore)}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Growth: </span>
                  <span className="font-medium">{Math.round(prop.growthPotential)}%</span>
                </div>
              </div>

              {/* Strengths & Concerns */}
              <div className="flex flex-col gap-4 text-xs sm:flex-row">
                {prop.strengths.length > 0 && (
                  <div className="flex-1">
                    <p className="text-muted-foreground mb-1">Strengths</p>
                    <div className="flex flex-wrap gap-1">
                      {prop.strengths.map((s, i) => (
                        <Badge key={i} variant="outline" className="text-success border-success/30 text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {prop.concerns.length > 0 && (
                  <div className="flex-1">
                    <p className="text-muted-foreground mb-1">Concerns</p>
                    <div className="flex flex-wrap gap-1">
                      {prop.concerns.map((c, i) => (
                        <Badge key={i} variant="outline" className="text-destructive border-destructive/30 text-xs">
                          {c}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {propertyScores.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p>No properties to score</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
