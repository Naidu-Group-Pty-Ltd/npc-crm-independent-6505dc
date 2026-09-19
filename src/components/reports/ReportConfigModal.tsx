import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Download, FileText, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const reportConfigSchema = z.object({
  title: z.string().min(1, 'Report title is required'),
  description: z.string().optional(),
  includeKPIs: z.boolean().default(true),
  includeSuburbChart: z.boolean().default(true),
  includePropertyTypeChart: z.boolean().default(true),
  includePriceRangeChart: z.boolean().default(true),
  includeBedroomChart: z.boolean().default(true),
  includeAdvancedAnalytics: z.boolean().default(true),
  includeExecutiveInsights: z.boolean().default(true),
  includeTemporalAnalysis: z.boolean().default(true),
  includeGeographicAnalysis: z.boolean().default(true),
  includeAgentPerformance: z.boolean().default(true),
  includeDailyListingActivity: z.boolean().default(true),
  includePricingTrends: z.boolean().default(true),
  includeDataConfidence: z.boolean().default(true),
  includeSuburbPerformanceMatrix: z.boolean().default(true),
  includeSuburbVolumeDistribution: z.boolean().default(true),
  includePriceVsVolumeAnalysis: z.boolean().default(true),
  includeAgentListingVolume: z.boolean().default(true),
  includeAgencyDistribution: z.boolean().default(true),
  customNotes: z.string().optional(),
  companyName: z.string().optional(),
  authorName: z.string().optional(),
});

export type ReportConfig = z.infer<typeof reportConfigSchema>;

interface ReportConfigModalProps {
  onGenerateReport: (config: ReportConfig) => void | Promise<unknown>;
  isGenerating: boolean;
  progress?: number;
  currentStep?: string;
}

export function ReportConfigModal({ onGenerateReport, isGenerating, progress = 0, currentStep = '' }: ReportConfigModalProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const form = useForm<ReportConfig>({
    resolver: zodResolver(reportConfigSchema),
    defaultValues: {
      title: 'Property Listings Report',
      description: 'Comprehensive analysis of property listings data',
      includeKPIs: true,
      includeSuburbChart: true,
      includePropertyTypeChart: true,
      includePriceRangeChart: true,
      includeBedroomChart: true,
      includeAdvancedAnalytics: true,
      includeExecutiveInsights: true,
      includeTemporalAnalysis: true,
      includeGeographicAnalysis: true,
      includeAgentPerformance: true,
      includeDailyListingActivity: true,
      includePricingTrends: true,
      includeDataConfidence: true,
      includeSuburbPerformanceMatrix: true,
      includeSuburbVolumeDistribution: true,
      includePriceVsVolumeAnalysis: true,
      includeAgentListingVolume: true,
      includeAgencyDistribution: true,
      customNotes: '',
      companyName: '',
      authorName: '',
    },
  });

  const handleSubmit = async (config: ReportConfig) => {
    if (isGenerating) return;
    const result = await onGenerateReport(config);
    if (result) setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      // Only allow closing if not generating
      if (!isGenerating) {
        setOpen(newOpen);
      }
    }}>
      <DialogTrigger asChild>
        <Button className="gap-2 rounded-full bg-primary px-5 font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-primary/30 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 active:translate-y-0">
          <Download className="h-4 w-4" />
          Generate Report
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] sm:w-full sm:max-w-2xl max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Configure Report
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="flex flex-col flex-1 min-h-0"
          >
            <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-6">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Report Information</h3>
              
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Report Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter report title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Brief description of the report"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Your company name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="authorName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Author Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Report author" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Chart Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Include in Report</h3>
              
              {/* Core Metrics Section */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Core Metrics & KPIs</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="includeKPIs"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Key Performance Indicators</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeAdvancedAnalytics"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Advanced Analytics Cards</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeExecutiveInsights"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Executive Insights</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Basic Distribution Charts */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Property Distribution Charts</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="includeSuburbChart"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Listings by Suburb (Bar Chart)</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includePropertyTypeChart"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Property Type Distribution (Pie Chart)</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includePriceRangeChart"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Price Range Distribution (Bar Chart)</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeBedroomChart"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Bedroom Distribution (Bar Chart)</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Temporal Analysis */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Temporal Analysis Charts</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="includeTemporalAnalysis"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Temporal Analysis Section</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeDailyListingActivity"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Daily Listing Activity (Line Chart)</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includePricingTrends"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Pricing Trends (Line Chart)</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeDataConfidence"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Data Confidence Trends (Line Chart)</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Geographic Analysis */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Geographic Analysis Charts</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="includeGeographicAnalysis"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Geographic Analysis Section</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeSuburbPerformanceMatrix"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Suburb Performance Matrix</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeSuburbVolumeDistribution"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Suburb Volume Distribution (Bar Chart)</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includePriceVsVolumeAnalysis"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Price vs Volume Analysis (Scatter Chart)</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Agent Performance */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Agent Performance Charts</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="includeAgentPerformance"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Agent Performance Section</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeAgentListingVolume"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Agent Listing Volume (Bar Chart)</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="includeAgencyDistribution"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Agency Size Distribution (Bar Chart)</FormLabel>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>

            {/* Custom Notes */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Additional Notes</h3>
              
              <FormField
                control={form.control}
                name="customNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Custom Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Add any additional notes or insights to include in the report"
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {isGenerating && (
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                  {currentStep || 'Processing...'}
                </div>
                <Progress value={progress} className="w-full" />
                <div className="text-xs text-muted-foreground">
                  {progress}% Complete
                </div>
              </div>
            )}

            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 border-t px-4 sm:px-6 py-3 shrink-0 bg-background">
              {!isGenerating ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    navigate('/generated-reports?tab=quantitative');
                  }}
                  className="gap-2 w-full sm:w-auto"
                >
                  <BarChart3 className="h-4 w-4" />
                  View Charts
                </Button>
              ) : <div className="hidden sm:block" />}
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isGenerating}
                  className="w-full sm:w-auto"
                >
                  {isGenerating ? 'Generating...' : 'Cancel'}
                </Button>
                <Button type="submit" disabled={isGenerating} className="w-full sm:w-auto">
                  {isGenerating ? `Generating... (${progress}%)` : 'Generate PDF Report'}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
