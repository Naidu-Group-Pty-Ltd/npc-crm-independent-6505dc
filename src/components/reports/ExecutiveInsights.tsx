import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PropertyListing } from '@/lib/airtable';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Info } from 'lucide-react';

interface ExecutiveInsightsProps {
  listings: PropertyListing[];
}

export function ExecutiveInsights({ listings }: ExecutiveInsightsProps) {
  const insights = useMemo(() => {
    if (!listings.length) return { insights: [], recommendations: [], anomalies: [] };

    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    const recent7 = listings.filter(l => l.receivedAt && new Date(l.receivedAt) >= last7Days);
    const recent30 = listings.filter(l => l.receivedAt && new Date(l.receivedAt) >= last30Days);
    
    // Market insights
    const weeklyVelocity = (recent7.length / 7) * 7; // Weekly rate
    const monthlyVelocity = (recent30.length / 30) * 30; // Monthly rate
    
    const pricesWithData = listings.filter(l => l.price && l.price > 0);
    const avgPrice = pricesWithData.length > 0 
      ? pricesWithData.reduce((sum, l) => sum + l.price!, 0) / pricesWithData.length
      : 0;
    
    const recentPrices = recent30.filter(l => l.price && l.price > 0);
    const recentAvgPrice = recentPrices.length > 0
      ? recentPrices.reduce((sum, l) => sum + l.price!, 0) / recentPrices.length
      : 0;
    
    const priceChange = avgPrice > 0 && recentAvgPrice > 0 
      ? ((recentAvgPrice - avgPrice) / avgPrice * 100)
      : 0;
    
    // Quality insights
    const withConfidence = listings.filter(l => l.confidence && l.confidence > 0);
    const avgConfidence = withConfidence.length > 0
      ? withConfidence.reduce((sum, l) => sum + l.confidence!, 0) / withConfidence.length * 100
      : 0;
    
    const lowConfidenceListings = listings.filter(l => l.confidence && l.confidence < 0.5).length;
    
    // Market coverage
    const suburbanData = listings.reduce((acc, l) => {
      const suburb = l.suburb || 'Unknown';
      acc[suburb] = (acc[suburb] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const topSuburbs = Object.entries(suburbanData)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    
    const marketConcentration = topSuburbs.reduce((sum, [, count]) => sum + count, 0) / listings.length * 100;
    
    // Generate insights
    const generatedInsights = [];
    const recommendations = [];
    const anomalies = [];
    
    // Velocity insights
    if (weeklyVelocity > monthlyVelocity * 1.2) {
      generatedInsights.push({
        type: 'positive',
        title: 'Accelerating Market Activity',
        description: `Weekly listing velocity (${weeklyVelocity.toFixed(1)}) is 20% above monthly average, indicating increased market activity.`,
      });
    } else if (weeklyVelocity < monthlyVelocity * 0.8) {
      generatedInsights.push({
        type: 'warning',
        title: 'Slowing Market Activity',
        description: `Weekly listing velocity (${weeklyVelocity.toFixed(1)}) is 20% below monthly average, suggesting market slowdown.`,
      });
    }
    
    // Price insights
    if (Math.abs(priceChange) > 5) {
      generatedInsights.push({
        type: priceChange > 0 ? 'positive' : 'negative',
        title: `${priceChange > 0 ? 'Price Appreciation' : 'Price Correction'}`,
        description: `Recent listings show ${Math.abs(priceChange).toFixed(1)}% ${priceChange > 0 ? 'increase' : 'decrease'} in average pricing.`,
      });
    }
    
    // Quality insights
    if (avgConfidence < 60) {
      generatedInsights.push({
        type: 'warning',
        title: 'Data Quality Concerns',
        description: `Average confidence score is ${avgConfidence.toFixed(1)}%. Consider reviewing data sources and extraction processes.`,
      });
      
      recommendations.push({
        priority: 'high',
        title: 'Improve Data Quality',
        description: `${lowConfidenceListings} listings have low confidence scores. Review and enhance data collection processes.`,
      });
    }
    
    // Market concentration
    if (marketConcentration > 50) {
      anomalies.push({
        severity: 'medium',
        title: 'High Market Concentration',
        description: `${marketConcentration.toFixed(1)}% of listings are concentrated in top 5 suburbs: ${topSuburbs.map(([suburb]) => suburb).join(', ')}.`,
      });
      
      recommendations.push({
        priority: 'medium',
        title: 'Diversify Market Coverage',
        description: 'Consider expanding data collection to more diverse geographic areas to reduce market concentration risk.',
      });
    }
    
    // Data completeness
    const incompleteListings = listings.filter(l => 
      !l.price || !l.suburb || !l.propertyType || !l.beds
    ).length;
    
    const completenessPercent = (incompleteListings / listings.length * 100);
    if (incompleteListings > listings.length * 0.2) {
      recommendations.push({
        priority: 'high',
        title: 'Address Data Completeness',
        description: `${incompleteListings} listings (${completenessPercent.toFixed(1)}%) have missing critical fields.`,
      });
      
      anomalies.push({
        severity: 'medium',
        title: 'Incomplete Listing Data',
        description: `${completenessPercent.toFixed(1)}% of listings are missing critical fields (price, suburb, type, or beds). This affects analysis accuracy.`,
      });
    }
    
    // Cross-link: if we have data quality recommendations, ensure a matching anomaly exists
    if (lowConfidenceListings > 0 && avgConfidence < 60) {
      anomalies.push({
        severity: avgConfidence < 40 ? 'high' : 'medium',
        title: 'Low Extraction Confidence',
        description: `${lowConfidenceListings} listings have confidence scores below 50%. Average confidence: ${avgConfidence.toFixed(1)}%.`,
      });
    }
    
    // Cross-link: if anomalies exist but no recommendations, add a general one
    if (anomalies.length > 0 && recommendations.length === 0) {
      recommendations.push({
        priority: 'low',
        title: 'Review Flagged Observations',
        description: `${anomalies.length} market observation(s) detected. Review the Market Observations panel for details and determine if action is needed.`,
      });
    }
    
    return { insights: generatedInsights, recommendations, anomalies };
  }, [listings]);

  return (
    <div className="space-y-6 reports-insight-suite">
      {/* Key Insights */}
      <Card className="reports-insight-card reports-executive-summary-card">
        <CardHeader className="reports-insight-card-header">
          <CardTitle>Executive Summary</CardTitle>
          <CardDescription>Key insights and market observations from your property data</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {insights.insights.length > 0 ? (
              insights.insights.map((insight, index) => (
                <Alert key={index} className={`reports-insight-alert reports-insight-alert-${insight.type} border-l-4 ${
                  insight.type === 'positive' ? 'border-l-success' :
                  insight.type === 'warning' ? 'border-l-warning' : 'border-l-destructive'
                }`}>
                  <div className="flex items-start gap-3">
                    <span className="reports-insight-icon-wrap">
                      {insight.type === 'positive' && <TrendingUp className="h-4 w-4 text-success" />}
                      {insight.type === 'warning' && <AlertTriangle className="h-4 w-4 text-warning" />}
                      {insight.type === 'negative' && <TrendingDown className="h-4 w-4 text-destructive" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="reports-insight-row-title">{insight.title}</div>
                      <AlertDescription className="reports-insight-row-description">
                        {insight.description}
                      </AlertDescription>
                    </div>
                  </div>
                </Alert>
              ))
            ) : (
              <Alert className="reports-insight-alert reports-insight-alert-neutral">
                <span className="reports-insight-icon-wrap"><Info className="h-4 w-4" /></span>
                <AlertDescription className="reports-insight-row-description">
                  Market conditions are stable with no significant trends requiring immediate attention.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Recommendations */}
        <Card className="reports-insight-card reports-action-card">
          <CardHeader className="reports-insight-card-header">
            <CardTitle>Action Items</CardTitle>
            <CardDescription>Recommended actions based on data analysis</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {insights.recommendations.length > 0 ? (
                insights.recommendations.map((rec, index) => (
                  <div key={index} className={`reports-insight-row reports-action-row reports-severity-${rec.priority}`}>
                    <span className="reports-insight-icon-wrap">
                      <CheckCircle className={`h-4 w-4 ${
                        rec.priority === 'high' ? 'text-destructive' :
                        rec.priority === 'medium' ? 'text-warning' : 'text-success'
                      }`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <div className="reports-insight-row-title">{rec.title}</div>
                        <Badge variant={
                          rec.priority === 'high' ? 'destructive' :
                          rec.priority === 'medium' ? 'secondary' : 'default'
                        } className={`reports-severity-badge reports-severity-${rec.priority}`}>
                          {rec.priority}
                        </Badge>
                      </div>
                      <div className="reports-insight-row-description">{rec.description}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="reports-empty-insight-state">
                  All key metrics are within expected ranges. No action items identified — market observations are also clear.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Anomalies */}
        <Card className="reports-insight-card reports-observation-card">
          <CardHeader className="reports-insight-card-header">
            <CardTitle>Market Observations</CardTitle>
            <CardDescription>Notable patterns and anomalies detected</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {insights.anomalies.length > 0 ? (
                insights.anomalies.map((anomaly, index) => (
                  <div key={index} className={`reports-insight-row reports-observation-row reports-severity-${anomaly.severity}`}>
                    <span className="reports-insight-icon-wrap">
                      <AlertTriangle className={`h-4 w-4 ${
                        anomaly.severity === 'high' ? 'text-destructive' :
                        anomaly.severity === 'medium' ? 'text-warning' : 'text-muted-foreground'
                      }`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <div className="reports-insight-row-title">{anomaly.title}</div>
                        <Badge variant="outline" className={`reports-severity-badge reports-severity-${anomaly.severity}`}>
                          {anomaly.severity}
                        </Badge>
                      </div>
                      <div className="reports-insight-row-description">{anomaly.description}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="reports-empty-insight-state">
                  No anomalies detected — all metrics are consistent and no action items have been flagged.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}