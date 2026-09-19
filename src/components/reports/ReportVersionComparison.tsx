import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import { TrendingUp, TrendingDown, ArrowRight, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface ComparisonProps {
  reportId: string;
  versionA: number;
  versionB: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface VersionData {
  version_number: number;
  created_at: string;
  quality_score: number;
  validation_flags: any;
  property_specs: any;
  financial_calculations: any;
  investment_score: any;
  data_sources: any;
  report_content: string;
}

export function ReportVersionComparison({ reportId, versionA, versionB, open, onOpenChange }: ComparisonProps) {
  const [dataA, setDataA] = useState<VersionData | null>(null);
  const [dataB, setDataB] = useState<VersionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && versionA && versionB) {
      fetchVersions();
    }
  }, [open, reportId, versionA, versionB]);

  const fetchVersions = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('report_versions')
        .select('*')
        .eq('report_id', reportId)
        .in('version_number', [versionA, versionB]);

      if (error) throw error;

      const vA = data.find(v => v.version_number === versionA);
      const vB = data.find(v => v.version_number === versionB);

      setDataA(vA as VersionData || null);
      setDataB(vB as VersionData || null);
    } catch (error) {
      console.error('Error fetching versions:', error);
      toast.error('Failed to load version data');
    } finally {
      setLoading(false);
    }
  };

  const compareValues = (valueA: any, valueB: any): boolean => {
    // Handle null/undefined cases
    if (valueA === null && valueB === null) return false;
    if (valueA === undefined && valueB === undefined) return false;
    if ((valueA === null || valueA === undefined) !== (valueB === null || valueB === undefined)) return true;
    
    // Handle primitive types
    if (typeof valueA !== 'object' || typeof valueB !== 'object') {
      return valueA !== valueB;
    }
    
    // Deep comparison for objects/arrays
    try {
      // Sort keys for consistent comparison
      const sortObject = (obj: any): any => {
        if (Array.isArray(obj)) {
          return obj.map(sortObject);
        }
        if (obj !== null && typeof obj === 'object') {
          return Object.keys(obj)
            .sort()
            .reduce((result: any, key) => {
              result[key] = sortObject(obj[key]);
              return result;
            }, {});
        }
        return obj;
      };
      
      return JSON.stringify(sortObject(valueA)) !== JSON.stringify(sortObject(valueB));
    } catch {
      return JSON.stringify(valueA) !== JSON.stringify(valueB);
    }
  };

  const renderMetricComparison = (label: string, valueA: any, valueB: any, format?: (val: any) => string) => {
    const displayA = format ? format(valueA) : (valueA !== null && valueA !== undefined ? valueA.toString() : 'N/A');
    const displayB = format ? format(valueB) : (valueB !== null && valueB !== undefined ? valueB.toString() : 'N/A');
    const changed = compareValues(valueA, valueB);

    return (
      <div className="grid grid-cols-[1fr,auto,1fr] gap-4 items-center py-2">
        <div className={`text-right ${changed ? 'text-muted-foreground' : ''}`}>
          {displayA}
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
          {changed && <ArrowRight className="h-4 w-4 text-primary" />}
        </div>
        <div className={`${changed ? 'font-semibold text-primary' : ''}`}>
          {displayB}
        </div>
      </div>
    );
  };

  if (loading || !dataA || !dataB) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[80vh] w-[95vw] sm:w-auto">
          <DialogHeader>
            <DialogTitle>Version Comparison</DialogTitle>
            <DialogDescription>Loading comparison data...</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const qualityChange = dataB.quality_score - dataA.quality_score;
  
  // Handle validation flags as either array or object
  const getValidationCount = (flags: any): number => {
    if (!flags) return 0;
    if (Array.isArray(flags)) return flags.length;
    if (typeof flags === 'object') return Object.keys(flags).length;
    return 0;
  };
  
  const validationCountA = getValidationCount(dataA.validation_flags);
  const validationCountB = getValidationCount(dataB.validation_flags);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh] w-[95vw] sm:w-auto overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Version Comparison</DialogTitle>
          <DialogDescription>
            Comparing Version {versionA} with Version {versionB}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[600px] pr-4">
          <div className="space-y-6">
            {/* Header Comparison */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-[1fr,auto,1fr] gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground mb-1">Version {versionA}</div>
                    <Badge variant="outline">{format(new Date(dataA.created_at), 'PP')}</Badge>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground self-center" />
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground mb-1">Version {versionB}</div>
                    <Badge variant="default">{format(new Date(dataB.created_at), 'PP')}</Badge>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* Quality Score */}
                <div className="flex items-center justify-center gap-4 py-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-muted-foreground">{dataA.quality_score}</div>
                    <div className="text-xs text-muted-foreground">Quality Score</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {qualityChange > 0 && <TrendingUp className="h-5 w-5 text-success" />}
                    {qualityChange < 0 && <TrendingDown className="h-5 w-5 text-destructive" />}
                    {qualityChange !== 0 && (
                      <span className={`text-sm font-medium ${qualityChange > 0 ? 'text-success' : 'text-destructive'}`}>
                        {qualityChange > 0 ? '+' : ''}{qualityChange}
                      </span>
                    )}
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold">{dataB.quality_score}</div>
                    <div className="text-xs text-muted-foreground">Quality Score</div>
                  </div>
                </div>

                {/* Validation Issues */}
                <div className="flex items-center justify-center gap-4 py-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{validationCountA} issues</span>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="font-medium">{validationCountB} issues</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Property Specs Comparison */}
            {(dataA.property_specs || dataB.property_specs) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Property Specifications</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {renderMetricComparison('Land Size', dataA.property_specs?.land_size_sqm, dataB.property_specs?.land_size_sqm, (v) => (v !== null && v !== undefined) ? `${v} m²` : 'N/A')}
                  {renderMetricComparison('Building Size', dataA.property_specs?.building_size_sqm, dataB.property_specs?.building_size_sqm, (v) => (v !== null && v !== undefined) ? `${v} m²` : 'N/A')}
                  {renderMetricComparison('Bedrooms', dataA.property_specs?.bedrooms, dataB.property_specs?.bedrooms)}
                  {renderMetricComparison('Bathrooms', dataA.property_specs?.bathrooms, dataB.property_specs?.bathrooms)}
                  {renderMetricComparison('Parking', dataA.property_specs?.parking, dataB.property_specs?.parking)}
                  {renderMetricComparison('Property Type', dataA.property_specs?.property_type, dataB.property_specs?.property_type)}
                  {renderMetricComparison('Year Built', dataA.property_specs?.year_built, dataB.property_specs?.year_built)}
                  {renderMetricComparison('Zoning', dataA.property_specs?.zoning, dataB.property_specs?.zoning)}
                </CardContent>
              </Card>
            )}

            {/* Financial Calculations Comparison */}
            {(dataA.financial_calculations || dataB.financial_calculations) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Financial Calculations</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {renderMetricComparison('Purchase Price', dataA.financial_calculations?.purchase_price, dataB.financial_calculations?.purchase_price, (v) => (v !== null && v !== undefined) ? `$${Number(v).toLocaleString('en-AU')}` : 'N/A')}
                  {renderMetricComparison('Stamp Duty', dataA.financial_calculations?.stamp_duty, dataB.financial_calculations?.stamp_duty, (v) => (v !== null && v !== undefined) ? `$${Number(v).toLocaleString('en-AU')}` : 'N/A')}
                  {renderMetricComparison('Legal Fees', dataA.financial_calculations?.legal_fees, dataB.financial_calculations?.legal_fees, (v) => (v !== null && v !== undefined) ? `$${Number(v).toLocaleString('en-AU')}` : 'N/A')}
                  {renderMetricComparison('Inspection Costs', dataA.financial_calculations?.inspection_costs, dataB.financial_calculations?.inspection_costs, (v) => (v !== null && v !== undefined) ? `$${Number(v).toLocaleString('en-AU')}` : 'N/A')}
                  {renderMetricComparison('Total Acquisition', dataA.financial_calculations?.total_acquisition_cost, dataB.financial_calculations?.total_acquisition_cost, (v) => (v !== null && v !== undefined) ? `$${Number(v).toLocaleString('en-AU')}` : 'N/A')}
                  {renderMetricComparison('Weekly Rent', dataA.financial_calculations?.estimated_weekly_rent, dataB.financial_calculations?.estimated_weekly_rent, (v) => (v !== null && v !== undefined) ? `$${Number(v).toLocaleString('en-AU')}` : 'N/A')}
                  {renderMetricComparison('Annual Rent', dataA.financial_calculations?.annual_rent, dataB.financial_calculations?.annual_rent, (v) => (v !== null && v !== undefined) ? `$${Number(v).toLocaleString('en-AU')}` : 'N/A')}
                  {renderMetricComparison('Rental Yield', dataA.financial_calculations?.rental_yield, dataB.financial_calculations?.rental_yield, (v) => (v !== null && v !== undefined) ? `${Number(v).toFixed(2)}%` : 'N/A')}
                  {renderMetricComparison('Annual Cash Flow', dataA.financial_calculations?.annual_cash_flow, dataB.financial_calculations?.annual_cash_flow, (v) => (v !== null && v !== undefined) ? `$${Number(v).toLocaleString('en-AU')}` : 'N/A')}
                  {renderMetricComparison('Operating Costs', dataA.financial_calculations?.total_annual_costs, dataB.financial_calculations?.total_annual_costs, (v) => (v !== null && v !== undefined) ? `$${Number(v).toLocaleString('en-AU')}` : 'N/A')}
                </CardContent>
              </Card>
            )}

            {/* Investment Score Comparison */}
            {(dataA.investment_score || dataB.investment_score) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Investment Score</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {renderMetricComparison('Overall Score', dataA.investment_score?.overall_score, dataB.investment_score?.overall_score, (v) => v ? `${v}/100` : 'N/A')}
                  {renderMetricComparison('Growth Potential', dataA.investment_score?.growth_potential, dataB.investment_score?.growth_potential, (v) => v ? `${v}/100` : 'N/A')}
                  {renderMetricComparison('Rental Demand', dataA.investment_score?.rental_demand, dataB.investment_score?.rental_demand, (v) => v ? `${v}/100` : 'N/A')}
                  {renderMetricComparison('Risk Level', dataA.investment_score?.risk_level, dataB.investment_score?.risk_level)}
                </CardContent>
              </Card>
            )}

            {/* Data Sources */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Data Sources</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium mb-2">Version {versionA}</div>
                    <div className="text-xs space-y-1">
                      {dataA.data_sources && Object.keys(dataA.data_sources).map(key => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="font-medium">{key}:</span>
                          <Badge variant="outline" className="text-xs">{dataA.data_sources[key]}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-2">Version {versionB}</div>
                    <div className="text-xs space-y-1">
                      {dataB.data_sources && Object.keys(dataB.data_sources).map(key => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="font-medium">{key}:</span>
                          <Badge variant="outline" className="text-xs">{dataB.data_sources[key]}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
