import { getAuthenticatedSupabaseClient } from '@/hooks/useAuthenticatedSupabase';
import type {
  BrandContext, ReportListing, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';
import {
  buildReportQaDocument,
} from '../../../../supabase/functions/_shared/reports/reportQa/normalise.pure';
import type {
  ReportQaSubject,
} from '../../../../supabase/functions/_shared/reports/reportQa/payload.pure';
import { applyReportQaProjection } from '../../../../supabase/functions/_shared/reportQaProjection.pure';
import { applyOrganisationAndBrand } from './organisation';

/*
 * The staff-session client, not the anon one.
 *
 * This format's rows are invisible to the browser client under the Command
 * Centre's custom cookie session — see `secureSource.ts` for the measurement —
 * so every read returned an empty result rather than an error, the adapter
 * answered `null`, and the router fell back to the legacy generator. The
 * gateway holds a service-role client and scopes the read to the verified
 * session, which is the rule every adapter read follows.
 */
const db = () => getAuthenticatedSupabaseClient();

/**
 * Report Q&A, through the normaliser the format's own render route uses.
 *
 * `buildReportQaDocument` is the same function `render-report-qa-pdf` calls, so
 * a template and the flowing route describe one conversation the same way. The
 * projection then restates that document; neither re-reads
 * `report_qa_messages`.
 *
 * ## The variant picks the subject
 *
 * This format is three documents, not one: the whole `transcript`, a single
 * `answer`, and the conversation's `structured` report. The Cash Flow adapter
 * already establishes that `variant` is what the caller asked for rather than
 * what the row says, and this reads it the same way. `transcript` is the
 * default because it is the only subject that is well-defined without also
 * being told *which* answer.
 *
 * The `structured` subject is accepted but not published by the projection —
 * see `reportQaProjection.pure.ts` for why binding a separately-generated
 * report beside the turns would put two answers to one question on a page.
 */

const CONVERSATION_COLUMNS = 'id, title, report_names, structured_report, created_at';
const MESSAGE_COLUMNS =
  'id, role, content, edited_content, created_at, model_provider, model_version, citations';

function subjectFor(variant: string | null | undefined): ReportQaSubject {
  return variant === 'answer' || variant === 'structured' ? variant : 'transcript';
}

async function loadConversation(id: string) {
  const { data, error } = await db()
    .from('report_qa_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, any>;
}

/**
 * Does this conversation contain an answer?
 *
 * Routing resolves before binding, and until this existed the two disagreed:
 * routing resolved for any conversation that loaded, while binding refuses one
 * with no assistant turn — which is **22 of the 252 stored conversations**, 21
 * of them holding no message at all. A routing context that resolves for a
 * record the binding cannot serve offers an operator a ready-looking template
 * and then produces nothing, which is the failure `cashFlowAdapter` documents
 * at length and checks in both of its methods for the same reason.
 *
 * One id, one row, `head` so no body comes back: cheaper than the transcript
 * read it saves when the answer is that there is nothing to render.
 */
async function hasAnswer(conversationId: string): Promise<boolean> {
  const { count, error } = await db()
    .from('report_qa_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant');
  if (error) return false;
  return (count ?? 0) > 0;
}

async function loadMessages(conversationId: string) {
  const { data, error } = await db()
    .from('report_qa_messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error || !data) return null;
  return data as Record<string, any>[];
}

export const qaAdapter: ReportTemplateAdapter = {
  reportType: 'qa',
  label: 'Report Q&A',
  supportsProduction: true,
  legacyFallback: {
    label: 'Report Q&A flowing export',
    route: 'render-report-qa-pdf',
    reason:
      'The flowing route paginates a conversation of any length. A template is a '
      + 'fixed page sequence and carries the first exchanges, so it stays the '
      + 'default for a long transcript.',
  },

  async listRecentReports({ limit = 20 }: { limit?: number } = {}): Promise<ReportListing[]> {
    try {
      const { data, error } = await db()
        .from('report_qa_conversations')
        .select('id, title, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      // A conversation with no assistant turn will decline at selection — the
      // binding context returns null — which is honest enough for a picker;
      // filtering here would cost a message count per row.
      return (data as Record<string, any>[]).map((row) => ({
        id: String(row.id),
        label: (row.title as string) || 'Report Q&A',
        savedAt: (row.created_at as string) ?? null,
      }));
    } catch {
      return [];
    }
  },

  async resolveRoutingContext({ reportId, variant }): Promise<RoutingContext | null> {
    const conversation = await loadConversation(reportId);
    if (!conversation) return null;
    // The same test the binding applies. See `hasAnswer`.
    if (!await hasAnswer(reportId)) return null;
    const subject = subjectFor(variant);
    /*
     * The structured write-up is NOT a templated document (RS-5c.5b).
     *
     * The projection deliberately never publishes `structured_report` (see
     * `reportQaProjection.pure.ts`), and no master carries a page bound to it —
     * every content page of the Q&A masters draws `qa.answer`, the FIRST turn's
     * reply, or the turns table. Routing the structured subject here therefore
     * produced a real document with nothing in it: measured through the journey
     * on 14 Sep 2026, a conversation holding a 5,460-character write-up came
     * out as a cover, "The question" with a note reading "This document carries
     * 0 of 4 exchanges; 4 are not shown", the sources page and the back cover.
     * A shell that looks finished is worse than the standard layout, so the
     * templated path declines and `deliverReportQaPdf` falls through to
     * `render-report-qa-pdf`, which draws the write-up. The day a master binds
     * the write-up (`qaStructuredNotTemplated.spec.ts` watches the composer
     * for it), this refusal is the line to remove.
     */
    if (subject === 'structured') return null;
    return {
      reportId,
      reportType: 'qa',
      variant: subject,
      tier: null,
      title: (conversation.title as string) || 'Report Q&A',
      fileLabel: 'report-qa',
      sourceTable: 'report_qa_conversations',
      legacyFallback: qaAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, variant, brand }:
    { reportId: string; variant?: string | null; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const conversation = await loadConversation(reportId);
    if (!conversation) return null;
    const messages = await loadMessages(reportId);
    if (!messages || messages.length === 0) return null;

    const subject = subjectFor(variant);
    const built = buildReportQaDocument({
      conversation,
      messages,
      subject,
      // The `answer` subject needs a message id and this adapter is not told
      // one, so it takes the first exchange. A caller that wants a particular
      // answer asks the flowing route, which is addressed by message.
      messageId: subject === 'answer' ? (messages.find((m) => m.role === 'assistant')?.id ?? null) : null,
      preparedOn: new Date().toISOString(),
      // The masters set the first answer (bounded by their answer pages) and
      // LIST the further questions; the flowing route's line budget would cut
      // the very turns that table exists for. See `BuildInput.keepAllTurns`.
      keepAllTurns: true,
    });
    // A conversation with no assistant turn is not a document. Returning null
    // rather than an empty one is what makes the library card say so.
    if (!built.ok) return null;

    const data: Record<string, any> = {
      report: {
        id: conversation.id,
        type: 'qa',
        generated_at: conversation.created_at,
      },
      conversation,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyReportQaProjection(data, built.document);
    await applyOrganisationAndBrand(data);

    return {
      data,
      meta: { reportId, reportType: 'qa', variant: subject, tier: null },
    };
  },
};
