import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders as createAuthCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage, extractOpenAIUsage } from '../_shared/logApiUsage.ts';
import { getBrandConfig } from '../_shared/brand-config.ts';
import { OperatorFacingError, failureResponse } from '../_shared/errorResponse.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface EmailData {
  id?: string;
  sender: string;
  subject: string;
  body: string;
  received_at?: string;
}

interface SummaryOutput {
  tldr: string;
  keyPoints: string[];
  requiredActions: string[];
  urgencyLevel: 'low' | 'medium' | 'high';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createAuthCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    // Parse body with error handling - session token may be in headers/cookies
    let body: any = {};
    try {
      body = await req.json();
    } catch (err) {
      console.log('[email-copilot] Body parsing failed (may be empty), continuing with empty body:', err);
      // Continue - session token should be in headers/cookies
    }

    const {
      action, email, emailId, linkedPropertyAddress, replyContext, clientId,
      // v2 inputs
      tone, length, intent, language, threadEmails, variants,
      // improve / quick reply inputs
      text, instruction,
    } = body;
    
    console.log(`[Email Copilot] Action: ${action}, EmailId: ${emailId || 'N/A'}, ClientId: ${clientId || 'N/A'}`);

    // SECURITY: Verify authentication
    // IMPORTANT: verifyAuth checks headers/cookies first, then body
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[email-copilot] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log('[email-copilot] Authenticated user:', userId);

    // Handle different actions
    switch (action) {
      // Audit item 43 — these two used to refuse unless `OPENAI_API_KEY` was
      // set, and neither has used it since both moved to `callLLMRaw`. The
      // router owns credential resolution: which key a call spends follows
      // from the agent's `route`, and `email_copilot` is configured `native`
      // here, so a request that this gate let through would reach OpenAI
      // anyway and a request it refused might have had a perfectly good
      // gateway credential.
      //
      // Its practical effect was to make one action fail differently from its
      // siblings: Summarize reported the client's generic "Failed to summarize
      // email" while Analyze and Translate, which never had the gate, reported
      // the server's "internal error" — two symptoms, one cause, and the gate
      // disguising it.
      case 'summarize':
        return await handleSummarize(email, emailId, supabase, corsHeaders);

      case 'draft_reply':
        return await handleDraftReply(email, emailId, linkedPropertyAddress, supabase, replyContext, corsHeaders);

      case 'draft_reply_v2':
        return await handleDraftReplyV2({
          email, emailId, linkedPropertyAddress, replyContext,
          tone, length, intent, language, threadEmails,
          variants: Math.min(Math.max(Number(variants) || 1, 1), 3),
        }, supabase, corsHeaders);

      case 'improve_text':
        return await handleImproveText({ text, instruction, tone, language }, supabase, corsHeaders);

      case 'quick_replies':
        return await handleQuickReplies({ email, threadEmails }, supabase, corsHeaders);

      case 'analyze':
        return await handleAnalyze({ email, emailId }, supabase, corsHeaders);

      case 'translate':
        return await handleTranslate({ text, language }, supabase, corsHeaders);

      case 'thread_summary':
        return await handleThreadSummary({ email, threadEmails }, supabase, corsHeaders);

      case 'save_email':
        return await handleSaveEmail(email, supabase, corsHeaders);

      case 'assign_client':
        return await handleAssignClient(emailId, clientId, supabase, corsHeaders);

      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (error) {
    // A sentence a handler composed on purpose reaches the operator; anything
    // else stays opaque. Both are logged in full against a correlation id.
    return failureResponse(error, 'email-copilot', corsHeaders);
  }
});

/**
 * What the provider actually said, for a caller that can only show a sentence.
 *
 * Audit item 43 — every handler here reduced a failed model call to
 * `LLM call failed`, which the outer catch turned into "internal error". The
 * router already carries the status and the per-attempt detail; discarding it
 * meant an expired credential, an exhausted balance and a rate limit were
 * indistinguishable on screen and left nothing in the log either.
 *
 * Bounded, because this reaches a toast.
 */
async function describeLlmFailure(r: { status: number; text: () => Promise<string> }): Promise<OperatorFacingError> {
  let detail = '';
  try { detail = (await r.text()).slice(0, 300); } catch { /* body already consumed */ }
  const hint = r.status === 401 || r.status === 403
    ? 'the AI provider rejected this deployment\'s credential'
    : r.status === 402
      ? 'the AI provider account has no remaining balance'
      : r.status === 429
        ? 'the AI provider is rate limiting this deployment — try again shortly'
        : 'the AI provider did not answer';
  // The provider's own body can name a model, an organisation or an internal
  // host, so it is logged rather than shown. The sentence is authored here.
  if (detail) console.error('[email-copilot] provider response body:', detail);
  return new OperatorFacingError(`AI request failed (${r.status}) — ${hint}.`, {
    status: 502,
    code: 'ai_provider_failed',
  });
}

async function handleSummarize(email: EmailData, emailId: string | null, supabase: any, corsHeaders: Record<string, string>): Promise<Response> {
  console.log('[Email Copilot] Generating summary...');
  
  const _brand = await getBrandConfig();
  const systemPrompt = `You are an email analysis assistant for ${_brand.companyName}, a property investment advisory company. 
Your task is to analyze incoming emails and provide a structured summary.

IMPORTANT: 
- Be concise and professional
- Focus on actionable information
- Identify any deadlines, requests, or required responses
- Assess urgency based on content (financial matters, legal deadlines = high; general inquiries = low)

Output format (JSON):
{
  "tldr": "One sentence summary",
  "keyPoints": ["Key point 1", "Key point 2", ...],
  "requiredActions": ["Action 1", "Action 2", ...],
  "urgencyLevel": "low" | "medium" | "high"
}`;

  const userPrompt = `Analyze this email and provide a structured summary:

From: ${email.sender}
Subject: ${email.subject}
Date: ${email.received_at || 'Not specified'}

Body:
${email.body}`;

  try {
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const response = await callLLMRaw({
      agentKey: 'email_copilot',
      // This function already writes its own api_usage_log row for this call;
      // letting the router log it too would bill the tenant twice.
      meterUsage: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 1000,
      responseFormat: { type: 'json_object' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      // "OpenAI API error" named the wrong party: the router chooses the
      // provider, and this deployment's `email_copilot` assignment can be any
      // of gateway, native or openrouter.
      console.error('[Email Copilot] model call failed:', response.status, errorText);
      throw await describeLlmFailure({ status: response.status, text: async () => errorText });
    }

    const data = await response.json();
    const summaryContent = data.choices[0].message.content;
    const summary: SummaryOutput = JSON.parse(summaryContent);

    // Log API usage
    const usage = extractOpenAIUsage(data);
    await logApiUsage(supabase, {
      service_name: 'openai',
      endpoint: '/v1/chat/completions',
      model_used: 'gpt-4o-mini',
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      tokens_used: usage.total_tokens,
      status: 'success',
      metadata: { function: 'email-copilot', action: 'summarize' },
    });

    console.log('[Email Copilot] Summary generated:', summary.urgencyLevel);

    // Update database if emailId provided
    if (emailId) {
      const { error: updateError } = await supabase
        .from('email_copilot_emails')
        .update({ 
          summary: summary,
          urgency_level: summary.urgencyLevel,
          status: 'summarized'
        })
        .eq('id', emailId);

      if (updateError) {
        console.error('[Email Copilot] DB update error:', updateError);
      }
    }

    return new Response(
      JSON.stringify({ success: true, summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Email Copilot] Summarize error:', error);
    throw error;
  }
}

async function handleDraftReply(
  email: EmailData, 
  emailId: string | null, 
  linkedPropertyAddress: string | null,
  supabase: any,
  replyContext?: string,
  corsHeaders: Record<string, string> = {}
): Promise<Response> {
  console.log('[Email Copilot] Generating draft reply...');

  const propertyContext = linkedPropertyAddress 
    ? `\n\nProperty Context: This email may relate to the property at ${linkedPropertyAddress}. Reference this if relevant.`
    : '';

  const userContextInstruction = replyContext 
    ? `\n\nUSER CONTEXT: The admin has provided the following guidance for the reply:\n"${replyContext}"\n\nIncorporate this context into your draft reply while maintaining professional tone.`
    : '';

  const _brandDr = await getBrandConfig();
  const systemPrompt = `You are an email drafting assistant for ${_brandDr.companyName}, a professional property investment advisory company.
Your task is to draft a professional, polite, and helpful reply to the given email.

IMPORTANT GUIDELINES:
- Match ${_brandDr.companyName}' professional, courteous tone
- Be clear, concise, and context-aware
- Do NOT make any financial commitments or guarantees
- Do NOT fabricate dates, prices, or specific details
- If information is missing, acknowledge it and offer to clarify
- Use proper email formatting with greeting and sign-off
- Sign off as "${_brandDr.companyName} Team"
${propertyContext}
${userContextInstruction}

This is a DRAFT only. The admin will review and edit before sending.`;

  const userPrompt = `Draft a professional reply to this email:

From: ${email.sender}
Subject: ${email.subject}
Date: ${email.received_at || 'Not specified'}

Body:
${email.body}
${replyContext ? `\n---\nAdmin guidance for reply: ${replyContext}` : ''}

---
Please draft a suitable reply that addresses the sender's concerns or questions.`;

  try {
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const response = await callLLMRaw({
      agentKey: 'email_copilot',
      // This function already writes its own api_usage_log row for this call;
      // letting the router log it too would bill the tenant twice.
      meterUsage: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.5,
      maxTokens: 1500,
    });

    if (!response.ok) {
      const errorText = await response.text();
      // "OpenAI API error" named the wrong party: the router chooses the
      // provider, and this deployment's `email_copilot` assignment can be any
      // of gateway, native or openrouter.
      console.error('[Email Copilot] model call failed:', response.status, errorText);
      throw await describeLlmFailure({ status: response.status, text: async () => errorText });
    }

    const data = await response.json();
    const draftReply = data.choices[0].message.content;

    // Log API usage
    const draftUsage = extractOpenAIUsage(data);
    await logApiUsage(supabase, {
      service_name: 'openai',
      endpoint: '/v1/chat/completions',
      model_used: 'gpt-4o-mini',
      prompt_tokens: draftUsage.prompt_tokens,
      completion_tokens: draftUsage.completion_tokens,
      tokens_used: draftUsage.total_tokens,
      status: 'success',
      metadata: { function: 'email-copilot', action: 'draft_reply' },
    });

    console.log('[Email Copilot] Draft reply generated');

    // Update database if emailId provided
    if (emailId) {
      const { error: updateError } = await supabase
        .from('email_copilot_emails')
        .update({ 
          draft_reply: draftReply,
          status: 'drafted'
        })
        .eq('id', emailId);

      if (updateError) {
        console.error('[Email Copilot] DB update error:', updateError);
      }
    }

    return new Response(
      JSON.stringify({ success: true, draftReply }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Email Copilot] Draft reply error:', error);
    throw error;
  }
}

async function handleSaveEmail(email: EmailData, supabase: any, corsHeaders: Record<string, string> = {}): Promise<Response> {
  console.log('[Email Copilot] Saving email...');

  const { data, error } = await supabase
    .from('email_copilot_emails')
    .insert({
      sender: email.sender,
      subject: email.subject,
      body: email.body,
      received_at: email.received_at || new Date().toISOString(),
      status: 'unread'
    })
    .select()
    .single();

  if (error) {
    console.error('[Email Copilot] Save error:', error);
    throw new Error(`Failed to save email: ${error.message}`);
  }

  console.log('[Email Copilot] Email saved with ID:', data.id);

  return new Response(
    JSON.stringify({ success: true, email: data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleAssignClient(
  emailId: string, 
  clientId: string | null, 
  supabase: any,
  corsHeaders: Record<string, string>
): Promise<Response> {
  console.log(`[Email Copilot] Assigning email ${emailId} to client ${clientId || 'null'}`);

  if (!emailId) {
    throw new Error('emailId is required');
  }

  // Update the email with the client_id
  const { data, error } = await supabase
    .from('email_copilot_emails')
    .update({ client_id: clientId })
    .eq('id', emailId)
    .select()
    .single();

  if (error) {
    console.error('[Email Copilot] Assign client error:', error);
    throw new Error(`Failed to assign client: ${error.message}`);
  }

  console.log('[Email Copilot] Email assigned to client:', clientId || 'unassigned');

  return new Response(
    JSON.stringify({ success: true, email: data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// =====================================================================
// V2 — Tone/Length/Intent/Language/Variants/Thread Context
// =====================================================================

const TONE_GUIDE: Record<string, string> = {
  formal: 'Formal and professional. Use full sentences, no contractions, polished business English.',
  friendly: 'Warm and friendly while still professional. Conversational, approachable, contractions OK.',
  direct: 'Direct and concise. Short sentences. No filler. Get to the point.',
  empathetic: 'Empathetic and warm. Acknowledge feelings, soften any bad news, reassure the reader.',
  enthusiastic: 'Upbeat and enthusiastic. Positive language, momentum, but not over-the-top.',
};

const LENGTH_GUIDE: Record<string, string> = {
  short: 'Keep it under 60 words. 2–3 short sentences. One paragraph.',
  medium: 'Around 80–140 words. 1–2 short paragraphs.',
  long: 'Around 180–260 words. 2–3 paragraphs with clear structure.',
};

const INTENT_GUIDE: Record<string, string> = {
  acknowledge: 'Acknowledge receipt of their message and confirm you are looking into it.',
  answer: 'Answer the question(s) raised in their email clearly and accurately based on context provided.',
  decline: 'Politely decline the request, explain briefly, and offer an alternative if appropriate.',
  schedule: 'Propose scheduling a call or meeting. Suggest the user fill in concrete time options.',
  request_info: 'Request the additional information needed before you can proceed.',
  send_document: 'Confirm a document will be / is attached and explain briefly what it covers.',
  follow_up: 'Follow up on the previous thread, gently nudge for a response or next step.',
  thank: 'Thank the sender warmly and confirm next steps if any.',
};

function buildThreadContext(threadEmails: any[] | undefined, currentBody: string): string {
  if (!threadEmails || !Array.isArray(threadEmails) || threadEmails.length === 0) return '';
  const recent = threadEmails.slice(0, 4).reverse(); // chronological, oldest of last 4 first
  const lines = recent.map((e: any, i: number) => {
    const body = (e.body || '').slice(0, 600);
    return `--- Message ${i + 1} ---\nFrom: ${e.sender}\nDate: ${e.received_at || ''}\nSubject: ${e.subject}\n\n${body}`;
  });
  return `\n\nPRIOR THREAD CONTEXT (oldest first):\n${lines.join('\n\n')}`;
}

async function handleDraftReplyV2(args: any, supabase: any, corsHeaders: Record<string, string>): Promise<Response> {
  const { email, emailId, linkedPropertyAddress, replyContext, tone, length, intent, language, threadEmails, variants } = args;
  console.log(`[Email Copilot V2] Draft reply: tone=${tone}, length=${length}, intent=${intent}, lang=${language}, variants=${variants}`);

  const _brand = await getBrandConfig();
  const propertyContext = linkedPropertyAddress
    ? `\n\nProperty Context: This email may relate to ${linkedPropertyAddress}. Reference it only if clearly relevant.`
    : '';

  const toneInstr = TONE_GUIDE[tone] || TONE_GUIDE.friendly;
  const lengthInstr = LENGTH_GUIDE[length] || LENGTH_GUIDE.medium;
  const intentInstr = intent ? `\n\nPRIMARY INTENT: ${INTENT_GUIDE[intent] || intent}` : '';
  const langInstr = language && language !== 'en'
    ? `\n\nLANGUAGE: Write the reply in ${language}. Keep proper nouns in their original form.`
    : '';
  const userCtx = replyContext
    ? `\n\nUSER GUIDANCE: "${replyContext}"\nIncorporate this faithfully.`
    : '';
  const threadCtx = buildThreadContext(threadEmails, email?.body || '');

  const systemPrompt = `You are an elite email drafting assistant for ${_brand.companyName}, a property investment advisory firm.

VOICE & TONE: ${toneInstr}
LENGTH: ${lengthInstr}${intentInstr}${langInstr}

NON-NEGOTIABLES:
- Never invent prices, dates, rates, or specifics. If unknown, say you'll confirm.
- Never make financial commitments or guarantees.
- Use proper email formatting: greeting on its own line, body, sign-off.
- Sign off as "${_brand.companyName} Team" unless guidance says otherwise.
- Output ONLY the reply body. No preamble, no "Here is your draft", no markdown code fences.${propertyContext}${userCtx}${threadCtx}`;

  const userPrompt = `Draft a reply to this email:

From: ${email.sender}
Subject: ${email.subject}
Date: ${email.received_at || 'N/A'}

Body:
${email.body}`;

  try {
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');

    // Generate N variants in parallel
    const n = Math.max(1, Math.min(3, Number(variants) || 1));
    const calls = Array.from({ length: n }, (_, i) =>
      callLLMRaw({
        agentKey: 'email_copilot',
        // This function already writes its own api_usage_log row for this call;
        // letting the router log it too would bill the tenant twice.
        meterUsage: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt + (n > 1 ? `\n\n(Variant ${i + 1} of ${n} — make this distinct from the others.)` : '') },
        ],
        temperature: n > 1 ? 0.6 + i * 0.15 : 0.5,
        maxTokens: length === 'long' ? 1200 : length === 'short' ? 400 : 800,
      })
    );

    const responses = await Promise.all(calls);
    const drafts: string[] = [];
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    for (const r of responses) {
      if (!r.ok) continue;
      const data = await r.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content) drafts.push(content);
      const u = extractOpenAIUsage(data);
      totalUsage.prompt_tokens += u.prompt_tokens || 0;
      totalUsage.completion_tokens += u.completion_tokens || 0;
      totalUsage.total_tokens += u.total_tokens || 0;
    }

    if (drafts.length === 0) throw new Error('No drafts generated');

    await logApiUsage(supabase, {
      service_name: 'openai',
      endpoint: '/v1/chat/completions',
      model_used: 'gpt-4o-mini',
      prompt_tokens: totalUsage.prompt_tokens,
      completion_tokens: totalUsage.completion_tokens,
      tokens_used: totalUsage.total_tokens,
      status: 'success',
      metadata: { function: 'email-copilot', action: 'draft_reply_v2', tone, length, intent, variants: drafts.length },
    });

    // Save first draft as canonical draft_reply
    if (emailId && drafts[0]) {
      await supabase.from('email_copilot_emails')
        .update({ draft_reply: drafts[0], status: 'drafted' })
        .eq('id', emailId);
    }

    return new Response(
      JSON.stringify({ success: true, drafts, draftReply: drafts[0] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Email Copilot V2] Error:', error);
    throw error;
  }
}

async function handleImproveText(args: any, supabase: any, corsHeaders: Record<string, string>): Promise<Response> {
  const { text, instruction, tone, language } = args;
  if (!text || !instruction) throw new Error('text and instruction are required');

  const _brand = await getBrandConfig();
  const toneInstr = tone ? `\nMaintain a ${tone} tone.` : '';
  const langInstr = language && language !== 'en' ? `\nKeep the language as ${language}.` : '';

  const systemPrompt = `You are an expert editor for ${_brand.companyName}'s outbound emails.
Apply the requested change to the provided text. Preserve the original meaning, names, and any factual claims.
Output ONLY the rewritten text. No preamble, no quotes, no markdown fences.${toneInstr}${langInstr}`;

  const userPrompt = `INSTRUCTION: ${instruction}\n\nORIGINAL TEXT:\n${text}\n\nReturn the rewritten text only.`;

  try {
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const r = await callLLMRaw({
      agentKey: 'email_copilot',
      // This function already writes its own api_usage_log row for this call;
      // letting the router log it too would bill the tenant twice.
      meterUsage: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      maxTokens: 1200,
    });
    if (!r.ok) throw await describeLlmFailure(r);
    const data = await r.json();
    const improved = (data.choices?.[0]?.message?.content || '').trim();

    const u = extractOpenAIUsage(data);
    await logApiUsage(supabase, {
      service_name: 'openai', endpoint: '/v1/chat/completions', model_used: 'gpt-4o-mini',
      prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, tokens_used: u.total_tokens,
      status: 'success', metadata: { function: 'email-copilot', action: 'improve_text', instruction },
    });

    return new Response(
      JSON.stringify({ success: true, improved }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('[Improve text] error:', e);
    throw e;
  }
}

async function handleQuickReplies(args: any, supabase: any, corsHeaders: Record<string, string>): Promise<Response> {
  const { email, threadEmails } = args;
  if (!email?.body) throw new Error('email is required');

  const _brand = await getBrandConfig();
  const threadCtx = buildThreadContext(threadEmails, email.body);

  const systemPrompt = `You generate 3 ultra-short reply suggestions for an email at ${_brand.companyName}.
Each suggestion is 3–6 words, action-oriented, distinct from the others.
Examples: "Will review and revert", "Schedule a call?", "Thanks, noted".
Return JSON: { "suggestions": ["...", "...", "..."] }${threadCtx}`;

  const userPrompt = `Email:\nFrom: ${email.sender}\nSubject: ${email.subject}\n\n${email.body.slice(0, 1500)}\n\nReturn 3 quick reply suggestions as JSON.`;

  try {
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const r = await callLLMRaw({
      agentKey: 'email_copilot',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.6,
      maxTokens: 200,
      responseFormat: { type: 'json_object' },
    });
    if (!r.ok) throw await describeLlmFailure(r);
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }
    const suggestions: string[] = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [];

    return new Response(
      JSON.stringify({ success: true, suggestions }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('[Quick replies] error:', e);
    return new Response(
      JSON.stringify({ success: false, suggestions: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

// =====================================================================
// Tier 4 — Polish: Analyze, Translate, Thread Summary
// =====================================================================

async function handleAnalyze(args: any, supabase: any, corsHeaders: Record<string, string>): Promise<Response> {
  const { email, emailId } = args;
  if (!email?.body) throw new Error('email is required');
  const _brand = await getBrandConfig();

  const systemPrompt = `You analyze inbound emails for ${_brand.companyName}, a property investment advisory.
Return ONLY JSON matching:
{
  "sentiment": "positive" | "neutral" | "negative" | "angry",
  "category": "inquiry" | "complaint" | "opportunity" | "admin" | "fyi" | "scheduling" | "document_request" | "other",
  "language": "English" | "Spanish" | "French" | ... (full English name of detected language),
  "urgencyLevel": "low" | "medium" | "high"
}
Rules:
- "angry" only if the sender expresses clear hostility, frustration, or escalation language.
- "complaint" if they express dissatisfaction; "inquiry" for questions; "opportunity" for new leads/business; "admin" for invoices/forms; "scheduling" for meeting requests; "document_request" if they ask for a document; "fyi" for informational only.
- urgencyLevel "high" if there's a deadline within 48h, financial/legal stakes, or escalation; "medium" if a response is expected this week; "low" otherwise.`;

  const userPrompt = `Analyze:\nFrom: ${email.sender}\nSubject: ${email.subject}\n\n${(email.body || '').slice(0, 4000)}`;

  try {
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const r = await callLLMRaw({
      agentKey: 'email_copilot',
      // This function already writes its own api_usage_log row for this call;
      // letting the router log it too would bill the tenant twice.
      meterUsage: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      maxTokens: 200,
      responseFormat: { type: 'json_object' },
    });
    if (!r.ok) throw await describeLlmFailure(r);
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }

    const intelligence = {
      sentiment: parsed.sentiment || 'neutral',
      category: parsed.category || 'other',
      language: parsed.language || 'English',
      urgencyLevel: parsed.urgencyLevel || 'low',
    };

    // Persist by merging into the existing summary jsonb so we don't need a new column
    if (emailId) {
      const { data: existing } = await supabase
        .from('email_copilot_emails')
        .select('summary')
        .eq('id', emailId)
        .maybeSingle();
      const merged = { ...(existing?.summary || {}), ...intelligence };
      await supabase
        .from('email_copilot_emails')
        .update({ summary: merged, urgency_level: intelligence.urgencyLevel })
        .eq('id', emailId);
    }

    const u = extractOpenAIUsage(data);
    await logApiUsage(supabase, {
      service_name: 'openai', endpoint: '/v1/chat/completions', model_used: 'gpt-4o-mini',
      prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, tokens_used: u.total_tokens,
      status: 'success', metadata: { function: 'email-copilot', action: 'analyze' },
    });

    return new Response(
      JSON.stringify({ success: true, intelligence }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('[Analyze] error:', e);
    throw e;
  }
}

async function handleTranslate(args: any, supabase: any, corsHeaders: Record<string, string>): Promise<Response> {
  const { text, language } = args;
  if (!text) throw new Error('text is required');
  const targetLang = language || 'en';

  const systemPrompt = `You are a precise translator. Translate the user's text into the target language code "${targetLang}".
- Preserve names, numbers, dates, URLs, and email addresses exactly.
- Preserve paragraph structure and line breaks.
- If the text is already in the target language, return it unchanged.
- Output ONLY the translated text. No preamble, no quotes, no explanations.`;

  try {
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const r = await callLLMRaw({
      agentKey: 'email_copilot',
      // This function already writes its own api_usage_log row for this call;
      // letting the router log it too would bill the tenant twice.
      meterUsage: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text.slice(0, 8000) },
      ],
      temperature: 0.2,
      maxTokens: 2000,
    });
    if (!r.ok) throw await describeLlmFailure(r);
    const data = await r.json();
    const translated = (data.choices?.[0]?.message?.content || '').trim();

    const u = extractOpenAIUsage(data);
    await logApiUsage(supabase, {
      service_name: 'openai', endpoint: '/v1/chat/completions', model_used: 'gpt-4o-mini',
      prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, tokens_used: u.total_tokens,
      status: 'success', metadata: { function: 'email-copilot', action: 'translate', target: targetLang },
    });

    return new Response(
      JSON.stringify({ success: true, translated, language: targetLang }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('[Translate] error:', e);
    throw e;
  }
}

async function handleThreadSummary(args: any, supabase: any, corsHeaders: Record<string, string>): Promise<Response> {
  const { email, threadEmails } = args;
  if (!email?.body) throw new Error('email is required');
  const _brand = await getBrandConfig();

  const allMessages = [
    ...(Array.isArray(threadEmails) ? threadEmails : []),
    { sender: email.sender, subject: email.subject, body: email.body, received_at: email.received_at },
  ];
  // chronological
  allMessages.sort((a: any, b: any) => new Date(a.received_at || 0).getTime() - new Date(b.received_at || 0).getTime());

  const transcript = allMessages.map((m: any, i: number) => {
    return `--- Message ${i + 1} ---\nFrom: ${m.sender}\nDate: ${m.received_at || ''}\nSubject: ${m.subject}\n\n${(m.body || '').slice(0, 1200)}`;
  }).join('\n\n');

  const systemPrompt = `You summarize email threads for ${_brand.companyName}.
Return ONLY JSON:
{
  "tldr": "1-2 sentence summary of the whole thread",
  "decisions": ["decisions explicitly agreed in the thread"],
  "openQuestions": ["questions raised but not yet answered"],
  "actionItems": [{ "owner": "name or role (e.g. Us / Client / John)", "task": "short description" }],
  "nextStep": "single sentence: what should happen next"
}
Be specific. If a section has nothing, return an empty array (or empty string for tldr/nextStep).`;

  const userPrompt = `Thread (${allMessages.length} messages, oldest first):\n\n${transcript}`;

  try {
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const r = await callLLMRaw({
      agentKey: 'email_copilot',
      // This function already writes its own api_usage_log row for this call;
      // letting the router log it too would bill the tenant twice.
      meterUsage: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 800,
      responseFormat: { type: 'json_object' },
    });
    if (!r.ok) throw await describeLlmFailure(r);
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }

    const summary = {
      tldr: parsed.tldr || '',
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      nextStep: parsed.nextStep || '',
    };

    const u = extractOpenAIUsage(data);
    await logApiUsage(supabase, {
      service_name: 'openai', endpoint: '/v1/chat/completions', model_used: 'gpt-4o-mini',
      prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, tokens_used: u.total_tokens,
      status: 'success', metadata: { function: 'email-copilot', action: 'thread_summary', messages: allMessages.length },
    });

    return new Response(
      JSON.stringify({ success: true, summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('[Thread summary] error:', e);
    throw e;
  }
}
