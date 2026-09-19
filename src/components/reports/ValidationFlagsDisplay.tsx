import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertTriangle, Info, XCircle, CheckCircle } from "lucide-react";
import type { ValidationFlag } from "@/types/validation";

interface ValidationFlagsDisplayProps {
  flags: ValidationFlag[];
  qualityScore?: number;
  showEmpty?: boolean;
}

export function ValidationFlagsDisplay({ flags, qualityScore, showEmpty = true }: ValidationFlagsDisplayProps) {
  if (flags.length === 0 && !showEmpty) {
    return null;
  }

  const criticalFlags = flags.filter(f => f.severity === 'critical');
  const highFlags = flags.filter(f => f.severity === 'high');
  const mediumFlags = flags.filter(f => f.severity === 'medium');
  const lowFlags = flags.filter(f => f.severity === 'low');

  const getSeverityIcon = (severity: ValidationFlag['severity']) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'high':
        return <AlertTriangle className="h-4 w-4 text-destructive" />;
      case 'medium':
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case 'low':
        return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getSeverityVariant = (severity: ValidationFlag['severity']): "destructive" | "default" | "secondary" => {
    switch (severity) {
      case 'critical':
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      case 'low':
        return 'secondary';
    }
  };

  const getTypeIcon = (type: ValidationFlag['type']) => {
    switch (type) {
      case 'error':
        return '⛔';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
    }
  };

  const getQualityColor = (score: number): string => {
    if (score >= 90) return 'text-success dark:text-success';
    if (score >= 75) return 'text-info dark:text-info';
    if (score >= 60) return 'text-brand-600 dark:text-brand-400';
    if (score >= 40) return 'text-warning dark:text-warning';
    return 'text-destructive dark:text-destructive';
  };

  const getQualityGrade = (score: number): string => {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B+';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C+';
    if (score >= 50) return 'C';
    return 'D';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Data Validation Results</CardTitle>
            <CardDescription>
              {flags.length === 0 ? 'All validation checks passed' : `${flags.length} validation issue${flags.length !== 1 ? 's' : ''} detected`}
            </CardDescription>
          </div>
          {qualityScore !== undefined && (
            <div className="text-center">
              <div className={`text-4xl font-bold ${getQualityColor(qualityScore)}`}>
                {qualityScore}
              </div>
              <div className="text-sm text-muted-foreground">
                Quality Score
              </div>
              <Badge variant="outline" className="mt-1">
                Grade: {getQualityGrade(qualityScore)}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {flags.length === 0 ? (
          <Alert>
            <CheckCircle className="h-4 w-4 text-success" />
            <AlertTitle>No Issues Found</AlertTitle>
            <AlertDescription>
              All financial calculations and data points have passed validation checks.
            </AlertDescription>
          </Alert>
        ) : (
          <Accordion type="multiple" className="w-full">
            {criticalFlags.length > 0 && (
              <AccordionItem value="critical">
                <AccordionTrigger className="text-destructive hover:no-underline">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5" />
                    <span className="font-semibold">Critical Issues ({criticalFlags.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-2">
                    {criticalFlags.map((flag, idx) => (
                      <Alert key={idx} variant="destructive">
                        <div className="flex items-start gap-3">
                          <span className="text-xl">{getTypeIcon(flag.type)}</span>
                          <div className="flex-1">
                            <AlertTitle className="text-sm font-semibold mb-1">
                              {flag.field.replace(/_/g, ' ').toUpperCase()}
                            </AlertTitle>
                            <AlertDescription className="text-sm">
                              <div className="mb-2">{flag.message}</div>
                              {flag.expected_range && (
                                <div className="text-xs bg-destructive/10 p-2 rounded mb-2">
                                  <strong>Expected:</strong> {flag.expected_range}
                                  <br />
                                  <strong>Current:</strong> {typeof flag.value === 'number' ? flag.value.toLocaleString('en-AU') : flag.value}
                                </div>
                              )}
                              {flag.recommendation && (
                                <div className="text-xs italic text-muted-foreground">
                                  💡 {flag.recommendation}
                                </div>
                              )}
                            </AlertDescription>
                          </div>
                        </div>
                      </Alert>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {highFlags.length > 0 && (
              <AccordionItem value="high">
                <AccordionTrigger className="text-destructive hover:no-underline">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" />
                    <span className="font-semibold">High Priority Issues ({highFlags.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-2">
                    {highFlags.map((flag, idx) => (
                      <Alert key={idx} variant="destructive">
                        <div className="flex items-start gap-3">
                          <span className="text-xl">{getTypeIcon(flag.type)}</span>
                          <div className="flex-1">
                            <AlertTitle className="text-sm font-semibold mb-1">
                              {flag.field.replace(/_/g, ' ').toUpperCase()}
                            </AlertTitle>
                            <AlertDescription className="text-sm">
                              <div className="mb-2">{flag.message}</div>
                              {flag.expected_range && (
                                <div className="text-xs bg-destructive/10 p-2 rounded mb-2">
                                  <strong>Expected:</strong> {flag.expected_range}
                                  <br />
                                  <strong>Current:</strong> {typeof flag.value === 'number' ? flag.value.toLocaleString('en-AU') : flag.value}
                                </div>
                              )}
                              {flag.recommendation && (
                                <div className="text-xs italic">
                                  💡 {flag.recommendation}
                                </div>
                              )}
                            </AlertDescription>
                          </div>
                        </div>
                      </Alert>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {mediumFlags.length > 0 && (
              <AccordionItem value="medium">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-warning" />
                    <span className="font-semibold">Medium Priority Warnings ({mediumFlags.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-2">
                    {mediumFlags.map((flag, idx) => (
                      <Alert key={idx}>
                        <div className="flex items-start gap-3">
                          <span className="text-xl">{getTypeIcon(flag.type)}</span>
                          <div className="flex-1">
                            <AlertTitle className="text-sm font-semibold mb-1">
                              {flag.field.replace(/_/g, ' ').toUpperCase()}
                            </AlertTitle>
                            <AlertDescription className="text-sm">
                              <div className="mb-2">{flag.message}</div>
                              {flag.expected_range && (
                                <div className="text-xs bg-muted p-2 rounded mb-2">
                                  <strong>Expected:</strong> {flag.expected_range}
                                  <br />
                                  <strong>Current:</strong> {typeof flag.value === 'number' ? flag.value.toLocaleString('en-AU') : flag.value}
                                </div>
                              )}
                              {flag.recommendation && (
                                <div className="text-xs italic text-muted-foreground">
                                  💡 {flag.recommendation}
                                </div>
                              )}
                            </AlertDescription>
                          </div>
                        </div>
                      </Alert>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {lowFlags.length > 0 && (
              <AccordionItem value="low">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Info className="h-5 w-5 text-muted-foreground" />
                    <span className="font-semibold">Low Priority Info ({lowFlags.length})</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 pt-2">
                    {lowFlags.map((flag, idx) => (
                      <div key={idx} className="text-sm border-l-2 border-muted pl-4 py-2">
                        <div className="font-medium mb-1">
                          {flag.field.replace(/_/g, ' ').toUpperCase()}
                        </div>
                        <div className="text-muted-foreground mb-1">{flag.message}</div>
                        {flag.recommendation && (
                          <div className="text-xs italic text-muted-foreground">
                            💡 {flag.recommendation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
