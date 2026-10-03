/**
 * AgentActionChips — the pages Aurixa offered to open, one tap away.
 *
 * The model never writes a link into its prose; it asks for a page by name or
 * by the record it found, the server composes the address, and the panel
 * re-checks it (`isAgentHref`) before drawing a button. So every chip here
 * opens a page this product has, for a record a tool actually returned.
 *
 * When the person asked to go somewhere and the screen keeps the panel beside
 * the page, the widget opens the first offer itself; the chip then reads
 * "You're here", so what moved the page is never a mystery.
 */
import type { CSSProperties } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { isAgentHref } from '@/lib/agent/protocol';
import { isCurrentPage, type PanelAction } from '@/lib/agent/answerPanel.pure';
import './aurixa.css';

interface AgentActionChipsProps {
  actions: readonly PanelAction[];
  onOpen?: (href: string) => void;
}

export function AgentActionChips({ actions, onOpen }: AgentActionChipsProps) {
  const location = useLocation();
  const safe = actions.filter((a) => isAgentHref(a.href));
  if (!safe.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Pages to open">
      {safe.map((action, i) => {
        const here = isCurrentPage(action.href, location);
        return here ? (
          <span key={action.href} className="aurixa-action" data-here="true" aria-current="page">
            <Check className="h-3.5 w-3.5" aria-hidden />
            <span className="truncate">{action.label}</span>
            <span className="text-muted-foreground">· You&apos;re here</span>
          </span>
        ) : (
          <Link
            key={action.href}
            to={action.href}
            onClick={() => onOpen?.(action.href)}
            className="aurixa-action"
            style={{ '--i': i } as CSSProperties}
          >
            <span className="truncate">Open {action.label}</span>
            <ArrowRight className="aurixa-action__arrow h-3.5 w-3.5" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}
