import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { internalError } from '../_shared/errorResponse.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface RetrievalRequest {
  query: string;
  reportTier?: 'compass' | 'executive' | 'snapshot';
  reportCategory?: 'investment' | 'comparison' | 'suburb_snapshot';
  templateType?: 'ai_structure' | 'pdf_layout' | 'client_branding';
  maxChunks?: number;
  similarityThreshold?: number;
}

const MAX_QUERY_LENGTH = 8_000;
const MAX_CHUNKS = 20;

// Generate query embedding
async function generateQueryEmbedding(query: string, openAIKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAIKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: query,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding error: ${error}`);
  }

  const data = await response.json();
  
  // Log embeddings API usage
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sbLog = createClient(supabaseUrl, supabaseKey);
  const embUsage = data.usage;
  await logApiUsage(sbLog, {
    service_name: 'openai',
    endpoint: '/v1/embeddings',
    model_used: 'text-embedding-3-small',
    prompt_tokens: embUsage?.prompt_tokens || 0,
    tokens_used: embUsage?.total_tokens || 0,
    status: 'success',
    metadata: { function: 'retrieve-template-context' },
  });

  return data.data[0].embedding;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openAIKey = Deno.env.get('OPENAI_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const body = await req.json();
    const {
      query,
      reportTier,
      reportCategory,
      templateType = 'ai_structure',
      maxChunks = 5,
      similarityThreshold = 0.7,
    }: RetrievalRequest = body;

    // SECURITY: Verify authentication
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[retrieve-template-context] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[retrieve-template-context] Authenticated user: ${userId}`);

    if (typeof query !== 'string' || query.trim().length === 0 || query.length > MAX_QUERY_LENGTH) {
      return new Response(
        JSON.stringify({ error: 'query must be a non-empty string of at most 8000 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > MAX_CHUNKS) {
      return new Response(
        JSON.stringify({ error: `maxChunks must be an integer between 1 and ${MAX_CHUNKS}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (typeof similarityThreshold !== 'number' || !Number.isFinite(similarityThreshold) || similarityThreshold < 0 || similarityThreshold > 1) {
      return new Response(
        JSON.stringify({ error: 'similarityThreshold must be a number between 0 and 1' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    
    console.log(`🔍 Retrieving context for query: "${query.substring(0, 100)}..."`);
    console.log(`   Filters: tier=${reportTier}, category=${reportCategory}, type=${templateType}`);
    
    // First, get active templates matching the criteria
    let templatesQuery = supabase
      .from('report_structure_templates')
      .select('id, name, template_type, report_tier, report_category')
      .eq('is_active', true)
      .eq('template_type', templateType);
    
    if (reportTier) {
      templatesQuery = templatesQuery.or(`report_tier.eq.${reportTier},report_tier.is.null`);
    }
    
    if (reportCategory) {
      templatesQuery = templatesQuery.or(`report_category.eq.${reportCategory},report_category.is.null`);
    }
    
    const { data: templates, error: templatesError } = await templatesQuery
      .order('priority', { ascending: false });
    
    if (templatesError) {
      throw new Error(`Failed to fetch templates: ${templatesError.message}`);
    }
    
    if (!templates || templates.length === 0) {
      console.log('⚠️ No active templates found matching criteria');
      return new Response(
        JSON.stringify({
          success: true,
          context: '',
          chunks: [],
          message: 'No active templates found matching criteria',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    console.log(`📋 Found ${templates.length} matching templates`);
    
    // Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(query, openAIKey);
    const embeddingString = `[${queryEmbedding.join(',')}]`;
    
    // Build template IDs for filtering
    const templateIds = templates.map(t => `template:${t.id}`);
    
    // Use the existing match_document_chunks function for similarity search
    const { data: matchedChunks, error: matchError } = await supabase
      .rpc('match_document_chunks', {
        query_embedding: embeddingString,
        match_threshold: similarityThreshold,
        match_count: maxChunks * 2, // Get more to filter
      });
    
    if (matchError) {
      console.error('Match error:', matchError);
      throw new Error(`Similarity search failed: ${matchError.message}`);
    }
    
    // Filter to only template chunks and limit
    const relevantChunks = (matchedChunks || [])
      .filter((chunk: any) => templateIds.includes(chunk.document_name))
      .slice(0, maxChunks);
    
    console.log(`✅ Retrieved ${relevantChunks.length} relevant chunks`);
    
    // Combine chunks into context string
    const contextParts: string[] = [];
    const chunkDetails: any[] = [];
    
    for (const chunk of relevantChunks) {
      const templateId = chunk.document_name.replace('template:', '');
      const template = templates.find(t => t.id === templateId);
      
      contextParts.push(`--- From template: ${template?.name || 'Unknown'} ---\n${chunk.chunk_text}`);
      chunkDetails.push({
        templateId,
        templateName: template?.name,
        chunkIndex: chunk.chunk_index,
        similarity: chunk.similarity,
        preview: chunk.chunk_text.substring(0, 200),
      });
    }
    
    const combinedContext = contextParts.join('\n\n');
    
    return new Response(
      JSON.stringify({
        success: true,
        context: combinedContext,
        chunks: chunkDetails,
        templatesUsed: templates.map(t => ({ id: t.id, name: t.name })),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
    
  } catch (error) {
    console.error('❌ Context retrieval error:', error);
    return new Response(
      JSON.stringify({
        ...internalError(error, 'retrieve-template-context'),
        success: false,
        context: '',
        chunks: [],
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
