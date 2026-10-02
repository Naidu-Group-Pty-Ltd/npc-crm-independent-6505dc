/**
 * AgentMessageActions — what you can do with a reply once it has landed.
 *
 * Copy, and read it aloud. They sit quietly under the reply and come forward
 * on hover (always visible on touch, and always on the latest reply), so the
 * conversation reads as a conversation rather than a toolbar.
 */
import { useEffect, useState } from 'react';
import { Check, Copy, Square, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toSpeakable } from '@/lib/agent/speech.pure';
import type { SpeechControls } from '@/lib/agent/useSpeech';

interface AgentMessageActionsProps {
  content: string;
  speech: SpeechControls;
  /** The latest reply keeps its actions visible. */
  pinned?: boolean;
}

export function AgentMessageActions({ content, speech, pinned }: AgentMessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  // Reading ends when the voice goes quiet, however it stopped.
  useEffect(() => {
    if (reading && !speech.speaking) {
      const t = window.setTimeout(() => {
        if (!speech.speaking) setReading(false);
      }, 400);
      return () => window.clearTimeout(t);
    }
  }, [reading, speech.speaking]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      /* clipboard refused — nothing to say */
    }
  };

  const toggleRead = () => {
    if (reading) {
      speech.cancel();
      setReading(false);
      return;
    }
    const text = toSpeakable(content);
    if (!text) return;
    speech.cancel();
    speech.unlock();
    speech.enqueue(text);
    setReading(true);
  };

  return (
    <div className={cn('aurixa-msg-actions mt-1.5 flex items-center gap-0.5', pinned && 'aurixa-msg-actions--pinned')}>
      <button type="button" onClick={copy} className="aurixa-msg-action" aria-label={copied ? 'Copied' : 'Copy reply'}>
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        <span className="aurixa-msg-action__label">{copied ? 'Copied' : 'Copy'}</span>
      </button>
      {speech.supported && (
        <button
          type="button"
          onClick={toggleRead}
          className="aurixa-msg-action"
          data-on={reading ? 'true' : undefined}
          aria-label={reading ? 'Stop reading' : 'Read aloud'}
          aria-pressed={reading}
        >
          {reading ? <Square className="h-3 w-3" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
          <span className="aurixa-msg-action__label">{reading ? 'Stop' : 'Listen'}</span>
        </button>
      )}
    </div>
  );
}
