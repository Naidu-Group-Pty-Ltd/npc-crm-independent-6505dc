/**
 * AgentVoiceMode — talking with Aurixa instead of typing at it.
 *
 * The composer's microphone dictates: it records until you press stop and
 * drops the words in the box. A conversation does not work like that, so this
 * is a different thing. Aurixa listens, notices when you have finished
 * (`useVoiceSession`), sends what you said through the SAME `sendMessage` the
 * Send button uses, reads the reply aloud while it is still being written
 * (`useStreamingSpeech`), and listens again. Nothing on the server knows the
 * difference.
 *
 * Four rules keep it humane:
 * - **You can always talk over it.** A tap on Aurixa while it speaks stops the
 *   voice and the reply, the way a person stops when interrupted, and it
 *   listens again.
 * - **A spoken yes is never an approval.** Anything the agent would change —
 *   an email, a record — still waits on a tap, because a misheard word must
 *   not send somebody's email. Aurixa says what it wants to do and the card
 *   holds Approve / Cancel.
 * - **Silence pauses, it never loops.** If nothing is said, Aurixa stops
 *   listening and says so, rather than leaving a microphone open.
 * - **Leaving is instant.** End stops the microphone and the voice at once;
 *   the conversation stays exactly where it was, in text.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AurixaPresence } from './presence/AurixaPresence';
import { AgentApprovalCard } from './AgentApprovalCard';
import { summarisePendingActions } from '@/lib/agent/toolNarration.pure';
import type { Presence } from '@/lib/agent/presence.pure';
import type { SpeechControls } from '@/lib/agent/useSpeech';
import type { VoiceSession } from '@/lib/agent/useVoiceSession';
import { useStreamingSpeech } from '@/lib/agent/useStreamingSpeech';
import { toSpeakable } from '@/lib/agent/speech.pure';

type Phase = 'starting' | 'listening' | 'waiting' | 'paused' | 'approval';

export interface VoicePendingAction {
  toolCalls?: unknown[];
  status?: 'pending' | 'approved' | 'rejected';
}

export interface AgentVoiceModeProps {
  presence: Presence;
  voice: VoiceSession;
  speech: SpeechControls;
  /** A request is in flight. */
  busy: boolean;
  /** Id and text of the reply being streamed, if one is. */
  streamKey: string | null;
  streamText: string;
  /** The most recent assistant text, for the caption once a reply has landed. */
  lastReply: string;
  /** The latest action waiting on Approve / Cancel, if any. */
  pending: VoicePendingAction | null;
  onSend: (text: string) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  /** Stop the reply being generated. */
  onStop: () => void;
  onExit: () => void;
}

/** The last couple of sentences of what Aurixa is saying, for the caption. */
function captionOf(markdown: string): string {
  const spoken = toSpeakable(markdown).trim();
  if (spoken.length <= 220) return spoken;
  const tail = spoken.slice(-220);
  const cut = tail.search(/[.!?]\s/);
  return `…${cut >= 0 && cut < 120 ? tail.slice(cut + 2) : tail}`;
}

function waitUntil(test: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (test()) {
      resolve();
      return;
    }
    const started = Date.now();
    const t = window.setInterval(() => {
      if (test() || Date.now() - started > timeoutMs) {
        window.clearInterval(t);
        resolve();
      }
    }, 120);
  });
}

export function AgentVoiceMode({
  presence, voice, speech, busy, streamKey, streamText, lastReply, pending,
  onSend, onApprove, onReject, onStop, onExit,
}: AgentVoiceModeProps) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [muted, setMuted] = useState(false);
  const [heardText, setHeardText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [settled, setSettled] = useState(0);
  const [silenced, setSilenced] = useState(false);
  const [deciding, setDeciding] = useState(false);

  const aliveRef = useRef(true);
  const mutedRef = useRef(muted);
  const pendingRef = useRef(pending);
  const busyRef = useRef(busy);
  const lastReplyRef = useRef(lastReply);
  const onSendRef = useRef(onSend);
  // The conversation loop runs across awaits, so it reads the latest of these
  // through refs, refreshed after every render.
  useLayoutEffect(() => {
    mutedRef.current = muted;
    pendingRef.current = pending;
    busyRef.current = busy;
    lastReplyRef.current = lastReply;
    onSendRef.current = onSend;
  });

  // Aurixa's own voice: the reply is read as it streams, unless interrupted.
  useStreamingSpeech({ speech, enabled: !silenced, streamKey, text: streamText });

  const listen = useCallback(async () => {
    if (!aliveRef.current) return;
    speech.cancel();
    setNotice(null);
    setPhase('listening');
    const outcome = await voice.listen();
    if (!aliveRef.current) return;
    if (outcome.kind === 'transcript') {
      setHeardText(outcome.text);
      setPhase('waiting');
      // An interrupted reply may still be winding down; a send made while it
      // is would be refused, so wait for it rather than lose the turn.
      await waitUntil(() => !busyRef.current, 15_000);
      if (!aliveRef.current) return;
      setSilenced(false);
      try {
        await onSendRef.current(outcome.text);
      } finally {
        if (aliveRef.current) setSettled((n) => n + 1);
      }
    } else if (outcome.kind === 'no-speech') {
      setPhase('paused');
      setNotice('I didn’t catch anything. Tap me when you’re ready.');
    } else if (outcome.kind === 'error') {
      setPhase('paused');
      setNotice(outcome.message);
    }
    // `cancelled`: whoever cancelled has already decided what comes next.
  }, [speech, voice]);

  const listenRef = useRef(listen);
  useLayoutEffect(() => {
    listenRef.current = listen;
  }, [listen]);

  // Start listening the moment voice mode opens; stop everything on the way out.
  useEffect(() => {
    aliveRef.current = true;
    void listenRef.current();
    return () => {
      aliveRef.current = false;
      voice.cancel();
      speech.cancel();
    };
    // Mount/unmount only: the refs carry the latest callbacks.
  }, []);

  // A turn has been answered: let Aurixa finish speaking, then carry on.
  useEffect(() => {
    if (settled === 0) return;
    let cancelled = false;
    void (async () => {
      await speech.whenIdle();
      if (cancelled || !aliveRef.current) return;
      const p = pendingRef.current;
      if (p && p.status === 'pending') {
        setPhase('approval');
        const first = summarisePendingActions(p.toolCalls)[0];
        const what = first ? `${first.title}${first.detail ? `, ${first.detail}` : ''}` : 'take that action';
        speech.enqueue(`Before I go ahead: ${what}. Tap approve when you’re ready.`);
        return;
      }
      if (lastReplyRef.current.trimStart().startsWith('⚠️')) {
        setPhase('paused');
        setNotice('That didn’t go through. Tap me to try again.');
        return;
      }
      if (mutedRef.current) {
        setPhase('paused');
        return;
      }
      void listenRef.current();
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, speech]);

  const interrupt = useCallback(() => {
    setSilenced(true);
    speech.cancel();
    if (busyRef.current) onStop();
  }, [onStop, speech]);

  const tapPresence = useCallback(() => {
    speech.unlock();
    if (phase === 'approval' || deciding) return;
    if (voice.state === 'listening') {
      voice.finish();
      return;
    }
    if (voice.state === 'transcribing') return;
    if (speech.speaking || busy) {
      interrupt();
      setMuted(false);
      void listen();
      return;
    }
    setMuted(false);
    void listen();
  }, [busy, deciding, interrupt, listen, phase, speech, voice]);

  const toggleMute = useCallback(() => {
    if (muted) {
      setMuted(false);
      if (phase === 'paused' && !busy && !speech.speaking) void listen();
      return;
    }
    setMuted(true);
    if (voice.state === 'listening') {
      voice.cancel();
      setPhase('paused');
    }
  }, [busy, listen, muted, phase, speech.speaking, voice]);

  const decide = useCallback(
    async (approved: boolean) => {
      setDeciding(true);
      speech.cancel();
      try {
        await (approved ? onApprove() : onReject());
      } finally {
        setDeciding(false);
      }
      if (!aliveRef.current) return;
      speech.enqueue(approved ? 'Done.' : 'Okay, I’ve left it.');
      await speech.whenIdle();
      if (!aliveRef.current) return;
      if (mutedRef.current) {
        setPhase('paused');
        return;
      }
      void listenRef.current();
    },
    [onApprove, onReject, speech],
  );

  const end = useCallback(() => {
    aliveRef.current = false;
    voice.cancel();
    speech.cancel();
    onExit();
  }, [onExit, speech, voice]);

  // Esc leaves voice mode (not the panel); Space taps Aurixa.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      end();
    } else if (e.key === ' ' && (e.target as HTMLElement).dataset.voiceStage === 'true') {
      e.preventDefault();
      tapPresence();
    }
  };

  // What to say under the orb.
  let status = presence.status;
  let hint: string | null = null;
  if (muted && voice.state !== 'listening' && !presence.active) {
    status = 'Microphone off';
    hint = 'Unmute when you want to keep talking.';
  } else if (phase === 'approval' && pending?.status === 'pending') {
    status = 'Needs your go-ahead';
    hint = 'Tap Approve when you’re ready — I won’t act on a spoken yes.';
  } else if (voice.state === 'listening') {
    hint = voice.heard ? 'Tap me when you’ve finished.' : 'Go ahead — I’ll know when you’ve finished.';
  } else if (speech.speaking) {
    hint = 'Tap me to interrupt.';
  } else if (busy) {
    hint = 'Tap me to stop and say something else.';
  } else if (phase === 'paused' || phase === 'starting') {
    status = phase === 'starting' ? 'Getting ready…' : 'Paused';
    hint = notice ?? 'Tap me to talk.';
  }

  const replyCaption = captionOf(streamKey ? streamText : lastReply);
  const showReply = Boolean(replyCaption) && (busy || speech.speaking || phase === 'approval' || phase === 'paused');
  const presenceMood = phase === 'approval' && pending?.status === 'pending' && !presence.active ? 'attention' : presence.mood;

  return (
    <div className="aurixa-voice-stage relative flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pt-6 text-center">
        <button
          type="button"
          onClick={tapPresence}
          data-voice-stage="true"
          className="aurixa-voice-stage__orb rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-4 focus-visible:ring-offset-background"
          aria-label={
            voice.state === 'listening'
              ? 'Finish speaking'
              : speech.speaking || busy
                ? 'Interrupt Aurixa'
                : 'Talk to Aurixa'
          }
        >
          <AurixaPresence mood={presenceMood} size={148} getLevel={voice.getLevel} />
        </button>

        <p className="mt-7 font-heading text-[1.15rem] font-medium tracking-tight text-foreground" aria-live="polite">
          {status}
        </p>
        {hint && <p className="mt-1 max-w-[18rem] text-[12.5px] leading-snug text-muted-foreground">{hint}</p>}

        <div className="mt-6 w-full max-w-[22rem] space-y-3">
          {heardText && (
            <p className="aurixa-voice-stage__heard text-[13px] leading-relaxed text-muted-foreground">
              <span className="sr-only">You said: </span>“{heardText}”
            </p>
          )}
          {showReply && (
            <p className="aurixa-voice-stage__caption text-[15px] leading-relaxed text-foreground" aria-live="off">
              {replyCaption}
            </p>
          )}
        </div>

        {phase === 'approval' && pending && (
          <div className="mt-5 w-full max-w-[22rem] text-left">
            <AgentApprovalCard
              toolCalls={pending.toolCalls}
              status={pending.status}
              busy={deciding}
              onApprove={() => void decide(true)}
              onReject={() => void decide(false)}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-center gap-5 px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <button
          type="button"
          onClick={toggleMute}
          className={cn('aurixa-voice-control', muted && 'aurixa-voice-control--on')}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <MicOff className="h-5 w-5" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={end}
          className="aurixa-voice-control aurixa-voice-control--end"
          aria-label="End voice conversation"
          title="End (Esc)"
        >
          <PhoneOff className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={interrupt}
          className={cn('aurixa-voice-control', !(busy || speech.speaking) && 'invisible')}
          aria-label="Stop Aurixa"
          title="Stop"
          tabIndex={busy || speech.speaking ? 0 : -1}
        >
          <Square className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
