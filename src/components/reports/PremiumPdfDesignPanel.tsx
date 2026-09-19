import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Palette, RotateCcw, SlidersHorizontal, Type } from "lucide-react";
import {
  DEFAULT_PDF_DESIGN_OPTIONS,
  type PdfChapterStyle,
  type PdfCoverStyle,
  type PdfDensity,
  type PdfDesignOptions,
  type PdfDesignPreset,
  type PdfTableStyle,
} from "./premiumPdfDesign";
import { REPORT_DESIGN_CONTROLS_VISIBLE } from "@/lib/reports/designControlsVisibility";

interface PremiumPdfDesignPanelProps {
  value: PdfDesignOptions;
  onChange: (next: PdfDesignOptions) => void;
}

const presetSwatches: Record<PdfDesignPreset, string> = {
  signature: "bg-primary",
  editorial_navy: "bg-chart-2",
  minimal_ink: "bg-foreground",
  high_contrast: "bg-success",
};

export function PremiumPdfDesignPanel({ value, onChange }: PremiumPdfDesignPanelProps) {
  const patch = (next: Partial<PdfDesignOptions>) => onChange({ ...value, ...next });

  // The design factor is hidden product-wide (designControlsVisibility.ts).
  // The refusal lives in the component rather than at its call sites so that a
  // future mount inherits the decision instead of reopening it.
  if (!REPORT_DESIGN_CONTROLS_VISIBLE) return null;

  return (
    <div className="w-full rounded-md border border-border bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            WeasyPrint design controls
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">Live render inputs</Badge>
          </div>
          <p className="text-xs text-muted-foreground">These settings are sent to the Premium PDF renderer and visibly change the final PDF.</p>
        </div>
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => onChange(DEFAULT_PDF_DESIGN_OPTIONS)}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Visual preset</Label>
          <Select value={value.preset} onValueChange={(preset) => patch({ preset: preset as PdfDesignPreset })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="signature">NPC Signature Gold</SelectItem>
              <SelectItem value="editorial_navy">Editorial Navy</SelectItem>
              <SelectItem value="minimal_ink">Minimal Ink</SelectItem>
              <SelectItem value="high_contrast">High Contrast</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-1.5 pt-1">
            {(["signature", "editorial_navy", "minimal_ink", "high_contrast"] as PdfDesignPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={preset}
                onClick={() => patch({ preset })}
                className={`h-4 flex-1 rounded-sm border ${value.preset === preset ? "border-primary" : "border-border"} ${presetSwatches[preset]}`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Cover</Label>
          <Select value={value.coverStyle} onValueChange={(coverStyle) => patch({ coverStyle: coverStyle as PdfCoverStyle })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="image">Clean image</SelectItem>
              <SelectItem value="title_overlay">Title overlay</SelectItem>
              <SelectItem value="editorial">Editorial masthead</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Chapter openings</Label>
          <Select value={value.chapterStyle} onValueChange={(chapterStyle) => patch({ chapterStyle: chapterStyle as PdfChapterStyle })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="classic">Classic numbered</SelectItem>
              <SelectItem value="opener_band">Full-width opener band</SelectItem>
              <SelectItem value="minimal">Minimal rule</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Tables</Label>
          <Select value={value.tableStyle} onValueChange={(tableStyle) => patch({ tableStyle: tableStyle as PdfTableStyle })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="classic">Classic contrast</SelectItem>
              <SelectItem value="ledger">Ledger lines</SelectItem>
              <SelectItem value="minimal">Minimal grid</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Density</Label>
          <Select value={value.density} onValueChange={(density) => patch({ density: density as PdfDensity })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="compact">Compact</SelectItem>
              <SelectItem value="balanced">Balanced</SelectItem>
              <SelectItem value="spacious">Spacious</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Type className="h-3.5 w-3.5" /> Body size</span>
            <span>{value.bodyScale}%</span>
          </div>
          <Slider min={90} max={112} step={1} value={[value.bodyScale]} onValueChange={([bodyScale]) => patch({ bodyScale })} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Palette className="h-3.5 w-3.5" /> Visual intensity</span>
            <span>{value.visualIntensity}%</span>
          </div>
          <Slider min={0} max={100} step={5} value={[value.visualIntensity]} onValueChange={([visualIntensity]) => patch({ visualIntensity })} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <ToggleRow label="Drop caps" checked={value.showDropCaps} onCheckedChange={(showDropCaps) => patch({ showDropCaps })} />
          <ToggleRow label="Numbers" checked={value.showSectionNumbers} onCheckedChange={(showSectionNumbers) => patch({ showSectionNumbers })} />
          <ToggleRow label="Justified" checked={value.justifyText} onCheckedChange={(justifyText) => patch({ justifyText })} />
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
