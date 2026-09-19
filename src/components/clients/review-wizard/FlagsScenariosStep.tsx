import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  AlertCircle, 
  AlertTriangle, 
  Info,
  TrendingUp,
  TrendingDown,
  Percent,
  Calendar
} from 'lucide-react';
import type { ValidationFlag, Scenario } from './types';

interface FlagsScenariosStepProps {
  flags: ValidationFlag[];
  scenarios: Scenario[];
}

export function FlagsScenariosStep({ flags, scenarios }: FlagsScenariosStepProps) {
  const criticalFlags = flags.filter(f => f.severity === 'critical');
  const highFlags = flags.filter(f => f.severity === 'high');
  const mediumFlags = flags.filter(f => f.severity === 'medium');
  const lowFlags = flags.filter(f => f.severity === 'low');

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'high':
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case 'medium':
        return <AlertTriangle className="h-4 w-4 text-brand-600" />;
      default:
        return <Info className="h-4 w-4 text-info" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <Badge className="bg-destructive/10 text-destructive border-destructive/20">Critical</Badge>;
      case 'high':
        return <Badge className="bg-warning/10 text-warning border-warning/20">High</Badge>;
      case 'medium':
        return <Badge className="bg-brand-500/10 text-brand-600 border-brand-500/20">Medium</Badge>;
      default:
        return <Badge className="bg-info/10 text-info border-info/20">Low</Badge>;
    }
  };

  const formatCurrency = (value: number) => {
    const absValue = Math.abs(value);
    const sign = value >= 0 ? '+' : '-';
    return `${sign}$${absValue.toLocaleString('en-AU')}`;
  };

  return (
    <div className="space-y-6">
      {/* Flags Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className={criticalFlags.length > 0 ? 'border-destructive/30 bg-destructive/50' : ''}>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-destructive">{criticalFlags.length}</div>
            <p className="text-xs text-muted-foreground">Critical</p>
          </CardContent>
        </Card>
        <Card className={highFlags.length > 0 ? 'border-warning/30 bg-warning/50' : ''}>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-warning">{highFlags.length}</div>
            <p className="text-xs text-muted-foreground">High</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-brand-600">{mediumFlags.length}</div>
            <p className="text-xs text-muted-foreground">Medium</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-info">{lowFlags.length}</div>
            <p className="text-xs text-muted-foreground">Low</p>
          </CardContent>
        </Card>
      </div>

      {/* Validation Flags */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Validation Flags</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {flags.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No validation flags - all data looks good!</p>
            </div>
          ) : (
            <>
              {/* Critical & High first */}
              {[...criticalFlags, ...highFlags].map((flag, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-2 bg-destructive/30">
                  <div className="flex items-start gap-3">
                    {getSeverityIcon(flag.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {getSeverityBadge(flag.severity)}
                        <Badge variant="outline" className="text-xs">{flag.field}</Badge>
                      </div>
                      <p className="text-sm mt-1">{flag.message}</p>
                      {flag.propertyAddress && (
                        <p className="text-xs text-muted-foreground mt-1">{flag.propertyAddress}</p>
                      )}
                      {flag.recommendation && (
                        <p className="text-xs text-info mt-1">→ {flag.recommendation}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Medium & Low */}
              {[...mediumFlags, ...lowFlags].map((flag, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-start gap-3">
                    {getSeverityIcon(flag.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {getSeverityBadge(flag.severity)}
                        <Badge variant="outline" className="text-xs">{flag.field}</Badge>
                      </div>
                      <p className="text-sm mt-1">{flag.message}</p>
                      {flag.propertyAddress && (
                        <p className="text-xs text-muted-foreground mt-1">{flag.propertyAddress}</p>
                      )}
                      {flag.recommendation && (
                        <p className="text-xs text-info mt-1">→ {flag.recommendation}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {/* Scenarios */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">What-If Scenarios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            See how different market conditions could impact your portfolio cash flow.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            {scenarios.map((scenario, i) => (
              <div key={i} className="min-w-0 border rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  {scenario.impact.cashFlowChange >= 0 ? (
                    <TrendingUp className="h-5 w-5 text-success" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-destructive" />
                  )}
                  <h4 className="font-medium">{scenario.name}</h4>
                </div>
                
                <p className="text-xs text-muted-foreground">{scenario.description}</p>
                
                <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Cash Flow Impact</p>
                    <p className={`text-lg font-bold ${
                      scenario.impact.cashFlowChange >= 0 ? 'text-success' : 'text-destructive'
                    }`}>
                      {formatCurrency(scenario.impact.cashFlowChange)}/mo
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">New Monthly CF</p>
                    <p className={`text-lg font-bold ${
                      scenario.impact.newNetCashflow >= 0 ? 'text-success' : 'text-destructive'
                    }`}>
                      {formatCurrency(scenario.impact.newNetCashflow)}/mo
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
