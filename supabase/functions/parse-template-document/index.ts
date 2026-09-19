import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  assessTextQuality,
  chunkDocumentText,
  dehyphenateWrappedLines,
  normalizeDocumentText,
} from '../_shared/documentText.pure.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

// OPTIMIZED: Increased chunk size to reduce total chunks
const CHUNK_SIZE = 3000; // Characters per chunk
const CHUNK_OVERLAP = 300; // Overlap between chunks

// Parallel processing configuration
const EMBEDDING_BATCH_SIZE = 20; // Process 20 embeddings at once
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_LENGTH = 600_000;
const MAX_CHUNKS = 250;

interface TemplateParseRequest {
  templateId: string;
  filePath: string;
  templateType: 'ai_structure' | 'pdf_layout' | 'client_branding';
  reportTier?: 'compass' | 'executive' | 'snapshot';
  reportCategory?: 'investment' | 'comparison' | 'suburb_snapshot';
  useAIExtraction?: boolean; // Flag to use AI-powered extraction
}

/**
 * Branding and page furniture removed before embedding.
 *
 * Every pattern here is deliberately BOUNDED. The previous set used greedy
 * `[A-Za-z\s]+` tails on `Prepared by`, `Author:` and `©` — and because `\s`
 * matches newlines, a single `Prepared by: …` line silently ate every following
 * paragraph until the next digit or punctuation mark. Whole sections of a
 * template were vanishing from the embeddings without any error. `\S*[^\S\n]*`
 * style tails and per-line anchors keep each filter to the line it belongs to.
 */
const CONTENT_FILTERS: RegExp[] = [
  // Company names.
  /\bNPC(?:\s+(?:Services?|Property|Consulting|Group))?\b/gi,
  /\bNational\s+Property\s+Collective\b/gi,
  /\bnpcservices\.com\.au\b/gi,

  // Generic company identifiers.
  /\b(?:ABN|ACN)\s*:?\s*\d[\d ]{6,14}\d\b/gi,
  /©\s*\d{4}[^\n]{0,60}/g,
  /\bAll\s+rights?\s+reserved\.?/gi,

  // Contact details that should not influence retrieval.
  /\b(?:\+?61\s?)?(?:\(0\d\)|0\d)[\s-]?\d{4}[\s-]?\d{4}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\bwww\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,

  // Page furniture.
  /\bPage\s+\d+(?:\s+of\s+\d+)?\b/gi,
  /^[ \t]*\d{1,4}[ \t]*$/gm,

  // Watermarks. Anchored with word boundaries so `drafting` and
  // `confidentiality` survive — the unbounded versions turned them into
  // `ing` and `iality`.
  /\bCONFIDENTIAL\b/gi,
  /\bDRAFT\b/g,
  /\bFor\s+internal\s+use\s+only\b/gi,

  // Attribution lines — bounded to the rest of their own line.
  /\bPrepared\s+(?:by|for)\s*:?[^\n]{0,80}/gi,
  /^[ \t]*Author\s*:?[^\n]{0,80}$/gim,

  // Dates that only identify a particular issue of the template.
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
];

// Words/phrases to replace with generic placeholders
const CONTENT_REPLACEMENTS: [RegExp, string][] = [
  // Replace specific company references with generic terms
  [/\bNPC(\s+Services?)?\b/gi, '[Company]'],
  [/\bNational\s+Property\s+Collective\b/gi, '[Company]'],

  // Normalize property address placeholders
  [/\{\{property_address\}\}/gi, '[PROPERTY_ADDRESS]'],
  [/\{\{suburb\}\}/gi, '[SUBURB]'],
  [/\{\{postcode\}\}/gi, '[POSTCODE]'],
  [/\{\{state\}\}/gi, '[STATE]'],
];

/**
 * Strip branding and page furniture ahead of embedding.
 *
 * Guards against over-deletion: if the filters would remove more than
 * `MAX_SANITIZE_LOSS_RATIO` of the document, the original text is kept and a
 * warning is logged. A runaway pattern degrading retrieval is bad; one silently
 * deleting most of a template is worse.
 */
const MAX_SANITIZE_LOSS_RATIO = 0.4;

function sanitizeForEmbedding(text: string): string {
  let sanitized = text;

  // Replacements first so the placeholders survive the deletion pass.
  for (const [pattern, replacement] of CONTENT_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  for (const filter of CONTENT_FILTERS) {
    sanitized = sanitized.replace(filter, '');
  }

  // Tidy up, preserving paragraph structure for the chunker.
  sanitized = sanitized
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const originalMeaningful = text.replace(/\s+/g, '').length;
  const sanitizedMeaningful = sanitized.replace(/\s+/g, '').length;
  if (
    originalMeaningful > 0 &&
    sanitizedMeaningful / originalMeaningful < 1 - MAX_SANITIZE_LOSS_RATIO
  ) {
    console.warn(
      `⚠️ Sanitisation would remove ${Math.round((1 - sanitizedMeaningful / originalMeaningful) * 100)}% of the template; keeping the unsanitised text instead.`,
    );
    return normalizeDocumentText(text);
  }

  return sanitized;
}

/**
 * Sanitize, then split into structure-aware overlapping chunks.
 *
 * The previous fixed character window cut sentences, tables and headings in
 * half and orphaned every continuation chunk from the section it belonged to,
 * which is the dominant cause of poor template retrieval. `chunkDocumentText`
 * splits on headings and paragraphs, falls back to sentence then word
 * boundaries, and repeats the governing heading on continuation chunks.
 */
function chunkText(text: string, chunkSize: number = CHUNK_SIZE, overlap: number = CHUNK_OVERLAP): string[] {
  return chunkDocumentText(sanitizeForEmbedding(text), {
    maxChars: chunkSize,
    overlapChars: overlap,
    minChars: Math.min(200, Math.floor(chunkSize / 6)),
  });
}

/** Retries a transient embedding failure so one 429 does not silently cost 20 chunks. */
const EMBEDDING_MAX_ATTEMPTS = 3;

// OPTIMIZED: Generate embeddings for multiple texts in a single API call
async function generateEmbeddingsBatch(texts: string[], openAIKey: string): Promise<number[][]> {
  let response: Response | null = null;

  for (let attempt = 1; attempt <= EMBEDDING_MAX_ATTEMPTS; attempt += 1) {
    response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: texts,
      }),
    });

    if (response.ok) break;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === EMBEDDING_MAX_ATTEMPTS) break;

    const backoffMs = 500 * 2 ** (attempt - 1);
    console.warn(`⏳ Embedding batch got ${response.status}; retrying in ${backoffMs}ms (attempt ${attempt + 1}/${EMBEDDING_MAX_ATTEMPTS})`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  if (!response || !response.ok) {
    const error = response ? await response.text() : 'no response';
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
    metadata: { function: 'parse-template-document', batchSize: texts.length },
  });

  return data.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((item: any) => item.embedding);
}

/**
 * Convert a PDF to base64 for AI processing.
 *
 * Chunked rather than character-by-character: the old loop performed one string
 * concatenation per byte, which on a 10 MB template meant ten million
 * reallocations and routinely pushed the function past its wall clock before it
 * had made a single API call.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // 32 KB — below the argument-count limit of `apply`.
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

// NEW: Use Lovable AI with vision to extract text from PDF as Markdown
async function extractTextFromPDFWithAI(pdfBuffer: ArrayBuffer, lovableApiKey: string): Promise<string> {
  console.log('🤖 Using AI vision to extract PDF content as Markdown...');
  
  const base64PDF = arrayBufferToBase64(pdfBuffer);
  
  const { callLLMRaw } = await import('../_shared/llmRouter.ts');
  const response = await callLLMRaw({
    agentKey: 'template_parsing',
    messages: [
      {
        role: 'system',
        content: `You are a document structure extractor. Your job is to extract ALL text content from the provided document and convert it into well-structured Markdown format.

CRITICAL REQUIREMENTS:
1. Extract EVERY section heading, subheading, and paragraph
2. Preserve the exact hierarchical structure using # for headings
3. Keep all bullet points, numbered lists, and tables
4. Include ALL data sources, citations, and attribution requirements mentioned
5. Preserve any formatting instructions or guidelines
6. Extract any template placeholders (like {{property_address}})
7. DO NOT summarize - include the FULL content
8. If content spans multiple pages, extract everything

OUTPUT FORMAT:
- Use proper Markdown syntax
- # for main sections, ## for subsections, ### for sub-subsections
- Use bullet points (-) for lists
- Use tables where appropriate
- Preserve any special formatting notes`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract the COMPLETE text content from this PDF document and convert it to well-structured Markdown. Include every section, heading, bullet point, and instruction. This is a report template - preserve all structure and formatting guidelines.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:application/pdf;base64,${base64PDF}` },
          },
        ] as any,
      },
    ],
    maxTokens: 32000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('AI extraction error:', errorText);
    
    // Check for rate limits
    if (response.status === 429) {
      throw new Error('AI rate limit exceeded. Please try again in a few minutes.');
    }
    if (response.status === 402) {
      throw new Error('AI credits exhausted. Please add credits to continue.');
    }
    
    throw new Error(`AI extraction failed: ${response.status}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';

  if (!raw || raw.length < 100) {
    throw new Error('AI extraction returned insufficient content. The PDF may be image-only or corrupted.');
  }

  // Normalise before anything downstream sees it: ligatures and soft hyphens
  // from the source PDF otherwise survive into the stored template and every
  // embedding built from it, so `identiﬁed` never matches a query for
  // `identified`.
  const extractedText = dehyphenateWrappedLines(normalizeDocumentText(raw));

  const quality = assessTextQuality(extractedText);
  if (quality.likelyGarbled) {
    throw new Error(
      'AI extraction produced unreadable text (the PDF is likely scanned or has a broken font encoding). ' +
        'Upload a text-based PDF, or a .md/.txt version of the template.',
    );
  }

  // The model was capped at 32k output tokens; a response that stops mid-word
  // means the template was longer than one pass. Flag it rather than storing a
  // silently half-extracted template.
  if (!/[.!?:)\]"'`\s]$/.test(extractedText)) {
    console.warn('⚠️ AI extraction ended mid-sentence — the template may exceed the single-pass output limit.');
  }

  console.log(`✓ AI extracted ${extractedText.length} characters of Markdown`);
  return extractedText;
}

/** Decode the HTML entities a template is likely to contain. */
function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'",
    mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
    rdquo: '”', ldquo: '“', trade: '™', copy: '©', reg: '®', deg: '°',
  };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    // `&amp;` is decoded LAST so `&amp;lt;` yields `&lt;` and not `<`.
    .replace(/&([a-z0-9#]+);/gi, (match, name) => named[String(name).toLowerCase()] ?? match)
    .replace(/&amp;/g, '&');
}

// Fallback: Basic text extraction for non-PDF files
async function extractTextBasic(content: string, fileName: string): Promise<string> {
  if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
    return normalizeDocumentText(content);
  }
  if (fileName.endsWith('.json')) {
    return JSON.stringify(JSON.parse(content), null, 2);
  }
  if (fileName.endsWith('.html') || fileName.endsWith('.htm')) {
    const structured = content
      // Script/style bodies are code, not template content, and previously
      // survived tag-stripping as a wall of JavaScript in the embeddings.
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<h([1-6])[^>]*>/gi, (_m, level) => `\n${'#'.repeat(Number(level))} `)
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/li>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|section|article|tr|table|ul|ol|blockquote)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]*>/g, '');
    return normalizeDocumentText(decodeHtmlEntities(structured));
  }
  return normalizeDocumentText(content);
}

// Process chunks in parallel batches with embeddings
async function processChunksInBatches(
  chunks: string[],
  templateId: string,
  templateType: string,
  reportTier: string | undefined,
  reportCategory: string | undefined,
  openAIKey: string,
  supabase: any
): Promise<any[]> {
  const storedChunks: any[] = [];
  const totalBatches = Math.ceil(chunks.length / EMBEDDING_BATCH_SIZE);
  
  console.log(`📦 Processing ${chunks.length} chunks in ${totalBatches} batches of ${EMBEDDING_BATCH_SIZE}`);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIdx = batchIndex * EMBEDDING_BATCH_SIZE;
    const endIdx = Math.min(startIdx + EMBEDDING_BATCH_SIZE, chunks.length);
    const batchChunks = chunks.slice(startIdx, endIdx);
    
    console.log(`🧠 Batch ${batchIndex + 1}/${totalBatches}: Generating embeddings for chunks ${startIdx + 1}-${endIdx}`);
    
    try {
      const embeddings = await generateEmbeddingsBatch(batchChunks, openAIKey);
      
      const insertRecords = batchChunks.map((chunk, i) => ({
        document_name: `template:${templateId}`,
        chunk_index: startIdx + i,
        chunk_text: chunk,
        embedding: `[${embeddings[i].join(',')}]`,
        metadata: {
          template_type: templateType,
          report_tier: reportTier,
          report_category: reportCategory,
          total_chunks: chunks.length,
        },
      }));
      
      const { data: insertedChunks, error: insertError } = await supabase
        .from('document_chunks')
        .insert(insertRecords)
        .select();
      
      if (insertError) {
        console.error(`❌ Failed to store batch ${batchIndex + 1}:`, insertError);
      } else {
        storedChunks.push(...(insertedChunks || []));
        console.log(`✓ Batch ${batchIndex + 1} complete: ${insertedChunks?.length || 0} chunks stored`);
      }
    } catch (batchError) {
      console.error(`❌ Embedding batch ${batchIndex + 1} error:`, batchError);
    }
  }
  
  return storedChunks;
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
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const body = await req.json();
    const { 
      templateId, 
      filePath, 
      templateType, 
      reportTier, 
      reportCategory,
      useAIExtraction = true // Default to AI extraction for better results
    }: TemplateParseRequest = body;
    
    // SECURITY: Verify authentication
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[parse-template-document] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[parse-template-document] Authenticated user: ${userId}`);
    
    console.log(`📄 Parsing template: ${templateId}, file: ${filePath}, AI extraction: ${useAIExtraction}`);
    
    // Download the file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('report-templates')
      .download(filePath);
    
    if (downloadError) {
      throw new Error(`Failed to download template: ${downloadError.message}`);
    }

    if (!fileData || fileData.size > MAX_FILE_SIZE_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Template file exceeds the 10 MB processing limit' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    
    let extractedText = '';
    const fileName = filePath.toLowerCase();
    
    if (fileName.endsWith('.pdf')) {
      if (useAIExtraction && lovableApiKey) {
        // Use AI vision to extract PDF content as structured Markdown
        const buffer = await fileData.arrayBuffer();
        extractedText = await extractTextFromPDFWithAI(buffer, lovableApiKey);
      } else {
        throw new Error('PDF extraction requires AI. Please enable AI extraction or upload a text-based file (.md, .txt).');
      }
    } else {
      // For non-PDF files, use basic extraction
      const textContent = await fileData.text();
      extractedText = await extractTextBasic(textContent, fileName);
    }
    
     // For text-based files (.md/.txt), templates can be concise (e.g. outline-only).
     // Use a smaller minimum and measure non-whitespace characters to avoid false failures.
     const trimmedExtracted = (extractedText || '').trim();
     extractedText = trimmedExtracted;

     if (extractedText.length > MAX_EXTRACTED_TEXT_LENGTH) {
       return new Response(
         JSON.stringify({ error: 'Extracted template text exceeds the processing limit' }),
         { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
       );
     }

     const isPdf = fileName.endsWith('.pdf');
     const meaningfulChars = trimmedExtracted.replace(/\s+/g, '').length;
     const minMeaningfulChars = isPdf ? 50 : 10;

     if (!trimmedExtracted || meaningfulChars < minMeaningfulChars) {
       throw new Error(
         `Insufficient text extracted from template (got ${meaningfulChars} meaningful chars). ` +
           `Please ensure the file contains readable content.`
       );
     }
    
    console.log(`📝 Extracted ${extractedText.length} characters`);
    console.log(`📄 Preview: ${extractedText.substring(0, 300)}...`);

    // Chunk BEFORE writing anything: rejecting an over-large template after the
    // `parsed_content` update left the row parsed but unembedded, so retrieval
    // silently used a template with no chunks behind it.
    const chunks = chunkText(extractedText);
    if (chunks.length > MAX_CHUNKS) {
      return new Response(
        JSON.stringify({
          error: 'Template produces too many chunks to process safely',
          chunksRequired: chunks.length,
          maxChunks: MAX_CHUNKS,
        }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (chunks.length === 0) {
      throw new Error('Template produced no embeddable content after sanitisation.');
    }

    // Update template with parsed Markdown content
    const { error: updateError } = await supabase
      .from('report_structure_templates')
      .update({
        parsed_content: extractedText,
        updated_at: new Date().toISOString(),
      })
      .eq('id', templateId);

    if (updateError) {
      console.error('Failed to update template:', updateError);
    }

    console.log(`🔪 Split into ${chunks.length} sanitized chunks for embedding (target chunk size: ${CHUNK_SIZE})`);
    console.log(`🧹 Content sanitized: company names, contact details, and irrelevant content filtered`);

    // Delete existing chunks for this template
    const { error: deleteError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_name', `template:${templateId}`);
    
    if (deleteError) {
      console.error('Failed to delete existing chunks:', deleteError);
    }
    
    // Process all chunks in parallel batches
    const storedChunks = await processChunksInBatches(
      chunks,
      templateId,
      templateType,
      reportTier,
      reportCategory,
      openAIKey,
      supabase
    );
    
    console.log(`✅ Successfully stored ${storedChunks.length}/${chunks.length} chunks with embeddings`);

    // Reporting success with zero stored chunks left the template retrievable
    // in name only — every RAG query against it returned nothing.
    if (storedChunks.length === 0) {
      throw new Error(
        'Template text was extracted but no chunks could be embedded. The embedding service may be unavailable — please retry.',
      );
    }

    const chunksFailed = chunks.length - storedChunks.length;
    return new Response(
      JSON.stringify({
        success: true,
        templateId,
        extractedLength: extractedText.length,
        chunksCreated: storedChunks.length,
        chunksExpected: chunks.length,
        chunksFailed,
        partial: chunksFailed > 0,
        preview: extractedText.substring(0, 1000) + (extractedText.length > 1000 ? '...' : ''),
        isMarkdown: true,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
    
  } catch (error) {
    console.error('❌ Template parsing error:', error);
    return new Response(
      JSON.stringify({
        ...internalError(error, 'parse-template-document'),
        success: false,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
