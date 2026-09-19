import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { PropertyListing } from '@/lib/airtable';
import { AlertTriangle, CheckCircle2, XCircle, Info, ChevronDown, ChevronUp, Lightbulb, Wrench, TrendingUp } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface DataQualityAnalysisProps {
  listings: PropertyListing[];
}

interface QualityIssue {
  label: string;
  count: number;
  severity: 'critical' | 'warning' | 'info';
  rootCause: string;
  remediation: string;
  impact: string;
}

export function DataQualityAnalysis({ listings }: DataQualityAnalysisProps) {
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);

  const qualityMetrics = useMemo(() => {
    if (!listings.length) return null;

    const fieldAnalysis = {
      required: [
        { field: 'address', label: 'Address', weight: 2 },
        { field: 'suburb', label: 'Suburb', weight: 2 },
        { field: 'price', label: 'Price', weight: 3 },
        { field: 'propertyType', label: 'Property Type', weight: 1 },
      ],
      important: [
        { field: 'beds', label: 'Bedrooms', weight: 1 },
        { field: 'baths', label: 'Bathrooms', weight: 1 },
        { field: 'agentName', label: 'Agent Name', weight: 1 },
        { field: 'agencyName', label: 'Agency Name', weight: 1 },
      ],
      optional: [
        { field: 'carSpaces', label: 'Car Spaces', weight: 0.5 },
        { field: 'landSize', label: 'Land Size', weight: 0.5 },
        { field: 'description', label: 'Description', weight: 0.5 },
        { field: 'images', label: 'Images', weight: 0.5 },
      ]
    };

    const calculateCompleteness = (fields: typeof fieldAnalysis.required) => {
      let totalWeight = 0;
      let filledWeight = 0;

      fields.forEach(({ field, weight }) => {
        totalWeight += weight;
        listings.forEach(listing => {
          const value = listing[field as keyof PropertyListing];
          if (value && 
              value !== 'Unknown' && 
              value !== 'Unknown Agent' && 
              value !== 'Unknown Agency' &&
              value !== 'Unknown Address' &&
              value !== 'Unknown Suburb') {
            if (field === 'price' && typeof value === 'number' && value > 0) {
              filledWeight += weight / listings.length;
            } else if (field !== 'price' && value) {
              filledWeight += weight / listings.length;
            }
          }
        });
      });

      return totalWeight > 0 ? (filledWeight / totalWeight) * 100 : 0;
    };

    // Data quality issues with remediation guidance
    const invalidPriceCount = listings.filter(l => l.price && (l.price <= 0 || l.price > 50000000)).length;
    const missingAgentCount = listings.filter(l => !l.agentName || l.agentName === 'Unknown Agent').length;
    const missingLocationCount = listings.filter(l => !l.address || l.address === 'Unknown Address').length;
    const lowConfidenceCount = listings.filter(l => l.confidence && l.confidence < 0.5).length;
    const missingDateCount = listings.filter(l => !l.receivedAt && !l.createdTime && !l.createdAt).length;

    const issues: QualityIssue[] = [
      {
        label: 'Invalid Prices',
        count: invalidPriceCount,
        severity: invalidPriceCount > 0 ? 'critical' : 'info',
        rootCause: 'Price extraction from email/PDF sources may misinterpret formatting (e.g., "$1,200 pw" rental vs sale price) or pull non-price numeric values.',
        remediation: 'Review flagged listings in the Listings page. Use the manual override modal to correct prices. Consider adding price validation rules to the email ingestion pipeline.',
        impact: 'Skews average price KPIs, distorts price range distribution charts, and reduces investment report accuracy.',
      },
      {
        label: 'Missing Agents',
        count: missingAgentCount,
        severity: missingAgentCount > 5 ? 'warning' : 'info',
        rootCause: 'Agent details are often embedded in email signatures or footers which the parser may not reliably extract, especially from image-heavy emails.',
        remediation: 'Cross-reference with agency CRM data. Enable the "Agent Extraction Enhancement" in Settings > Data Pipeline to improve parser accuracy.',
        impact: 'Reduces Agent Performance tab accuracy and limits agent-level reporting capability.',
      },
      {
        label: 'Missing Locations',
        count: missingLocationCount,
        severity: missingLocationCount > 0 ? 'critical' : 'info',
        rootCause: 'Address fields may be absent when listings arrive as attachments (PDFs/images) without structured text, or when the source email lacks explicit address formatting.',
        remediation: 'Use the Data Import page to bulk-update addresses. For recurring sources, configure address extraction patterns in Settings > Email Rules.',
        impact: 'Listings without locations are excluded from suburb analysis, geographic mapping, and suburb-level investment reports.',
      },
      {
        label: 'Low Confidence',
        count: lowConfidenceCount,
        severity: lowConfidenceCount > 10 ? 'warning' : 'info',
        rootCause: 'Low confidence scores indicate the AI parser was uncertain about extracted fields — typically caused by unstructured email formats, mixed-language content, or heavily styled HTML.',
        remediation: 'Review low-confidence listings individually. Flag recurring source formats for parser training. Consider manual verification for listings below 40% confidence.',
        impact: 'Low-confidence data may contain extraction errors that cascade into reports and comparisons.',
      },
      {
        label: 'Missing Dates',
        count: missingDateCount,
        severity: missingDateCount > 0 ? 'warning' : 'info',
        rootCause: 'Date fields rely on email "ReceivedAt" headers. Forwarded emails or manual imports may lack this metadata.',
        remediation: 'Ensure email forwarding rules preserve original headers. For manual imports, use the date field in the import CSV template.',
        impact: 'Listings without dates are excluded from temporal trend analysis and "Recent Listings" KPI calculations.',
      },
    ];

    // Confidence distribution
    const confidenceDistribution = {
      high: listings.filter(l => l.confidence && l.confidence >= 0.8).length,
      medium: listings.filter(l => l.confidence && l.confidence >= 0.5 && l.confidence < 0.8).length,
      low: listings.filter(l => l.confidence && l.confidence < 0.5).length,
      unknown: listings.filter(l => !l.confidence).length,
    };

    const totalWithConfidence = confidenceDistribution.high + confidenceDistribution.medium + confidenceDistribution.low;
    const avgConfidence = totalWithConfidence > 0
      ? listings.filter(l => l.confidence).reduce((s, l) => s + (l.confidence || 0), 0) / totalWithConfidence
      : 0;

    return {
      completeness: {
        required: calculateCompleteness(fieldAnalysis.required),
        important: calculateCompleteness(fieldAnalysis.important),
        optional: calculateCompleteness(fieldAnalysis.optional),
      },
      issues,
      confidenceDistribution,
      avgConfidence,
      totalListings: listings.length,
    };
  }, [listings]);

  if (!qualityMetrics) return null;

  const getCompletenessColor = (percentage: number) => {
    if (percentage >= 80) return 'text-success dark:text-success';
    if (percentage >= 60) return 'text-brand-600 dark:text-brand-400';
    return 'text-destructive dark:text-destructive';
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical': return 'destructive' as const;
      case 'warning': return 'secondary' as const;
      default: return 'outline' as const;
    }
  };

  const overallScore = (
    qualityMetrics.completeness.required * 0.5 + 
    qualityMetrics.completeness.important * 0.3 + 
    qualityMetrics.completeness.optional * 0.2
  );

  const activeIssues = qualityMetrics.issues.filter(i => i.count > 0);

  return (
    <div className="space-y-6 reports-quality-suite">
      {/* Overall Quality Score Banner */}
      <Card className="reports-quality-score-card border-l-4" style={{ borderLeftColor: overallScore >= 80 ? 'hsl(var(--chart-2))' : overallScore >= 60 ? 'hsl(var(--chart-3))' : 'hsl(var(--destructive))' }}>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="reports-quality-score-value text-3xl font-bold" style={{ color: overallScore >= 80 ? 'hsl(var(--chart-2))' : overallScore >= 60 ? 'hsl(var(--chart-3))' : 'hsl(var(--destructive))' }}>
                {overallScore.toFixed(0)}%
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Overall Data Quality Score</p>
                <p className="text-xs text-muted-foreground">
                  {activeIssues.length === 0 
                    ? 'All quality checks passed — no issues detected'
                    : `${activeIssues.length} issue${activeIssues.length > 1 ? 's' : ''} detected across ${qualityMetrics.totalListings} listings`
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={overallScore >= 80 ? 'default' : overallScore >= 60 ? 'secondary' : 'destructive'} className="reports-quality-status-badge">
                {overallScore >= 80 ? 'Healthy' : overallScore >= 60 ? 'Needs Attention' : 'Action Required'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Field Completeness */}
      <Card className="reports-quality-card">
        <CardHeader className="reports-quality-card-header">
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            Field Completeness
          </CardTitle>
          <CardDescription>
            Percentage of listings with complete data across different field categories
          </CardDescription>
        </CardHeader>
        <CardContent className="reports-quality-card-content space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="reports-completeness-tile space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Required Fields</span>
                <span className={`text-sm font-bold ${getCompletenessColor(qualityMetrics.completeness.required)}`}>
                  {qualityMetrics.completeness.required.toFixed(1)}%
                </span>
              </div>
              <Progress value={qualityMetrics.completeness.required} className="reports-quality-progress h-2" />
              <p className="text-xs text-muted-foreground">Address, Suburb, Price, Property Type</p>
            </div>

            <div className="reports-completeness-tile space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Important Fields</span>
                <span className={`text-sm font-bold ${getCompletenessColor(qualityMetrics.completeness.important)}`}>
                  {qualityMetrics.completeness.important.toFixed(1)}%
                </span>
              </div>
              <Progress value={qualityMetrics.completeness.important} className="reports-quality-progress h-2" />
              <p className="text-xs text-muted-foreground">Beds, Baths, Agent, Agency</p>
            </div>

            <div className="reports-completeness-tile space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Optional Fields</span>
                <span className={`text-sm font-bold ${getCompletenessColor(qualityMetrics.completeness.optional)}`}>
                  {qualityMetrics.completeness.optional.toFixed(1)}%
                </span>
              </div>
              <Progress value={qualityMetrics.completeness.optional} className="reports-quality-progress h-2" />
              <p className="text-xs text-muted-foreground">Car Spaces, Land Size, Description</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Quality Issues with Remediation */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="reports-quality-card">
          <CardHeader className="reports-quality-card-header">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Data Quality Issues
            </CardTitle>
            <CardDescription>
              Click any issue to see root cause and remediation steps
            </CardDescription>
          </CardHeader>
          <CardContent className="reports-quality-card-content space-y-2">
            {qualityMetrics.issues.map((issue) => (
              <Collapsible
                key={issue.label}
                open={expandedIssue === issue.label}
                onOpenChange={(open) => setExpandedIssue(open ? issue.label : null)}
              >
                <CollapsibleTrigger className="w-full">
                  <div className={`reports-quality-issue-row reports-quality-severity-${issue.severity}`}>
                    <div className="flex min-w-0 items-center gap-2">
                      {issue.count > 0 && issue.severity === 'critical' && <XCircle className="h-3.5 w-3.5 text-destructive" />}
                      {issue.count > 0 && issue.severity === 'warning' && <AlertTriangle className="h-3.5 w-3.5 text-brand-500" />}
                      {(issue.count === 0 || issue.severity === 'info') && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                      <span className="reports-quality-issue-label">{issue.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={issue.count > 0 ? getSeverityBadge(issue.severity) : 'outline'} className={`reports-quality-count-badge reports-quality-severity-${issue.severity}`}>
                        {issue.count}
                      </Badge>
                      {expandedIssue === issue.label ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="reports-quality-detail-panel ml-6 mr-2 mb-3 space-y-2.5">
                    <div className="flex items-start gap-2">
                      <Info className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Root Cause</p>
                        <p className="text-xs text-foreground">{issue.rootCause}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Wrench className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-primary">Remediation</p>
                        <p className="text-xs text-foreground">{issue.remediation}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <TrendingUp className="h-3.5 w-3.5 mt-0.5 text-brand-500 shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-brand-600 dark:text-brand-400">Impact</p>
                        <p className="text-xs text-foreground">{issue.impact}</p>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </CardContent>
        </Card>

        <Card className="reports-quality-card">
          <CardHeader className="reports-quality-card-header">
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-info" />
              Confidence Distribution
            </CardTitle>
            <CardDescription>
              Extraction confidence across all listings
            </CardDescription>
          </CardHeader>
          <CardContent className="reports-quality-card-content space-y-4">
            {/* Stacked horizontal bar */}
            {(() => {
              const tiers = [
                { label: 'High', count: qualityMetrics.confidenceDistribution.high, color: 'hsl(var(--chart-2))' },
                { label: 'Medium', count: qualityMetrics.confidenceDistribution.medium, color: 'hsl(var(--chart-3))' },
                { label: 'Low', count: qualityMetrics.confidenceDistribution.low, color: 'hsl(var(--destructive))' },
                { label: 'Unknown', count: qualityMetrics.confidenceDistribution.unknown, color: 'hsl(var(--muted-foreground))' },
              ];
              const total = qualityMetrics.totalListings;
              return (
                <div className="space-y-3">
                  <div className="reports-confidence-stack h-6 w-full rounded-full overflow-hidden flex bg-muted">
                    {tiers.map(tier => {
                      const pct = total > 0 ? (tier.count / total) * 100 : 0;
                      if (pct === 0) return null;
                      return (
                        <div
                          key={tier.label}
                          className="h-full transition-all relative group hover:brightness-110"
                          style={{ width: `${pct}%`, backgroundColor: tier.color }}
                          title={`${tier.label}: ${tier.count} (${pct.toFixed(0)}%)`}
                        />
                      );
                    })}
                  </div>
                  {/* Legend */}
                  <div className="reports-confidence-legend grid grid-cols-2 gap-2">
                    {tiers.map(tier => {
                      const pct = total > 0 ? (tier.count / total) * 100 : 0;
                      return (
                        <div key={tier.label} className="reports-confidence-legend-item flex items-center gap-2 text-xs">
                          <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: tier.color }} />
                          <span className="text-muted-foreground">{tier.label}</span>
                          <span className="font-semibold ml-auto">{tier.count} <span className="text-muted-foreground font-normal">({pct.toFixed(0)}%)</span></span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            
            <div className="pt-3 border-t space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Average Confidence</p>
                <p className="text-xs font-bold">{(qualityMetrics.avgConfidence * 100).toFixed(1)}%</p>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Overall Quality Score</p>
                <p className="text-xs font-bold">{overallScore.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actionable Summary */}
      {activeIssues.length > 0 && (
        <Card className="reports-quality-card reports-quality-actions-card">
          <CardHeader className="reports-quality-card-header pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-5 w-5 text-brand-500" />
              Recommended Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {activeIssues
                .sort((a, b) => {
                  const sevOrder = { critical: 0, warning: 1, info: 2 };
                  return (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2);
                })
                .slice(0, 4)
                .map(issue => (
                  <div key={issue.label} className={`reports-quality-action-row reports-quality-severity-${issue.severity}`}>
                    <Badge variant={getSeverityBadge(issue.severity)} className={`reports-quality-count-badge reports-quality-severity-${issue.severity} text-[10px] mt-0.5 shrink-0`}>
                      {issue.severity === 'critical' ? 'URGENT' : issue.severity === 'warning' ? 'REVIEW' : 'FYI'}
                    </Badge>
                    <div>
                      <p className="text-xs font-medium">{issue.label} ({issue.count})</p>
                      <p className="text-[11px] text-muted-foreground line-clamp-2">{issue.remediation}</p>
                    </div>
                  </div>
                ))
              }
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
