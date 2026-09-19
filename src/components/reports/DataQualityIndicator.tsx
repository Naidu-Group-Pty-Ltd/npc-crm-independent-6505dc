import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle, AlertCircle, HelpCircle, Database, Clock } from "lucide-react";
import type { DataSources } from "@/types/validation";
import { calculateOverallDataQuality } from "@/types/validation";

interface DataQualityIndicatorProps {
  dataSources?: DataSources | null;
  inline?: boolean;
  showDetails?: boolean;
}

export function DataQualityIndicator({ dataSources, inline = false, showDetails = true }: DataQualityIndicatorProps) {
  if (!dataSources) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="gap-1">
              <HelpCircle className="h-3 w-3" />
              {inline ? 'N/A' : 'Data Quality: N/A'}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>No data source information available</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const overallQuality = calculateOverallDataQuality(dataSources);
  
  const getQualityColor = (quality: number): string => {
    if (quality >= 90) return 'bg-success dark:bg-success';
    if (quality >= 75) return 'bg-info dark:bg-info';
    if (quality >= 60) return 'bg-brand-500 dark:bg-brand-600';
    return 'bg-warning dark:bg-warning';
  };

  const getQualityIcon = (quality: number) => {
    if (quality >= 90) return <CheckCircle className="h-3 w-3" />;
    if (quality >= 60) return <AlertCircle className="h-3 w-3" />;
    return <AlertCircle className="h-3 w-3" />;
  };

  const getQualityLabel = (quality: number): string => {
    if (quality >= 95) return 'Excellent';
    if (quality >= 85) return 'Very Good';
    if (quality >= 75) return 'Good';
    if (quality >= 60) return 'Fair';
    return 'Poor';
  };

  const getSourceIcon = (sourceName: string) => {
    const name = sourceName.toLowerCase();
    if (name.includes('abs') || name.includes('rba')) return '🏛️';
    if (name.includes('domain') || name.includes('api')) return '🌐';
    if (name.includes('google')) return '🗺️';
    if (name.includes('calculated')) return '🧮';
    if (name.includes('cached')) return '💾';
    if (name.includes('estimated')) return '📊';
    return '📄';
  };

  const getSourceBadgeVariant = (confidence: number): "default" | "secondary" | "outline" => {
    if (confidence >= 0.9) return 'default';
    if (confidence >= 0.7) return 'secondary';
    return 'outline';
  };

  const sourceEntries = Object.entries(dataSources).filter(([_, source]) => source !== null && source !== undefined);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`gap-1 ${getQualityColor(overallQuality)} text-foreground dark:text-white border-none`}
          >
            {getQualityIcon(overallQuality)}
            {inline ? `${overallQuality}%` : `Data Quality: ${overallQuality}%`}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-md">
          <div className="space-y-2">
            <div className="font-semibold border-b pb-2 mb-2">
              Overall Data Quality: {getQualityLabel(overallQuality)} ({overallQuality}%)
            </div>
            
            {showDetails && sourceEntries.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Data Sources:</div>
                {sourceEntries.map(([field, source]) => {
                  if (!source) return null;
                  return (
                    <div key={field} className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <span>{getSourceIcon(source.source)}</span>
                        <span className="font-medium">{field.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={getSourceBadgeVariant(source.confidence)} className="text-xs">
                          {source.source}
                        </Badge>
                        <span className="text-muted-foreground">
                          {(source.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
                
                <div className="flex items-center gap-1 text-xs text-muted-foreground pt-2 border-t">
                  <Clock className="h-3 w-3" />
                  <span>Last updated: {new Date(sourceEntries[0][1]?.timestamp || Date.now()).toLocaleString('en-AU')}</span>
                </div>
              </div>
            )}

            <div className="text-xs text-muted-foreground pt-2 border-t">
              <Database className="h-3 w-3 inline mr-1" />
              Quality score based on {sourceEntries.length} data source{sourceEntries.length !== 1 ? 's' : ''}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
