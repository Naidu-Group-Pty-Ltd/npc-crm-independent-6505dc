/**
 * The frame around the comparison's model-written analysis.
 *
 * The name is the product's, not a description of the technique: this is
 * **Aurixa Intelligence (AI) Decision Support**, and it is spelled the same way
 * here and on the card inside it. It is declared once, in `AI_PANEL_TITLE`,
 * because the two surfaces sit one inside the other — a reader sees both at
 * once, and two spellings of one name read as two different features.
 */
import { Sparkles } from 'lucide-react';
import type { CashFlowContainerProps } from './types';

/** The one spelling of this panel's name. Pinned by `aiPanelNaming.spec.tsx`. */
export const AI_PANEL_TITLE = 'Aurixa Intelligence (AI) Decision Support';

interface CashFlowAiPanelProps extends CashFlowContainerProps {
  active?: boolean;
}

export function CashFlowAiPanel({ children, active = true }: CashFlowAiPanelProps) {
  if (!active) return null;

  return (
    <section className="min-w-0 space-y-4 rounded-[1.75rem] border border-brand-300/30 bg-gradient-to-br from-card dark:from-background via-card dark:via-background to-card dark:to-background p-3 shadow-2xl shadow-sm dark:shadow-black/20 ring-1 ring-brand-400/15 md:p-4">
      <div className="flex min-w-0 items-center gap-3 px-1">
        <span className="shrink-0 rounded-2xl bg-brand-400/10 p-2 text-brand-300 shadow-sm ring-1 ring-brand-300/20">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand-100 md:text-base">{AI_PANEL_TITLE}</p>
          <p className="text-xs leading-5 text-muted-foreground dark:text-foreground [overflow-wrap:anywhere]">Generate, save, and export comparison analysis without changing report payloads.</p>
        </div>
      </div>
      {children}
    </section>
  );
}
