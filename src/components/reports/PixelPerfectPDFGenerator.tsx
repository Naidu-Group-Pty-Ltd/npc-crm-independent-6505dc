/**
 * The Investment PDF button.
 *
 * The drawing moved to `@/lib/reports/investment/investmentPdfDocument` so that
 * this component and `deliverInvestmentPdf` produce ONE document rather than
 * two implementations of the same one. Nothing about the document changed —
 * see that module's header for what the extraction did and did not touch.
 *
 * What stays here is this control's own behaviour: generate, upload, record
 * `pdf_url`, download, and the toasts a person clicking a button expects.
 */
import React, { forwardRef, useImperativeHandle } from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { secureStorageUpload } from '@/hooks/useSecureStorage';
import { downloadClientPdf } from '@/lib/reports/clientPdfDownload';
import {
  generateInvestmentPdfBlob,
  type InvestmentReportData,
  type ReportTier,
} from '@/lib/reports/investment/investmentPdfDocument';

interface PixelPerfectPDFGeneratorProps {
  report: InvestmentReportData;
  includeSources?: boolean;
  includeScoring?: boolean;
  reportTier?: ReportTier;
  pdf_url?: string | null;
  skipDatabaseUpdate?: boolean;
  /**
   * How the control presents. The unified template-first delivery is every
   * surface's primary road now, so this generator is offered as the named
   * legacy layout beside it — same document, quieter chrome. The ref handle
   * is unaffected either way; the send fallback still reaches it.
   */
  appearance?: 'primary' | 'legacy';
}

export interface PixelPerfectPDFGeneratorHandle {
  generateAndUpload: () => Promise<string | null>;
  /** The button's own download action, for callers that trigger it programmatically. */
  download: () => Promise<void>;
}


export const PixelPerfectPDFGenerator = forwardRef<PixelPerfectPDFGeneratorHandle, PixelPerfectPDFGeneratorProps>(({ report, includeSources = true, includeScoring = true, reportTier = 'compass', skipDatabaseUpdate = false, appearance = 'primary' }, ref) => {
  const [isGenerating, setIsGenerating] = React.useState(false);

  /**
   * Draw the document, store it, and point the row at it.
   *
   * The upload half is verbatim what `generateCore` used to end with; only the
   * drawing moved. `skipDatabaseUpdate` still spares comparison reports, which
   * live in a different table.
   */
  const generateCore = async (): Promise<{ blob: Blob; publicUrl: string; suburb: string; state: string }> => {
    const { blob, fileName, suburb, state } = await generateInvestmentPdfBlob({
      report, reportTier, presentation: { includeSources, includeScoring },
    });

    console.log('☁️ Step 7: Uploading to Supabase Storage...');
    console.log('📤 Uploading as:', fileName);
    const uploadResult = await secureStorageUpload(
      'investment-reports',
      fileName,
      blob,
      { contentType: 'application/pdf', upsert: true, resourceId: report.id }
    );

    if (!uploadResult.success) {
      console.error('❌ Upload failed:', uploadResult.error);
      throw new Error(uploadResult.error || 'Upload failed');
    }
    console.log('✓ Upload successful:', uploadResult.path);

    console.log('🔗 Step 8: Getting public URL...');
    const { data: urlResult } = await invokeSecureFunction('secure-storage', {
      operation: 'publicUrl',
      bucket: 'investment-reports',
      path: fileName
    });
    const publicUrl = urlResult?.data?.publicUrl || '';
    console.log('✓ Public URL:', publicUrl);

    if (!skipDatabaseUpdate) {
      console.log('💽 Step 9: Updating database...');
      const { error: updateError } = await invokeSecureFunction('manage-investment-reports', {
        action: 'update',
        reportId: report.id,
        // Store the stable object path, never a short-lived/public URL. The
        // shared downloader obtains an authorised response at click time.
        data: { pdf_url: uploadResult.path }
      });
      if (updateError) {
        console.error('❌ Database update failed:', updateError);
        throw new Error(updateError.message || 'Database update failed');
      }
      console.log('✓ Database updated');
    } else {
      console.log('⏭️ Step 9: Skipping database update (comparison report)');
    }

    return { blob, publicUrl, suburb, state };
  };

  const handleGenerationError = (error: unknown) => {
    console.error('❌ PDF generation error:', error);
    let errorMessage = 'Failed to generate PDF. ';
    if (error instanceof Error) {
      if (error.message.includes('WinAnsi')) {
        errorMessage += 'Special characters encoding issue detected.';
      } else if (error.message.includes('template')) {
        errorMessage += 'Template loading failed.';
      } else if (error.message.includes('storage')) {
        errorMessage += 'Failed to upload to storage.';
      } else {
        errorMessage += error.message;
      }
    }
    toast.error(errorMessage);
  };

  // Generate, upload, and return the public URL (no download)
  const handleGenerateAndUpload = async (): Promise<string | null> => {
    setIsGenerating(true);
    try {
      const result = await generateCore();
      toast.success('PDF generated and uploaded successfully!');
      return result.publicUrl;
    } catch (error) {
      handleGenerationError(error);
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  // Generate, upload, AND download to device
  const generatePixelPerfectPDF = async () => {
    setIsGenerating(true);
    try {
      // Prefer the existing persisted standard client PDF. This is the same
      // flow used by the Generated Reports card and avoids needless renders.
      if (report.pdf_url) {
        await downloadClientPdf(report.id, {
          report: {
            id: report.id,
            property_address: report.address,
            report_tier: reportTier,
            pdf_url: report.pdf_url,
          },
        });
        toast.success('Client PDF downloaded successfully.');
        return;
      }
      const result = await generateCore();

      // The renderer persists the stable storage path first. Download through
      // the same authorised retrieval service used by report-library cards.
      await downloadClientPdf(report.id, {
        report: {
          id: report.id,
          property_address: report.address,
          report_tier: reportTier,
          pdf_url: result.publicUrl,
        },
      });

      console.log('✅ PDF generation completed successfully!');
      toast.success('PDF generated and saved successfully!');

      logActivityDirect({
        actionType: 'report_pdf_downloaded',
        entityType: 'investment_report',
        entityId: report.id,
        entityName: report.address,
        metadata: { format: 'pdf', source: 'pixel_perfect_generator' }
      });
    } catch (error) {
      handleGenerationError(error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Expose generateAndUpload for external use (e.g., Send to Client)
  useImperativeHandle(ref, () => ({
    generateAndUpload: handleGenerateAndUpload,
    download: generatePixelPerfectPDF,
  }));

  return (
    <div className="inline-flex items-center gap-1">
      <Button
        onClick={generatePixelPerfectPDF}
        disabled={isGenerating}
        variant={appearance === 'legacy' ? 'ghost' : 'default'}
        size={appearance === 'legacy' ? 'sm' : 'default'}
        className={appearance === 'legacy' ? 'gap-2 text-muted-foreground' : 'gap-2'}
      >
        <Download className="h-4 w-4" />
        {isGenerating
          ? 'Generating PDF...'
          : appearance === 'legacy' ? 'Download (legacy layout)' : 'Download Client PDF'}
      </Button>
      <FlattenPdfIconButton
        getPdfBlob={async () => (await generateCore()).blob}
        filename={`${(report as any)?.address || 'investment-report'}.pdf`}
        disabled={isGenerating}
      />
    </div>
  );
});

PixelPerfectPDFGenerator.displayName = 'PixelPerfectPDFGenerator';
