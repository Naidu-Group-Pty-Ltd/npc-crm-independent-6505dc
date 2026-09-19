/**
 * BindingFixerPopover — surfaces broken bindings with auto-suggested
 * replacements. The user can apply per-issue or "Auto-fix all" with one click.
 */
import { useMemo, useState } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Wand2, Sparkles, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { buildFixes, applyAllAutoFixes, applyFix, type BindingFix } from '@/lib/reportTemplate/bindingFixer';
import type { TemplateIssue } from '@/lib/reportTemplate/bindingValidation';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

interface Props {
  template: ReportTemplate;
  issues: TemplateIssue[];
  sampleData: Record<string, any>;
  onApply: (next: ReportTemplate) => void;
  onJumpTo: (issue: TemplateIssue) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const KIND_LABEL: Record<string, string> = {
  path: 'Unknown path',
  token: 'Unknown token',
  filter: 'Unknown filter',
};

export function BindingFixerPopover({ template, issues, sampleData, onApply, onJumpTo, open: controlledOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const fixes: BindingFix[] = useMemo(
    () => buildFixes(issues, template, sampleData),
    [issues, template, sampleData],
  );
  const fixable = fixes.filter((f) => f.suggestions.length > 0);
  const autoCount = fixable.filter((f) => f.suggestions[0]?.score >= 0.6).length;

  const apply = (fix: BindingFix, replacement: string) => {
    onApply(applyFix(template, fix, replacement));
    toast.success(`Fixed "${fix.broken}" → "${replacement}"`);
  };

  const applyAll = () => {
    const { template: next, applied, skipped } = applyAllAutoFixes(template, fixable);
    if (applied === 0) { toast.info('No high-confidence fixes available'); return; }
    onApply(next);
    toast.success(`Applied ${applied} fix${applied === 1 ? '' : 'es'}${skipped ? `, skipped ${skipped} low-confidence` : ''}`);
    setOpen(false);
  };

  if (issues.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 gap-1.5 text-[11px] border-brand-500/40 text-brand-600 hover:bg-brand-500/10"
          title="AI-assisted binding fixer"
        >
          <Wand2 className="h-3 w-3" /> Fix bindings
          {autoCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded bg-brand-500/20 text-[9px] font-semibold uppercase tracking-wider">
              {autoCount} auto
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[460px] p-0">
        <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-brand-500" /> Binding fixer
            <span className="text-[10px] text-muted-foreground font-normal">
              {fixable.length} of {issues.length} resolvable
            </span>
          </div>
          <Button
            size="sm"
            variant="default"
            className="h-7 text-[11px]"
            onClick={applyAll}
            disabled={autoCount === 0}
            title="Apply every high-confidence (≥60%) suggestion"
          >
            <Wand2 className="h-3 w-3 mr-1" /> Auto-fix {autoCount > 0 ? `(${autoCount})` : ''}
          </Button>
        </div>
        <ScrollArea className="max-h-[420px]">
          {fixes.length === 0 ? (
            <div className="px-3 py-6 text-xs text-muted-foreground text-center">
              No fixable bindings — check the issue list for syntax/structural problems.
            </div>
          ) : (
            <ul className="divide-y">
              {fixes.map((f, idx) => (
                <li key={idx} className="px-3 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium flex items-center gap-1.5">
                        <span className="text-[9px] uppercase tracking-wider px-1 rounded bg-muted">{KIND_LABEL[f.kind]}</span>
                        <code className="font-mono text-destructive truncate">{f.broken}</code>
                      </div>
                      <button
                        type="button"
                        onClick={() => onJumpTo(f.issue)}
                        className="text-[10px] text-muted-foreground hover:text-primary truncate block text-left"
                      >
                        {f.issue.where}
                      </button>
                    </div>
                  </div>
                  {f.suggestions.length === 0 ? (
                    <div className="text-[10px] italic text-muted-foreground pl-1">No suggestions — edit manually.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 pl-1">
                      {f.suggestions.map((s, si) => (
                        <button
                          key={si}
                          type="button"
                          onClick={() => apply(f, s.replacement)}
                          className={`group inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] transition-colors ${
                            s.score >= 0.6
                              ? 'border-success/40 bg-success/5 text-success hover:bg-success/15'
                              : 'border-border hover:border-primary hover:bg-primary/5'
                          }`}
                          title={`Confidence ${(s.score * 100).toFixed(0)}%${s.preview ? ` · preview: ${s.preview}` : ''}`}
                        >
                          <ArrowRight className="h-2.5 w-2.5 opacity-60" />
                          <code className="font-mono">{s.label}</code>
                          <span className="text-[9px] opacity-60">{Math.round(s.score * 100)}%</span>
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <div className="px-3 py-2 border-t text-[10px] text-muted-foreground">
          Suggestions are fuzzy-matched against your sample data + tokens. Auto-fix applies suggestions ≥60% confidence.
        </div>
      </PopoverContent>
    </Popover>
  );
}
