/**
 * DesignBriefCard — renders the structured brief returned by the Template
 * Design Agent's vision pass. Shown inline in chat so the designer can verify
 * what the AI "saw" before/after layout synthesis.
 */
import { Palette, Type, LayoutGrid, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface DesignBriefView {
  palette: { role: string; hex: string; label?: string }[];
  typography: { heading: string; body: string; vibe: string };
  layout: { grid: string; density: string; sections: { role: string; title: string; span: number; notes?: string }[] };
  content?: { headline?: string; deck?: string; body?: string; labels?: string[] };
  motifs?: string[];
}

export interface BriefPairing { bg: string; text: string; ratio: number; swapped: boolean }

interface Props {
  brief: DesignBriefView;
  pairings?: BriefPairing[];
  swaps?: string[];
}

export function DesignBriefCard({ brief, pairings = [], swaps = [] }: Props) {
  return (
    <div className="mt-3 rounded-md border bg-card/60 p-3 space-y-3 text-[11px]">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Palette className="h-3.5 w-3.5 text-primary" /> Design brief
      </div>

      {/* Palette */}
      <div className="space-y-1">
        <div className="uppercase tracking-wide text-[9px] text-muted-foreground">Palette</div>
        <div className="flex flex-wrap gap-1.5">
          {brief.palette.map((p, i) => (
            <div
              key={i}
              className="flex items-center gap-1 rounded border px-1.5 py-0.5"
              title={`${p.role}: ${p.hex}${p.label ? ` (${p.label})` : ''}`}
            >
              <span
                className="inline-block h-3 w-3 rounded-sm border"
                style={{ backgroundColor: p.hex }}
              />
              <span className="font-mono text-[10px]">{p.hex}</span>
              <span className="text-[9px] text-muted-foreground">{p.role}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Contrast guard */}
      {pairings.length > 0 && (
        <div className="space-y-1">
          <div className="uppercase tracking-wide text-[9px] text-muted-foreground">Contrast guard</div>
          <div className="flex flex-wrap gap-1.5">
            {pairings.map((p, i) => {
              const ok = p.ratio >= 4.5;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 border ${ok ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'}`}
                  title={`${p.text} on ${p.bg} = ${p.ratio.toFixed(2)}:1`}
                >
                  {ok ? <ShieldCheck className="h-3 w-3 text-success" /> : <ShieldAlert className="h-3 w-3 text-warning" />}
                  <span className="inline-block h-2.5 w-2.5 rounded-sm border" style={{ backgroundColor: p.bg }} />
                  <span className="inline-block h-2.5 w-2.5 rounded-sm border" style={{ backgroundColor: p.text }} />
                  <span className="font-mono text-[10px]">{p.ratio.toFixed(1)}:1</span>
                  {p.swapped && <Badge variant="outline" className="h-3.5 px-1 text-[8px]">auto-swap</Badge>}
                </div>
              );
            })}
          </div>
          {swaps.length > 0 && (
            <ul className="pl-3 list-disc text-[10px] text-muted-foreground space-y-0.5">
              {swaps.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Typography */}
      <div className="space-y-1">
        <div className="uppercase tracking-wide text-[9px] text-muted-foreground flex items-center gap-1">
          <Type className="h-3 w-3" /> Typography
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px]">heading: {brief.typography.heading}</Badge>
          <Badge variant="outline" className="text-[10px]">body: {brief.typography.body}</Badge>
          <Badge className="text-[10px] bg-primary/15 text-primary border-primary/30">{brief.typography.vibe}</Badge>
        </div>
      </div>

      {/* Layout sections */}
      <div className="space-y-1">
        <div className="uppercase tracking-wide text-[9px] text-muted-foreground flex items-center gap-1">
          <LayoutGrid className="h-3 w-3" /> Layout · {brief.layout.density}
        </div>
        <div className="space-y-0.5">
          {brief.layout.sections.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded bg-muted/40 px-2 py-1">
              <Badge variant="outline" className="text-[9px] uppercase tracking-wide">{s.role}</Badge>
              <span className="flex-1 truncate text-[11px]">{s.title}</span>
              <span className="text-[9px] text-muted-foreground font-mono">{s.span}/12</span>
            </div>
          ))}
        </div>
      </div>

      {/* Motifs */}
      {brief.motifs && brief.motifs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {brief.motifs.map((m, i) => (
            <Badge key={i} variant="secondary" className="text-[9px]">{m}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}
