import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { 
  Star, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  Clock,
  ThumbsUp,
  ThumbsDown,
  CheckCircle,
  XCircle,
  DollarSign
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { callLogBadgeBase } from './badgeStyles';

interface CallQualityScoreProps {
  sentiment: string | null;
  durationSeconds: number | null;
  outcome: string | null;
  cost: number | null;
  hasTranscript: boolean;
  compact?: boolean;
}

interface ScoreBreakdown {
  category: string;
  score: number;
  maxScore: number;
  icon: React.ElementType;
  description: string;
}

export const calculateCallQualityScore = (
  sentiment: string | null,
  durationSeconds: number | null,
  outcome: string | null,
  cost: number | null,
  hasTranscript: boolean
): { totalScore: number; maxScore: number; grade: string; breakdown: ScoreBreakdown[] } => {
  const breakdown: ScoreBreakdown[] = [];
  
  // Sentiment Score (0-30 points)
  let sentimentScore = 15; // neutral default
  if (sentiment === 'positive') sentimentScore = 30;
  else if (sentiment === 'mixed') sentimentScore = 20;
  else if (sentiment === 'neutral') sentimentScore = 15;
  else if (sentiment === 'negative') sentimentScore = 5;
  
  breakdown.push({
    category: 'Sentiment',
    score: sentimentScore,
    maxScore: 30,
    icon: sentimentScore >= 20 ? ThumbsUp : sentimentScore >= 10 ? Minus : ThumbsDown,
    description: sentiment ? `${sentiment.charAt(0).toUpperCase() + sentiment.slice(1)} sentiment detected` : 'No sentiment data'
  });
  
  // Duration Score (0-25 points)
  // Optimal duration: 2-10 minutes
  let durationScore = 0;
  if (durationSeconds) {
    const minutes = durationSeconds / 60;
    if (minutes >= 2 && minutes <= 10) durationScore = 25; // optimal
    else if (minutes >= 1 && minutes < 2) durationScore = 15; // short but ok
    else if (minutes > 10 && minutes <= 20) durationScore = 20; // slightly long
    else if (minutes > 20 && minutes <= 30) durationScore = 15; // long
    else if (minutes > 30) durationScore = 10; // very long
    else if (minutes < 1) durationScore = 5; // too short
  }
  
  breakdown.push({
    category: 'Duration',
    score: durationScore,
    maxScore: 25,
    icon: Clock,
    description: durationSeconds 
      ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s (optimal: 2-10 min)` 
      : 'No duration data'
  });
  
  // Outcome Score (0-30 points)
  let outcomeScore = 0;
  if (outcome) {
    switch (outcome.toLowerCase()) {
      case 'completed':
      case 'success':
        outcomeScore = 30;
        break;
      case 'voicemail':
        outcomeScore = 15;
        break;
      case 'no-answer':
      case 'busy':
        outcomeScore = 10;
        break;
      case 'failed':
      case 'cancelled':
        outcomeScore = 5;
        break;
      default:
        outcomeScore = 10;
    }
  }
  
  breakdown.push({
    category: 'Outcome',
    score: outcomeScore,
    maxScore: 30,
    icon: outcomeScore >= 20 ? CheckCircle : XCircle,
    description: outcome ? `Call ${outcome}` : 'No outcome data'
  });
  
  // Cost Efficiency Score (0-10 points)
  // Lower cost is better, assuming avg cost around $0.10-0.50
  let costScore = 5; // default
  if (cost !== null) {
    if (cost < 0.05) costScore = 10;
    else if (cost < 0.15) costScore = 8;
    else if (cost < 0.30) costScore = 6;
    else if (cost < 0.50) costScore = 4;
    else costScore = 2;
  }
  
  breakdown.push({
    category: 'Cost Efficiency',
    score: costScore,
    maxScore: 10,
    icon: DollarSign,
    description: cost !== null ? `$${cost.toFixed(4)} per call` : 'No cost data'
  });
  
  // Transcript Availability Bonus (0-5 points)
  const transcriptScore = hasTranscript ? 5 : 0;
  breakdown.push({
    category: 'Data Quality',
    score: transcriptScore,
    maxScore: 5,
    icon: Star,
    description: hasTranscript ? 'Full transcript available' : 'No transcript'
  });
  
  const totalScore = sentimentScore + durationScore + outcomeScore + costScore + transcriptScore;
  const maxScore = 100;
  
  // Calculate grade
  let grade = 'F';
  const percentage = (totalScore / maxScore) * 100;
  if (percentage >= 90) grade = 'A+';
  else if (percentage >= 85) grade = 'A';
  else if (percentage >= 80) grade = 'A-';
  else if (percentage >= 75) grade = 'B+';
  else if (percentage >= 70) grade = 'B';
  else if (percentage >= 65) grade = 'B-';
  else if (percentage >= 60) grade = 'C+';
  else if (percentage >= 55) grade = 'C';
  else if (percentage >= 50) grade = 'C-';
  else if (percentage >= 45) grade = 'D+';
  else if (percentage >= 40) grade = 'D';
  else grade = 'F';
  
  return { totalScore, maxScore, grade, breakdown };
};

const getGradeColor = (grade: string): string => {
  if (grade.startsWith('A')) return 'border-success/40 bg-success/20 text-success shadow-success/10';
  if (grade.startsWith('B')) return 'border-info/40 bg-info/20 text-info shadow-info/10';
  if (grade.startsWith('C')) return 'border-brand-300/40 bg-brand-500/20 text-brand-100 shadow-brand-500/10';
  if (grade.startsWith('D')) return 'border-warning/40 bg-warning/20 text-warning shadow-warning/10';
  return 'border-destructive/40 bg-destructive/20 text-destructive shadow-destructive/10';
};

const getGradeTextColor = (grade: string): string => {
  if (grade.startsWith('A')) return 'text-success';
  if (grade.startsWith('B')) return 'text-info';
  if (grade.startsWith('C')) return 'text-brand-500';
  if (grade.startsWith('D')) return 'text-warning';
  return 'text-destructive';
};

const getTrendIcon = (score: number, maxScore: number) => {
  const percentage = (score / maxScore) * 100;
  if (percentage >= 70) return <TrendingUp className="w-3 h-3 text-success" />;
  if (percentage >= 40) return <Minus className="w-3 h-3 text-brand-500" />;
  return <TrendingDown className="w-3 h-3 text-destructive" />;
};

export const CallQualityScore = ({
  sentiment,
  durationSeconds,
  outcome,
  cost,
  hasTranscript,
  compact = false,
}: CallQualityScoreProps) => {
  const { totalScore, maxScore, grade, breakdown } = useMemo(
    () => calculateCallQualityScore(sentiment, durationSeconds, outcome, cost, hasTranscript),
    [sentiment, durationSeconds, outcome, cost, hasTranscript]
  );
  
  const percentage = (totalScore / maxScore) * 100;
  
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              className={cn(callLogBadgeBase, getGradeColor(grade), 'cursor-help px-3 font-bold tracking-wide')}
            >
              {grade}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="w-64 p-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Quality Score</span>
                <span className={`font-bold ${getGradeTextColor(grade)}`}>
                  {totalScore}/{maxScore}
                </span>
              </div>
              <Progress value={percentage} className="h-2" />
              <div className="space-y-1 text-xs">
                {breakdown.map((item) => (
                  <div key={item.category} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{item.category}</span>
                    <span>{item.score}/{item.maxScore}</span>
                  </div>
                ))}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Header with Grade */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full border shadow-sm ${getGradeColor(grade)} flex items-center justify-center`}>
            <span className="text-foreground dark:text-white font-bold text-lg">{grade}</span>
          </div>
          <div>
            <p className="font-semibold">Call Quality Score</p>
            <p className="text-sm text-muted-foreground">
              {totalScore} / {maxScore} points
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-bold ${getGradeTextColor(grade)}`}>
            {Math.round(percentage)}%
          </p>
        </div>
      </div>
      
      {/* Progress Bar */}
      <Progress value={percentage} className="h-3" />
      
      {/* Breakdown */}
      <div className="space-y-3">
        {breakdown.map((item) => {
          const Icon = item.icon;
          const itemPercentage = (item.score / item.maxScore) * 100;
          return (
            <div key={item.category} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{item.category}</span>
                  {getTrendIcon(item.score, item.maxScore)}
                </div>
                <span className="text-sm font-semibold">
                  {item.score}/{item.maxScore}
                </span>
              </div>
              <Progress value={itemPercentage} className="h-1.5" />
              <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Badge-only component for list views
export const CallQualityBadge = ({
  sentiment,
  durationSeconds,
  outcome,
  cost,
  hasTranscript,
}: Omit<CallQualityScoreProps, 'compact'>) => {
  return (
    <CallQualityScore
      sentiment={sentiment}
      durationSeconds={durationSeconds}
      outcome={outcome}
      cost={cost}
      hasTranscript={hasTranscript}
      compact
    />
  );
};
