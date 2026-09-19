/**
 * EditorOnboardingTour — first-run multi-step coachmark for the Template Builder
 * V2 editor (rehaul Phase 7).
 *
 * Modal-based (not anchored to DOM nodes) so it stays robust as the editor
 * chrome evolves. Dismissal persists per browser via localStorage; reopen via
 * the "?" shortcuts dialog.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, ArrowLeft, MousePointerClick, LayoutTemplate, Type, Database, Eye } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'tpl-editor-onboarding-seen';

export function hasSeenEditorTour(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}
export function markEditorTourSeen(): void {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
}
export function resetEditorTour(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

interface Step {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: MousePointerClick,
    title: 'Drag from the Insert rail',
    body: 'Grab any element — text, shape, image, icon — from the left rail and drop it onto the canvas at the cursor. Click to drop at the viewport center instead.',
  },
  {
    icon: LayoutTemplate,
    title: 'Build pages with layout tools',
    body: 'Multi-select with marquee, align/distribute from the floating toolbar, snap to guides, group, lock, and reorder pages from the page thumbnails on the left.',
  },
  {
    icon: Type,
    title: 'Style text inline',
    body: 'Double-click any text overlay to edit inline. Select it for the floating text toolbar — font, size, weight, color, alignment, line-height, lists.',
  },
  {
    icon: Database,
    title: 'Bind data with one click',
    body: 'Open the Bind popover from the Properties inspector to insert {{path}} values from your sample data. Live preview swaps in real report data.',
  },
  {
    icon: Eye,
    title: 'Preview & ship',
    body: 'Switch between Design, Preview, and PDF in the top bar. Hit Save to draft, then submit for approval. Need help any time — press ? for shortcuts.',
  },
];

export interface EditorOnboardingTourProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user finishes or skips. Use to persist `seen=true`. */
  onComplete?: () => void;
}

export function EditorOnboardingTour({ open, onOpenChange, onComplete }: EditorOnboardingTourProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;
  const current = STEPS[step];
  const Icon = current.icon;

  const finish = () => {
    onComplete?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) finish(); else onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
            {current.body}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex items-center gap-1.5" aria-hidden>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted'}`}
            />
          ))}
        </div>

        <DialogFooter className="mt-4 flex-row justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={finish}>Skip tour</Button>
          <div className="flex gap-2">
            {!isFirst && (
              <Button variant="outline" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                Back
              </Button>
            )}
            {isLast ? (
              <Button size="sm" onClick={finish}>Get started</Button>
            ) : (
              <Button size="sm" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
                Next
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
