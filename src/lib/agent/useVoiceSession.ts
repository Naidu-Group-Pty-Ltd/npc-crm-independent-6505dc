/**
 * useVoiceSession — one spoken turn, from "I'm listening" to the words said.
 *
 * The composer's dictation button (`VoiceToTextButton`) records until the user
 * presses stop. A conversation cannot work that way: nobody presses a button
 * to finish a sentence. This hook listens, decides for itself when the person
 * has finished (`createVad`), and hands the recording to the SAME
 * transcription function the dictation button uses — so voice mode adds no
 * backend and spends nothing the existing button does not.
 *
 * It also exposes how loud the person is (`getLevel`) so the orb can visibly
 * listen. The level is read from a ref on every animation frame by whoever
 * draws it; it never causes a React render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { createVad, rmsFromBytes, type VadOptions } from './vad.pure';

export type VoiceSessionState = 'idle' | 'listening' | 'transcribing';

export type VoiceSessionOutcome =
  | { kind: 'transcript'; text: string }
  | { kind: 'no-speech' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

function supportedMime(): { mimeType: string; ext: string } {
  const types = [
    { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
    { mimeType: 'audio/webm', ext: 'webm' },
    { mimeType: 'audio/mp4', ext: 'mp4' },
    { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' },
    { mimeType: 'audio/ogg', ext: 'ogg' },
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t.mimeType)) return t;
  }
  return { mimeType: 'audio/webm', ext: 'webm' };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

type StopReason = 'auto' | 'manual' | 'cancel' | 'no-speech';

export interface VoiceSession {
  supported: boolean;
  state: VoiceSessionState;
  /** True once the person has started speaking in the current turn. */
  heard: boolean;
  /** Listen for one turn. Resolves with what happened. */
  listen: (options?: VadOptions) => Promise<VoiceSessionOutcome>;
  /** Stop listening now and transcribe what was said so far. */
  finish: () => void;
  /** Stop listening and discard the turn. */
  cancel: () => void;
  /** Smoothed 0..1 loudness, for drawing. */
  getLevel: () => number;
}

export function useVoiceSession(): VoiceSession {
  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const [state, setState] = useState<VoiceSessionState>('idle');
  const [heard, setHeard] = useState(false);
  const levelRef = useRef(0);
  const stopRef = useRef<((reason: 'manual' | 'cancel') => void) | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRef.current?.('cancel');
    };
  }, []);

  const listen = useCallback(
    async (options?: VadOptions): Promise<VoiceSessionOutcome> => {
      if (!supported) return { kind: 'error', message: 'Voice is not available in this browser.' };
      stopRef.current?.('cancel');

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        return { kind: 'error', message: 'Aurixa needs your microphone. Allow it in the browser and try again.' };
      }

      const { mimeType, ext } = supportedMime();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType });
      } catch {
        recorder = new MediaRecorder(stream);
      }
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const AudioCtx: typeof AudioContext | undefined =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = AudioCtx ? new AudioCtx() : null;
      const analyser = ctx ? ctx.createAnalyser() : null;
      if (ctx && analyser) {
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        void ctx.resume?.();
      }
      const frame = new Uint8Array(analyser ? analyser.fftSize : 0);
      const vad = createVad(options);

      setHeard(false);
      setState('listening');

      return new Promise<VoiceSessionOutcome>((resolve) => {
        let raf = 0;
        let last = performance.now();
        let ended = false;
        let spoke = false;
        let reason: StopReason = 'auto';

        const teardown = () => {
          cancelAnimationFrame(raf);
          stream.getTracks().forEach((t) => t.stop());
          void ctx?.close?.().catch(() => undefined);
          levelRef.current = 0;
          stopRef.current = null;
        };

        const stop = (why: StopReason) => {
          if (ended) return;
          ended = true;
          reason = why;
          if (recorder.state !== 'inactive') recorder.stop();
          else onStopped();
        };

        const onStopped = async () => {
          teardown();
          if (reason === 'cancel') {
            if (mountedRef.current) setState('idle');
            resolve({ kind: 'cancelled' });
            return;
          }
          const blob = new Blob(chunks, { type: mimeType });
          // A tap on "done" is trusted even if the detector heard nothing: a
          // quiet speaker should not be told they said nothing.
          if (reason === 'no-speech' || (reason === 'auto' && !spoke) || blob.size < 200) {
            if (mountedRef.current) setState('idle');
            resolve({ kind: 'no-speech' });
            return;
          }
          if (mountedRef.current) setState('transcribing');
          try {
            const audio = await blobToDataUrl(blob);
            const { data, error } = await invokeSecureFunction('voice-to-text', {
              audio,
              mimeType,
              fileName: `audio.${ext}`,
            });
            if (error) throw new Error(error.message || 'Transcription failed');
            const text = typeof data?.text === 'string' ? data.text.trim() : '';
            resolve(text ? { kind: 'transcript', text } : { kind: 'no-speech' });
          } catch (err) {
            resolve({ kind: 'error', message: err instanceof Error ? err.message : 'Transcription failed' });
          } finally {
            if (mountedRef.current) setState('idle');
          }
        };

        recorder.onstop = () => void onStopped();
        stopRef.current = (why) => stop(why);

        const tick = () => {
          if (ended) return;
          const now = performance.now();
          const dt = Math.min(100, now - last);
          last = now;
          if (analyser) {
            analyser.getByteTimeDomainData(frame);
            const s = vad.push(rmsFromBytes(frame), dt);
            // Fast attack, slow release: the orb leaps to a syllable and settles.
            const target = s.level;
            levelRef.current += (target - levelRef.current) * (target > levelRef.current ? 0.55 : 0.12);
            if (s.phase === 'speaking' && !spoke) {
              spoke = true;
              if (mountedRef.current) setHeard(true);
            }
            if (s.phase === 'ended' || s.phase === 'max-length') {
              stop('auto');
              return;
            }
            if (s.phase === 'no-speech') {
              stop('no-speech');
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };

        try {
          recorder.start(250);
        } catch {
          teardown();
          if (mountedRef.current) setState('idle');
          resolve({ kind: 'error', message: 'The microphone could not start recording.' });
          return;
        }
        raf = requestAnimationFrame(tick);
      });
    },
    [supported],
  );

  const finish = useCallback(() => stopRef.current?.('manual'), []);
  const cancel = useCallback(() => stopRef.current?.('cancel'), []);
  const getLevel = useCallback(() => levelRef.current, []);

  return useMemo(
    () => ({ supported, state, heard, listen, finish, cancel, getLevel }),
    [supported, state, heard, listen, finish, cancel, getLevel],
  );
}
