/**
 * useStreamingSpeech — speak a reply while it is still being written.
 *
 * Follows ONE streaming message (`streamKey`, the widget's in-flight message
 * id) and hands each newly completed sentence to the speech queue. When the
 * stream ends the key goes null; the last text seen for that key is flushed
 * once and the hook stops following. That ordering matters: after a reply
 * finishes, the widget swaps the in-flight message for the server's copy
 * under a different id, and a hook keyed on "the last assistant message"
 * would start reading the whole reply again from the top.
 */
import { useEffect, useRef } from 'react';
import { takeSpeakable } from './speech.pure';
import type { SpeechControls } from './useSpeech';

export interface StreamingSpeechInput {
  speech: SpeechControls;
  enabled: boolean;
  /** Id of the message being streamed, or null when nothing is. */
  streamKey: string | null;
  /** That message's content so far. */
  text: string;
  /** Called once the final sentence has been queued. */
  onFlushed?: () => void;
}

export function useStreamingSpeech({ speech, enabled, streamKey, text, onFlushed }: StreamingSpeechInput) {
  const followingRef = useRef<string | null>(null);
  const cursorRef = useRef(0);
  const lastTextRef = useRef('');
  const flushedRef = useRef(onFlushed);
  useEffect(() => {
    flushedRef.current = onFlushed;
  }, [onFlushed]);

  useEffect(() => {
    if (!enabled) {
      followingRef.current = null;
      return;
    }

    if (streamKey) {
      if (followingRef.current !== streamKey) {
        followingRef.current = streamKey;
        cursorRef.current = 0;
      }
      lastTextRef.current = text;
      const take = takeSpeakable(text, cursorRef.current, false);
      if (take.text) speech.enqueue(take.text);
      cursorRef.current = take.next;
      return;
    }

    if (followingRef.current) {
      const take = takeSpeakable(lastTextRef.current, cursorRef.current, true);
      if (take.text) speech.enqueue(take.text);
      followingRef.current = null;
      cursorRef.current = 0;
      lastTextRef.current = '';
      flushedRef.current?.();
    }
  }, [enabled, streamKey, text, speech]);
}
