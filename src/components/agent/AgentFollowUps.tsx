/**
 * AgentFollowUps — "want me to…?", offered after a reply.
 *
 * Chosen from the areas of the business the reply actually touched, so a
 * pipeline answer offers pipeline next steps. Each chip is sent as an ordinary
 * message: anything that would change data still goes through the agent's own
 * approval step.
 */
import type { CSSProperties } from 'react';
import { CornerDownRight } from 'lucide-react';
import './aurixa.css';

interface AgentFollowUpsProps {
  suggestions: string[];
  onPick: (prompt: string) => void;
}

export function AgentFollowUps({ suggestions, onPick }: AgentFollowUpsProps) {
  if (suggestions.length === 0) return null;
  return (
    <div className="aurixa-followups mt-3 flex flex-wrap items-center gap-1.5" aria-label="Suggested next questions">
      {suggestions.map((s, i) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="aurixa-followup"
          style={{ '--i': i } as CSSProperties}
        >
          <CornerDownRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          {s}
        </button>
      ))}
    </div>
  );
}
