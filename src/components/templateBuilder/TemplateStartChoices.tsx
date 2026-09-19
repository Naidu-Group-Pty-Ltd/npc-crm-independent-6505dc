/**
 * The three start routes, as a card grid.
 *
 * The copy itself lives in `@/lib/reportTemplate/templateStartRoutes` — see the
 * note there for why Import and Convert cannot be merged. This file is the
 * rendering, shaped on `EditorEmptyState` so the two first-run surfaces in this
 * feature behave identically (same keyboard handling, same `aria-disabled`).
 */
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  TEMPLATE_START_ROUTES,
  type TemplateStartKey,
} from '@/lib/reportTemplate/templateStartRoutes';

export interface TemplateStartChoicesProps {
  onBlank: () => void;
  onImport: () => void;
  onConvert: () => void;
  /** Everything is an edit; without the permission the cards are inert. */
  disabled?: boolean;
  /** Shown above the grid. Pass null for a bare grid inside another heading. */
  heading?: string | null;
  description?: string | null;
}

export function TemplateStartChoices({
  onBlank,
  onImport,
  onConvert,
  disabled,
  heading = 'Start a template',
  description = 'Three ways in. They end in different places, so the last line of each card is '
    + 'what you get.',
}: TemplateStartChoicesProps) {
  const handlers: Record<TemplateStartKey, () => void> = {
    blank: onBlank,
    import: onImport,
    convert: onConvert,
  };

  return (
    <div>
      {heading && (
        <div className="mb-5">
          <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {TEMPLATE_START_ROUTES.map((route) => {
          const Icon = route.icon;
          const run = handlers[route.key];
          return (
            /* The card is not itself a button.
               It was, with a `<Button>` nested inside it — two interactive
               elements one inside the other, which is invalid and gives screen
               readers two overlapping controls for one action. The button is
               the control; the card just makes the whole area clickable for a
               pointer, which needs no role and no tab stop of its own. */
            <Card
              key={route.key}
              className={`group flex flex-col gap-4 p-6 transition-shadow focus-within:border-primary/60 ${
                disabled
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer hover:border-primary/60 hover:shadow-md'
              }`}
              onClick={() => !disabled && run()}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold">{route.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{route.body}</p>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  You get
                </p>
                <p className="text-sm">{route.outcome}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={(e) => { e.stopPropagation(); if (!disabled) run(); }}
                className="w-full justify-between"
              >
                {route.cta}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
