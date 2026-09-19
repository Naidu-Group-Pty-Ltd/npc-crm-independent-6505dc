/**
 * The results of a property comparison, as one panel both surfaces mount.
 *
 * There were two of these. The modal that runs an analysis drew a six-tab
 * results view, and the library's viewer drew a different four-tab one with
 * its own layouts, its own empty-states and no Final tab — so what a person
 * saw depended on whether they watched the analysis finish or opened the same
 * row a minute later from Generated Reports. This panel is the content both
 * mount; the chrome around it (the modal's re-run and history, the viewer's
 * title and provenance alerts) stays with each surface.
 *
 * Everything here renders a NORMALISED analysis (`normaliseComparisonAnalysis`
 * / `analysisFromComparisonRow`) and guards what it prints: the producer may
 * omit any section or any axis inside one, and severity / risk level / value
 * are optional in the response schema. Each section mounts under its own
 * ErrorBoundary so a surprising row degrades to a per-section notice, never a
 * dead page. Score denominators are DETECTED, not asserted: six stored
 * comparisons score 0–10 (docs/reports/COMPARISON.md F9), and printing 9.2/100
 * asserts a number the model did not write — `detectScale` is the same
 * authority the typeset PDF uses.
 */
import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, DollarSign,
  MapPin, Target, TrendingUp, Trophy, XCircle,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { absentComparisonSections } from './comparisonRecovery.pure';
import { detectScale } from '@/lib/reports/propertyComparison/normalise.pure';

/**
 * The shape this panel renders. Structurally satisfied by the modal's fresh
 * (normalised) analysis and by the viewer's stored-row reading alike.
 */
export interface ComparisonAnalysisView {
  executiveSummary: string;
  rankings: any[];
  financialComparison: Record<string, any>;
  locationComparison: Record<string, any>;
  riskComparison: Record<string, any>;
  investorMatches: any[];
  competitiveAdvantages: any[];
  redFlags: any[];
  finalRecommendation: Record<string, any>;
}

function getRankIcon(rank: number) {
  if (rank === 1) return <Trophy className="h-5 w-5 text-brand-500" />;
  if (rank === 2) return <Trophy className="h-5 w-5 text-muted-foreground" />;
  if (rank === 3) return <Trophy className="h-5 w-5 text-warning" />;
  return <Target className="h-5 w-5 text-muted-foreground" />;
}

// Both take whatever the model wrote — `riskLevel` and `severity` are optional
// in the response schema, and calling `.toLowerCase()` on an absent one is a
// page-level crash, not a styling nit.
function getRiskColor(riskLevel: string | null | undefined) {
  const level = (riskLevel || '').toLowerCase();
  if (level.includes('low')) return 'text-success bg-success/10 border-success/30';
  if (level.includes('high')) return 'text-destructive bg-destructive/10 border-destructive/30';
  return 'text-brand-600 bg-brand-50 border-brand-200';
}

function getSeverityIcon(severity: string | null | undefined) {
  const sev = (severity || '').toLowerCase();
  if (sev.includes('high') || sev.includes('critical')) return <XCircle className="h-4 w-4 text-destructive" />;
  if (sev.includes('medium')) return <AlertCircle className="h-4 w-4 text-brand-500" />;
  return <AlertTriangle className="h-4 w-4 text-warning" />;
}

// ── Results sections ────────────────────────────────────────────────────────
//
// Extracted from inline JSX for two reasons, both learned on 2026-08-26 when a
// completed comparison took down the whole Generated Reports page behind a
// "Comparison Complete" toast. Each section GUARDS what it renders — the
// producer may omit any section, or any axis inside one (a stored
// financialComparison held only `bestYield`), and the response schema names
// the verdict `recommendations` while this view reads `finalRecommendation`.
// And each mounts under its own ErrorBoundary: a boundary only catches throws
// in components BELOW it, so a section must be a component for the boundary to
// contain it — inline JSX throws in the dialog's own render and unmounts the
// page.

/** A value that may be printed as text, or null when it is not printable. */
const asText = (v: unknown): string | null =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : null;

const sectionHasContent = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length > 0;
  return true;
};

function SectionNotProduced({ name }: { name: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <AlertCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
      <p className="text-sm font-medium">The {name} section was not produced for this run</p>
      <p className="mt-1 text-xs text-muted-foreground">
        The model ran out of room or had nothing recorded for it. Re-run the analysis to try for a
        complete document.
      </p>
    </div>
  );
}

function SectionRenderFailure({ name }: { name: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm">
      <p className="font-medium">The {name} section could not be displayed</p>
      <p className="mt-1 text-xs text-muted-foreground">
        The rest of the analysis is unaffected. Re-run the analysis, or download the PDF instead.
      </p>
    </div>
  );
}

function FinancialComparisonSection({ analysis }: { analysis: ComparisonAnalysisView }) {
  const fin = (analysis.financialComparison || {}) as Record<string, any>;
  const axes = [
    { key: 'bestYield', title: 'Best Rental Yield', valueLabel: 'Yield', icon: <TrendingUp className="h-4 w-4 text-success" /> },
    { key: 'bestCashFlow', title: 'Best Cash Flow', valueLabel: 'Monthly', icon: <DollarSign className="h-4 w-4 text-info" /> },
    { key: 'bestROI', title: 'Best ROI Projection', valueLabel: 'Expected ROI', icon: <TrendingUp className="h-4 w-4 text-accent" /> },
    { key: 'bestValue', title: 'Best Value', valueLabel: null as string | null, icon: <Target className="h-4 w-4 text-warning" /> },
  ].filter((axis) => sectionHasContent(fin[axis.key]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Financial Performance Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {axes.length === 0 ? (
          <SectionNotProduced name="financial comparison" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {axes.map((axis) => {
              const winner = fin[axis.key] || {};
              return (
                <Card key={axis.key}>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      {axis.icon}
                      {axis.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Property</span>
                        <Badge>#{asText(winner.propertyNumber) ?? '—'}</Badge>
                      </div>
                      {axis.valueLabel && asText(winner.value) && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{axis.valueLabel}</span>
                          <span className="font-medium">{asText(winner.value)}</span>
                        </div>
                      )}
                      {asText(winner.reason) && (
                        <p className="text-xs text-muted-foreground mt-2">{asText(winner.reason)}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LocationComparisonSection({ analysis }: { analysis: ComparisonAnalysisView }) {
  const entries = Object.entries((analysis.locationComparison || {}) as Record<string, any>)
    .filter(([, value]) => sectionHasContent(value));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Location Intelligence Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length === 0 ? (
          <SectionNotProduced name="location comparison" />
        ) : (
          <div className="grid gap-4">
            {entries.map(([key, value]) => (
              <Card key={key}>
                <CardHeader>
                  <CardTitle className="text-base capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Leading Property</span>
                    <Badge>Property #{asText(value?.propertyNumber) ?? '—'}</Badge>
                  </div>
                  {asText(value?.reason) && (
                    <p className="text-sm text-muted-foreground">{asText(value?.reason)}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RiskComparisonSection({ analysis }: { analysis: ComparisonAnalysisView }) {
  const risk = (analysis.riskComparison || {}) as Record<string, any>;
  const riskLevels: any[] = Array.isArray(risk.riskLevels) ? risk.riskLevels : [];
  const redFlags: any[] = Array.isArray(analysis.redFlags) ? analysis.redFlags : [];
  const hasAnything = sectionHasContent(risk) || redFlags.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Risk Assessment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasAnything && <SectionNotProduced name="risk assessment" />}

        {(sectionHasContent(risk.lowestRisk) || sectionHasContent(risk.highestRisk)) && (
          <div className="grid gap-4 md:grid-cols-2">
            {sectionHasContent(risk.lowestRisk) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base text-success">Lowest Risk</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Property</span>
                    <Badge variant="outline">#{asText(risk.lowestRisk?.propertyNumber) ?? '—'}</Badge>
                  </div>
                  {asText(risk.lowestRisk?.reason) && (
                    <p className="text-sm text-muted-foreground">{asText(risk.lowestRisk?.reason)}</p>
                  )}
                </CardContent>
              </Card>
            )}

            {sectionHasContent(risk.highestRisk) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base text-destructive">Highest Risk</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Property</span>
                    <Badge variant="outline">#{asText(risk.highestRisk?.propertyNumber) ?? '—'}</Badge>
                  </div>
                  {asText(risk.highestRisk?.reason) && (
                    <p className="text-sm text-muted-foreground">{asText(risk.highestRisk?.reason)}</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {riskLevels.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Risk Levels by Property</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {riskLevels.map((riskRow, index) => (
                <div key={`${asText(riskRow?.propertyNumber) ?? 'p'}-${index}`} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Property {asText(riskRow?.propertyNumber) ?? '—'}</span>
                    <Badge className={getRiskColor(asText(riskRow?.riskLevel))}>
                      {asText(riskRow?.riskLevel) ?? 'Unrated'}
                    </Badge>
                  </div>
                  {(Array.isArray(riskRow?.specificRisks) ? riskRow.specificRisks : []).length > 0 && (
                    <ul className="space-y-1 mt-2">
                      {riskRow.specificRisks.map((riskItem: unknown, i: number) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                          <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          {asText(riskItem)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {redFlags.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-destructive flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                Red Flags & Concerns
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {redFlags.map((flag, index) => (
                <div key={`${asText(flag?.propertyNumber) ?? 'p'}-${index}`} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Property {asText(flag?.propertyNumber) ?? '—'}</span>
                    <div className="flex items-center gap-2">
                      {getSeverityIcon(asText(flag?.severity))}
                      {asText(flag?.severity) && <Badge variant="destructive">{asText(flag?.severity)}</Badge>}
                    </div>
                  </div>
                  <ul className="space-y-1">
                    {(Array.isArray(flag?.concerns) ? flag.concerns : []).map((concern: unknown, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                        <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        {asText(concern)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}

function FinalRecommendationSection({ analysis }: { analysis: ComparisonAnalysisView }) {
  const fr = (analysis.finalRecommendation || {}) as Record<string, any>;
  const runners: any[] = Array.isArray(fr.runners) ? fr.runners : [];
  const scenarios: any[] = Array.isArray(fr.alternativeScenarios) ? fr.alternativeScenarios : [];
  const matches: any[] = Array.isArray(analysis.investorMatches) ? analysis.investorMatches : [];
  const hasAnything = sectionHasContent(fr) || matches.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-brand-500" />
          Final Recommendation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasAnything && <SectionNotProduced name="final recommendation" />}

        {sectionHasContent(fr.bestOverall) && (
          <Card className="border-2 border-primary">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Trophy className="h-6 w-6 text-brand-500" />
                Best Overall Investment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-3">
                <span className="text-lg font-semibold">
                  Property #{asText(fr.bestOverall?.propertyNumber) ?? '—'}
                </span>
                <Badge className="text-lg px-4 py-1">Top Choice</Badge>
              </div>
              {asText(fr.bestOverall?.reason) && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {asText(fr.bestOverall?.reason)}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {runners.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Runner-Up Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {runners.map((runner, index) => (
                <div key={index} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">Property #{asText(runner?.propertyNumber) ?? '—'}</span>
                    <Badge variant="secondary">Close Second</Badge>
                  </div>
                  {asText(runner?.reason) && (
                    <p className="text-sm text-muted-foreground">{asText(runner?.reason)}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {scenarios.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Alternative Scenarios</CardTitle>
              <CardDescription>
                Recommendations based on different investment goals
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {scenarios.map((scenario, index) => (
                <div key={index} className="border rounded-lg p-3">
                  {asText(scenario?.scenario) && (
                    <h5 className="font-medium text-sm mb-2">{asText(scenario?.scenario)}</h5>
                  )}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm text-muted-foreground">Recommended:</span>
                    <Badge>Property #{asText(scenario?.recommendation) ?? '—'}</Badge>
                  </div>
                  {asText(scenario?.reason) && (
                    <p className="text-xs text-muted-foreground">{asText(scenario?.reason)}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {matches.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Investor Profile Matching</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {matches.map((match, index) => (
                <div key={`${asText(match?.propertyNumber) ?? 'p'}-${index}`} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">Property {asText(match?.propertyNumber) ?? '—'}</span>
                    <div className="flex gap-1 flex-wrap">
                      {(Array.isArray(match?.investorTypes) ? match.investorTypes : []).map((type: unknown, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {asText(type)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {asText(match?.reasoning) && (
                    <p className="text-xs text-muted-foreground">{asText(match?.reasoning)}</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}

export function ComparisonResultsPanel({
  analysis,
  showAbsentBanner = true,
}: {
  analysis: ComparisonAnalysisView;
  /** The viewer's salvaged path announces what is missing itself. */
  showAbsentBanner?: boolean;
}) {
  const absentSections = useMemo(
    () => (showAbsentBanner ? absentComparisonSections(analysis as any) : []),
    [analysis, showAbsentBanner],
  );
  // One reading per comparison, never per score — the scale is a property of
  // the model call that produced the set (COMPARISON.md §4).
  const scoreScale = useMemo(() => {
    const scores = (analysis.rankings || [])
      .map((r: any) => r?.finalScore)
      .filter((s: any): s is number => typeof s === 'number' && Number.isFinite(s));
    return detectScale(scores)?.outOf ?? 100;
  }, [analysis]);

  return (
    <>
      {absentSections.length > 0 && (
        <Card className="mb-4 border-warning/30 bg-warning/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="text-sm">
              <p className="font-medium">This analysis is incomplete</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The model did not produce: {absentSections.join(', ')}. Everything shown below is
                complete — use Re-run Analysis to try for the missing sections.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rankings">Rankings</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="location">Location</TabsTrigger>
          <TabsTrigger value="risk">Risk</TabsTrigger>
          <TabsTrigger value="recommendation">Final</TabsTrigger>
        </TabsList>

        <div className="mt-4 min-w-0">
          <TabsContent value="overview" className="space-y-4 mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Executive Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {analysis.executiveSummary}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Comparison</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(analysis.rankings || []).map((ranking) => (
                  <div
                    key={ranking.propertyNumber}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                  >
                    <div className="mt-1">{getRankIcon(ranking.rank)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline">#{ranking.rank}</Badge>
                        <h4 className="font-medium text-sm truncate">{ranking.address}</h4>
                        <Badge className="ml-auto">
                          {typeof ranking.finalScore === 'number' ? ranking.finalScore.toFixed(1) : ranking.finalScore}/{scoreScale}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {ranking.bestSuitedFor}
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {(ranking.primaryStrengths || []).slice(0, 2).map((strength, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {strength}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rankings" className="space-y-4 mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Detailed Rankings</CardTitle>
                <CardDescription>
                  Comprehensive ranking of all properties with strengths and concerns
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(analysis.rankings || []).map((ranking) => (
                  <Card key={ranking.propertyNumber}>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          {getRankIcon(ranking.rank)}
                          <div>
                            <CardTitle className="text-lg">
                              Rank #{ranking.rank}: Property {ranking.propertyNumber}
                            </CardTitle>
                            <CardDescription className="mt-1">
                              {ranking.address}
                            </CardDescription>
                          </div>
                        </div>
                        <Badge className="text-lg px-3 py-1">
                          {typeof ranking.finalScore === 'number' ? ranking.finalScore.toFixed(1) : ranking.finalScore}/{scoreScale}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <h5 className="text-sm font-medium mb-2 flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-success" />
                          Primary Strengths
                        </h5>
                        <ul className="space-y-1">
                          {(ranking.primaryStrengths || []).map((strength, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" />
                              {strength}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <Separator />

                      <div>
                        <h5 className="text-sm font-medium mb-2 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-warning" />
                          Primary Concerns
                        </h5>
                        <ul className="space-y-1">
                          {(ranking.primaryConcerns || []).map((concern, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" />
                              {concern}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <Separator />

                      <div>
                        <h5 className="text-sm font-medium mb-2">Best Suited For</h5>
                        <Badge variant="secondary" className="text-sm">
                          {ranking.bestSuitedFor}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="financial" className="space-y-4 mt-0">
            <ErrorBoundary fallback={<SectionRenderFailure name="financial comparison" />}>
              <FinancialComparisonSection analysis={analysis} />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="location" className="space-y-4 mt-0">
            <ErrorBoundary fallback={<SectionRenderFailure name="location comparison" />}>
              <LocationComparisonSection analysis={analysis} />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="risk" className="space-y-4 mt-0">
            <ErrorBoundary fallback={<SectionRenderFailure name="risk assessment" />}>
              <RiskComparisonSection analysis={analysis} />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="recommendation" className="space-y-4 mt-0">
            <ErrorBoundary fallback={<SectionRenderFailure name="final recommendation" />}>
              <FinalRecommendationSection analysis={analysis} />
            </ErrorBoundary>
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}
