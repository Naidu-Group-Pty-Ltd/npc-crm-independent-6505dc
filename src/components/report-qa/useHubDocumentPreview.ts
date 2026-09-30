import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  requestReportQaPreview,
  type ReportQaPreviewResult,
} from '@/lib/reports/reportQa/requestReportQaPdf';

interface Args {
  /** No conversation, no preview: the route draws only what it can read. */
  conversationId: string | null;
  subject: 'answer' | 'structured';
  /** Required for the `answer` subject. */
  messageId?: string | null;
  /** What the editor holds now. */
  text: string;
  /**
   * True when the editor holds something other than what is stored. Only then
   * is the text sent as a draft — a draft is an edit, and drawing one takes the
   * rights the edit's Save takes, while the record may be previewed by anybody
   * who can read it.
   */
  edited: boolean;
  /** The chosen template's identity. A change redraws the preview. */
  templateKey: string;
  /** Whether the preview is on screen. Nothing is drawn while it is not. */
  visible: boolean;
}

export interface HubDocumentPreviewState {
  available: boolean;
  preview: ReportQaPreviewResult | null;
  drawing: boolean;
  error: string | null;
  /** The editor or the template has moved since this preview was drawn. */
  stale: boolean;
  /** When the preview on screen was drawn. */
  drawnAt: Date | null;
  refresh: () => Promise<void>;
}

/**
 * The export dialog's Preview: the document the export would make, drawn by
 * the report service in the chosen template (`requestReportQaPreview`).
 *
 * A draw is a round trip to the engine, so it happens when it is useful rather
 * than on every keystroke:
 *
 * - the first time the preview is shown;
 * - whenever the chosen template changes while it is shown;
 * - when the preview comes back into view after the text was edited.
 *
 * Edits made while it is on screen (the side-by-side view) mark it stale, and
 * the person redraws it — the button, or Ctrl/⌘+Enter in the editor. A draw
 * that failed is not retried by itself: the error is shown with the way out.
 */
export function useHubDocumentPreview({
  conversationId,
  subject,
  messageId,
  text,
  edited,
  templateKey,
  visible,
}: Args): HubDocumentPreviewState {
  const available = Boolean(conversationId) && (subject !== 'answer' || Boolean(messageId));
  const [preview, setPreview] = useState<ReportQaPreviewResult | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawnKey, setDrawnKey] = useState<string | null>(null);
  const [drawnAt, setDrawnAt] = useState<Date | null>(null);

  // The text itself, whether or not it is stored: saving an edit that was
  // already previewed changes nothing on the page, so it must not read stale.
  const key = `${templateKey}\u0000${text}`;
  // What a draw reads, current as of the last render. Written in a layout
  // effect, which runs before the effect below that may draw.
  const latest = useRef({ conversationId, subject, messageId, text, edited, key, templateKey });
  useLayoutEffect(() => {
    latest.current = { conversationId, subject, messageId, text, edited, key, templateKey };
  });
  const runId = useRef(0);
  // What the last draw was asked for — whether or not it succeeded, so a
  // failure is shown rather than retried in a loop.
  const attemptedKey = useRef<string | null>(null);
  const attemptedTemplate = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const { conversationId: id, subject: s, messageId: mid, text: t, edited: e, key: k, templateKey: tk } = latest.current;
    if (!id) return;
    const run = ++runId.current;
    attemptedKey.current = k;
    attemptedTemplate.current = tk;
    setDrawing(true);
    setError(null);
    try {
      const result = await requestReportQaPreview(id, s, {
        messageId: mid ?? null,
        draft: e ? t : null,
      });
      if (run !== runId.current) return;
      setPreview(result);
      setDrawnKey(k);
      setDrawnAt(new Date());
    } catch (err) {
      if (run !== runId.current) return;
      setError(err instanceof Error ? err.message : 'The preview could not be drawn.');
    } finally {
      if (run === runId.current) setDrawing(false);
    }
  }, []);

  // Coming into view is remembered until it is acted on, so a tab switched
  // to during a draw still redraws once that draw is done.
  const wasVisible = useRef(false);
  const cameIntoView = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) cameIntoView.current = true;
    wasVisible.current = visible;
    if (!visible) {
      cameIntoView.current = false;
      return;
    }
    if (!available || drawing) return;
    const never = attemptedKey.current === null;
    const moved = attemptedKey.current !== key;
    const templateMoved = attemptedTemplate.current !== null && attemptedTemplate.current !== templateKey;
    const onView = cameIntoView.current;
    cameIntoView.current = false;
    if (never || templateMoved || (onView && moved)) void refresh();
  }, [available, visible, templateKey, key, drawing, refresh]);

  return {
    available,
    preview,
    drawing,
    error,
    stale: preview !== null && drawnKey !== key,
    drawnAt,
    refresh,
  };
}
