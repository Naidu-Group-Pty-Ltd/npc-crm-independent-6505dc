/**
 * SpellCheckDialog — sweep all text overlays for likely misspellings.
 *
 * Pure client-side: uses a small high-frequency English misspelling
 * dictionary (top fat-finger errors + AU/UK spelling guards) plus heuristic
 * checks (repeated letters > 3, double spaces, lone "teh"). Designed to flag
 * obvious typos pre-flight rather than replace a full ispell pass.
 *
 * Click a flag to jump straight to the offending overlay in the editor.
 */
import { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, SpellCheck } from 'lucide-react';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ReportTemplate;
  onJumpTo: (pageId: string, blockId: string, overlayId: string) => void;
}

// Common typos → suggestion. Kept lean; renderer is the source of truth.
const TYPOS: Record<string, string> = {
  teh: 'the', adn: 'and', recieve: 'receive', recieved: 'received',
  seperate: 'separate', occured: 'occurred', occuring: 'occurring',
  untill: 'until', wich: 'which', acommodate: 'accommodate',
  accomodate: 'accommodate', begining: 'beginning', beleive: 'believe',
  calender: 'calendar', concious: 'conscious', definately: 'definitely',
  enviroment: 'environment', goverment: 'government', independant: 'independent',
  liase: 'liaise', maintainance: 'maintenance', neccessary: 'necessary',
  occassion: 'occasion', persistant: 'persistent', priviledge: 'privilege',
  publically: 'publicly', refered: 'referred', relevent: 'relevant',
  succesful: 'successful', tommorow: 'tomorrow', truely: 'truly',
  untill2: 'until', wether: 'whether', wierd: 'weird', writting: 'writing',
  thier: 'their', youre: "you're", dont: "don't", cant: "can't",
  wont: "won't", isnt: "isn't", arent: "aren't", didnt: "didn't",
  doesnt: "doesn't", wouldnt: "wouldn't", couldnt: "couldn't", shouldnt: "shouldn't",
  // US → AU/UK guards (warn, not block)
  color: 'colour', favor: 'favour', favorite: 'favourite', center: 'centre',
  organize: 'organise', organized: 'organised', realize: 'realise',
  analyze: 'analyse', behavior: 'behaviour', honor: 'honour',
};

interface Finding {
  pageId: string;
  pageName: string;
  blockId: string;
  overlayId: string;
  overlayName?: string;
  word: string;
  suggestion: string;
  context: string;
  severity: 'typo' | 'style';
}

function scanTemplate(template: ReportTemplate): Finding[] {
  const out: Finding[] = [];
  for (const page of template.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const overlay of block.overlays ?? []) {
        if (overlay.type !== 'text' && overlay.type !== 'textOnPath') continue;
        const raw = String((overlay as any).content ?? '');
        if (!raw) continue;
        // Skip bindings {{...}} so we don't flag template tokens
        const visible = raw.replace(/\{\{[^}]+\}\}/g, ' ').replace(/<[^>]+>/g, ' ');
        // Repeated whitespace
        if (/\s{2,}/.test(visible)) {
          out.push({
            pageId: page.id, pageName: page.name, blockId: block.id, overlayId: overlay.id,
            overlayName: (overlay as any).name, word: '(double space)', suggestion: 'single space',
            context: raw.slice(0, 80), severity: 'style',
          });
        }
        // Tokenize
        const tokens = visible.match(/[A-Za-z']+/g) ?? [];
        for (const t of tokens) {
          const lower = t.toLowerCase();
          const hit = TYPOS[lower];
          if (hit) {
            const isStyle = ['color','favor','favorite','center','organize','organized','realize','analyze','behavior','honor'].includes(lower);
            out.push({
              pageId: page.id, pageName: page.name, blockId: block.id, overlayId: overlay.id,
              overlayName: (overlay as any).name,
              word: t, suggestion: hit, context: snippet(raw, t),
              severity: isStyle ? 'style' : 'typo',
            });
          }
          // Heuristic: 3+ identical letters in a row outside of allowlisted words
          if (/([a-z])\1{2,}/i.test(lower) && lower.length > 3 && !['xxx','www'].includes(lower)) {
            out.push({
              pageId: page.id, pageName: page.name, blockId: block.id, overlayId: overlay.id,
              overlayName: (overlay as any).name,
              word: t, suggestion: 'check spelling', context: snippet(raw, t),
              severity: 'style',
            });
          }
        }
      }
    }
  }
  return out;
}

function snippet(haystack: string, needle: string): string {
  const i = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return haystack.slice(0, 80);
  const start = Math.max(0, i - 24);
  const end = Math.min(haystack.length, i + needle.length + 24);
  return (start > 0 ? '…' : '') + haystack.slice(start, end) + (end < haystack.length ? '…' : '');
}

export function SpellCheckDialog({ open, onOpenChange, template, onJumpTo }: Props) {
  const findings = useMemo(() => (open ? scanTemplate(template) : []), [open, template]);
  const typos = findings.filter((f) => f.severity === 'typo');
  const style = findings.filter((f) => f.severity === 'style');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SpellCheck className="h-4 w-4" /> Spell check
          </DialogTitle>
          <DialogDescription>
            Heuristic sweep across every text overlay. Bindings ({'{{path}}'}) and HTML tags are ignored.
          </DialogDescription>
        </DialogHeader>

        {findings.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
            <CheckCircle2 className="h-12 w-12 text-success" />
            <div className="text-sm font-medium">No obvious issues found</div>
            <div className="text-xs text-muted-foreground">
              {(template.pages ?? []).reduce((n, p) => n + (p.blocks ?? []).reduce((m, b) => m + (b.overlays ?? []).filter((o) => o.type === 'text' || o.type === 'textOnPath').length, 0), 0)} text overlays scanned
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 gap-2">
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="destructive">{typos.length} typos</Badge>
              <Badge variant="outline">{style.length} style / AU spelling</Badge>
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-1.5 pr-3">
                {findings.map((f, i) => (
                  <button
                    key={i}
                    onClick={() => { onJumpTo(f.pageId, f.blockId, f.overlayId); onOpenChange(false); }}
                    className="w-full text-left rounded border p-2 hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant={f.severity === 'typo' ? 'destructive' : 'secondary'} className="text-[10px] uppercase">
                        {f.severity}
                      </Badge>
                      <span className="font-mono font-semibold">{f.word}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-medium">{f.suggestion}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {f.pageName}{f.overlayName ? ` · ${f.overlayName}` : ''}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground truncate">{f.context}</div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
