/**
 * Producing a typeset Report Q&A document, from wherever it is asked for.
 *
 * Extracted from `ReportQaDownloadButton` so the export menu can offer the
 * same documents as plain menu items rather than embedding the whole button —
 * a `DropdownMenu` nested inside another menu's content never opens, and a
 * dialog rendered there vanishes with it. One hook means one set of toasts,
 * one consent rule and one attachment shape.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { deliverReportQaPdf } from '@/lib/reports/reportQa/deliverReportQaPdf';
import type { ReportQaSubjectName } from '@/lib/reports/reportQa/requestReportQaPdf';

export function useReportQaDelivery(args: {
  conversationId: string | null;
  messageId?: string | null;
  onAttachToEmail?: (blob: Blob, fileName: string) => void;
  onAttached?: () => void;
}) {
  const { conversationId, messageId, onAttachToEmail, onAttached } = args;
  const [running, setRunning] = useState<ReportQaSubjectName | null>(null);

  const run = async (
    subject: ReportQaSubjectName,
    options: { attach?: boolean; email?: boolean } = {},
  ) => {
    if (!conversationId) {
      toast.error('Start a conversation first');
      return;
    }
    setRunning(subject);
    try {
      const result = await deliverReportQaPdf(conversationId, subject, {
        messageId: messageId ?? null,
        // Only the structured subject can spend tokens, and only when the
        // conversation has no write-up stored. Asking for that subject is the
        // consent — the menu item says "Uses AI" beside it.
        generateIfMissing: subject === 'structured',
        attachToConversation: options.attach === true,
        save: !options.email && !options.attach,
      });

      if (options.email) onAttachToEmail?.(result.blob, result.fileName);
      if (options.attach) onAttached?.();

      const notes: string[] = [];
      if (result.pageCount) notes.push(`${result.pageCount} pages`);
      if (result.truncated) {
        notes.push(`${result.turnsShown} of ${result.turnCount} exchanges — the rest is in the .md export`);
      }
      if (result.generated) notes.push('written up by AI');
      if (result.brandGaps.length) notes.push(`brand incomplete: ${result.brandGaps.join(', ')}`);

      toast.success(result.fileName, { description: notes.join(' · ') || undefined });
    } catch (e) {
      // The renderer's own message, in front of the person who pressed the
      // button. It names what is missing — an undeployed route, a conversation
      // with no write-up stored — and what still works.
      toast.error(e instanceof Error ? e.message : 'Could not produce the document');
    } finally {
      setRunning(null);
    }
  };

  return { running, busy: running !== null, run };
}
