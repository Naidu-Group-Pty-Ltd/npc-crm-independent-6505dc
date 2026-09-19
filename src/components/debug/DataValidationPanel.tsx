import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, XCircle, AlertTriangle, RefreshCw, Database, BarChart3 } from 'lucide-react';
import { PropertyListing } from '@/lib/airtable';
import { propertyDataService } from '@/services/propertyDataService';
import { DataValidator, DataComparisonResult, logDataComparison } from '@/utils/dataValidation';

interface DataValidationPanelProps {
  dashboardData?: PropertyListing[];
  reportsData?: PropertyListing[];
  className?: string;
}

export function DataValidationPanel({ dashboardData, reportsData, className = '' }: DataValidationPanelProps) {
  const [isValidating, setIsValidating] = useState(false);
  const [comparison, setComparison] = useState<DataComparisonResult | null>(null);
  const [lastValidation, setLastValidation] = useState<Date | null>(null);

  const runValidation = async () => {
    if (!dashboardData || !reportsData) {
      // Fetch fresh data for comparison
      setIsValidating(true);
      try {
        console.log('Fetching fresh data for validation...');
        
        // Simulate dashboard data fetch (limited)
        const dashboardResult = await propertyDataService.fetchAllListings({ 
          maxRecords: 100,
          includeDebugInfo: true 
        });
        
        // Simulate reports data fetch (all records)
        const reportsResult = await propertyDataService.fetchAllListings({
          includeDebugInfo: true
        });

        // Clear cache and fetch again to test consistency
        propertyDataService.clearCache();
        const reportsResult2 = await propertyDataService.fetchAllListings({
          includeDebugInfo: true
        });

        const comparisonResult = DataValidator.compareDataSets(
          dashboardResult.listings.slice(0, 100), // Simulate dashboard limit
          reportsResult.listings
        );

        setComparison(comparisonResult);
        setLastValidation(new Date());
        
        // Log detailed results
        logDataComparison(comparisonResult);
        
        console.log('🔍 Additional Analysis:');
        console.log(`First reports fetch: ${reportsResult.listings.length} listings`);
        console.log(`Second reports fetch: ${reportsResult2.listings.length} listings`);
        console.log(`Cache consistency: ${reportsResult.listings.length === reportsResult2.listings.length ? '✅' : '❌'}`);

      } catch (error) {
        console.error('Validation failed:', error);
      } finally {
        setIsValidating(false);
      }
    } else {
      // Use provided data
      setIsValidating(true);
      const comparisonResult = DataValidator.compareDataSets(dashboardData, reportsData);
      setComparison(comparisonResult);
      setLastValidation(new Date());
      logDataComparison(comparisonResult);
      setIsValidating(false);
    }
  };

  useEffect(() => {
    if (dashboardData && reportsData && !comparison) {
      runValidation();
    }
  }, [dashboardData, reportsData]);

  const getDiscrepancyStatus = () => {
    if (!comparison) return null;
    
    if (comparison.discrepancy === 0) {
      return { color: 'green', icon: <CheckCircle className="h-4 w-4" />, text: 'Perfect Match' };
    } else if (comparison.discrepancy <= 5) {
      return { color: 'yellow', icon: <AlertTriangle className="h-4 w-4" />, text: 'Minor Discrepancy' };
    } else {
      return { color: 'red', icon: <XCircle className="h-4 w-4" />, text: 'Major Discrepancy' };
    }
  };

  const status = getDiscrepancyStatus();

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Data Validation Dashboard
        </CardTitle>
        <CardDescription>
          Compare data consistency between dashboard and reports
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {lastValidation && (
              <span className="text-sm text-muted-foreground">
                Last checked: {lastValidation.toLocaleTimeString('en-AU')}
              </span>
            )}
          </div>
          <Button 
            onClick={runValidation} 
            disabled={isValidating}
            size="sm"
            variant="outline"
          >
            {isValidating ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Validating...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Run Validation
              </>
            )}
          </Button>
        </div>

        {comparison && (
          <Tabs defaultValue="overview" className="w-full">
            <div className="overflow-x-auto -mx-1 px-1 scrollbar-hide">
              <TabsList className="inline-flex w-auto min-w-max">
                <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
                <TabsTrigger value="fields" className="text-xs sm:text-sm">Field Analysis</TabsTrigger>
                <TabsTrigger value="quality" className="text-xs sm:text-sm">Data Quality</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Dashboard</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{comparison.dashboardCount.toLocaleString('en-AU')}</div>
                    <p className="text-xs text-muted-foreground">listings</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Reports</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{comparison.reportsCount.toLocaleString('en-AU')}</div>
                    <p className="text-xs text-muted-foreground">listings</p>
                  </CardContent>
                </Card>
              </div>

              {status && (
                <Alert className={`border-${status.color}-200 bg-${status.color}-50`}>
                  <div className="flex items-center gap-2">
                    {status.icon}
                    <AlertDescription className="font-medium">
                      {status.text}: {comparison.discrepancy} listing difference
                    </AlertDescription>
                  </div>
                </Alert>
              )}

              {comparison.duplicatesFound > 0 && (
                <Alert className="border-warning/30 bg-warning/10">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Found {comparison.duplicatesFound} potential duplicate listings
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            <TabsContent value="fields" className="space-y-4">
              <div className="space-y-3">
                {Object.entries(comparison.fieldComparison).map(([field, data]) => (
                  <div key={field} className="flex flex-col gap-2 p-3 border rounded-lg sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full shrink-0 ${data.match ? 'bg-success' : 'bg-destructive'}`} />
                      <span className="font-medium capitalize text-sm">{field.replace(/([A-Z])/g, ' $1').trim()}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs sm:text-sm text-muted-foreground flex-wrap">
                      <span>Dashboard: {data.dashboard}</span>
                      <span>Reports: {data.reports}</span>
                      <Badge variant={data.match ? "secondary" : "destructive"}>
                        {data.match ? 'Match' : 'Mismatch'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="quality" className="space-y-4">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Dashboard Data Quality</span>
                    <span className="text-sm text-muted-foreground">
                      {comparison.dataQualityScores.dashboard.toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={comparison.dataQualityScores.dashboard} className="h-2" />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Reports Data Quality</span>
                    <span className="text-sm text-muted-foreground">
                      {comparison.dataQualityScores.reports.toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={comparison.dataQualityScores.reports} className="h-2" />
                </div>

                <div className="text-xs text-muted-foreground mt-4">
                  Data quality is calculated based on field completeness, valid values, and data consistency.
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {!comparison && !isValidating && (
          <Alert>
            <BarChart3 className="h-4 w-4" />
            <AlertDescription>
              Click "Run Validation" to analyze data consistency between dashboard and reports.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}