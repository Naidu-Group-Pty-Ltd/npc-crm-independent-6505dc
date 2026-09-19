import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Lightbulb
} from 'lucide-react';
import type { ReviewWizardData } from './types';

interface RecommendationsStepProps {
  recommendations: ReviewWizardData['recommendations'];
}

export function RecommendationsStep({ recommendations }: RecommendationsStepProps) {
  const highPriority = recommendations.filter(r => r.priority === 'high');
  const mediumPriority = recommendations.filter(r => r.priority === 'medium');
  const lowPriority = recommendations.filter(r => r.priority === 'low');

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return <Badge className="bg-destructive/10 text-destructive border-destructive/20">High Priority</Badge>;
      case 'medium':
        return <Badge className="bg-brand-500/10 text-brand-600 border-brand-500/20">Medium Priority</Badge>;
      default:
        return <Badge className="bg-success/10 text-success border-success/20">Low Priority</Badge>;
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high':
        return <AlertTriangle className="h-5 w-5 text-destructive" />;
      case 'medium':
        return <Lightbulb className="h-5 w-5 text-brand-600" />;
      default:
        return <CheckCircle2 className="h-5 w-5 text-success" />;
    }
  };

  const RecommendationCard = ({ rec }: { rec: ReviewWizardData['recommendations'][0] }) => (
    <div className="min-w-0 border rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        {getPriorityIcon(rec.priority)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {getPriorityBadge(rec.priority)}
            <Badge variant="outline" className="text-xs">{rec.category}</Badge>
          </div>
          <h4 className="font-medium">{rec.title}</h4>
          <p className="text-sm text-muted-foreground mt-1">{rec.description}</p>
        </div>
      </div>

      {rec.actionItems.length > 0 && (
        <div className="pt-2 border-t space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Action Items</p>
          {rec.actionItems.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <span className="min-w-0 break-words">{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className={highPriority.length > 0 ? 'border-destructive/30' : ''}>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-destructive">{highPriority.length}</div>
            <p className="text-xs text-muted-foreground">High Priority</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-brand-600">{mediumPriority.length}</div>
            <p className="text-xs text-muted-foreground">Medium Priority</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-success">{lowPriority.length}</div>
            <p className="text-xs text-muted-foreground">Opportunities</p>
          </CardContent>
        </Card>
      </div>

      {/* High Priority */}
      {highPriority.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Immediate Action Required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {highPriority.map((rec, i) => (
              <RecommendationCard key={i} rec={rec} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Medium Priority */}
      {mediumPriority.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-brand-600" />
              Recommended Improvements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {mediumPriority.map((rec, i) => (
              <RecommendationCard key={i} rec={rec} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Low Priority / Opportunities */}
      {lowPriority.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              Growth Opportunities
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {lowPriority.map((rec, i) => (
              <RecommendationCard key={i} rec={rec} />
            ))}
          </CardContent>
        </Card>
      )}

      {recommendations.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-success" />
            <p className="font-medium">No recommendations at this time</p>
            <p className="text-sm">Your portfolio appears to be in good shape!</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
