/**
 * The typeset market intelligence report, beside the legacy one.
 *
 * Additive. `MarketIntelligencePDFGenerator.ts` and both buttons that drive it
 * stay exactly where they are; this is a second control offering the
 * server-rendered document, the way the Borrowing Capacity, Cash Flow,
 * Portfolio, Comparison, Client Details and Q&A migrations each did.
 *
 * ## The audience selector is on this control, deliberately
 *
 * A report row carries the `audience_segment` it was generated under, and the
 * document is materially different between them — the suburb layer's closing
 * panels are written for an investor, a homebuyer, or both. The legacy inherits
 * the row's value silently and offers no way to produce another edition without
 * regenerating the whole report through the model.
 *
 * Here the edition is a render-time choice, so the same stored report can be
 * issued as an investor edition and a homebuyer edition without spending a
 * token. It defaults to the report's own segment, so doing nothing produces
 * what the row says.
 *
 * ## What the caller sees when a layer is missing
 *
 * Six of the record's 46 layer bodies are empty strings. The document names them
 * on its own opening page; this control repeats that in the toast, because
 * somebody about to email a client a report with two sections missing should
 * find that out before they send it, not after.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { deliverMarketIntelligencePdf } from '@/lib/reports/marketIntelligence/deliverMarketIntelligencePdf';

/** The editions the document knows how to set. */
const AUDIENCES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'investor', label: 'Investor' },
  { value: 'homebuyer', label: 'Homebuyer' },
];

export interface MarketIntelligenceDownloadButtonProps {
  /** The `marketing_intelligence_reports` row to typeset. */
  reportId: string;
  /** The row's own segment. The selector opens here. */
  audienceSegment?: string | null;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'default' | 'icon';
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  label?: string;
}

export function MarketIntelligenceDownloadButton({
  reportId,
  audienceSegment,
  disabled,
  className,
  size = 'sm',
  variant = 'outline',
  label = 'Typeset PDF',
}: MarketIntelligenceDownloadButtonProps) {
  const [busy, setBusy] = useState(false);
  const [persist, setPersist] = useState(true);
  const [edition, setEdition] = useState<string>(
    AUDIENCES.some((a) => a.value === audienceSegment) ? String(audienceSegment) : 'general',
  );

  const handleDownload = async () => {
    setBusy(true);
    const toastId = toast.loading('Typesetting the market intelligence report…', {
      description: 'Rendering server-side under your brand — this takes a few seconds.',
    });
    try {
      const delivered = await deliverMarketIntelligencePdf(reportId, {
        persist,
        // The real thing, not a label: the route hands this to the normaliser as
        // an audience override, so the suburb section's closing panels are the
        // ones written for this reader. The cover's edition line follows from it.
        audience: edition,
      });

      const notes: string[] = [];
      if (delivered.pageCount) notes.push(`${delivered.pageCount} pages`);
      if (delivered.emptyLayers.length) {
        notes.push(`${delivered.emptyLayers.length} layer(s) returned no data: ${delivered.emptyLayers.join(', ')}`);
      }
      if (delivered.dropped.length) notes.push(`not shown: ${delivered.dropped.join(', ')}`);
      if (delivered.brandGaps.length) notes.push(`brand gaps: ${delivered.brandGaps.join(', ')}`);
      if (delivered.persisted) notes.push('saved for the scheduled email');
      // Said at the moment it happens, like every other fall-through in the
      // programme: the person asked for the stored copy and got their chosen
      // template instead, and the email attaches the standard layout (RS-5c.4).
      else if (delivered.templated && delivered.persistRequested) {
        notes.push('drawn from your chosen template; not saved for the scheduled email, which attaches the standard layout');
      }

      toast.success('Report ready', {
        id: toastId,
        description: notes.join(' · ') || delivered.fileName,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not produce the report';
      toast.error('Typesetting failed', { id: toastId, description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {/* At `size="icon"` the label is not drawn, so it is declared: the History
          modal's primary action was an unnamed button that a screen reader
          announces as "button" (found by the RS-5c.5 format journey). */}
      <Button
        onClick={handleDownload}
        disabled={busy || disabled || !reportId}
        variant={variant}
        size={size}
        className={className}
        aria-label={size === 'icon' ? (busy ? 'Typesetting…' : label) : undefined}
        title={size === 'icon' ? label : undefined}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
        {size !== 'icon' && <span className="ml-2 text-xs">{busy ? 'Typesetting…' : label}</span>}
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={busy || disabled}
            aria-label="Typeset PDF options"
          >
            <span className="text-[10px] font-medium uppercase tracking-wide">
              {edition.slice(0, 3)}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="end">
          <div className="space-y-3">
            <p className="text-sm font-medium">Typeset PDF options</p>

            <div className="space-y-1.5">
              <Label className="text-xs">Edition</Label>
              <div className="flex gap-1">
                {AUDIENCES.map((a) => (
                  <Button
                    key={a.value}
                    type="button"
                    variant={edition === a.value ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 flex-1 text-[11px]"
                    onClick={() => setEdition(a.value)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Changes the closing panels on the suburb section. No model call.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="mi-persist-toggle" className="text-xs leading-tight cursor-pointer">
                Save for the scheduled email
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  Stores the PDF so a scheduled marketing send can attach it
                </span>
              </Label>
              <Switch id="mi-persist-toggle" checked={persist} onCheckedChange={setPersist} />
            </div>

            {/* This popover is the format's options panel, so the template
                belongs in it rather than a page away. The row form is used
                here because the panel is not a menu — there are no
                `DropdownMenuItem`s for a menu section to sit among. */}
            <ReportTemplateSelector
              reportType="market_intelligence"
              formatLabel="Market Intelligence"
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
