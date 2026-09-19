/**
 * EditorEmptyState — first-run chooser shown when a template has zero pages.
 *
 * Rehaul Phase 7 onboarding: replaces the bare "No page selected" placeholder
 * with the three start paths the plan calls for — Blank page, From a template,
 * From a reference (import). Pure presentational; the editor wires the action
 * callbacks to its existing starter/marketplace/import flows.
 */
import { FileText, LayoutTemplate, Upload, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export interface EditorEmptyStateProps {
  onBlank: () => void;
  onTemplates: () => void;
  onReference: () => void;
  /** Disable the reference CTA when the template has no id yet (must save first). */
  referenceDisabled?: boolean;
}

interface Choice {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function EditorEmptyState({ onBlank, onTemplates, onReference, referenceDisabled }: EditorEmptyStateProps) {
  const choices: Choice[] = [
    {
      key: 'blank',
      icon: FileText,
      title: 'Blank page',
      body: 'Start from an empty A4 page and drop in text, shapes, images or data blocks.',
      cta: 'Add blank page',
      onClick: onBlank,
    },
    {
      key: 'templates',
      icon: LayoutTemplate,
      title: 'From a template',
      body: 'Pick a starter page — cover, KPI grid, comparison table, summary, appendix…',
      cta: 'Browse templates',
      onClick: onTemplates,
    },
    {
      key: 'reference',
      icon: Upload,
      title: 'From a reference',
      body: 'Drop a PDF, screenshot, URL, code snippet, ZIP, or Figma export — reconstructed into editable pages.',
      cta: 'Import reference',
      onClick: onReference,
      disabled: !!referenceDisabled,
      disabledReason: 'Save the template once before importing a reference.',
    },
  ];

  return (
    <div className="h-full w-full overflow-y-auto p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Start your template</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick a starting point. You can mix and match — add more pages, swap themes, or import another reference any time.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {choices.map((c) => {
            const Icon = c.icon;
            return (
              <Card
                key={c.key}
                className={`group relative flex flex-col gap-4 p-6 transition-all ${
                  c.disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md'
                }`}
                onClick={() => !c.disabled && c.onClick()}
                role="button"
                tabIndex={c.disabled ? -1 : 0}
                onKeyDown={(e) => {
                  if (!c.disabled && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    c.onClick();
                  }
                }}
                aria-disabled={c.disabled || undefined}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold">{c.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{c.body}</p>
                  {c.disabled && c.disabledReason ? (
                    <p className="mt-2 text-xs italic text-muted-foreground">{c.disabledReason}</p>
                  ) : null}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={c.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!c.disabled) c.onClick();
                  }}
                  className="w-full justify-between"
                >
                  {c.cta}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Card>
            );
          })}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Tip: drag any element from the Insert panel straight onto the canvas. Press <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px]">?</kbd> for all keyboard shortcuts.
        </p>
      </div>
    </div>
  );
}
