import { PixelPerfectPDFGenerator, type PixelPerfectPDFGeneratorHandle } from './PixelPerfectPDFGenerator';
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

interface ComparisonData {
  id: string;
  property_count: number;
  property_addresses?: string[];
  property_states?: string[];
  report_title?: string;
  executive_summary: string | null;
  rankings: any;
  financial_comparison: any;
  location_comparison: any;
  risk_comparison: any;
  recommendations: any;
  red_flags: any;
  report_ids: string[];
  created_at: string;
}

interface ComparisonPDFGeneratorProps {
  comparison: ComparisonData;
}

export function ComparisonPDFGenerator({ comparison }: ComparisonPDFGeneratorProps) {
  const [formattedContent, setFormattedContent] = useState<string | null>(null);
  const [isFormatting, setIsFormatting] = useState(false);
  const formattedForId = useRef<string | null>(null);
  const pdfRef = useRef<PixelPerfectPDFGeneratorHandle>(null);
  const [fireOnReady, setFireOnReady] = useState(false);

  // Formatted once per ROW — and only when the legacy layout is actually
  // chosen. This used to format on MOUNT, which spent a metered model call
  // for every viewer opened whether or not anyone downloaded the legacy
  // document (an earlier defect had it formatting on every re-render). The
  // deterministic typeset control beside this one is the primary road now;
  // this button pays for its model formatting at the moment somebody picks
  // the legacy layout, once per stored row.
  useEffect(() => {
    if (formattedForId.current !== comparison.id) {
      formattedForId.current = null;
      setFormattedContent(null);
      setFireOnReady(false);
    }
  }, [comparison.id]);

  // The click that paid for formatting also gets its download: fire the
  // generator once the formatted content is mounted.
  useEffect(() => {
    if (fireOnReady && formattedContent && pdfRef.current) {
      setFireOnReady(false);
      void pdfRef.current.download();
    }
  }, [fireOnReady, formattedContent]);

  const handleLegacyChosen = async () => {
    if (isFormatting) return;
    formattedForId.current = comparison.id;
    setFireOnReady(true);
    await formatComparisonReport();
  };

  const formatComparisonReport = async () => {
    try {
      setIsFormatting(true);
      console.log('Calling format-comparison-report edge function...');

      const { data, error } = await invokeSecureFunction('format-comparison-report', {
        comparisonData: comparison
      });

      if (error) {
        console.error('Error formatting report:', error);
        toast.error('Failed to format comparison report');
        // Fallback to basic formatting
        setFormattedContent(generateBasicReportContent());
      } else if (data?.formattedContent) {
        console.log('Successfully formatted comparison report');
        setFormattedContent(data.formattedContent);
      } else {
        console.warn('No formatted content returned, using fallback');
        setFormattedContent(generateBasicReportContent());
      }
    } catch (error) {
      console.error('Error in formatComparisonReport:', error);
      toast.error('Error formatting report, using basic format');
      setFormattedContent(generateBasicReportContent());
    } finally {
      setIsFormatting(false);
    }
  };

  // Fallback basic formatting function
  const generateBasicReportContent = (): string => {
    const title = comparison.report_title || `Property Comparison Analysis - ${comparison.property_count} Properties`;
    const states = comparison.property_states?.join(', ') || 'Mixed States';
    
    let content = `# ${title}\n\n`;
    content += `**Properties Compared:** ${comparison.property_count}\n`;
    content += `**States:** ${states}\n`;
    content += `**Analysis Date:** ${new Date(comparison.created_at).toLocaleDateString('en-AU')}\n\n`;
    
    if (comparison.property_addresses && comparison.property_addresses.length > 0) {
      content += `**Property Addresses:**\n`;
      comparison.property_addresses.forEach((address, index) => {
        content += `${index + 1}. ${address}\n`;
      });
      content += `\n`;
    }
    
    content += `---\n\n`;
    
    if (comparison.executive_summary) {
      content += '## Executive Summary\n\n';
      content += comparison.executive_summary + '\n\n';
    }

    if (comparison.rankings) {
      content += '## Overall Rankings\n\n';
      content += JSON.stringify(comparison.rankings, null, 2) + '\n\n';
    }

    if (comparison.financial_comparison) {
      content += '## Financial Analysis\n\n';
      content += JSON.stringify(comparison.financial_comparison, null, 2) + '\n\n';
    }

    if (comparison.location_comparison) {
      content += '## Location Intelligence\n\n';
      content += JSON.stringify(comparison.location_comparison, null, 2) + '\n\n';
    }

    if (comparison.risk_comparison) {
      content += '## Risk Assessment\n\n';
      content += JSON.stringify(comparison.risk_comparison, null, 2) + '\n\n';
    }

    if (comparison.recommendations) {
      content += '## Investment Recommendations\n\n';
      content += JSON.stringify(comparison.recommendations, null, 2) + '\n\n';
    }

    if (comparison.red_flags && Array.isArray(comparison.red_flags) && comparison.red_flags.length > 0) {
      content += '## Important Considerations\n\n';
      comparison.red_flags.forEach((flag: any) => {
        content += `- ${typeof flag === 'string' ? flag : JSON.stringify(flag)}\n`;
      });
      content += '\n';
    }

    return content;
  };

  // Until the legacy layout is chosen, this control is a quiet named choice
  // beside the primary typeset download — nothing is formatted and nothing is
  // spent. While formatting runs, the SAME button stays in place and says
  // what it is doing (the old full-width spinner block replaced the button
  // entirely, so the control read as a download that appeared and vanished).
  if (isFormatting || !formattedContent) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 text-muted-foreground"
        disabled={isFormatting}
        onClick={handleLegacyChosen}
      >
        {isFormatting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {isFormatting ? 'Preparing legacy layout…' : 'Download (legacy layout)'}
      </Button>
    );
  }

  // Transform comparison data to match PixelPerfectPDFGenerator expectations
  const transformedReport = {
    id: comparison.id,
    address: comparison.report_title || `Comparison Analysis - ${comparison.property_count} Properties`,
    content: formattedContent, // Use the formatted content from Perplexity
    created_at: comparison.created_at || new Date().toISOString(),
    enhanced_data: {
      domainData: null,
      absData: null,
      rbaData: null,
      financialData: comparison.financial_comparison,
      locationData: comparison.location_comparison,
      investmentScore: comparison.rankings,
    }
  };

  return <PixelPerfectPDFGenerator ref={pdfRef} report={transformedReport} skipDatabaseUpdate appearance="legacy" />;
}
