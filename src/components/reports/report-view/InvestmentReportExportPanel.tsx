import { useState, type ReactNode } from 'react';
import { ChevronDown, Download, FileText, Images, Link, Paintbrush, RotateCcw, Sparkles, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { PremiumPdfButton } from '@/components/reports/PremiumPdfButton';
import { RegenerateWithPerplexityButton } from '@/components/reports/RegenerateWithPerplexityButton';
import { PremiumPdfDesignPanel } from '@/components/reports/PremiumPdfDesignPanel';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import { DEFAULT_PDF_DESIGN_OPTIONS } from '@/components/reports/premiumPdfDesign';
import { REPORT_DESIGN_CONTROLS_VISIBLE } from '@/lib/reports/designControlsVisibility';
import { INVESTMENT_REPORT_FORMAT } from '@/lib/reportTemplate/reportFormats';
import type { ExportPanelProps } from './types';

interface ToggleRowProps {
  icon?: ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function ToggleRow({ icon, label, description, checked, onCheckedChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background/70 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          <span>{label}</span>
        </div>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function InvestmentReportExportPanel({
  report,
  includeSources,
  includeScoring,
  includeCharts,
  includeHeroImages,
  includeSparklines,
  pdfDesignOptions,
  onIncludeSourcesChange,
  onIncludeScoringChange,
  onIncludeChartsChange,
  onIncludeHeroImagesChange,
  onIncludeSparklinesChange,
  onPdfDesignOptionsChange,
  onHeroImagesManage,
  onRegenerated,
  onDownload,
}: ExportPanelProps) {
  const [controlsOpen, setControlsOpen] = useState(true);

  return (
    <div className="space-y-4">
      <Collapsible open={controlsOpen} onOpenChange={setControlsOpen}>
        <Card className="overflow-hidden border-primary/10 bg-card/95 shadow-sm">
          <CollapsibleTrigger className="w-full text-left">
            <CardHeader className="border-b bg-gradient-to-br from-background via-background to-primary/5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2"><Download className="h-4 w-4" />Publishing & Export</CardTitle>
                  <CardDescription>Configure report content, generate PDFs, and manage premium styling.</CardDescription>
                </div>
                <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${controlsOpen ? 'rotate-180' : ''}`} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-5 p-4">
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">PDF Content</h3>
              <p className="text-xs text-muted-foreground">
                Scoring and sources decide what the report <em>contains</em>, in every
                presentation. Charts, hero images and sparklines decide what is <em>drawn</em>
                — the figures they illustrate stay on the page either way.
              </p>
            </div>
            <ToggleRow
              icon={<TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Include scoring"
              description="Show investment scoring in the client PDF."
              checked={includeScoring}
              onCheckedChange={onIncludeScoringChange}
            />
            <ToggleRow
              icon={<Link className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Include sources"
              description="Append source notes and supporting references."
              checked={includeSources}
              onCheckedChange={onIncludeSourcesChange}
            />
            <ToggleRow
              icon={<FileText className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Charts"
              description="Draw the charts the report's own figures support."
              checked={includeCharts}
              onCheckedChange={onIncludeChartsChange}
            />
            <ToggleRow
              icon={<Images className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Hero images"
              description="Place the imagery already stored against this report."
              checked={includeHeroImages}
              onCheckedChange={onIncludeHeroImagesChange}
            />
            <Button variant="outline" size="sm" className="w-full bg-background/70" onClick={onHeroImagesManage}>
              <Images className="h-3.5 w-3.5 mr-1" />
              Manage hero images
            </Button>
            <ToggleRow
              icon={<Sparkles className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Sparklines"
              description="Draw the ten-year shape beside the financial figures."
              checked={includeSparklines}
              onCheckedChange={onIncludeSparklinesChange}
            />
          </section>

          <section className="space-y-3 rounded-xl border bg-muted/20 p-3">
            <div>
              <h3 className="text-sm font-semibold">Generation</h3>
              <p className="text-xs text-muted-foreground">Produce the client document and refresh the report content.</p>
            </div>
            {/* Before the buttons, deliberately: which template the document
                comes out in is a decision about the document, and it used to be
                invisible — resolved by ranking, with no surface anywhere in the
                product that showed it or let anyone change it. */}
            <ReportTemplateSelector
              reportType={INVESTMENT_REPORT_FORMAT.reportType}
              formatLabel={INVESTMENT_REPORT_FORMAT.label}
            />
            <div className="grid gap-2">
              {/* ONE client-PDF action. A second, separately mounted generator
                  used to sit beneath this one as "Download (legacy layout)",
                  and the two took different halves of the five controls above
                  — so which switches a client's document honoured depended on
                  which button was pressed. See `PremiumPdfButton`. */}
              <ErrorBoundary fallback={<div className="text-sm text-muted-foreground">PDF tools are unavailable.</div>}>
                <PremiumPdfButton
                  reportId={report.id}
                  propertyAddress={report.property_address}
                  variant={report.report_variant ?? null}
                  includeSources={includeSources}
                  includeScoring={includeScoring}
                  includeCharts={includeCharts}
                  includeHeroImages={includeHeroImages}
                  includeSparklines={includeSparklines}
                  designOptions={pdfDesignOptions}
                />
              </ErrorBoundary>
              <RegenerateWithPerplexityButton
                reportId={report.id}
                propertyAddress={report.property_address}
                onRegenerated={onRegenerated}
                variant="default"
                size="sm"
              />
            </div>
          </section>

          {/* The Design section is hidden product-wide — see
              `designControlsVisibility.ts`. The heading, the description and
              the Reset button are inside the guard with the panel, because the
              panel refusing to draw on its own would leave a bordered box
              titled "Design" over nothing, which reads as a broken page. The
              options themselves still travel to the renderer above; they are
              simply always the defaults. */}
          {REPORT_DESIGN_CONTROLS_VISIBLE && (
            <section className="space-y-3 rounded-xl border bg-background/70 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><Paintbrush className="h-3.5 w-3.5" />Design</h3>
                  <p className="text-xs text-muted-foreground">Tune premium PDF presentation settings.</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 px-2 text-xs"
                  onClick={() => onPdfDesignOptionsChange(DEFAULT_PDF_DESIGN_OPTIONS)}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Reset
                </Button>
              </div>
              <PremiumPdfDesignPanel value={pdfDesignOptions} onChange={onPdfDesignOptionsChange} />
            </section>
          )}

          <Button variant="outline" size="sm" className="w-full bg-background/70" onClick={onDownload}>
            <Download className="h-4 w-4 mr-1" />
            Download raw text
          </Button>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
