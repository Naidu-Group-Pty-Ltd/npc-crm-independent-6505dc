import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { createUsageTrackingStream } from '../_shared/streamUsageLogger.ts';
import { getBrandConfig } from '../_shared/brand-config.ts';
import { internalError } from '../_shared/errorResponse.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

// System prompt for the User Guide Assistant — brand name is injected dynamically.
//
// The section-link list used to be hardcoded here: thirty `[[section:id|Title]]`
// examples maintained by hand. That was a third copy of the section list (after
// the guide page and the knowledge base) and it went stale the moment a section
// was added — the assistant could not link to anything it had not been told
// about, however well the knowledge base described it.
//
// The knowledge base now carries each section's ID inline, so the rules below
// describe the FORMAT and the payload supplies the ids. Adding a section to the
// guide makes it linkable here with no change to this file.
const buildSystemPrompt = (brandName: string) => `You are a helpful AI assistant for the ${brandName} Property Dashboard. Your role is to guide users through the platform's features and help them understand how to use the dashboard effectively.

IMPORTANT GUIDELINES:
1. Be concise and helpful - provide clear, actionable answers
2. When referencing a feature, link to its section using [[section:SECTION_ID|Section Title]]
3. Use the knowledge base context provided to answer questions accurately
4. If you're unsure about something, say so rather than guessing
5. Format your responses using Markdown for better readability
6. When listing steps, use numbered lists
7. When explaining features, use bullet points
8. Always be friendly and encouraging

SECTION LINKING:
- Every section in the knowledge base below declares its own "Section ID".
- Use exactly that id: [[section:the-declared-id|The Section Title]].
- NEVER invent a section id. If no section covers what you are describing, say so
  in prose instead of guessing at a link — a broken link sends the user nowhere.
- Include relevant section links whenever you discuss a feature.

PLAN & MODULE AWARENESS:
- The knowledge base opens with a MODULE CATALOGUE describing which modules this
  workspace's plan includes, which need an upgrade, and which are paid add-ons.
- ALWAYS check that catalogue before explaining how to use a feature.
- If a feature is NOT included on the current plan, say so plainly first, name the
  plan or add-on that provides it, and then offer to explain what it does.
  Do not walk someone through using something they cannot see in their sidebar.
- If the plan is unknown, ask which plan they are on rather than assuming access.
- Documentation existing for a feature does NOT mean this workspace has it.`;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json();
    const { messages, knowledgeBase } = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[user-guide-assistant] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[user-guide-assistant] Authenticated user: ${userId}`);
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing user guide assistant request with ${messages.length} messages`);

    // Build the full system prompt with knowledge base (brand-aware)
    const _brand = await getBrandConfig();
    const fullSystemPrompt = `${buildSystemPrompt(_brand.companyName)}

---

# KNOWLEDGE BASE (Use this to answer questions):

${knowledgeBase}`;

    const { streamLLM } = await import('../_shared/llmRouter.ts');
    const response = await streamLLM({
      agentKey: 'user_guide_assistant',
      messages: [
        { role: 'system', content: fullSystemPrompt },
        ...messages,
      ],
      extraBody: { stream_options: { include_usage: true } },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please contact support." }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to get AI response" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Intercept stream to capture token usage from the final SSE chunk
    const trackedStream = createUsageTrackingStream(response.body!, {
      supabase,
      serviceName: 'gemini',
      modelUsed: 'gemini-3-flash-preview',
      userId: userId || undefined,
      metadata: { function: 'user-guide-assistant', messageCount: messages.length },
    });

    // Return the tracked stream
    return new Response(trackedStream, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
    });

  } catch (error) {
    console.error("User guide assistant error:", error);
    return new Response(
      JSON.stringify(internalError(error, 'user-guide-assistant')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
