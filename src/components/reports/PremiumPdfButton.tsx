import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { logActivityDirect } from "@/hooks/useActivityLogger";
import { FlattenPdfIconButton } from "@/components/common/FlattenPdfIconButton";
import { saveTemplateDocument } from "@/lib/reportTemplate/templateDocument";
import {
  produceInvestmentDocument,
  type InvestmentDocument,
  type ProduceInvestmentOptions,
} from "@/lib/reports/investment/deliverInvestmentPdf";
import type { PdfDesignOptions } from "./premiumPdfDesign";

interface ClientPdfButtonProps extends Pick<
  ProduceInvestmentOptions,
  'includeSources' | 'includeScoring' | 'includeCharts' | 'includeHeroImages' | 'includeSparklines' | 'audience'
> {
  reportId: string;
  propertyAddress: string;
  variant?: string | null;
  designOptions?: PdfDesignOptions;
}

/**
 * The one control that produces the client's Investment PDF.
 *
 * ## Why there is only one
 *
 * There used to be two, side by side: this, and a separately mounted browser
 * generator labelled "Download (legacy layout)". They took DIFFERENT switches
 * — this one carried Charts, Hero images and Sparklines, that one carried
 * Sources and Scoring — so which of the five a client's document honoured
 * depended on which button had been pressed, and neither honoured all five.
 * Two buttons meant two documents, which meant two truths.
 *
 * `produceInvestmentDocument` is the one contract now: it reads the record
 * once, applies the client-readiness gate, applies the content rules, and then
 * chooses a presentation — the template the person selected, or the standard
 * one. Every surface asks it, so a client receives the document the operator
 * reviewed whichever control they reached for.
 */
export function PremiumPdfButton({
  reportId,
  propertyAddress,
  variant = null,
  includeSources = true,
  includeScoring = true,
  includeCharts = true,
  includeHeroImages = false,
  includeSparklines = true,
  audience = 'investor',
  designOptions,
}: ClientPdfButtonProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  /** Every control, every time. A control the caller drops is a control that lies. */
  const options = useCallback((): ProduceInvestmentOptions => ({
    variant,
    includeSources,
    includeScoring,
    includeCharts,
    includeHeroImages,
    includeSparklines,
    audience,
    designOptions,
  }), [variant, includeSources, includeScoring, includeCharts, includeHeroImages,
    includeSparklines, audience, designOptions]);

  /**
   * What the evidence records is the renderer that drew THESE bytes.
   *
   * It used to record `premium_weasyprint` on every download, including after
   * WeasyPrint had stopped being reachable from this path at all — false
   * production telemetry, which is worse than none because it is read as
   * evidence of what happened.
   */
  const logDownload = (doc: InvestmentDocument, flattened?: boolean) => logActivityDirect({
    actionType: "report_pdf_downloaded",
    entityType: "investment_report",
    entityId: reportId,
    entityName: propertyAddress,
    metadata: {
      format: "pdf",
      source: doc.engine,
      templateId: doc.templateId,
      audience,
      ...(flattened ? { flattened: true } : {}),
      designOptions,
    },
  });

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const doc = await produceInvestmentDocument(reportId, options());
      await logDownload(doc);
      saveTemplateDocument({ blob: doc.blob, fileName: doc.fileName, templateId: doc.templateId ?? "" });
      toast({
        title: "Client PDF ready",
        // A template drew it, whichever engine did the drawing — the
        // browser's preview renderer or the print engine that draws the
        // final document.
        description: doc.templateId
          ? "Rendered with your selected template. Your download should begin shortly."
          : "Rendered with the standard presentation. Your download should begin shortly.",
      });
    } catch (err: any) {
      console.error("[ClientPdfButton]", err);
      toast({
        title: "The client PDF could not be produced",
        description: err?.message || "Please retry shortly.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const renderForFlatten = useCallback(async (): Promise<Blob> => {
    const doc = await produceInvestmentDocument(reportId, options());
    await logDownload(doc, true);
    return doc.blob;
    // `logDownload` closes over the same values `options` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, options]);

  return (
    <div className="inline-flex items-center gap-1">
      <Button
        variant="default"
        size="sm"
        onClick={handleClick}
        disabled={loading}
        className="bg-gradient-to-r from-primary to-primary/70 hover:from-primary/90 hover:to-primary/60"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <FileDown className="h-4 w-4 mr-1" />
        )}
        {loading ? "Rendering…" : "Generate Client PDF"}
      </Button>
      <FlattenPdfIconButton
        getPdfBlob={renderForFlatten}
        filename={`investment-report-${reportId}.pdf`}
        disabled={loading}
      />
    </div>
  );
}
