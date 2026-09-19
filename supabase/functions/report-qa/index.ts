import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import { verifyAuth, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getBrandConfig } from '../_shared/brand-config.ts';
import { logApiUsage, extractOpenAIUsage } from '../_shared/logApiUsage.ts';
import { createUsageTrackingStream } from '../_shared/streamUsageLogger.ts';
import { runAgentLoop, agentLoopHasTools, type AgentLoopProvider } from '../_shared/agent-loop.ts';
import { listTools } from '../_shared/agent-tools.ts';
import { resolveReportQaAccess, canRead, canWrite, canAdminister } from '../_shared/reportQaAccess.ts';
import { actorIsSuperadmin, requireModulePermission, type ModulePerm } from '../_shared/authz.ts';
import { consumeRateLimit, enforceBase64Limit, getTrustedClientIp } from '../_shared/requestSecurity.ts';

import { extractReportMetrics } from '../_shared/calculators.ts';
import { fitMessagesToBudget, inputBudgetForModel } from '../_shared/contextBudget.ts';
// Side-effect import: registers calculator + live-data tools into the
// shared registry. Empty in Phase 2.1; populated in 2.2 and 2.3.
import '../_shared/agent-tools-registry.ts';

// Phase 5.3 — prompt + model version tracking. Bump this string whenever the
// system prompt or routing logic changes meaningfully so we can A/B traceback.
const PROMPT_VERSION = '2026-05-18.v2-finance-strategist';

type ReportQAModelRoute = 'gateway' | 'native' | 'openrouter';
type ReportQAModelAssignment = {
  agent_key: string;
  route: ReportQAModelRoute;
  model_id: string;
  fallback_chain: Array<{ route: ReportQAModelRoute; model_id: string }>;
  temperature: number | null;
  max_tokens: number | null;
  reasoning_effort: string | null;
};

const REPORT_QA_AGENT_KEYS = new Set(['report_qa', 'report_qa_fast', 'report_qa_deep', 'report_qa_search']);
const LEGACY_REPORT_QA_PROVIDER_TO_AGENT_KEY: Record<string, string> = {
  openai: 'report_qa',
  'openai-direct': 'report_qa',
  gemini: 'report_qa_deep',
  perplexity: 'report_qa_search',
};
const REPORT_QA_RETRYABLE_STATUSES = new Set([404, 410, 500, 502, 503, 504]);
const REPORT_QA_MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const REPORT_QA_MAX_PDF_BYTES = 15 * 1024 * 1024;
const REPORT_QA_MAX_QUESTION_CHARS = 8_000;
const REPORT_QA_MAX_HISTORY_MESSAGES = 40;

function normaliseReportQAAgentKey(candidate: unknown): string {
  const key = typeof candidate === 'string' ? candidate.trim() : '';
  if (REPORT_QA_AGENT_KEYS.has(key)) return key;
  return LEGACY_REPORT_QA_PROVIDER_TO_AGENT_KEY[key] ?? 'report_qa';
}

async function loadReportQAModelAssignment(supabase: any, requested: unknown): Promise<ReportQAModelAssignment> {
  const agentKey = normaliseReportQAAgentKey(requested);
  const selectCols = 'agent_key, route, model_id, fallback_chain, temperature, max_tokens, reasoning_effort';
  let { data, error } = await supabase
    .from('agent_model_assignments')
    .select(selectCols)
    .eq('agent_key', agentKey)
    .maybeSingle();

  if (error) console.warn('[report-qa] Failed to load model assignment:', error.message);

  if (!data && agentKey !== 'report_qa') {
    const fallback = await supabase
      .from('agent_model_assignments')
      .select(selectCols)
      .eq('agent_key', 'report_qa')
      .maybeSingle();
    data = fallback.data;
    if (fallback.error) console.warn('[report-qa] Failed to load primary model fallback:', fallback.error.message);
  }

  if (!data) {
    return {
      agent_key: agentKey,
      route: 'gateway',
      model_id: 'google/gemini-3-flash-preview',
      fallback_chain: [{ route: 'gateway', model_id: 'google/gemini-2.5-flash' }],
      temperature: null,
      max_tokens: null,
      reasoning_effort: null,
    };
  }

  return {
    ...data,
    route: data.route as ReportQAModelRoute,
    fallback_chain: Array.isArray(data.fallback_chain) ? data.fallback_chain : [],
  } as ReportQAModelAssignment;
}

function modelFamilyServiceName(modelId: string, route: ReportQAModelRoute): string {
  const model = (modelId || '').toLowerCase();
  if (route === 'openrouter') return 'openrouter';
  if (model.includes('sonar') || model.includes('perplexity')) return 'perplexity';
  if (model.includes('gemini') || model.startsWith('google/')) return 'gemini';
  if (model.includes('claude') || model.startsWith('anthropic/')) return 'anthropic';
  if (model.includes('gpt') || model.startsWith('openai/') || model.startsWith('o')) return 'openai';
  return route;
}

function supportsReportQATools(assignment: ReportQAModelAssignment): boolean {
  const model = (assignment.model_id || '').toLowerCase();
  if (model.includes('sonar') || model.includes('perplexity')) return false;
  if (assignment.route === 'gateway' || assignment.route === 'openrouter') return true;
  return model.startsWith('gpt-') || model.startsWith('o') || model.startsWith('chatgpt');
}

function reportQAModelChain(assignment: ReportQAModelAssignment): ReportQAModelAssignment[] {
  const raw = [
    { route: assignment.route, model_id: assignment.model_id },
    ...(assignment.fallback_chain ?? []),
  ];
  const seen = new Set<string>();
  return raw
    .filter((step) => {
      const key = `${step.route}:${step.model_id}`;
      if (!step.route || !step.model_id || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((step) => ({ ...assignment, route: step.route, model_id: step.model_id }));
}

function buildOpenAICompatibleChatConfig(
  assignment: ReportQAModelAssignment,
  keys: { lovable?: string | null; openai?: string | null; perplexity?: string | null; openrouter?: string | null },
): {
  endpoint: string;
  apiKey: string;
  extraHeaders?: Record<string, string>;
  maxField: 'max_tokens' | 'max_completion_tokens';
  maxTokens: number;
  serviceName: string;
  provider: AgentLoopProvider;
} {
  const model = (assignment.model_id || '').toLowerCase();
  const maxTokens = assignment.max_tokens ?? (model.includes('gemini') ? 65536 : model.includes('sonar') ? 8192 : 16384);
  const serviceName = modelFamilyServiceName(assignment.model_id, assignment.route);

  if (assignment.route === 'gateway') {
    if (!keys.lovable) throw new Error('LOVABLE_API_KEY is not configured');
    return {
      endpoint: 'https://ai.gateway.lovable.dev/v1/chat/completions',
      apiKey: keys.lovable,
      maxField: model.startsWith('openai/') || model.includes('gpt') ? 'max_completion_tokens' : 'max_tokens',
      maxTokens,
      serviceName,
      provider: model.includes('gemini') ? 'gemini' : 'openai-gateway',
    };
  }

  if (assignment.route === 'openrouter') {
    if (!keys.openrouter) throw new Error('OPENROUTER_API_KEY is not configured');
    return {
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: keys.openrouter,
      extraHeaders: {
        'HTTP-Referer': Deno.env.get('APP_URL') ?? 'https://lovable.dev',
        'X-Title': 'NPC Property Dashboard',
      },
      maxField: 'max_tokens',
      maxTokens,
      serviceName,
      provider: 'openai-gateway',
    };
  }

  if (model.startsWith('gpt-') || model.startsWith('o') || model.startsWith('chatgpt')) {
    if (!keys.openai) throw new Error('OPENAI_API_KEY is not configured');
    return {
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: keys.openai,
      maxField: 'max_completion_tokens',
      maxTokens,
      serviceName,
      provider: 'openai-direct',
    };
  }

  if (model.startsWith('sonar')) {
    if (!keys.perplexity) throw new Error('PERPLEXITY_API_KEY is not configured');
    return {
      endpoint: 'https://api.perplexity.ai/chat/completions',
      apiKey: keys.perplexity,
      maxField: 'max_tokens',
      maxTokens,
      serviceName,
      provider: 'openai-gateway',
    };
  }

  throw new Error(`Model route ${assignment.route}/${assignment.model_id} is not stream-compatible for Report Q&A. Use gateway/openrouter or an OpenAI/Perplexity native chat model.`);
}

function buildChatCompletionBody(assignment: ReportQAModelAssignment, messages: any[], stream: boolean, config: { maxField: 'max_tokens' | 'max_completion_tokens'; maxTokens: number }) {
  const body: any = {
    model: assignment.model_id,
    messages,
    [config.maxField]: config.maxTokens,
  };
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  if (assignment.temperature !== null && assignment.temperature !== undefined) body.temperature = Number(assignment.temperature);
  if (assignment.reasoning_effort) body.reasoning = { effort: assignment.reasoning_effort };
  return body;
}

// ============= PDF TEXT EXTRACTION HELPER =============
// Optimized lightweight approach for Deno Edge Functions
// Uses streaming chunk processing to avoid CPU timeouts
// Supports OCR for scanned/image-based PDFs via OpenAI Vision API

const MAX_PDF_SIZE_FOR_FULL_PARSE = 500000; // 500KB - limit for full parsing
const MAX_TEXT_MATCHES = 2000; // Limit matches to prevent infinite loops
const MAX_IMAGES_TO_OCR = 6; // Limit number of page images to process per request
// A flattened A4 page rasterised for OCR is ~0.3-1.5MB; 6MB per page leaves
// generous headroom instead of silently dropping every page of a print-quality
// render (the old 2MB ceiling skipped them all and produced "no text").
const MAX_IMAGE_SIZE_FOR_OCR = 6_000_000;

type PageImageInput = {
  pageNumber: number;
  base64: string; // base64 WITHOUT data url prefix
  mimeType?: string; // e.g. image/png
  width?: number;
  height?: number;
};

/**
 * Extract text content from a PDF - optimized for Edge Functions
 * Uses chunk-based processing to avoid CPU timeouts
 * Optionally performs OCR on embedded images
 */
async function extractPdfText(
  pdfBytes: Uint8Array, 
  openaiApiKey?: string,
  pageImages?: PageImageInput[]
): Promise<{ text: string; totalPages: number; imagesProcessed: number }> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes, { 
      ignoreEncryption: true,
      updateMetadata: false 
    });
    
    const pageCount = pdfDoc.getPageCount();
    console.log(`[PDF-Extract] Processing ${pageCount} pages, size: ${pdfBytes.length} bytes`);
    
    // For large PDFs, use simplified extraction to avoid CPU timeout
    const useSimplified = pdfBytes.length > MAX_PDF_SIZE_FOR_FULL_PARSE;
    
    if (useSimplified) {
      console.log(`[PDF-Extract] Using simplified extraction for large PDF`);
    }
    
    // Extract text from the PDF content in a single pass
    const extractedText = extractTextFromPdfBytes(pdfBytes, useSimplified);
    
    // If we got very little text, try OCR on provided page images (client-rendered)
    let ocrText = '';
    let imagesProcessed = 0;
    
    // OCR no longer depends on an OpenAI key: `performOcrOnImage` prefers the
    // Lovable AI gateway and only falls back to OpenAI when a key is present.
    if (extractedText.length < 500) {
      if (pageImages && pageImages.length > 0) {
        console.log(
          `[PDF-Extract] Low text content (${extractedText.length} chars), attempting OCR on ${pageImages.length} provided page images...`
        );

        const ocrResult = await extractTextFromProvidedImages(pageImages, openaiApiKey);
        ocrText = ocrResult.text;
        imagesProcessed = ocrResult.imagesProcessed;

        if (ocrText) {
          console.log(`[PDF-Extract] OCR extracted ${ocrText.length} chars from ${imagesProcessed} images`);
        }
      } else {
        console.log(
          `[PDF-Extract] Low text content (${extractedText.length} chars) but no pageImages provided; skipping OCR.`
        );
      }
    }
    
    // Combine text and OCR results
    const combinedText = [extractedText, ocrText].filter(t => t.trim()).join('\n\n--- OCR FROM IMAGES ---\n\n');
    
    return {
      text: combinedText,
      totalPages: pageCount,
      imagesProcessed
    };
  } catch (error) {
    console.error('[PDF-Extract] Error loading PDF:', error);
    throw error;
  }
}

/**
 * OCR provided page images using OpenAI Vision API.
 * NOTE: OpenAI Vision only accepts image mime-types, not PDFs.
 */
function estimateBytesFromBase64Length(base64: string): number {
  // Base64 size ≈ (len * 3) / 4 - padding
  const len = base64.length;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

async function extractTextFromProvidedImages(
  pageImages: PageImageInput[],
  openaiApiKey?: string
): Promise<{ text: string; imagesProcessed: number }> {
  const start = Date.now();
  const ocrTexts: string[] = [];
  let processed = 0;

  const imagesToUse = pageImages
    .filter((img) => !!img?.base64)
    .slice(0, MAX_IMAGES_TO_OCR);

  console.log(`[PDF-OCR] OCR on provided images: ${imagesToUse.length} images`);

  for (const img of imagesToUse) {
    // Hard guard to avoid long executions (platform may kill ~150s)
    if (Date.now() - start > 90_000) {
      console.log('[PDF-OCR] Timeout guard hit; stopping OCR loop early');
      break;
    }

    const approxBytes = estimateBytesFromBase64Length(img.base64);
    if (approxBytes > MAX_IMAGE_SIZE_FOR_OCR) {
      console.log(
        `[PDF-OCR] Skipping page ${img.pageNumber} image (too large: ~${approxBytes} bytes)`
      );
      continue;
    }

    const mimeType = img.mimeType || 'image/png';
    const pageNumber = img.pageNumber || 0;

    const ocrResult = await performOcrOnImage(img.base64, mimeType, pageNumber, openaiApiKey);
    if (ocrResult && ocrResult.trim().length > 10) {
      ocrTexts.push(`[Page ${pageNumber}]\n${ocrResult}`);
      processed++;
    }
  }

  return { text: ocrTexts.join('\n\n'), imagesProcessed: processed };
}

const OCR_PROMPT = (pageNumber: number) => `Extract ALL text visible on this page image (page ${pageNumber}). Include:
- All headings, titles, and labels
- All body text and paragraphs
- All numbers, prices, and data
- All table content (format as markdown tables)
- All bullet points and lists

Return plain text/markdown only (no JSON).`;

async function callVisionOcr(
  endpoint: string,
  apiKey: string,
  model: string,
  base64Image: string,
  mimeType: string,
  pageNumber: number,
): Promise<string | null> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT(pageNumber) },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        },
      ],
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[PDF-OCR] Vision API error (${model}): ${response.status} - ${errorText.slice(0, 300)}`);
    return null;
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  return typeof text === 'string' && text.trim() ? text : null;
}

/**
 * OCR one rasterised page. The Lovable AI gateway is tried first so a flattened
 * (image-only) report can always be read even when no OpenAI key is configured
 * for this project — the previous OpenAI-only path silently produced no text at
 * all in that case, which surfaced to the user as "could not extract text".
 */
async function performOcrOnImage(
  base64Image: string,
  mimeType: string,
  pageNumber: number,
  openaiApiKey?: string
): Promise<string | null> {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  try {
    if (lovableKey) {
      const viaGateway = await callVisionOcr(
        'https://ai.gateway.lovable.dev/v1/chat/completions',
        lovableKey,
        'google/gemini-3.6-flash',
        base64Image,
        mimeType,
        pageNumber,
      );
      if (viaGateway) return viaGateway;
    }
    if (openaiApiKey) {
      return await callVisionOcr(
        'https://api.openai.com/v1/chat/completions',
        openaiApiKey,
        'gpt-4o-mini',
        base64Image,
        mimeType,
        pageNumber,
      );
    }
    console.error('[PDF-OCR] No vision provider configured (LOVABLE_API_KEY / OPENAI_API_KEY absent)');
    return null;
  } catch (error) {
    console.error('[PDF-OCR] Vision API call failed:', error);
    return null;
  }
}

// ============= NULL BYTE SANITIZATION =============
// PostgreSQL text columns cannot store \u0000 (null bytes).
// PDF extraction and OCR can produce these characters.
function sanitizeForPostgres(text: string | null | undefined): string {
  if (!text) return text ?? '';
  // Remove null bytes that PostgreSQL rejects (error 22P05)
  // deno-lint-ignore no-control-regex
  return text.replace(/\x00/g, '');
}

function sanitizeArray(arr: string[] | null | undefined): string[] {
  if (!arr) return [];
  return arr.map(s => sanitizeForPostgres(s));
}


/**
 * Extract text from PDF bytes using optimized single-pass parsing
 * Processes in chunks to avoid CPU timeout
 */
function extractTextFromPdfBytes(pdfBytes: Uint8Array, simplified: boolean): string {
  const startTime = Date.now();
  const textParts: string[] = [];
  
  try {
    // Convert to string for parsing
    const pdfString = new TextDecoder('latin1').decode(pdfBytes);
    let matchCount = 0;
    
    // OPTIMIZATION: Use non-global regex and manual iteration for large files
    // This prevents catastrophic backtracking
    
    // Strategy 1: Extract text from parentheses with Tj/TJ operators (most common)
    // Use a simpler, faster regex pattern
    const simpleTextPattern = /\(([^\\)]{1,200})\)\s*T[jJ]/g;
    let match;
    
    while ((match = simpleTextPattern.exec(pdfString)) !== null && matchCount < MAX_TEXT_MATCHES) {
      const text = decodePdfStringFast(match[1]);
      if (text.length > 1) {
        textParts.push(text);
        matchCount++;
      }
      
      // Timeout protection - check every 100 matches
      if (matchCount % 100 === 0 && Date.now() - startTime > 3000) {
        console.log(`[PDF-Extract] Early exit after ${matchCount} matches (timeout protection)`);
        break;
      }
    }
    
    // Strategy 2: Only for smaller files, also check TJ arrays
    if (!simplified && matchCount < MAX_TEXT_MATCHES / 2) {
      const tjArrayPattern = /\[([^\]]{1,500})\]\s*TJ/g;
      while ((match = tjArrayPattern.exec(pdfString)) !== null && matchCount < MAX_TEXT_MATCHES) {
        const arrayContent = match[1];
        // Quick extraction of strings from array
        const strings = arrayContent.match(/\(([^)]{1,100})\)/g);
        if (strings) {
          for (const s of strings.slice(0, 20)) { // Limit per-array extraction
            const text = decodePdfStringFast(s.slice(1, -1));
            if (text.length > 1) {
              textParts.push(text);
              matchCount++;
            }
          }
        }
        
        if (Date.now() - startTime > 4000) {
          console.log(`[PDF-Extract] TJ array early exit (timeout protection)`);
          break;
        }
      }
    }
    
    console.log(`[PDF-Extract] Extracted ${matchCount} text segments in ${Date.now() - startTime}ms`);
    
    // Join and clean up the text
    const rawText = textParts.join(' ');
    
    // Basic cleanup: remove excessive whitespace
    const cleanedText = rawText
      .replace(/\s+/g, ' ')
      .replace(/([.!?])\s+/g, '$1\n')
      .trim();
    
    return cleanedText;
  } catch (error) {
    console.error(`[PDF-Extract] Extraction error:`, error);
    return '';
  }
}

/**
 * Fast PDF string decoder - minimal processing
 */
function decodePdfStringFast(str: string): string {
  // Quick decode - only handle most common escapes
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\\/g, '\\')
    .replace(/\\(.)/g, '$1');
}
// CORS headers sourced from shared helper (uses ALLOWED_ORIGINS env var with safe legacy fallback).
import { createCorsHeaders } from '../_shared/auth.ts';
import { internalError } from '../_shared/errorResponse.ts';

/**
 * Decode base64 to Uint8Array - simple and reliable approach
 * Uses atob for the full string (works fine for audio files up to ~50MB)
 * IMPORTANT: Do NOT split base64 at arbitrary boundaries - base64 works in 4-char groups
 */
function decodeBase64ToUint8Array(base64String: string): Uint8Array {
  // Clean up the base64 string - remove any whitespace or newlines
  const cleanBase64 = base64String.replace(/\s/g, '');
  
  // Decode base64 to binary string
  const binaryString = atob(cleanBase64);
  
  // Convert binary string to Uint8Array
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes;
}

// ============= RAG HELPER FUNCTIONS =============

/**
 * Step 1: Chunk text into smaller overlapping segments
 * Uses sentence-aware chunking with overlap for better context preservation
 */
/**
 * Enriched chunk that carries the paragraph and page where it originated.
 * Used to build paragraph-level citations for the chat UI.
 */
export interface EnrichedChunk {
  text: string;
  paragraph_index: number; // 1-based index of first paragraph in chunk
  page_number: number | null; // best-effort page number derived from [Page N] markers
}

/**
 * Chunk text while tracking the running paragraph index and the most
 * recently seen [Page N] marker so the resulting chunks can be cited
 * by both paragraph and page.
 */
function chunkText(text: string, chunkSize = 800, overlapSize = 150): EnrichedChunk[] {
  const cleanText = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleanText) return [];

  // Split into paragraphs and walk them, tracking the running paragraph index
  // and the most recently observed [Page N] marker.
  const paragraphs = cleanText.split(/\n\n+/);
  const pageRegex = /\[Page\s+(\d+)\]/i;

  const initial: EnrichedChunk[] = [];
  let currentText = '';
  let currentParaStart = 1;
  let currentPage: number | null = null;
  let runningPara = 0;

  const flush = () => {
    const trimmed = currentText.trim();
    if (trimmed) {
      initial.push({
        text: trimmed,
        paragraph_index: currentParaStart,
        page_number: currentPage,
      });
    }
    currentText = '';
  };

  for (const paragraph of paragraphs) {
    runningPara += 1;
    const match = paragraph.match(pageRegex);
    if (match) currentPage = parseInt(match[1], 10) || currentPage;

    if (currentText.length + paragraph.length > chunkSize && currentText.length > 0) {
      flush();
      // Start a new chunk with a small word-level overlap from the previous one
      // for better retrieval recall across chunk boundaries.
      const words = (initial[initial.length - 1]?.text || '').split(' ');
      const overlapWords = words.slice(-Math.floor(overlapSize / 5));
      currentText = overlapWords.join(' ') + '\n\n' + paragraph;
      currentParaStart = runningPara;
    } else {
      if (!currentText) currentParaStart = runningPara;
      currentText += (currentText ? '\n\n' : '') + paragraph;
    }
  }
  flush();

  // Secondary split for any oversized chunks — keep the parent chunk's
  // paragraph_index/page_number since the metadata is approximate at this
  // resolution.
  const finalChunks: EnrichedChunk[] = [];
  for (const chunk of initial) {
    if (chunk.text.length > chunkSize * 1.5) {
      const sentences = chunk.text.split(/(?<=[.!?])\s+/);
      let sub = '';
      for (const sentence of sentences) {
        if (sub.length + sentence.length > chunkSize && sub.length > 0) {
          finalChunks.push({ ...chunk, text: sub.trim() });
          sub = sentence;
        } else {
          sub += (sub ? ' ' : '') + sentence;
        }
      }
      if (sub.trim()) finalChunks.push({ ...chunk, text: sub.trim() });
    } else {
      finalChunks.push(chunk);
    }
  }

  console.log(`[RAG] Chunked text into ${finalChunks.length} segments (paragraph + page tagged)`);
  return finalChunks;
}

/**
 * Step 2: Generate embedding vector for a text chunk via Lovable AI Gateway.
 * Uses Gemini embedding-001 truncated (Matryoshka) to 1536 dims to match the
 * existing pgvector column. Falls back to OpenAI if the gateway is unavailable.
 */
async function generateEmbedding(text: string, openaiApiKey: string): Promise<number[]> {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const input = text.substring(0, 8000);

  if (lovableKey) {
    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-embedding-001',
          input,
          dimensions: 1536,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const vec = data?.data?.[0]?.embedding;
        if (Array.isArray(vec) && vec.length === 1536) return vec;
        console.warn(`[RAG] Gateway returned unexpected embedding shape (len=${vec?.length}); falling back.`);
      } else {
        const errText = await response.text();
        console.warn(`[RAG] Gateway embedding error ${response.status}: ${errText.slice(0, 200)} – falling back to OpenAI.`);
      }
    } catch (err) {
      console.warn('[RAG] Gateway embedding threw, falling back to OpenAI:', err);
    }
  }

  // Legacy fallback: OpenAI
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[RAG] Embedding API error: ${response.status} - ${errorText}`);
    throw new Error(`Failed to generate embedding: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Compute SHA-256 hex of a string for chunk dedupe.
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const EMBEDDING_MODEL_VERSION = 'lovable/gemini-embedding-001@1536';

export interface ChunkPersistMetadata {
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  report_type?: string | null;
}

/**
 * Step 3: Store document chunks with embeddings in database
 */
async function storeDocumentChunks(
  supabase: any,
  documentName: string,
  chunks: EnrichedChunk[],
  openaiApiKey: string,
  conversationId?: string,
  chunkMeta?: ChunkPersistMetadata
): Promise<void> {
  console.log(`[RAG] Storing ${chunks.length} chunks for document: ${documentName}`);

  // Delete existing chunks for this document to avoid duplicates
  if (conversationId) {
    await supabase
      .from('document_chunks')
      .delete()
      .eq('document_name', documentName)
      .eq('conversation_id', conversationId);
  }

  // Process chunks in batches to avoid overwhelming the API
  const batchSize = 5;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);

    const chunksWithEmbeddings = await Promise.all(
      batch.map(async (chunk, batchIndex) => {
        const chunkIndex = i + batchIndex;
        const content_hash = await sha256Hex(`${documentName}::${chunkIndex}::${chunk.text}`);
        const baseRow: Record<string, unknown> = {
          document_name: documentName,
          chunk_index: chunkIndex,
          chunk_text: chunk.text,
          paragraph_index: chunk.paragraph_index,
          page_number: chunk.page_number,
          conversation_id: conversationId || null,
          suburb: chunkMeta?.suburb ?? null,
          state: chunkMeta?.state ?? null,
          postcode: chunkMeta?.postcode ?? null,
          report_type: chunkMeta?.report_type ?? null,
          model_version: EMBEDDING_MODEL_VERSION,
          content_hash,
        };
        try {
          const embedding = await generateEmbedding(chunk.text, openaiApiKey);
          return {
            ...baseRow,
            embedding: JSON.stringify(embedding),
            metadata: { char_count: chunk.text.length, created_at: new Date().toISOString() },
          };
        } catch (error) {
          console.error(`[RAG] Failed to embed chunk ${chunkIndex}:`, error);
          return {
            ...baseRow,
            embedding: null,
            metadata: { char_count: chunk.text.length, created_at: new Date().toISOString(), embedding_error: true },
          };
        }
      })
    );

    const { error } = await supabase
      .from('document_chunks')
      .insert(chunksWithEmbeddings);

    if (error) {
      console.error(`[RAG] Error storing chunks batch ${i}:`, error);
      throw error;
    }

    console.log(`[RAG] Stored batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)}`);
  }

  console.log(`[RAG] Successfully stored all ${chunks.length} chunks with embeddings`);
}

export interface RetrievedChunk {
  chunk_text: string;
  document_name: string;
  similarity: number;
  paragraph_index?: number | null;
  page_number?: number | null;
}

export interface RetrieveFilters {
  documentNames?: string[];
  suburb?: string;
  state?: string;
  postcode?: string;
  reportType?: string;
  semanticWeight?: number;
  keywordWeight?: number;
}

async function retrieveRelevantChunks(
  supabase: any,
  query: string,
  openaiApiKey: string,
  conversationId?: string,
  matchThreshold = 0.5,
  matchCount = 12,
  filters?: RetrieveFilters
): Promise<RetrievedChunk[]> {
  console.log(`[RAG] Hybrid retrieval for query: "${query.substring(0, 50)}..."`);

  try {
    const queryEmbedding = await generateEmbedding(query, openaiApiKey);

    const { data, error } = await supabase.rpc('match_document_chunks_hybrid', {
      query_embedding: JSON.stringify(queryEmbedding),
      query_text: query,
      match_conversation_id: conversationId || null,
      match_document_names: filters?.documentNames ?? null,
      match_suburb: filters?.suburb ?? null,
      match_state: filters?.state ?? null,
      match_postcode: filters?.postcode ?? null,
      match_report_type: filters?.reportType ?? null,
      match_threshold: matchThreshold,
      match_count: matchCount,
      semantic_weight: filters?.semanticWeight ?? 0.7,
      keyword_weight: filters?.keywordWeight ?? 0.3,
    });

    if (error) {
      console.error(`[RAG] Hybrid search error, falling back to semantic-only:`, error);
      // Fallback to legacy semantic-only RPC if hybrid not available
      const { data: legacy, error: legacyErr } = await supabase.rpc('match_document_chunks', {
        query_embedding: JSON.stringify(queryEmbedding),
        match_conversation_id: conversationId || null,
        match_threshold: matchThreshold,
        match_count: matchCount,
      });
      if (legacyErr) throw legacyErr;
      const allowedNames = filters?.documentNames?.length ? new Set(filters.documentNames) : null;
      return allowedNames ? (legacy || []).filter((chunk: RetrievedChunk) => allowedNames.has(chunk.document_name)) : (legacy || []);
    }

    console.log(`[RAG] Hybrid found ${data?.length || 0} chunks (top score: ${data?.[0]?.hybrid_score?.toFixed(3) ?? 'n/a'})`);
    return data || [];
  } catch (error) {
    console.error(`[RAG] Failed to retrieve chunks:`, error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Phase 3.3 — Per-client memory extractor
// ---------------------------------------------------------------------------
// Lightweight, best-effort: asks gemini-2.5-flash to pull 0–5 durable facts
// from the latest Q&A turn and upserts them on the `client_qa_memory` table.
// Caller invokes fire-and-forget after the assistant stream completes.
interface ExtractMemoryArgs {
  supabase: any;
  clientId: string;
  conversationId: string | null;
  userId: string | null;
  question: string;
  answer: string;
  lovableApiKey: string;
}

async function extractAndStoreClientMemory(args: ExtractMemoryArgs): Promise<void> {
  const { supabase, clientId, conversationId, userId, question, answer, lovableApiKey } = args;
  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${lovableApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        max_tokens: 600,
        messages: [
          {
            role: 'system',
            content:
              "You extract durable, reusable facts about a property-investment client from a single Q&A turn. " +
              "Only keep facts that will still matter in future conversations (goals, risk profile, decisions, hard preferences, key constraints). " +
              "Do NOT extract one-off questions, transient numbers from a single report, or generic advice. " +
              "Respond ONLY with a JSON array (0–5 items). Each item: {\"kind\":\"goal|preference|risk|decision|fact\",\"content\":\"<<=180 chars>>\",\"importance\":1-10}. " +
              "If nothing durable, return [].",
          },
          {
            role: 'user',
            content: `Client question:\n${question.slice(0, 800)}\n\nAssistant answer:\n${answer.slice(0, 3500)}\n\nReturn the JSON array now.`,
          },
        ],
      }),
    });
    if (!resp.ok) {
      console.warn('[report-qa] memory extractor HTTP', resp.status);
      return;
    }
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return;
    let items: any;
    try { items = JSON.parse(match[0]); } catch { return; }
    if (!Array.isArray(items) || items.length === 0) return;

    const validKinds = new Set(['goal', 'preference', 'risk', 'decision', 'fact']);
    const rows = await Promise.all(
      items
        .filter((it: any) => it && typeof it.content === 'string' && validKinds.has(it.kind))
        .slice(0, 5)
        .map(async (it: any) => {
          const content = String(it.content).trim().slice(0, 220);
          const importance = Math.max(1, Math.min(10, Number(it.importance) || 5));
          const hash = await sha256Hex(`${clientId}::${it.kind}::${content.toLowerCase()}`);
          return {
            client_id: clientId,
            user_id: userId,
            kind: it.kind,
            content,
            importance,
            source_conversation_id: conversationId,
            content_hash: hash,
          };
        })
    );
    if (rows.length === 0) return;
    const { error } = await supabase
      .from('client_qa_memory')
      .upsert(rows, { onConflict: 'client_id,kind,content_hash', ignoreDuplicates: true });
    if (error) console.warn('[report-qa] memory upsert err:', error.message);
    else console.log(`[report-qa] stored ${rows.length} client memory items for ${clientId}`);
  } catch (e) {
    console.warn('[report-qa] memory extractor failed:', e);
  }
}

/**
 * Format retrieved chunks for prompt injection, labelling each excerpt with a
 * stable [S{n}] tag and paragraph/page metadata so the model is encouraged to
 * cite back using the same tags.
 */
function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  if (!chunks || chunks.length === 0) return '';

  const contextParts = chunks.map((chunk, idx) => {
    const loc: string[] = [];
    if (chunk.page_number) loc.push(`p.${chunk.page_number}`);
    if (chunk.paragraph_index != null) loc.push(`¶${chunk.paragraph_index}`);
    const locStr = loc.length ? ` | ${loc.join(' · ')}` : '';
    return `[S${idx + 1}] [Source: ${chunk.document_name}${locStr} | Relevance: ${(chunk.similarity * 100).toFixed(1)}%]\n${chunk.chunk_text}`;
  });

  return `\n\n## RETRIEVED CONTEXT FROM KNOWLEDGE BASE\nThe following excerpts from uploaded documents are most relevant. When you use information from an excerpt, cite the source using its tag, e.g. [S1] or [S3].\n\n${contextParts.join('\n\n---\n\n')}`;
}

/**
 * Build the structured citations payload that is returned to the client.
 * Each entry is a paragraph-level pointer back into the source report.
 */
function buildStructuredCitations(chunks: RetrievedChunk[]): Array<{
  document_name: string;
  page_number: number | null;
  paragraph_index: number | null;
  snippet: string;
  similarity: number;
}> {
  return (chunks || []).map((c) => ({
    document_name: c.document_name,
    page_number: c.page_number ?? null,
    paragraph_index: c.paragraph_index ?? null,
    snippet: (c.chunk_text || '').substring(0, 320),
    similarity: c.similarity,
  }));
}

type ReportQAPersistTurnArgs = {
  conversationId: string | null | undefined;
  userId?: string | null;
  question: unknown;
  assistantText: unknown;
  modelProvider?: string | null;
  modelVersion?: string | null;
  citations?: unknown[] | null;
  comparisonMode?: boolean;
  promptVersion?: string;
  toolInvocations?: unknown[] | null;
  streamId?: string | null;
  fallbackAssistantText: string;
  source: string;
  persistUser?: boolean;
  persistAssistant?: boolean;
};

async function persistReportQATurn(supabase: any, args: ReportQAPersistTurnArgs): Promise<void> {
  const conversationId = typeof args.conversationId === 'string' && args.conversationId.trim()
    ? args.conversationId.trim()
    : null;
  if (!conversationId) return;

  const questionText = sanitizeForPostgres(String(args.question ?? '').trim() || '[Question not captured]');
  const assistantTextRaw = String(args.assistantText ?? '').trim();
  const assistantText = sanitizeForPostgres(assistantTextRaw || args.fallbackAssistantText);
  const nowIso = new Date().toISOString();
  const sentBy = typeof args.userId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.userId)
    ? args.userId
    : null;
  const safeToolInvocations = Array.isArray(args.toolInvocations) ? args.toolInvocations : [];
  const safeCitations = Array.isArray(args.citations) && args.citations.length > 0 ? args.citations : null;

  console.log('[report-qa] Persisting Q&A turn', {
    source: args.source,
    conversationId,
    userLen: questionText.length,
    assistantLen: assistantText.length,
    capturedAssistant: assistantTextRaw.length > 0,
    toolCount: safeToolInvocations.length,
    streamId: args.streamId || null,
  });

  if (args.persistUser !== false) {
    const userInsert = await supabase.from('report_qa_messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: questionText,
      sent_by: sentBy,
      stream_id: args.streamId || null,
    });
    if (userInsert.error) {
      console.error('[report-qa] User message persist failed:', userInsert.error);
    }
  }

  if (args.persistAssistant !== false) {
    const assistantInsert = await supabase.from('report_qa_messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: assistantText,
      model_provider: args.modelProvider || null,
      citations: safeCitations,
      comparison_mode: Boolean(args.comparisonMode),
      prompt_version: args.promptVersion || PROMPT_VERSION,
      model_version: args.modelVersion || null,
      tool_invocations: safeToolInvocations,
      stream_id: args.streamId || null,
    });
    if (assistantInsert.error) {
      console.error('[report-qa] Assistant message persist failed:', assistantInsert.error);
    }
  }

  const convUpdate = await supabase
    .from('report_qa_conversations')
    .update({ updated_at: nowIso })
    .eq('id', conversationId);
  if (convUpdate.error) {
    console.error('[report-qa] Conversation timestamp update failed:', convUpdate.error);
  }
}

/**
 * fetchUpstreamWithRetry — wraps fetch() with exponential backoff for
 * transient upstream failures (429 / 5xx / network errors). Used for all
 * model calls so a flaky gateway no longer surfaces as a hard failure.
 */
async function fetchUpstreamWithRetry(
  input: string,
  init: RequestInit,
  opts: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {}
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 600;
  const label = opts.label ?? 'upstream';

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(input, init);
      // Retry on 429 + 5xx. Never retry on 402 (payment) or 4xx auth/validation.
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return res;
      }

      console.warn(`[report-qa] ${label} attempt ${attempt}/${maxAttempts} → HTTP ${res.status}`);
      if (attempt === maxAttempts) return res;

      // Honour Retry-After if present
      const retryAfter = res.headers.get('retry-after');
      const headerDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0;
      const delay = Math.max(headerDelay, baseDelayMs * Math.pow(2, attempt - 1));
      await new Promise((r) => setTimeout(r, delay));
    } catch (err) {
      lastError = err;
      console.warn(`[report-qa] ${label} attempt ${attempt}/${maxAttempts} → network error:`, err);
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)));
    }
  }

  // Should never reach here
  throw lastError ?? new Error(`${label} failed`);
}

// ============= END RAG HELPER FUNCTIONS =============

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    // Parse body with error handling - session token may be in headers/cookies
    let body: any = {};
    try {
      body = await req.json();
    } catch (err) {
      console.log('[report-qa] Body parsing failed (may be empty), continuing with empty body:', err);
      // Continue - session token should be in headers/cookies
    }

    // PUBLIC action (no auth) — shared answer lookup must be reachable
    // without a session so anyone with the link can view a single answer.
    // WP-07 hardening: hashed-token lookup via RPC, IP-based rate limit,
    // audit outcome without ever logging the raw token.
    if (body?.action === "get-shared-answer-public") {
      const shareToken = body?.shareToken;
      if (typeof shareToken !== 'string' || shareToken.length < 16 || shareToken.length > 128) {
        return new Response(JSON.stringify({ error: "shareToken required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const sbPub = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

      // Use only platform-provided, single-address headers. The quota key must
      // not contain any token material an unauthenticated caller can vary.
      const requesterIp = getTrustedClientIp(req.headers) ?? 'unknown';
      const ua = (req.headers.get('user-agent') || '').slice(0, 240);
      const prefix = shareToken.slice(0, 8);

      // Atomic public quotas run before the lookup. The global ceiling limits
      // aggregate abuse, while the trusted client identity prevents attackers
      // bypassing the per-client limit by rotating token prefixes.
      try {
        const globalQuota = await consumeRateLimit(sbPub, 'report-qa:public-share:global', 10_000, 60 * 60);
        const clientQuota = await consumeRateLimit(sbPub, `report-qa:public-share:client:${requesterIp}`, 60, 60 * 60);
        if (!globalQuota.allowed || !clientQuota.allowed) {
          return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (error) {
        console.error('[report-qa] public share rate limit unavailable:', error);
        return new Response(JSON.stringify({ error: "Service unavailable" }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data, error } = await sbPub.rpc("get_shared_qa_answer", { _share_token: shareToken });
      if (error) {
        console.error('[report-qa] get-shared-answer-public error:', error);
        // Do not persist unauthenticated misses/errors: random tokens must not
        // amplify into an unbounded access-log table.
        return new Response(JSON.stringify({ error: "Lookup failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        // Successful accesses remain auditable; attacker-controlled misses do not.
        return new Response(JSON.stringify({ error: "Not found or revoked" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await sbPub.from('report_qa_share_access_log').insert({
        share_token_prefix: prefix, message_id: row.message_id, outcome: 'ok',
        requester_ip: requesterIp, requester_ua: ua,
      });
      return new Response(JSON.stringify({ answer: row }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    
    // SECURITY: Verify authentication
    // IMPORTANT: verifyAuth checks headers/cookies first, then body
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[report-qa] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[report-qa] Authenticated user: ${userId}`);

    // WP-07 — resolve superadmin once; all access decisions route through the
    // shared resolver so we never "select then filter in JS".
    const isSuperadmin = await actorIsSuperadmin(supabase, userId ?? '');
    // Deliberately use 404 here. A caller must not be able to distinguish a
    // conversation/message they cannot access from one that does not exist.
    const denyResponse = (msg = 'Not found') =>
      new Response(JSON.stringify({ error: msg }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    const { action } = body;

    type ReportQaActionRequirement = 'none' | 'read' | 'write' | 'admin';
    const reportQaActionPolicy: Record<string, { access: ReportQaActionRequirement; permission: ModulePerm; paid?: boolean; extraModule?: { module: string; permission: ModulePerm } }> = {
      'create-conversation': { access: 'none', permission: 'can_edit' },
      'get-conversations': { access: 'none', permission: 'can_view' },
      'load-conversation': { access: 'read', permission: 'can_view' },
      'chat': { access: 'write', permission: 'can_edit', paid: true },
      // Transcription converts audio to text only — it never reads or writes
      // conversation data, and it must work in a brand-new chat before any
      // conversation row exists. Module permission + paid rate limits still
      // apply; there is simply no conversation resource to authorize.
      'transcribe': { access: 'none', permission: 'can_edit', paid: true },
      // OCR only converts caller-supplied page images to text. It does not
      // access or persist a conversation, so it must work before a new chat
      // has a conversation id. The separate `extract` action remains a
      // write-authorized storage path.
      'ocr-pages': { access: 'none', permission: 'can_edit', paid: true },
      'extract': { access: 'write', permission: 'can_edit', paid: true },
      'index-reports': { access: 'write', permission: 'can_edit', paid: true },
      'update-conversation': { access: 'admin', permission: 'can_edit' },
      'summarize-conversation': { access: 'write', permission: 'can_edit', paid: true },
      'delete-conversation': { access: 'admin', permission: 'can_delete' },
      'share-conversation': { access: 'admin', permission: 'can_edit' },
      'revoke-share': { access: 'admin', permission: 'can_edit' },
      'get-shares': { access: 'admin', permission: 'can_view' },
      'submit-feedback': { access: 'write', permission: 'can_edit' },
      'get-feedback': { access: 'read', permission: 'can_view' },
      'toggle-pin-message': { access: 'write', permission: 'can_edit' },
      'generate-share-link': { access: 'admin', permission: 'can_edit' },
      'revoke-share-link': { access: 'admin', permission: 'can_edit' },
      'branch-conversation': { access: 'admin', permission: 'can_edit' },
      'generate-qa-pdf': { access: 'read', permission: 'can_edit', paid: true },
      // This legacy client-side PDF contains only request content and does not
      // resolve stored reports; it still needs Report Q&A edit permission.
      'export-pdf': { access: 'none', permission: 'can_edit' },
      'get-knowledge-stats': { access: 'read', permission: 'can_view' },
      'get-team-members': { access: 'none', permission: 'can_view' },
      'get-mailboxes': { access: 'none', permission: 'can_view' },
      // SEC-MED: outbound email requires the Email Copilot module too — Report
      // Q&A edit permission alone must not confer send authority. Recipient DLP
      // + per-sender rate quota are additionally enforced in the handler.
      'send-email': { access: 'none', permission: 'can_edit', extraModule: { module: 'email_copilot', permission: 'can_edit' } },
      // The token itself is the credential for this legacy authenticated alias.
      'get-shared-answer': { access: 'none', permission: 'can_view' },
    };

    /**
     * Central, pre-dispatch Report Q&A gate. All resource identifiers are
     * resolved before an action can query RAG, messages, memory, or a paid
     * provider. Message actions derive their conversation from the message
     * itself and reject a mismatched caller-supplied conversation id.
     */
    const authorizeReportQaAction = async (): Promise<Response | null> => {
      const policy = reportQaActionPolicy[action];
      // Public share-token resolution is handled before authentication. These
      // non-conversation helpers do not expose report data.
      if (!policy) return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

      const module = await requireModulePermission(supabase, { userId, authMethod: 'human' }, 'report_qa', policy.permission);
      if (!module.ok) return denyResponse();

      // Some actions require a second business module (e.g. send-email also
      // needs email_copilot.can_edit). Deny-by-default: fail closed if missing.
      if (policy.extraModule) {
        const extra = await requireModulePermission(supabase, { userId, authMethod: 'human' }, policy.extraModule.module, policy.extraModule.permission);
        if (!extra.ok) return denyResponse();
      }

      let conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;
      if (action === 'branch-conversation') conversationId = typeof body.sourceConversationId === 'string' ? body.sourceConversationId : null;

      const messageId = typeof body.messageId === 'string'
        ? body.messageId
        : (typeof body.branchFromMessageId === 'string' ? body.branchFromMessageId : null);
      if (messageId) {
        const { data: message } = await supabase.from('report_qa_messages')
          .select('conversation_id').eq('id', messageId).maybeSingle();
        if (!message?.conversation_id) return denyResponse();
        if (conversationId && conversationId !== message.conversation_id) return denyResponse();
        conversationId = message.conversation_id;
      }

      if (policy.access !== 'none') {
        if (!conversationId) return denyResponse();
        const access = await resolveReportQaAccess(supabase, { actorId: userId, isSuperadmin, conversationId });
        const allowed = policy.access === 'read' ? canRead(access.role)
          : policy.access === 'write' ? canWrite(access.role)
          : canAdminister(access.role);
        if (!allowed || !access.conversation) return denyResponse();
      }

      // Paid provider quota applies to every paid action, including
      // conversation-independent ones (access: 'none') such as transcribe.
      // Transcribe gets a higher ceiling because live-preview transcription
      // fires repeatedly during a single recording (an 8-minute recording can
      // legitimately produce ~50 preview calls).
      if (policy.paid) {
        const perUserLimit = action === 'transcribe' ? 240 : 30;
        const perIpLimit = action === 'transcribe' ? 720 : 90;
        try {
          const quota = await consumeRateLimit(supabase, `report-qa:${action}:user:${userId}`, perUserLimit, 60 * 60);
          if (!quota.allowed) {
            return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
              status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(quota.retryAfterSeconds) },
            });
          }
          const ip = getTrustedClientIp(req.headers);
          if (ip) {
            const ipQuota = await consumeRateLimit(supabase, `report-qa:${action}:ip:${ip}`, perIpLimit, 60 * 60);
            if (!ipQuota.allowed) return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(ipQuota.retryAfterSeconds) } });
          }
        } catch (error) {
          console.error('[report-qa] paid action rate-limit unavailable:', error);
          return new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
      return null;
    };

    const authorizationFailure = await authorizeReportQaAction();
    if (authorizationFailure) return authorizationFailure;

    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log(`[report-qa] Action: ${action}`);

    // Handle voice-to-text transcription
    if (action === "transcribe") {
      const { audio } = body;
      
      if (!audio) {
        throw new Error("No audio data provided");
      }

      const boundedAudio = enforceBase64Limit(audio, Math.ceil(REPORT_QA_MAX_AUDIO_BYTES * 4 / 3) + 16, REPORT_QA_MAX_AUDIO_BYTES);
      if (!boundedAudio.ok) return boundedAudio.error;

      if (!OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured for voice transcription");
      }

      console.log(`[report-qa] Processing voice transcription...`);

      // Decode base64 audio to binary
      const binaryAudio = decodeBase64ToUint8Array(boundedAudio.normalized);
      console.log(`[report-qa] Decoded audio size: ${binaryAudio.length} bytes`);
      
      // Prepare form data
      const formData = new FormData();
      const blob = new Blob([binaryAudio], { type: 'audio/webm' });
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-1');

      // Send to OpenAI
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[report-qa] Whisper API error: ${response.status} - ${errorText}`);
        throw new Error(`Voice transcription failed: ${response.status}`);
      }

      const result = await response.json();
      console.log(`[report-qa] Transcribed: ${result.text?.substring(0, 50)}...`);

      // Log Whisper API usage
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sbLog = createClient(supabaseUrl, supabaseKey);
      await logApiUsage(sbLog, {
        service_name: 'openai',
        endpoint: '/v1/audio/transcriptions',
        model_used: 'whisper-1',
        status: 'success',
        metadata: { function: 'report-qa', action: 'voice_transcribe' },
      });

      return new Response(
        JSON.stringify({ success: true, text: result.text }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle standalone raster OCR or PDF extraction with RAG storage (Step 5).
    // `ocr-pages` is intentionally unable to persist or resolve stored data.
    if (action === "extract" || action === "ocr-pages") {
      const isOcrOnlyAction = action === "ocr-pages";
      const { fileData, fileName, conversationId, enableOCR = true, pageImages } = body;
      const enableRAG = isOcrOnlyAction ? false : body.enableRAG ?? true;
      console.log(`[report-qa] Extracting text from: ${fileName}, RAG enabled: ${enableRAG}, OCR enabled: ${enableOCR}`);
      
      if (!Array.isArray(pageImages) && pageImages !== undefined) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (typeof fileName !== 'string' || fileName.length < 1 || fileName.length > 255) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const imagesOnly = (!fileData || typeof fileData !== 'string' || fileData.length === 0)
        && Array.isArray(pageImages) && pageImages.length > 0;

      if (isOcrOnlyAction && !imagesOnly) {
        return new Response(JSON.stringify({ error: 'OCR pages are required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Accept either a full data URL or raw base64.
      const base64Data = (typeof fileData === 'string' && fileData.includes(','))
        ? (fileData.split(',').pop() || '')
        : (fileData || '');
      let normalizedPdf = '';
      if (!imagesOnly) {
        const boundedPdf = enforceBase64Limit(base64Data, Math.ceil(REPORT_QA_MAX_PDF_BYTES * 4 / 3) + 16, REPORT_QA_MAX_PDF_BYTES);
        if (!boundedPdf.ok) return boundedPdf.error;
        normalizedPdf = boundedPdf.normalized;
      }

      let extractedText = "";
      let imagesProcessed = 0;
      let totalPages = 0;
      let fileSizeBytes = 0;
      let ocrOnlyText = '';

      try {
        if (imagesOnly) {
          // OCR-only batch: the client rasterised the PDF and is streaming a few
          // pages per request, so a whole print-quality document never has to fit
          // in one edge payload (which is what used to fail outright).
          console.log(`[report-qa] OCR-only batch: ${pageImages.length} page images`);
          const ocr = await extractTextFromProvidedImages(pageImages, enableOCR ? OPENAI_API_KEY : undefined);
          ocrOnlyText = ocr.text;
          imagesProcessed = ocr.imagesProcessed;
          totalPages = pageImages.length;
          if (ocrOnlyText.trim()) {
            extractedText = ocrOnlyText;
          } else {
            return new Response(
              JSON.stringify({
                success: false,
                error: 'OCR returned no readable text for these pages.',
                imagesProcessed,
              }),
              { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
          }
        } else {
          // Convert base64 to Uint8Array for PDF parsing
          const binaryString = atob(normalizedPdf);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          fileSizeBytes = bytes.length;
          console.log(`[report-qa] PDF size: ${fileSizeBytes} bytes`);

          // Use our custom PDF text extraction function with optional OCR
          const ocrKey = enableOCR ? OPENAI_API_KEY : undefined;
          const result = await extractPdfText(bytes, ocrKey, Array.isArray(pageImages) ? pageImages : undefined);
          const { text, totalPages: pages, imagesProcessed: imgCount } = result;
          imagesProcessed = imgCount;
          totalPages = pages;

          console.log(`[report-qa] Extracted text from ${totalPages} pages, OCR'd ${imagesProcessed} images`);

          if (text && text.trim().length > 0) {
            extractedText = `[Document: ${fileName}]\n[Pages: ${totalPages}]${imagesProcessed > 0 ? `\n[Images OCR'd: ${imagesProcessed}]` : ''}\n\n${text}`;
            console.log(`[report-qa] Successfully extracted ${extractedText.length} characters`);
          } else {
            // PDF might be image-based (scanned), provide fallback message
            console.log(`[report-qa] No text extracted - PDF may be image-based or encrypted`);
            extractedText = `[Document: ${fileName}]\n[Pages: ${totalPages}]\n\nThis PDF appears to be image-based (scanned) or encrypted and text content could not be automatically extracted. The document has been uploaded but you may need to manually enter key details.`;
          }
        }
      } catch (pdfError) {
        console.error(`[report-qa] PDF extraction error:`, pdfError);

        // Provide informative fallback
        extractedText = `[Document: ${fileName}]\n\nPDF text extraction encountered an error: ${pdfError.message}. The document has been uploaded but raw text could not be automatically extracted.`;
      }

      console.log(`[report-qa] Final extracted text length: ${extractedText.length} characters`);

      // Step 5: Store extracted text as chunks with embeddings for RAG
      let ragEnabled = false;
      let chunksStored = 0;
      if (enableRAG && OPENAI_API_KEY && extractedText.length > 100) {
        try {
          console.log(`[report-qa] Processing document for RAG storage...`);

          const chunks = chunkText(extractedText);
          chunksStored = chunks.length;

          // Derive lightweight location metadata so chunks are filterable later.
          const metrics = extractReportMetrics(extractedText);
          let suburb: string | null = null;
          if (metrics.address) {
            const parts = metrics.address.split(',').map(p => p.trim());
            if (parts.length >= 2) suburb = parts[1] || null;
          }
          const chunkMeta = {
            suburb,
            state: metrics.state ?? null,
            postcode: metrics.postcode ?? null,
            report_type: null,
          };

          await storeDocumentChunks(supabase, fileName, chunks, OPENAI_API_KEY, conversationId, chunkMeta);

          ragEnabled = true;
          console.log(`[report-qa] RAG storage complete for ${fileName}`);
        } catch (ragError) {
          console.error(`[report-qa] RAG storage failed (non-critical):`, ragError);
          // Continue without RAG - extraction still succeeded
        }
      } else if (!OPENAI_API_KEY) {
        console.log(`[report-qa] RAG storage skipped - OPENAI_API_KEY not configured`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          extractedText,
          ragEnabled,
          chunksStored,
          imagesProcessed,
          totalPages,
          fileSizeBytes,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle chat Q&A with RAG retrieval (Step 6)
    if (action === "chat") {
      const { reportContents, reportNames, selectedReportNames, question, chatHistory, conversationId, useRAG = true, modelProvider: requestedModelProvider = 'report_qa', agentKey: requestedAgentKey, needsConversationSummary = false, totalMessageCount = 0, agentMode = false, enabledTools } = body;
      if (typeof question !== 'string' || question.trim().length === 0 || question.length > REPORT_QA_MAX_QUESTION_CHARS) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (chatHistory !== undefined && (!Array.isArray(chatHistory) || chatHistory.length > REPORT_QA_MAX_HISTORY_MESSAGES)) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const modelAssignment = await loadReportQAModelAssignment(supabase, requestedAgentKey ?? requestedModelProvider);
      const modelProvider = modelAssignment.agent_key;
      const modelVersion = modelAssignment.model_id;
      const modelRoute = modelAssignment.route;
      console.log(`[report-qa] Processing chat question: ${question?.substring(0, 50)}...`);
      console.log(`[report-qa] ConversationId: ${conversationId}, RAG: ${useRAG}, AgentKey: ${modelProvider}, Route: ${modelRoute}, Model: ${modelVersion}`);

      // === RAG-FIRST CONTEXT ASSEMBLY ===
      // Instead of sending full report content every message, we:
      // 1. Load the structural summary from the conversation
      // 2. Retrieve semantically relevant chunks via embeddings
      // 3. Fall back to raw content only if RAG is not available

      let summaryContext = "";
      let ragContext = "";
      let hasRagContext = false;
      // Hold onto retrieved chunks so we can build paragraph-level citations
      // and return them to the client alongside the answer.
      let retrievedChunksForCitations: RetrievedChunk[] = [];
      const selectedDocumentNames = Array.isArray(selectedReportNames) && selectedReportNames.length > 0
        ? selectedReportNames.filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0)
        : (Array.isArray(reportNames) ? reportNames.filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0) : []);

      if (conversationId) {
        supabase
          .from("report_qa_conversations")
          .update({ agent_mode: Boolean(agentMode), updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .then(() => console.log(`[report-qa] Persisted conversation chat state for ${conversationId}`))
          .catch((stateError: any) => console.warn(`[report-qa] Failed to persist conversation chat state:`, stateError));
      }
      const hasReports = (reportContents && reportContents.length > 0);
      const isMultiReport = selectedDocumentNames.length > 1 || (reportContents && reportContents.length > 1);
      // Comparison mode is enabled when the user has selected ≥2 reports.
      // It drives both prompt selection and a UI badge on the answer.
      const comparisonMode = selectedDocumentNames.length > 1 || (Array.isArray(reportContents) && reportContents.length > 1);

      // Per-client memory (Phase 3.3): if conversation is linked to a client,
      // load durable facts/preferences and inject them into the system prompt.
      let clientMemoryContext = "";
      let conversationClientId: string | null = null;

      // Try RAG-based context assembly first
      if (conversationId && OPENAI_API_KEY) {
        // Load structural summary from conversation
        try {
          const { data: conv } = await supabase
            .from("report_qa_conversations")
            .select("structured_report, report_names, client_id")
            .eq("id", conversationId)
            .single();

          const allConversationReportNames = Array.isArray(conv?.report_names) ? conv.report_names : [];
          const selectedAllConversationReports = selectedDocumentNames.length === 0 || (
            selectedDocumentNames.length === allConversationReportNames.length &&
            selectedDocumentNames.every((name) => allConversationReportNames.includes(name))
          );
          if (conv?.structured_report && conv.structured_report.length > 100 && selectedAllConversationReports) {
            summaryContext = conv.structured_report;
            console.log(`[report-qa] Loaded structural summary: ${summaryContext.length} chars`);
          } else if (conv?.structured_report && !selectedAllConversationReports) {
            console.log(`[report-qa] Skipping all-report structural summary because selected report grounding is narrowed to ${selectedDocumentNames.length} report(s)`);
          }
          conversationClientId = (conv?.client_id as string | null) || null;
        } catch (e) {
          console.error(`[report-qa] Failed to load summary:`, e);
        }

        // Load top per-client memories
        if (conversationClientId) {
          try {
            const { data: memRows } = await supabase
              .from('client_qa_memory')
              .select('kind, content, importance')
              .eq('client_id', conversationClientId)
              .order('importance', { ascending: false })
              .order('updated_at', { ascending: false })
              .limit(30);
            if (memRows && memRows.length > 0) {
              const grouped: Record<string, string[]> = {};
              for (const m of memRows) {
                const k = m.kind as string;
                (grouped[k] ||= []).push(`- ${m.content}`);
              }
              const lines: string[] = [];
              for (const [k, items] of Object.entries(grouped)) {
                lines.push(`**${k.toUpperCase()}**\n${items.join('\n')}`);
              }
              clientMemoryContext = lines.join('\n\n');
              console.log(`[report-qa] Loaded ${memRows.length} client memory items for ${conversationClientId}`);
            }
          } catch (memErr) {
            console.error('[report-qa] Failed to load client memory:', memErr);
          }
        }

        // Retrieve relevant chunks via semantic search
        if (useRAG) {
          try {
            const relevantChunks = await retrieveRelevantChunks(
              supabase,
              question,
              OPENAI_API_KEY,
              conversationId,
              0.5, // Lower threshold for broader matches
              12,  // More chunks for comprehensive context
              selectedDocumentNames.length > 0 ? { documentNames: selectedDocumentNames } : undefined
            );

            if (relevantChunks.length > 0) {
              ragContext = formatRetrievedContext(relevantChunks);
              hasRagContext = true;
              retrievedChunksForCitations = relevantChunks;
              console.log(`[report-qa] RAG retrieved ${relevantChunks.length} relevant chunks`);
            }
          } catch (ragError) {
            console.error(`[report-qa] RAG retrieval failed:`, ragError);
          }
        }
      }

      // Build context section
      // Priority: Summary + RAG chunks (preferred) > Raw content (fallback)
      const MAX_CONTEXT_CHARS = 800000;
      
      function truncateContext(text: string, maxChars: number): string {
        if (text.length <= maxChars) return text;
        const truncated = text.substring(0, maxChars);
        const lastBreak = Math.max(
          truncated.lastIndexOf('\n\n'),
          truncated.lastIndexOf('. '),
          truncated.lastIndexOf('.\n')
        );
        const cutPoint = lastBreak > maxChars * 0.8 ? lastBreak + 1 : maxChars;
        return truncated.substring(0, cutPoint) + '\n\n[... Content truncated. Ask specific questions for more detail.]';
      }

      let contextSection = "";
      
      if (summaryContext || hasRagContext) {
        // RAG mode: Use summary + retrieved chunks (much more efficient)
        const parts: string[] = [];
        
        if (summaryContext) {
          parts.push(`## REPORT SUMMARY\n${summaryContext}`);
        }
        
        if (ragContext) {
          parts.push(ragContext);
        }
        
        contextSection = parts.join('\n\n');
        console.log(`[report-qa] Using RAG context: ${contextSection.length} chars (summary: ${summaryContext.length}, chunks: ${ragContext.length})`);
      } else if (hasReports) {
        // Fallback: Use raw report content from request (legacy behavior for non-indexed conversations)
        console.log(`[report-qa] RAG not available, falling back to raw content injection from request`);
        
        if (isMultiReport) {
          const perReportLimit = Math.floor(MAX_CONTEXT_CHARS / reportContents.length);
          contextSection = reportContents.map((content: string, idx: number) => 
            `--- REPORT ${idx + 1}: ${reportNames?.[idx] || `Report ${idx + 1}`} ---\n${truncateContext(content, perReportLimit)}\n`
          ).join("\n\n");
        } else {
          const raw = reportContents?.[0] || body.reportContent || "";
          contextSection = truncateContext(raw, MAX_CONTEXT_CHARS);
        }
      } else if (conversationId) {
        // DB fallback: Load raw content from conversation record when nothing else is available
        console.log(`[report-qa] No RAG or request content, loading raw content from DB for conversation ${conversationId}`);
        try {
          const { data: convFallback } = await supabase
            .from("report_qa_conversations")
            .select("report_contents, report_names")
            .eq("id", conversationId)
            .single();

          if (convFallback?.report_contents && convFallback.report_contents.length > 0) {
            const dbNames = convFallback.report_names || [];
            const allowedNames = selectedDocumentNames.length > 0 ? new Set(selectedDocumentNames) : null;
            const filteredPairs = (convFallback.report_contents || [])
              .map((content: string, idx: number) => ({ content, name: dbNames[idx] || `Report ${idx + 1}` }))
              .filter((pair: { content: string; name: string }) => !allowedNames || allowedNames.has(pair.name));
            const dbContents = filteredPairs.map((pair: { content: string; name: string }) => pair.content);
            const filteredDbNames = filteredPairs.map((pair: { content: string; name: string }) => pair.name);
            console.log(`[report-qa] DB fallback: loaded ${dbContents.length} reports from conversation`);

            if (dbContents.length > 1) {
              const perReportLimit = Math.floor(MAX_CONTEXT_CHARS / dbContents.length);
              contextSection = dbContents.map((content: string, idx: number) =>
                `--- REPORT ${idx + 1}: ${filteredDbNames[idx] || `Report ${idx + 1}`} ---\n${truncateContext(content, perReportLimit)}\n`
              ).join("\n\n");
            } else {
              contextSection = truncateContext(dbContents[0], MAX_CONTEXT_CHARS);
            }
          }
        } catch (dbErr) {
          console.error(`[report-qa] DB fallback failed:`, dbErr);
        }
      }
      
      if (contextSection.length > MAX_CONTEXT_CHARS) {
        contextSection = truncateContext(contextSection, MAX_CONTEXT_CHARS);
      }
      console.log(`[report-qa] Final context section length: ${contextSection.length} chars`);

      let systemPrompt = "";

      // === FINANCE STRATEGIST PERSONA (always-on) ===
      // Prepended to every variant so the agent answers as a senior AU property
      // finance strategist — not just a report reader. Reinforces tool-use over
      // estimation, AU localisation, and compliance guardrails.
      const _brandCfg = await getBrandConfig();
      const FINANCE_PERSONA = `# ROLE: Senior Australian Property Finance Strategist
You are a senior property finance strategist for ${_brandCfg.companyName}, combining the lens of a mortgage broker, portfolio strategist, and investment analyst. You advise on real-world decisions, not just report contents.

## DOMAINS OF EXPERTISE
- **Lending & serviceability**: borrowing capacity, DTI, HEM, LVR tiering, LMI, lender policy nuances, P&I vs IO, offset/redraw, refinance & equity release timing
- **Cash flow & tax**: gross/net yield, weekly/monthly/annual cash flow, negative vs positive gearing, depreciation (Div 40 / Div 43), CGT (incl. 50% discount, main residence), land tax by state, stamp duty by state, GST on commercial
- **Portfolio strategy**: diversification (geography, asset class, tenant profile), ownership structures (personal, joint, trust, SMSF, company) and their lending/tax trade-offs, exit & hold strategy, equity recycling
- **Markets**: suburb-level supply/demand, vacancy, rental yields, demographic & infrastructure drivers, growth vs yield trade-off, cycle positioning across AU capitals and regionals
- **Risk**: interest rate sensitivity, rental void, oversupply, policy/regulation, concentration, serviceability shock testing

## REASONING STYLE
- **Compute, don't guess.** When a question involves numbers (yield, LVR, cash flow, borrowing capacity, CGT, depreciation, stamp duty, land tax, scenario modelling), CALL the calculator/data tools available to you rather than estimating. Show the inputs you used.
- **State assumptions explicitly** (interest rate, term, growth rate, CPI, vacancy %, tax bracket) and flag which are defaults vs client-specific.
- **Quantify trade-offs.** Don't say "good yield" — say "5.2% gross yield, ~120bps above the suburb median of 4.0%".
- **Think in scenarios.** When useful, model base / stress / upside (e.g. +1% rates, -10% rent) so the user sees the range.
- **Be decisive.** Give a clear recommendation with reasoning, then list the conditions under which you'd change your mind.

## AUSTRALIAN LOCALISATION
- Always AUD, AU spelling, AU terminology ('Postcode' not 'ZIP', 'Strata' not 'HOA').
- Use exact period multipliers (Weekly = annual ÷ 52, Monthly = annual ÷ 12; Weekly→Monthly = 52/12).
- Round interest rates to 2 decimals.
- Reference ATO, APRA, NCCP, state Revenue Offices, RBA cash rate where relevant.

## COMPLIANCE GUARDRAILS
- This is **strategic guidance and education**, not personal financial product advice under the Corporations Act, nor credit assistance under the NCCP Act.
- For execution (loan application, tax filing, structure set-up), recommend the user confirm with their licensed mortgage broker, accountant, or financial adviser.
- Do not promise specific lender approval or guaranteed returns. Frame projections as scenarios based on stated assumptions.
- Never invent client-specific figures; if a number isn't in context or computable from tools, say so and ask for the missing input.

## ANSWER SHAPE
- Lead with the **direct answer / recommendation** in 1-2 sentences.
- Follow with **the numbers** (table or bullets) and **the reasoning**.
- Close with **next actions** the user can take (or what they should ask their broker/accountant).
- Use markdown; structure for mobile reading.

---

`;

      
      // Determine context type for prompt selection
      const hasContext = contextSection.length > 100;
      const isMultiReportContext = isMultiReport || (reportNames && reportNames.length > 1);
      
      if (isMultiReportContext && hasContext) {
        systemPrompt = FINANCE_PERSONA + `You are an expert Australian investment property analyst and advisor for ${(await getBrandConfig()).companyName}. You have been provided with MULTIPLE investment reports for SIDE-BY-SIDE COMPARISON analysis.

## YOUR EXPERTISE
- Deep knowledge of Australian property markets across all states and territories
- Understanding of property investment strategies (growth, yield, cash flow)
- Expertise in financial analysis, tax implications (including depreciation, negative gearing)
- Knowledge of demographic trends, infrastructure development, and economic indicators
- Familiarity with Australian lending practices, LVR requirements, and mortgage calculations

## COMPARISON MODE — REQUIRED OUTPUT STRUCTURE
You MUST structure every answer in this exact order:

1. **Snapshot table** — A markdown table with one column per report and rows for the most relevant comparison metrics (purchase price, yield, weekly cash flow, capital growth %, suburb median, vacancy rate, etc.). Use "—" for missing values. Include a header row with the report names.
2. **Per-report narrative** — One short paragraph per report (\`### Report Name\` heading) summarising its standout strengths and concerns.
3. **Head-to-head verdict** — A "### Verdict" section that ranks the reports for at least two investor profiles (e.g. growth-focused vs yield-focused) and names a clear winner with reasoning.
4. **Risks & caveats** — A "### Risks" bullet list calling out red flags per report.

## RESPONSE GUIDELINES
- Always include specific numbers and percentages from the reports — never generalise where data exists
- If a metric is missing for one report, write "—" in the table rather than omitting the row
- When citing information from the retrieved excerpts, ALWAYS use the bracketed source tags [S1], [S2], etc. exactly as they appear in the context
- Also indicate the source REPORT NAME inline when referencing report-specific figures
- Format for easy scanning — clients will read this on mobile

## REPORT DATA
${contextSection}`;
      } else if (hasContext) {
        systemPrompt = FINANCE_PERSONA + `You are an expert Australian investment property analyst and advisor for ${(await getBrandConfig()).companyName}. You have been provided with investment property report data to analyze.

## YOUR EXPERTISE
- Deep knowledge of Australian property markets across all states and territories
- Understanding of property investment strategies (growth, yield, cash flow)
- Expertise in financial analysis, tax implications (including depreciation, negative gearing)
- Knowledge of demographic trends, infrastructure development, and economic indicators
- Familiarity with Australian lending practices, LVR requirements, and mortgage calculations
- Understanding of stamp duty, council rates, strata fees, and ongoing costs

## YOUR ROLE
1. Answer questions accurately and thoroughly based on the report content
2. Provide investment insights and analysis beyond just reading data
3. Explain financial metrics in context (is 4% yield good? depends on location and growth)
4. Identify opportunities AND risks that may not be explicitly stated
5. Provide actionable advice suitable for investor decision-making

## RESPONSE GUIDELINES
- Be thorough and provide detailed explanations
- Include specific numbers and figures from the report
- Contextualize data (compare to market averages when possible)
- Structure responses with clear sections for complex questions
- When providing summaries (TLDR), include:
  • Property overview (type, location, price)
  • Key financial metrics (yield, cash flow, capital growth)
  • Top 3 strengths and top 3 concerns
  • Investor suitability rating
- If information is not in the report, clearly state that and explain what assumptions you're making
- When citing information, indicate the source

## REPORT DATA
${contextSection}`;
      } else if (ragContext) {
        // No reports loaded but we have RAG context from knowledge base
        systemPrompt = FINANCE_PERSONA + `You are an expert Australian investment property analyst and advisor for ${(await getBrandConfig()).companyName}.

## YOUR EXPERTISE
- Deep knowledge of Australian property markets across all states and territories
- Understanding of property investment strategies (positive/negative gearing, growth vs yield, SMSF property)
- Expertise in financial analysis, ROI calculations, cash flow projections
- Knowledge of Australian tax implications (depreciation schedules, CGT, land tax, stamp duty by state)
- Understanding of demographic trends, infrastructure development, and economic indicators
- Familiarity with Australian lending practices, LVR requirements, and current interest rates

## YOUR ROLE
1. Answer property investment questions using information from the knowledge base
2. Provide market insights and trends for Australian property
3. Explain financial concepts clearly with examples
4. Help users understand investment strategies and their implications
5. Discuss risks and opportunities in the current market

## RESPONSE GUIDELINES
- Use information from the retrieved knowledge base documents when relevant
- Be conversational yet professional
- Provide detailed, actionable advice
- Use Australian context (AUD, local market references, Australian regulations)
- Include relevant data points when discussing markets
- When citing information from the knowledge base, indicate the source
- Structure longer responses with clear headings and bullet points
${ragContext}`;
      } else {
        // Open-ended conversation without document context
        systemPrompt = FINANCE_PERSONA + `You are an expert Australian investment property analyst and advisor for ${(await getBrandConfig()).companyName}, a property investment advisory firm.

## YOUR EXPERTISE
- Deep knowledge of Australian property markets across all states and territories (Sydney, Melbourne, Brisbane, Perth, Adelaide, Hobart, Darwin, Canberra, and regional areas)
- Understanding of property investment strategies (positive/negative gearing, growth vs yield, SMSF property)
- Expertise in financial analysis, ROI calculations, cash flow projections
- Knowledge of Australian tax implications (depreciation schedules, CGT, land tax, stamp duty by state)
- Understanding of demographic trends, infrastructure development, and economic indicators
- Familiarity with Australian lending practices, LVR requirements, and current interest rates
- Knowledge of property types (houses, units, townhouses, dual occupancy, commercial)

## YOUR ROLE
1. Answer property investment questions with expert-level detail
2. Provide market insights and trends for Australian property
3. Explain financial concepts clearly with examples
4. Help users understand investment strategies and their implications
5. Discuss risks and opportunities in the current market

## RESPONSE GUIDELINES
- Be conversational yet professional
- Provide detailed, actionable advice
- Use Australian context (AUD, local market references, Australian regulations)
- Include relevant data points when discussing markets
- Acknowledge when information may be outdated or when users should verify current rates/prices
- Structure longer responses with clear headings and bullet points
- If asked about specific properties without a report, encourage them to upload one

## CURRENT CONTEXT
No investment report has been uploaded. You are having an open conversation about property investment. If the user wants specific property analysis, encourage them to upload a report.`;
      }

      // === ROLLING CONVERSATION SUMMARY ===
      // When conversations get long, load/generate a summary of older messages
      // to preserve context without bloating the payload
      let conversationSummaryContext = "";
      
      if (conversationId && needsConversationSummary && totalMessageCount > 12) {
        try {
          // First, try to load existing summary from DB
          const { data: convSummary } = await supabase
            .from("report_qa_conversations")
            .select("conversation_summary, summary_message_count")
            .eq("id", conversationId)
            .single();
          
          const existingSummary = convSummary?.conversation_summary;
          const summarizedCount = convSummary?.summary_message_count || 0;
          
          // Check if we need to generate/update the summary
          // Regenerate if we have 6+ new messages since last summary
          const currentMessageCount = totalMessageCount;
          const unsummarizedMessages = currentMessageCount - summarizedCount;
          
          if (unsummarizedMessages >= 6 || (!existingSummary && currentMessageCount > 12)) {
            console.log(`[report-qa] Generating rolling summary (${unsummarizedMessages} new messages since last summary)`);
            
            // Fetch older messages that aren't in the current chat window
            const { data: olderMessages } = await supabase
              .from("report_qa_messages")
              .select("role, content, created_at")
              .eq("conversation_id", conversationId)
              .order("created_at", { ascending: true })
              .limit(currentMessageCount); // Get all messages
            
            if (olderMessages && olderMessages.length > 0) {
              // Build a transcript of messages to summarize (everything except the most recent window)
              const messagesToSummarize = olderMessages.slice(0, Math.max(0, olderMessages.length - 20));
              
              if (messagesToSummarize.length > 0) {
                const transcript = messagesToSummarize.map((m: any) => 
                  `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 3000)}`
                ).join('\n\n');
                
                // Generate summary using a fast model
                const { callLLMRaw } = await import("../_shared/llmRouter.ts");
                const summaryResponse = await callLLMRaw({
                  agentKey: 'transcript_cleaning',
                  messages: [
                    {
                      role: "system",
                      content: `You are a conversation summarizer. Create a concise but comprehensive summary of this Q&A conversation about property investment. Preserve:
1. ALL specific numbers, figures, property addresses, and financial data mentioned
2. Key questions asked and conclusions reached
3. Any recommendations or action items discussed
4. The user's apparent investment goals and preferences
5. Any specific properties, suburbs, or markets discussed

Format as a structured summary with bullet points. Be thorough but concise. Max 2000 words.`,
                    },
                    {
                      role: "user",
                      content: `${existingSummary ? `PREVIOUS SUMMARY:\n${existingSummary}\n\n---\n\nNEW MESSAGES TO INCORPORATE:\n` : ''}${transcript}`,
                    },
                  ],
                  maxTokens: 4096,
                });
                
                if (summaryResponse.ok) {
                  const summaryData = await summaryResponse.json();
                  const newSummary = summaryData.choices?.[0]?.message?.content || "";
                  
                  if (newSummary.length > 50) {
                    conversationSummaryContext = newSummary;
                    
                    // Store summary in DB (fire-and-forget)
                    supabase
                      .from("report_qa_conversations")
                      .update({
                        conversation_summary: newSummary,
                        last_summarized_at: new Date().toISOString(),
                        summary_message_count: currentMessageCount,
                      })
                      .eq("id", conversationId)
                      .then(() => console.log(`[report-qa] Saved rolling summary (${newSummary.length} chars)`))
                      .catch((e: any) => console.error(`[report-qa] Failed to save summary:`, e));
                  }
                }
              }
            }
          } else if (existingSummary) {
            // Use existing summary
            conversationSummaryContext = existingSummary;
            console.log(`[report-qa] Using existing conversation summary (${existingSummary.length} chars)`);
          }
        } catch (summaryError) {
          console.error(`[report-qa] Conversation summary error (non-critical):`, summaryError);
        }
      }
      
      // Inject conversation summary into system prompt if available
      if (clientMemoryContext) {
        systemPrompt += `\n\n## CLIENT MEMORY (durable facts known about this client)\nUse these to personalise your answers. If something here conflicts with new information in this conversation, treat the new information as the latest truth.\n\n${clientMemoryContext}`;
      }
      if (conversationSummaryContext) {
        systemPrompt += `\n\n## EARLIER CONVERSATION CONTEXT\nThe following is a summary of earlier messages in this conversation that are beyond the recent chat window. Use this to maintain continuity and avoid repeating information:\n\n${conversationSummaryContext}`;
      }

      // Build messages ensuring strict alternation (required by Perplexity)
      const rawHistory = chatHistory || [];
      const sanitizedHistory: { role: string; content: string }[] = [];
      for (const msg of rawHistory) {
        // Skip if same role as previous (merge or drop to maintain alternation)
        if (sanitizedHistory.length > 0 && sanitizedHistory[sanitizedHistory.length - 1].role === msg.role) {
          // Merge consecutive same-role messages
          sanitizedHistory[sanitizedHistory.length - 1].content += '\n\n' + msg.content;
        } else {
          sanitizedHistory.push({ role: msg.role, content: msg.content });
        }
      }
      // If last history message is 'user', merge it into the current question
      let finalQuestion = question;
      if (sanitizedHistory.length > 0 && sanitizedHistory[sanitizedHistory.length - 1].role === 'user') {
        const lastUserMsg = sanitizedHistory.pop()!;
        finalQuestion = lastUserMsg.content + '\n\n' + question;
      }
      
      const rawMessages = [
        { role: "system", content: systemPrompt },
        ...sanitizedHistory,
        { role: "user", content: finalQuestion },
      ];

      // Token-aware budgeter: pick per-model budget, drop oldest history first,
      // then truncate system context tail. Keeps the most important slots intact.
      const budgetModelHint = modelVersion;
      const budget = fitMessagesToBudget(
        rawMessages,
        inputBudgetForModel(budgetModelHint),
        { systemContextSeparator: '\n\n## ' }
      );
      const messages = budget.messages;
      if (budget.trimmed.historyDropped || budget.trimmed.systemTruncatedChars) {
        console.log(`[report-qa] Budget trim — historyDropped=${budget.trimmed.historyDropped}, systemTruncatedChars=${budget.trimmed.systemTruncatedChars}, estTokens=${budget.estimatedTokens}`);
      } else {
        console.log(`[report-qa] Budget OK — estTokens=${budget.estimatedTokens}`);
      }

      // Check if streaming is requested
      const streamingEnabled = body.stream === true;
      
      if (streamingEnabled) {
        console.log(`[report-qa] Streaming mode enabled, provider: ${modelProvider}, agentMode: ${agentMode}`);
        const streamId = (crypto as any).randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        if (conversationId) {
          await persistReportQATurn(supabase, {
            conversationId,
            userId,
            question,
            assistantText: '',
            persistAssistant: false,
            streamId,
            fallbackAssistantText: '',
            source: 'chat-stream-user-eager',
          });
        }

        // -----------------------------------------------------------------
        // AGENT MODE: multi-turn tool-calling loop
        // -----------------------------------------------------------------
        // Activated only when: (a) caller opts in via agentMode=true,
        // (b) provider supports reliable function calling (not Perplexity),
        // (c) at least one tool is registered (or the caller passed an
        // explicit enabledTools allow-list with registered entries).
        // The agent loop yields the same OpenAI-compatible SSE stream the
        // frontend already parses, plus extra `_meta`, `_tool`, and
        // `_error` events for transparency.
        const canRunAgent =
          agentMode &&
          supportsReportQATools(modelAssignment) &&
          agentLoopHasTools(enabledTools);

        if (canRunAgent) {
          const agentConfig = buildOpenAICompatibleChatConfig(modelAssignment, {
            lovable: LOVABLE_API_KEY,
            openai: OPENAI_API_KEY,
            perplexity: PERPLEXITY_API_KEY,
            openrouter: OPENROUTER_API_KEY,
          });

          const structuredCitationsAgent = buildStructuredCitations(retrievedChunksForCitations);
          const agentStreamId = streamId;

          // Best-effort checkpoint so dropped streams are diagnosable.
          try {
            await supabase.from('report_qa_stream_checkpoints').insert({
              stream_id: agentStreamId,
              conversation_id: conversationId || null,
              user_id: userId || null,
              model_provider: modelProvider,
              comparison_mode: comparisonMode,
              citations: structuredCitationsAgent,
              status: 'streaming',
            });
          } catch (cpErr) {
            console.warn('[report-qa] agent checkpoint insert failed (non-fatal):', cpErr);
          }

          const agentStream = runAgentLoop({
            provider: agentConfig.provider,
            apiKey: agentConfig.apiKey,
            endpoint: agentConfig.endpoint,
            extraHeaders: agentConfig.extraHeaders,
            model: modelVersion,
            messages,
            maxCompletionTokensField: agentConfig.maxField,
            maxCompletionTokens: agentConfig.maxTokens,
            enabledTools,
            toolContext: {
              supabase,
              userId: userId || null,
              conversationId: conversationId || null,
              reportContents,
              reportNames,
            },
            leadingMetaEvent: {
              _meta: {
                stream_id: agentStreamId,
                comparisonMode,
                citations: structuredCitationsAgent,
                modelProvider,
                modelAgentKey: modelProvider,
                modelVersion,
                modelRoute,
                agentMode: true,
                tools_available: listTools().map((t) => t.name),
              },
            },
            onComplete: async ({ toolInvocations, turns, finalText }) => {
              console.log(
                `[report-qa] Agent loop complete: ${turns} turn(s), ${toolInvocations.length} tool invocation(s)`,
              );
              try {
                await persistReportQATurn(supabase, {
                  conversationId,
                  userId,
                  question,
                  assistantText: finalText,
                  modelProvider,
                  modelVersion,
                  citations: structuredCitationsAgent,
                  comparisonMode,
                  promptVersion: PROMPT_VERSION,
                  toolInvocations,
                  streamId: agentStreamId,
                  fallbackAssistantText: '⚠️ Agent completed but text could not be captured. Please retry.',
                  source: 'agent-stream',
                  persistUser: false,
                });
              } catch (persistErr) {
                console.error('[report-qa] Failed to persist agent messages:', persistErr);
              }
              try {
                await supabase
                  .from('report_qa_stream_checkpoints')
                  .update({
                    status: 'completed',
                    last_event_at: new Date().toISOString(),
                  })
                  .eq('stream_id', agentStreamId);
              } catch {
                /* non-fatal */
              }
            },
          });

          return new Response(agentStream, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/event-stream',
              'x-stream-id': agentStreamId,
              'x-agent-mode': 'true',
            },
          });
        }

        // -----------------------------------------------------------------
        // Non-agent streaming path — route through live Model Hub assignment
        // with assignment fallback_chain support instead of hardcoded models.
        // -----------------------------------------------------------------
        let response: Response | null = null;
        let streamModelName = modelVersion;
        let streamRoute = modelRoute;
        let streamServiceName = modelFamilyServiceName(modelVersion, modelRoute);
        let lastFailureStatus = 500;
        let lastFailureText = '';

        for (const attempt of reportQAModelChain(modelAssignment)) {
          const config = buildOpenAICompatibleChatConfig(attempt, {
            lovable: LOVABLE_API_KEY,
            openai: OPENAI_API_KEY,
            perplexity: PERPLEXITY_API_KEY,
            openrouter: OPENROUTER_API_KEY,
          });
          console.log(`[report-qa] Streaming via ${attempt.agent_key}: ${attempt.route}/${attempt.model_id}`);

          const candidate = await fetchUpstreamWithRetry(config.endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
              ...(config.extraHeaders ?? {}),
            },
            body: JSON.stringify(buildChatCompletionBody(attempt, messages, true, config)),
          }, { label: `${attempt.route}:${attempt.model_id}-stream` });

          if (candidate.ok) {
            response = candidate;
            streamModelName = attempt.model_id;
            streamRoute = attempt.route;
            streamServiceName = config.serviceName;
            break;
          }

          lastFailureStatus = candidate.status;
          lastFailureText = await candidate.text();
          console.error(`[report-qa] Chat error (${attempt.route}/${attempt.model_id}): ${candidate.status} - ${lastFailureText}`);

          if (candidate.status === 429) {
            return new Response(
              JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
              { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          if (candidate.status === 402) {
            return new Response(
              JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
              { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          if (!REPORT_QA_RETRYABLE_STATUSES.has(candidate.status)) break;
        }

        if (!response) {
          throw new Error(`AI API error: ${lastFailureStatus}${lastFailureText ? ` - ${lastFailureText.slice(0, 500)}` : ''}`);
        }

        // Intercept the stream to capture token usage from the final SSE chunk
        const sbLogStream = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        
        const trackedStream = createUsageTrackingStream(response.body!, {
          supabase: sbLogStream,
          serviceName: streamServiceName,
          modelUsed: streamModelName,
          userId: userId || undefined,
          metadata: { function: 'report-qa', action: 'chat', modelProvider, modelVersion: streamModelName, modelRoute: streamRoute },
        });

        // Prepend a metadata SSE event so the client can render paragraph-level
        // citations and the comparison-mode badge without waiting for the answer.
        const structuredCitations = buildStructuredCitations(retrievedChunksForCitations);
        const metaPayload = {
          _meta: {
            stream_id: streamId,
            comparisonMode,
            citations: structuredCitations,
            modelProvider,
            modelAgentKey: modelProvider,
            modelVersion: streamModelName,
            modelRoute: streamRoute,
          },
        };
        const metaLine = `data: ${JSON.stringify(metaPayload)}\n\n`;

        // Create a checkpoint row up-front so a dropped stream can be diagnosed.
        try {
          await supabase.from('report_qa_stream_checkpoints').insert({
            stream_id: streamId,
            conversation_id: conversationId || null,
            user_id: userId || null,
            model_provider: modelProvider,
            comparison_mode: comparisonMode,
            citations: structuredCitations,
            status: 'streaming',
          });
        } catch (cpErr) {
          console.warn('[report-qa] Failed to create stream checkpoint (non-fatal):', cpErr);
        }

        const composedStream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const decoder = new TextDecoder();
            controller.enqueue(encoder.encode(metaLine));
            const reader = trackedStream.getReader();
            // Capture assistant content as it streams so we can generate
            // contextual follow-up suggestions once the answer completes.
            let assistantText = '';
            let parseBuf = '';
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(value);
                try {
                  parseBuf += decoder.decode(value, { stream: true });
                  let nl: number;
                  while ((nl = parseBuf.indexOf('\n')) !== -1) {
                    const line = parseBuf.slice(0, nl).replace(/\r$/, '');
                    parseBuf = parseBuf.slice(nl + 1);
                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6).trim();
                    if (!payload || payload === '[DONE]') continue;
                    try {
                      const j = JSON.parse(payload);
                      // Try multiple SSE shapes so persistence survives when
                      // the upstream provider returns non-OpenAI delta formats
                      // (Anthropic/Gemini via gateway, Responses API, etc).
                      const candidates: unknown[] = [
                        j?.choices?.[0]?.delta?.content,
                        j?.choices?.[0]?.message?.content,
                        j?.delta?.content,
                        j?.delta?.text,
                        j?.output_text,
                        j?.content,
                        j?.text,
                      ];
                      for (const c of candidates) {
                        if (typeof c === 'string' && c.length > 0) { assistantText += c; break; }
                        if (Array.isArray(c)) {
                          for (const part of c) {
                            const pt = typeof part === 'string' ? part : (part?.text ?? part?.content);
                            if (typeof pt === 'string') assistantText += pt;
                          }
                          break;
                        }
                      }
                    } catch { /* partial json — ignore */ }
                  }
                } catch { /* peek is best-effort */ }
              }
            } catch (err) {
              console.error('[report-qa] Stream pipe error:', err);
            } finally {
              try {
                await persistReportQATurn(supabase, {
                  conversationId,
                  userId,
                  question,
                  assistantText,
                  modelProvider,
                  modelVersion: streamModelName,
                  citations: structuredCitations,
                  comparisonMode,
                  promptVersion: PROMPT_VERSION,
                  streamId,
                  fallbackAssistantText: '⚠️ Response completed but text could not be captured. Please retry.',
                  source: 'chat-stream',
                  persistUser: false,
                });
              } catch (persistErr) {
                console.error('[report-qa] Failed to persist stream messages:', persistErr);
              }

              // Phase 2.4 — generate 3 AI follow-up suggestions and emit as
              // a `_followups` SSE event. Best-effort: any failure is logged
              // and swallowed so it never blocks closing the stream.
              try {
                if (assistantText && assistantText.length > 40 && LOVABLE_API_KEY) {
                  const reportLine = Array.isArray(reportNames) && reportNames.length
                    ? `Reports: ${reportNames.slice(0, 5).join(', ')}`
                    : 'No reports attached.';
                  const fuResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${LOVABLE_API_KEY}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      model: 'google/gemini-2.5-flash',
                      max_tokens: 220,
                      messages: [
                        {
                          role: 'system',
                          content:
                            'You generate exactly 3 short, specific, distinct follow-up questions an Australian property advisor would naturally ask next, based on the user\'s question and the assistant\'s answer. Each question must be ≤90 chars, end with "?", and reference a concrete topic from the answer (numbers, suburbs, risks, scenarios). Respond ONLY with a JSON array of 3 strings — no prose, no markdown.',
                        },
                        {
                          role: 'user',
                          content: `${reportLine}\n\nUser asked: ${String(question || '').slice(0, 600)}\n\nAssistant answered:\n${assistantText.slice(0, 4000)}\n\nReturn the JSON array now.`,
                        },
                      ],
                    }),
                  });
                  if (fuResp.ok) {
                    const fuData = await fuResp.json();
                    const raw = fuData?.choices?.[0]?.message?.content || '';
                    const match = raw.match(/\[[\s\S]*\]/);
                    if (match) {
                      const arr = JSON.parse(match[0]);
                      if (Array.isArray(arr)) {
                        const cleaned = arr
                          .map((s: any) => (typeof s === 'string' ? s.trim() : ''))
                          .filter((s: string) => s.length > 0 && s.length <= 140)
                          .slice(0, 3);
                        if (cleaned.length > 0) {
                          controller.enqueue(
                            encoder.encode(`data: ${JSON.stringify({ _followups: cleaned })}\n\n`),
                          );
                        }
                      }
                    }
                  } else {
                    console.warn('[report-qa] Follow-up gen HTTP', fuResp.status);
                  }
                }
              } catch (fuErr) {
                console.warn('[report-qa] Follow-up generation failed (non-fatal):', fuErr);
              }

              // Phase 3.3 — extract durable client memories (fire-and-forget).
              if (conversationClientId && assistantText && assistantText.length > 60 && LOVABLE_API_KEY) {
                extractAndStoreClientMemory({
                  supabase,
                  clientId: conversationClientId,
                  conversationId: conversationId || null,
                  userId: userId || null,
                  question: String(question || ''),
                  answer: assistantText,
                  lovableApiKey: LOVABLE_API_KEY,
                }).catch(e => console.warn('[report-qa] client memory extract failed:', e));
              }
              controller.close();
              // Best-effort: mark checkpoint complete
              supabase.from('report_qa_stream_checkpoints')
                .update({ status: 'completed', last_event_at: new Date().toISOString() })
                .eq('stream_id', streamId)
                .then(() => {});
            }
          },
        });

        // Return the tracked streaming response
        return new Response(composedStream, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "x-stream-id": streamId,
          },
        });
      }
      
      // Non-streaming mode — route through live Model Hub assignment.
      let response: Response | null = null;
      let citations: string[] = [];
      let chatModelName = modelVersion;
      let chatRoute = modelRoute;
      let chatServiceName = modelFamilyServiceName(modelVersion, modelRoute);
      let lastFailureStatus = 500;
      let lastFailureText = '';

      for (const attempt of reportQAModelChain(modelAssignment)) {
        const config = buildOpenAICompatibleChatConfig(attempt, {
          lovable: LOVABLE_API_KEY,
          openai: OPENAI_API_KEY,
          perplexity: PERPLEXITY_API_KEY,
          openrouter: OPENROUTER_API_KEY,
        });
        console.log(`[report-qa] Non-stream via ${attempt.agent_key}: ${attempt.route}/${attempt.model_id}`);

        const candidate = await fetchUpstreamWithRetry(config.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            ...(config.extraHeaders ?? {}),
          },
          body: JSON.stringify(buildChatCompletionBody(attempt, messages, false, config)),
        }, { label: `${attempt.route}:${attempt.model_id}-nonstream` });

        if (candidate.ok) {
          response = candidate;
          chatModelName = attempt.model_id;
          chatRoute = attempt.route;
          chatServiceName = config.serviceName;
          break;
        }

        lastFailureStatus = candidate.status;
        lastFailureText = await candidate.text();
        console.error(`[report-qa] Chat error (${attempt.route}/${attempt.model_id}): ${candidate.status} - ${lastFailureText}`);

        if (candidate.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (candidate.status === 402) {
          return new Response(
            JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (!REPORT_QA_RETRYABLE_STATUSES.has(candidate.status)) break;
      }

      if (!response) {
        throw new Error(`AI API error: ${lastFailureStatus}${lastFailureText ? ` - ${lastFailureText.slice(0, 500)}` : ''}`);
      }

      const aiResponse = await response.json();
      console.log(`[report-qa] AI Response structure (${modelProvider}/${chatModelName}):`, JSON.stringify(aiResponse, null, 2));
      
      // Extract citations from Perplexity response
      if (chatServiceName === 'perplexity' && aiResponse.citations) {
        citations = aiResponse.citations;
        console.log(`[report-qa] Perplexity citations: ${citations.length}`);
      }
      
      // GPT-5 may return content in different paths
      let responseText = 
        aiResponse.choices?.[0]?.message?.content ||
        aiResponse.choices?.[0]?.text ||
        aiResponse.content ||
        aiResponse.message?.content ||
        "";
      
      if (!responseText || responseText.trim() === "") {
        console.error(`[report-qa] Empty response from AI. Full response:`, JSON.stringify(aiResponse));
        responseText = "I couldn't generate a response. Please try again.";
      }

      // Log chat API usage (non-streaming)
      const chatUsage = extractOpenAIUsage(aiResponse);
      const sbLogChat = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      await logApiUsage(sbLogChat, {
        service_name: chatServiceName,
        endpoint: '/v1/chat/completions',
        model_used: chatModelName,
        prompt_tokens: chatUsage.prompt_tokens,
        completion_tokens: chatUsage.completion_tokens,
        tokens_used: chatUsage.total_tokens,
        status: 'success',
        metadata: { function: 'report-qa', action: 'chat', streaming: false, modelProvider, modelVersion: chatModelName, modelRoute: chatRoute },
      });

      // Build structured paragraph-level citations (non-streaming path)
      const structuredCitationsNS = buildStructuredCitations(retrievedChunksForCitations);

      // Save messages to database if conversationId provided
      if (conversationId) {
        await persistReportQATurn(supabase, {
          conversationId,
          userId,
          question,
          assistantText: responseText,
          modelProvider,
          modelVersion: chatModelName,
          citations: structuredCitationsNS,
          comparisonMode,
          promptVersion: PROMPT_VERSION,
          fallbackAssistantText: "I couldn't generate a response. Please try again.",
          source: 'chat-nonstream',
        });

        // Check if this is the first message and generate a dynamic title
        const { count } = await supabase
          .from("report_qa_messages")
          .select("*", { count: "exact", head: true })
          .eq("conversation_id", conversationId);

        // Generate dynamic title after first exchange (2 messages = user + assistant)
        if (count && count <= 2) {
          console.log(`[report-qa] First exchange detected, generating dynamic title...`);
          
          try {
            const titleResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  {
                    role: "system",
                    content: `Generate a short, descriptive title (max 6 words) for a property investment Q&A conversation. The title should capture the main topic being discussed. Return ONLY the title text, no quotes or punctuation at the end.`,
                  },
                  {
                    role: "user",
                    content: `User question: "${question}"\n\nAI response (first 200 chars): "${responseText.substring(0, 200)}..."`,
                  },
                ],
                max_tokens: 50,
              }),
            });

            if (titleResponse.ok) {
              const titleData = await titleResponse.json();
              const generatedTitle = (titleData.choices?.[0]?.message?.content || "").trim().replace(/['"]+/g, '');
              
              if (generatedTitle && generatedTitle.length > 0 && generatedTitle.length <= 60) {
                await supabase
                  .from("report_qa_conversations")
                  .update({ title: generatedTitle })
                  .eq("id", conversationId);
                
                console.log(`[report-qa] Updated conversation title to: ${generatedTitle}`);
              }
            }
          } catch (titleError) {
            console.error(`[report-qa] Failed to generate dynamic title:`, titleError);
            // Continue without failing - title generation is non-critical
          }
        }
      }

      console.log(`[report-qa] Generated response (${modelProvider}): ${responseText.length} characters`);

      return new Response(
        JSON.stringify({ 
          response: responseText,
          ragUsed: ragContext.length > 0,
          modelProvider,
          modelAgentKey: modelProvider,
          modelVersion: chatModelName,
          modelRoute: chatRoute,
          comparisonMode,
          citations: citations.length > 0 ? citations : undefined,
          structuredCitations: structuredCitationsNS.length > 0 ? structuredCitationsNS : undefined,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle conversation creation
    if (action === "create-conversation") {
      const { reportNames, reportContents, title } = body;
      
      // Sanitize all text content to remove null bytes (PostgreSQL error 22P05)
      const sanitizedContents = sanitizeArray(reportContents);
      const sanitizedNames = sanitizeArray(reportNames);
      const sanitizedTitle = sanitizeForPostgres(title || `Q&A: ${sanitizedNames.join(", ")}`);

      const { data, error } = await supabase
        .from("report_qa_conversations")
        .insert({
          // Never rely on a browser-supplied owner or a database default: the
          // authenticated actor is the authoritative conversation owner.
          created_by: userId,
          report_names: sanitizedNames,
          report_contents: sanitizedContents,
          title: sanitizedTitle,
        })
        .select()
        .single();

      if (error) throw error;

      console.log(`[report-qa] Created conversation: ${data.id}`);

      return new Response(
        JSON.stringify({ success: true, conversation: data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle report indexing for RAG - chunks reports, generates embeddings + summary
    if (action === "index-reports") {
      const { conversationId } = body;
      
      if (!conversationId) {
        return new Response(
          JSON.stringify({ error: "conversationId is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!OPENAI_API_KEY) {
        console.log('[report-qa] index-reports: OPENAI_API_KEY not configured, skipping');
        return new Response(
          JSON.stringify({ success: true, indexed: false, reason: 'OPENAI_API_KEY not configured' }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Load the conversation to get report contents
      const { data: conv, error: convError } = await supabase
        .from("report_qa_conversations")
        .select("report_contents, report_names, structured_report")
        .eq("id", conversationId)
        .single();

      if (convError) throw convError;

      // Check if already indexed (has structured_report)
      if (conv.structured_report && conv.structured_report.length > 100) {
        // Check if chunks exist too
        const { count } = await supabase
          .from("document_chunks")
          .select("*", { count: 'exact', head: true })
          .eq("conversation_id", conversationId);
        
        if (count && count > 0) {
          console.log(`[report-qa] Conversation ${conversationId} already indexed (${count} chunks, summary exists)`);
          return new Response(
            JSON.stringify({ success: true, indexed: true, alreadyIndexed: true, chunksCount: count }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const reportContents = conv.report_contents || [];
      const reportNames = conv.report_names || [];

      if (reportContents.length === 0) {
        console.log(`[report-qa] No report contents to index for conversation ${conversationId}`);
        return new Response(
          JSON.stringify({ success: true, indexed: false, reason: 'No report contents' }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[report-qa] Indexing ${reportContents.length} reports for conversation ${conversationId}`);

      // Step 1: Delete existing chunks for this conversation
      await supabase
        .from("document_chunks")
        .delete()
        .eq("conversation_id", conversationId);

      // Step 2: Chunk and embed each report
      let totalChunks = 0;
      for (let i = 0; i < reportContents.length; i++) {
        const content = reportContents[i];
        const name = reportNames[i] || `Report ${i + 1}`;
        
        if (!content || content.length < 50) continue;
        
        const chunks = chunkText(content, 1500, 200); // Larger chunks for better context
        console.log(`[report-qa] Report "${name}": ${chunks.length} chunks from ${content.length} chars`);

        const metrics = extractReportMetrics(content);
        let suburb: string | null = null;
        if (metrics.address) {
          const parts = metrics.address.split(',').map(p => p.trim());
          if (parts.length >= 2) suburb = parts[1] || null;
        }
        const chunkMeta = {
          suburb,
          state: metrics.state ?? null,
          postcode: metrics.postcode ?? null,
          report_type: null,
        };

        await storeDocumentChunks(supabase, `report:${name}`, chunks, OPENAI_API_KEY, conversationId, chunkMeta);
        totalChunks += chunks.length;
      }

      // Step 3: Generate structural summary using AI
      let summary = '';
      try {
        const allContent = reportContents.map((c: string, i: number) => 
          `--- ${reportNames[i] || `Report ${i + 1}`} ---\n${c.substring(0, 50000)}`
        ).join('\n\n');

        const summaryResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `You are a property investment report analyst. Create a comprehensive structural summary of the provided investment report(s). This summary will be used as context for a Q&A system.

Include ALL of these elements:
1. **Property Overview**: Address, type, price, land/building size, bedrooms/bathrooms
2. **Financial Summary**: Purchase price, estimated rental yield, gross/net yield, cash flow projections, stamp duty, LMI
3. **Market Data**: Suburb median prices, growth rates, days on market, vacancy rates, rental demand
4. **Demographics**: Population, age distribution, household composition, income levels
5. **Infrastructure & Location**: Transport, schools, amenities, planned developments
6. **Risk Assessment**: Key risks identified, flood/fire zones, market risks
7. **Investment Metrics**: Capital growth projections, depreciation estimates, tax benefits
8. **Comparison Points** (if multiple reports): Side-by-side key metrics

Be thorough and include ALL specific numbers, percentages, and data points mentioned in the reports. This summary needs to capture the full analytical picture.`,
              },
              {
                role: "user",
                content: `Summarize these investment report(s):\n\n${allContent}`,
              },
            ],
            max_tokens: 8000,
          }),
        });

        if (summaryResponse.ok) {
          const summaryData = await summaryResponse.json();
          summary = summaryData.choices?.[0]?.message?.content || '';
          console.log(`[report-qa] Generated summary: ${summary.length} chars`);

          // Log summary generation usage
          const summaryUsage = extractOpenAIUsage(summaryData);
          await logApiUsage(supabase, {
            service_name: 'gemini',
            endpoint: '/v1/chat/completions',
            model_used: 'gemini-2.5-flash',
            prompt_tokens: summaryUsage.prompt_tokens,
            completion_tokens: summaryUsage.completion_tokens,
            tokens_used: summaryUsage.total_tokens,
            status: 'success',
            metadata: { function: 'report-qa', action: 'index-reports-summary' },
          });
        } else {
          console.error(`[report-qa] Summary generation failed: ${summaryResponse.status}`);
        }
      } catch (summaryError) {
        console.error(`[report-qa] Summary generation error:`, summaryError);
      }

      // Step 4: Store summary in conversation
      if (summary) {
        await supabase
          .from("report_qa_conversations")
          .update({ structured_report: summary })
          .eq("id", conversationId);
      }

      console.log(`[report-qa] Indexing complete: ${totalChunks} chunks, summary ${summary.length} chars`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          indexed: true, 
          chunksCount: totalChunks, 
          summaryLength: summary.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle fetching conversation history (no limit - return all)
    if (action === "get-conversations") {
      // Fetch only the authenticated actor's own conversations. The service
      // role client bypasses RLS, so this scope is mandatory even for admins;
      // collaborations are returned separately from active share rows below.
      const { data, error } = await supabase
        .from("report_qa_conversations")
        .select("id, title, report_names, created_at, updated_at, structured_report, client_id, agent_mode, branched_from_conversation_id, branched_from_message_id")
        .eq("created_by", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch conversations shared with this user
      let sharedConversations: any[] = [];
      if (userId) {
        const { data: shared } = await supabase
          .from("report_qa_conversation_shares")
          .select("conversation_id, permission, handoff_note, report_qa_conversations(id, title, report_names, created_at, updated_at, structured_report, agent_mode), custom_users!report_qa_conversation_shares_shared_by_fkey(username)")
          .eq("shared_with", userId)
          .eq("is_active", true)
          .order("created_at", { ascending: false });

        sharedConversations = (shared || []).map((s: any) => ({
          ...s.report_qa_conversations,
          shared: true,
          shared_by: s.custom_users?.username || 'Unknown',
          permission: s.permission,
          handoff_note: s.handoff_note,
        }));
      }

      // Legacy conversations: rows created before ownership stamping have
      // created_by IS NULL and would otherwise be invisible to everyone.
      // Superadmins (who already hold admin access to any conversation via
      // resolveReportQaAccess) get them listed, flagged as legacy.
      let legacyConversations: any[] = [];
      if (isSuperadmin) {
        const { data: legacy, error: legacyError } = await supabase
          .from("report_qa_conversations")
          .select("id, title, report_names, created_at, updated_at, structured_report, client_id, agent_mode, branched_from_conversation_id, branched_from_message_id")
          .is("created_by", null)
          .order("created_at", { ascending: false });
        if (legacyError) {
          console.error('[report-qa] get-conversations legacy fetch failed:', legacyError);
        } else {
          legacyConversations = (legacy || []).map((c: any) => ({ ...c, legacy: true }));
        }
      }

      return new Response(
        JSON.stringify({ success: true, conversations: data, shared_conversations: sharedConversations, legacy_conversations: legacyConversations }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle loading a specific conversation
    if (action === "load-conversation") {
      const { conversationId, limit, offset } = body;
      const pageLimit = limit || 50;
      const pageOffset = offset || 0;

      // WP-07 — resolve effective access before touching messages/metadata.
      const access = await resolveReportQaAccess(supabase, { actorId: userId, isSuperadmin, conversationId });
      if (!canRead(access.role) || !access.conversation) return denyResponse();
      const conversation = access.conversation;

      // Get total message count (DB-scoped, not select-all-then-filter)
      const { count: totalCount, error: countError } = await supabase
        .from("report_qa_messages")
        .select("*", { count: 'exact', head: true })
        .eq("conversation_id", conversationId);


      if (countError) throw countError;

      // Fetch paginated messages (most recent first for offset, then reverse)
      const { data: messages, error: msgError } = await supabase
        .from("report_qa_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .range(pageOffset, pageOffset + pageLimit - 1);

      if (msgError) throw msgError;

      return new Response(
        JSON.stringify({ 
          success: true, 
          conversation, 
          messages,
          totalMessages: totalCount || 0,
          hasMore: (pageOffset + pageLimit) < (totalCount || 0),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle updating conversation (e.g., title)
    if (action === "update-conversation") {
      const { conversationId, title, clientId, reportNames, reportContents } = body;

      if (!conversationId) {
        return new Response(
          JSON.stringify({ error: "conversationId is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // WP-07 — owner/admin only for title/client rewiring; collaborate may
      // update report_names/report_contents but not re-link client_id.
      const access = await resolveReportQaAccess(supabase, { actorId: userId, isSuperadmin, conversationId });
      if (!canWrite(access.role)) return denyResponse();
      const isAdminOfConv = canAdminister(access.role);

      const updateData: any = {};
      if (title !== undefined) {
        if (!isAdminOfConv) return denyResponse('Only the owner can rename this conversation');
        updateData.title = title;
      }
      if (reportNames !== undefined) updateData.report_names = Array.isArray(reportNames) ? reportNames : [];
      if (reportContents !== undefined) updateData.report_contents = Array.isArray(reportContents) ? reportContents : [];
      if (clientId !== undefined) {
        if (!isAdminOfConv) return denyResponse('Only the owner can re-link the client');
        updateData.client_id = clientId || null;
      }

      const reportSetChanged = reportNames !== undefined || reportContents !== undefined;
      if (reportSetChanged) {
        // Chunks and the structural summary are derived from the complete report
        // set. Remove the chunks before publishing the new set, then clear the
        // summary in the same update so removed report data cannot remain in RAG.
        const { error: chunkDeleteError } = await supabase
          .from("document_chunks")
          .delete()
          .eq("conversation_id", conversationId);

        if (chunkDeleteError) throw chunkDeleteError;
        updateData.structured_report = null;
      }

      updateData.updated_at = new Date().toISOString();


      const { data, error } = await supabase
        .from("report_qa_conversations")
        .update(updateData)
        .eq("id", conversationId)
        .select()
        .single();

      if (error) throw error;

      console.log(`[report-qa] Updated conversation: ${conversationId}`);

      return new Response(
        JSON.stringify({ success: true, conversation: data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle summarize-conversation: AI processes raw chat into structured report
    if (action === "summarize-conversation") {
      const { messages: chatMessages, reportNames, title } = body;
      
      if (!chatMessages || chatMessages.length === 0) {
        return new Response(
          JSON.stringify({ error: "No messages provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[report-qa] Summarizing conversation: ${chatMessages.length} messages`);

      const transcript = chatMessages.map((m: any) => {
        const role = m.role === 'user' ? 'Advisor' : 'AI Analyst';
        return `**${role}:**\n${m.content}`;
      }).join('\n\n---\n\n');

      const _brandSum = await getBrandConfig();
      const summarizePrompt = `You are a professional report writer for ${_brandSum.companyName}, an Australian property investment advisory firm.

You have been given a raw Q&A conversation transcript between a property advisor and an AI analyst about investment property reports. Your task is to transform this raw conversation into a polished, structured analytical report suitable for client presentation.

## INSTRUCTIONS
1. Extract ALL key insights, findings, data points, and recommendations from the conversation
2. Organize them into a professional report structure
3. Remove conversational artifacts (greetings, "thank you", repetition, back-and-forth)
4. Preserve ALL numerical data, statistics, and specific details mentioned
5. Write in a professional third-person analytical tone
6. Use proper markdown formatting with headings, bullet points, and tables where appropriate

## REQUIRED REPORT STRUCTURE
Use the following sections (skip any that have no relevant content):

# ${title || 'Investment Analysis Report'}

## Executive Summary
A concise 2-3 paragraph overview of the key findings and recommendations.

## Property Overview
Key details about the property/properties discussed.

## Financial Analysis
Any financial metrics, yields, cash flow projections, costs discussed.

## Market & Location Insights
Demographics, infrastructure, growth drivers, market trends.

## Risk Assessment
Identified risks, concerns, and mitigation strategies.

## Opportunities & Strengths
Positive factors and investment opportunities identified.

## Recommendations
Actionable recommendations and next steps.

## Additional Notes
Any other relevant information from the conversation.

---
*Reports analyzed: ${(reportNames || []).join(', ') || 'N/A'}*
*Generated: ${new Date().toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' })}*
*Prepared by: ${_brandSum.companyName}*

## RAW CONVERSATION TRANSCRIPT
${transcript}`;

      const summarizeMessages = [
        { role: "system", content: "You are an expert report writer. Transform raw conversations into polished, structured reports. Output only the final markdown report, no preamble." },
        { role: "user", content: summarizePrompt },
      ];

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5.2",
          messages: summarizeMessages,
          max_completion_tokens: 8192,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[report-qa] Summarize error: ${response.status} - ${errorText}`);
        
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        throw new Error(`AI API error: ${response.status}`);
      }

      const aiResponse = await response.json();
      const structuredReport = aiResponse.choices?.[0]?.message?.content || "";

      console.log(`[report-qa] Generated structured report: ${structuredReport.length} chars`);

      return new Response(
        JSON.stringify({ success: true, structuredReport }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle deleting conversation
    if (action === "delete-conversation") {
      const { conversationId } = body;

      if (!conversationId) {
        return new Response(
          JSON.stringify({ error: "conversationId is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // WP-07 — owner/admin only.
      const access = await resolveReportQaAccess(supabase, { actorId: userId, isSuperadmin, conversationId });
      if (!canAdminister(access.role)) return denyResponse();



      // Delete messages first (foreign key constraint)
      await supabase
        .from("report_qa_messages")
        .delete()
        .eq("conversation_id", conversationId);

      // Delete the conversation
      const { error } = await supabase
        .from("report_qa_conversations")
        .delete()
        .eq("id", conversationId);

      if (error) throw error;

      console.log(`[report-qa] Deleted conversation: ${conversationId}`);

      return new Response(
        JSON.stringify({ success: true, deleted: conversationId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle sharing a conversation
    if (action === "share-conversation") {
      const { conversationId, targetUserId, permission, handoffNote } = body;
      if (!conversationId || !targetUserId) {
        return new Response(
          JSON.stringify({ error: "conversationId and targetUserId are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (targetUserId === userId) {
        return new Response(
          JSON.stringify({ error: "Cannot share with yourself" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // WP-07 — only owner/admin can (re)share; sharees cannot expand access.
      const shareAccess = await resolveReportQaAccess(supabase, { actorId: userId, isSuperadmin, conversationId });
      if (!canAdminister(shareAccess.role)) return denyResponse('Only the owner can share this conversation');

      const { error: shareError } = await supabase

        .from("report_qa_conversation_shares")
        .insert({
          conversation_id: conversationId,
          shared_by: userId,
          shared_with: targetUserId,
          permission: permission || 'view',
          handoff_note: handoffNote || null,
        });
      if (shareError) throw shareError;

      // Get sharer's name and conversation title for notification
      const { data: sharerData } = await supabase.from('custom_users').select('username').eq('id', userId).limit(1);
      const { data: convData } = await supabase.from('report_qa_conversations').select('title').eq('id', conversationId).limit(1);
      const sharerName = sharerData?.[0]?.username || 'A team member';
      const convTitle = convData?.[0]?.title || 'Untitled Q&A';
      const noteText = handoffNote ? ` — "${handoffNote}"` : '';
      await supabase.from('notifications').insert({
        type: 'qa_conversation_shared',
        title: 'Q&A Session Shared With You',
        message: `${sharerName} shared "${convTitle}" with you${noteText}`,
        entity_id: conversationId,
        read: false,
      });

      console.log(`[report-qa] Shared conversation ${conversationId} with user ${targetUserId}`);
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // List active shares on a conversation (owner/admin only) so the share
    // dialog can show who already has access and allow revocation.
    if (action === "get-shares") {
      const { conversationId: sharesConvId } = body;
      const { data: shares, error: sharesError } = await supabase
        .from("report_qa_conversation_shares")
        .select("shared_with, permission, handoff_note, created_at, custom_users!report_qa_conversation_shares_shared_with_fkey(username)")
        .eq("conversation_id", sharesConvId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (sharesError) throw sharesError;
      const mapped = (shares || []).map((s: any) => ({
        shared_with: s.shared_with,
        username: s.custom_users?.username || 'Unknown',
        permission: s.permission,
        handoff_note: s.handoff_note,
        created_at: s.created_at,
      }));
      return new Response(
        JSON.stringify({ success: true, shares: mapped }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle revoking a share
    if (action === "revoke-share") {
      const { conversationId: convId, targetUserId: revokeUserId } = body;
      if (!convId || !revokeUserId) {
        return new Response(JSON.stringify({ error: "conversationId and targetUserId are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // WP-07 — only owner/admin can revoke.
      const revokeAccess = await resolveReportQaAccess(supabase, { actorId: userId, isSuperadmin, conversationId: convId });
      if (!canAdminister(revokeAccess.role)) return denyResponse('Only the owner can revoke shares');

      const { error: revokeError } = await supabase
        .from("report_qa_conversation_shares")
        .update({ is_active: false })
        .eq("conversation_id", convId)
        .eq("shared_with", revokeUserId);
      if (revokeError) throw revokeError;

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Phase 5.1 — Answer quality feedback (thumbs up/down + optional reason)
    if (action === "submit-feedback") {
      const { messageId, conversationId: feedbackConvId, rating, reason } = body;
      if (!messageId || !feedbackConvId || ![1, -1].includes(rating)) {
        return new Response(
          JSON.stringify({ error: "messageId, conversationId, rating(±1) required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { error: fbErr } = await supabase
        .from("report_qa_message_feedback")
        .upsert({
          message_id: messageId,
          conversation_id: feedbackConvId,
          user_id: userId,
          rating,
          reason: reason || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "message_id,user_id" });
      if (fbErr) throw fbErr;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get-feedback") {
      const { conversationId: fbConvId } = body;
      if (!fbConvId) {
        return new Response(JSON.stringify({ error: "conversationId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase
        .from("report_qa_message_feedback")
        .select("message_id, rating, reason")
        .eq("conversation_id", fbConvId)
        .eq("user_id", userId);
      if (error) throw error;
      return new Response(JSON.stringify({ feedback: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phase 5.5 — Pin individual answers
    if (action === "toggle-pin-message") {
      const { messageId, pinned } = body;
      if (!messageId || typeof pinned !== "boolean") {
        return new Response(JSON.stringify({ error: "messageId + pinned bool required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await supabase
        .from("report_qa_messages")
        .update({ pinned })
        .eq("id", messageId);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, pinned }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phase 4.5 — Per-answer shareable links
    // WP-07 — public share links are 128-bit random tokens; we store only a
    // sha256 hash + 8-char prefix + expiry, never the plaintext.
    if (action === "generate-share-link") {
      const { messageId, ttlDays } = body;
      if (!messageId) {
        return new Response(JSON.stringify({ error: "messageId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Resolve the parent conversation and authorize.
      const { data: msgRow } = await supabase
        .from("report_qa_messages")
        .select("id, conversation_id")
        .eq("id", messageId)
        .maybeSingle();
      if (!msgRow) return denyResponse('Message not found');
      const linkAccess = await resolveReportQaAccess(supabase, {
        actorId: userId, isSuperadmin, conversationId: msgRow.conversation_id,
      });
      if (!canAdminister(linkAccess.role)) return denyResponse('Only the owner can create share links');

      // 32-byte random → base64url (256 bits of entropy).
      const raw = new Uint8Array(32);
      crypto.getRandomValues(raw);
      const token = btoa(String.fromCharCode(...raw))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const prefix = token.slice(0, 8);

      const enc = new TextEncoder();
      const digest = await crypto.subtle.digest('SHA-256', enc.encode(token));
      const hash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0')).join('');

      const days = Math.min(Math.max(Number(ttlDays) || 30, 1), 90);
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      const { error: updErr } = await supabase
        .from("report_qa_messages")
        .update({
          share_token: null,
          share_token_hash: hash,
          share_token_prefix: prefix,
          share_expires_at: expiresAt,
          share_revoked_at: null,
        })
        .eq("id", messageId);
      if (updErr) throw updErr;

      return new Response(JSON.stringify({ shareToken: token, expiresAt }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "revoke-share-link") {
      const { messageId } = body;
      if (!messageId) {
        return new Response(JSON.stringify({ error: "messageId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: msgRow } = await supabase
        .from("report_qa_messages")
        .select("id, conversation_id")
        .eq("id", messageId)
        .maybeSingle();
      if (!msgRow) return denyResponse('Message not found');
      const revokeLinkAccess = await resolveReportQaAccess(supabase, {
        actorId: userId, isSuperadmin, conversationId: msgRow.conversation_id,
      });
      if (!canAdminister(revokeLinkAccess.role)) return denyResponse('Only the owner can revoke share links');

      const { error } = await supabase
        .from("report_qa_messages")
        .update({
          share_token: null,
          share_token_hash: null,
          share_token_prefix: null,
          share_revoked_at: new Date().toISOString(),
        })
        .eq("id", messageId);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Phase 5.4 — Branch a conversation from a specific message.
    // Copies all messages up to and including `branchFromMessageId` into a
    // brand-new conversation row so the user can explore an alternative path
    // without polluting the original thread.
    if (action === "branch-conversation") {
      const { sourceConversationId, branchFromMessageId, newTitle } = body;
      if (!sourceConversationId || !branchFromMessageId) {
        return new Response(
          JSON.stringify({ error: "sourceConversationId and branchFromMessageId required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Load source conversation
      const { data: srcConv, error: srcErr } = await supabase
        .from("report_qa_conversations")
        .select("*")
        .eq("id", sourceConversationId)
        .maybeSingle();
      if (srcErr || !srcConv) throw srcErr || new Error("Source conversation not found");

      // Find the branch point's created_at to capture messages up to it
      const { data: branchMsg, error: bErr } = await supabase
        .from("report_qa_messages")
        .select("created_at")
        .eq("id", branchFromMessageId)
        .maybeSingle();
      if (bErr || !branchMsg) throw bErr || new Error("Branch message not found");

      // Create new conversation with provenance
      const { data: newConv, error: newConvErr } = await supabase
        .from("report_qa_conversations")
        .insert({
          created_by: userId,
          title: newTitle || `${srcConv.title || "Q&A"} — branch`,
          report_names: srcConv.report_names || [],
          client_id: srcConv.client_id || null,
          structured_report: srcConv.structured_report || null,
          branched_from_conversation_id: sourceConversationId,
          branched_from_message_id: branchFromMessageId,
        })
        .select("id")
        .single();
      if (newConvErr) throw newConvErr;

      // Copy messages up to and including the branch point
      const { data: msgs, error: msgsErr } = await supabase
        .from("report_qa_messages")
        .select("role, content, model_provider, citations, comparison_mode, tool_invocations, attachments, prompt_version, model_version")
        .eq("conversation_id", sourceConversationId)
        .lte("created_at", branchMsg.created_at)
        .order("created_at", { ascending: true });
      if (msgsErr) throw msgsErr;

      if (msgs && msgs.length > 0) {
        const rows = msgs.map(m => ({ ...m, conversation_id: newConv.id }));
        const { error: copyErr } = await supabase.from("report_qa_messages").insert(rows);
        if (copyErr) throw copyErr;
      }

      return new Response(JSON.stringify({ success: true, conversationId: newConv.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phase 4.5 — Public shared-answer lookup (no auth — token-gated).
    if (action === "get-shared-answer") {
      const { shareToken } = body;
      if (!shareToken) {
        return new Response(JSON.stringify({ error: "shareToken required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const sbPub = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data, error } = await sbPub.rpc("get_shared_qa_answer", { _share_token: shareToken });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        return new Response(JSON.stringify({ error: "Not found or revoked" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ answer: row }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get-team-members") {
      const { data: members, error: membersError } = await supabase
        .from("custom_users")
        .select("id, username, email, role")
        .eq("is_active", true)
        .order("username");
      if (membersError) throw membersError;
      // Filter out current user
      const filtered = (members || []).filter((m: any) => m.id !== userId);
      return new Response(
        JSON.stringify({ success: true, team_members: filtered }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "get-mailboxes") {
      if (!userId) {
        return new Response(
          JSON.stringify({ success: false, error: "Authentication required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Only return the current session user's own mailbox — never other tenant users.
      const { data, error } = await supabase
        .from("custom_users")
        .select("id, username, personal_mailbox")
        .eq("id", userId)
        .eq("is_active", true)
        .not("personal_mailbox", "is", null);

      if (error) throw error;

      const mailboxes = (data || []).filter((u: any) => u.personal_mailbox);
      console.log(`[report-qa] Fetched ${mailboxes.length} mailbox(es) for user ${userId}`);

      return new Response(
        JSON.stringify({ success: true, mailboxes }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    // Handle email sending
    if (action === "send-email") {
      const { to, subject, content, reportNames } = body;

      if (!RESEND_API_KEY) {
        throw new Error("RESEND_API_KEY is not configured");
      }

      if (typeof to !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
        return new Response(JSON.stringify({ success: false, error: 'A valid recipient is required.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Recipient-domain allowlist (DLP). When EMAIL_RECIPIENT_ALLOWLIST is set
      // (comma-separated domains), the recipient must be within it. Unset = allow.
      const allowlistRaw = (Deno.env.get('EMAIL_RECIPIENT_ALLOWLIST') || '').trim();
      if (allowlistRaw) {
        const allowedDomains = allowlistRaw.toLowerCase().split(',').map((d) => d.trim().replace(/^@/, '')).filter(Boolean);
        const domain = (to.split('@')[1] || '').toLowerCase().trim();
        if (!allowedDomains.includes(domain)) {
          return new Response(JSON.stringify({ success: false, error: 'Recipient is outside the permitted domains.' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Per-sender send-rate quota so a compromised session can't blast email.
      if (userId && userId !== 'service_role') {
        const quota = await consumeRateLimit(supabase, `report-qa:send-email:${userId}`, 60, 60 * 60);
        if (!quota.allowed) {
          return new Response(JSON.stringify({ success: false, error: 'Send rate limit reached. Please try again later.' }), {
            status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const resend = new Resend(RESEND_API_KEY);

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #1a365d; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9fafb; }
            .footer { padding: 15px; text-align: center; font-size: 12px; color: #666; border-top: 1px solid #e5e7eb; }
            pre { white-space: pre-wrap; word-wrap: break-word; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Investment Report Summary</h1>
              ${reportNames?.length ? `<p>Reports: ${reportNames.join(", ")}</p>` : ""}
            </div>
            <div class="content">
              <pre>${content}</pre>
            </div>
            <div class="footer">
              <p>${(await getBrandConfig()).companyName}</p>
              <p>Phone: ${(await getBrandConfig()).contactPhone || ''} | Email: ${(await getBrandConfig()).contactEmail}</p>
              <p>Website: ${(await getBrandConfig()).contactWebsite || ''}</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const _brand = await getBrandConfig();
      const emailResponse = await resend.emails.send({
        from: _brand.fromHeaderAdmin,
        to: [to],
        subject: subject || "Investment Report Summary",
        html: htmlContent,
      });

      console.log(`[report-qa] Email sent to: ${to}`);

      return new Response(
        JSON.stringify({ success: true, emailResponse }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle PDF export (basic)
    if (action === "export-pdf") {
      const { content, reportName } = body;
      console.log(`[report-qa] Generating PDF for: ${reportName}`);

      const cleanContent = content.replace(/[^\x00-\x7F]/g, "");
      const timestamp = new Date().toLocaleString();
      
      const pdfContent = `
%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${cleanContent.length + 200} >>
stream
BT
/F1 16 Tf
50 750 Td
(Report Summary) Tj
/F1 10 Tf
0 -30 Td
(Generated: ${timestamp}) Tj
0 -20 Td
(Source: ${reportName || 'Investment Report'}) Tj
0 -30 Td
/F1 11 Tf
${cleanContent.split('\n').slice(0, 50).map((line: string, i: number) => `0 -14 Td (${line.replace(/[()\\]/g, '\\$&').substring(0, 80)}) Tj`).join('\n')}
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${cleanContent.length + 500}
%%EOF`;

      const base64Pdf = btoa(pdfContent);
      
      return new Response(
        JSON.stringify({
          success: true,
          pdfDataUrl: `data:application/pdf;base64,${base64Pdf}`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle generate PDF and store to bucket for chat integration
    if (action === "generate-qa-pdf") {
      const { conversationId, messages, reportNames, title } = body;
      console.log(`[report-qa] Generating QA PDF for conversation: ${conversationId}`);

      if (!conversationId || !messages || messages.length === 0) {
        throw new Error("Missing required parameters: conversationId and messages");
      }

      // WP-07 — must have read access to export a PDF for this conversation.
      const pdfAccess = await resolveReportQaAccess(supabase, {
        actorId: userId, isSuperadmin, conversationId,
      });
      if (!canRead(pdfAccess.role)) return denyResponse();



      // Fetch active QA export template from database
      const { data: activeTemplate, error: templateError } = await supabase
        .from('report_structure_templates')
        .select('*')
        .eq('template_type', 'qa_export')
        .eq('is_active', true)
        .single();

      let templatePdfBytes: Uint8Array | null = null;
      
      if (activeTemplate && !templateError) {
        console.log(`[report-qa] Using active template: ${activeTemplate.name}`);
        
        // Download template PDF from storage
        const { data: templateData, error: downloadError } = await supabase.storage
          .from('report-templates')
          .download(activeTemplate.file_path);
          
        if (templateData && !downloadError) {
          templatePdfBytes = new Uint8Array(await templateData.arrayBuffer());
          console.log(`[report-qa] Template loaded: ${templatePdfBytes.length} bytes`);
        } else {
          console.warn(`[report-qa] Failed to download template: ${downloadError?.message}`);
        }
      } else {
        console.log('[report-qa] No active template found, using default styling');
      }

      // Create PDF document
      let pdfDoc: PDFDocument;
      let startContentPage = 0;
      
      // NPC default colors
      const primaryColor = rgb(0.07, 0.2, 0.38); // Dark blue
      const accentColor = rgb(0.89, 0.71, 0.31); // Gold
      const textColor = rgb(0.2, 0.2, 0.2);
      const lightGray = rgb(0.95, 0.95, 0.95);
      
      if (templatePdfBytes) {
        // Load template PDF and use first page as cover
        const templateDoc = await PDFDocument.load(templatePdfBytes);
        pdfDoc = await PDFDocument.create();
        
        // Copy first page from template as cover
        const [coverPage] = await pdfDoc.copyPages(templateDoc, [0]);
        pdfDoc.addPage(coverPage);
        startContentPage = 1;
        
        console.log('[report-qa] Cover page copied from template');
      } else {
        // Create new PDF with default cover
        pdfDoc = await PDFDocument.create();
        
        // Create default cover page
        const coverPage = pdfDoc.addPage([612, 792]);
        const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
        
        // Background header
        coverPage.drawRectangle({
          x: 0,
          y: 692,
          width: 612,
          height: 100,
          color: primaryColor,
        });
        
        // Gold accent line
        coverPage.drawRectangle({
          x: 0,
          y: 688,
          width: 612,
          height: 4,
          color: accentColor,
        });
        
        // Title
        coverPage.drawText('Q&A Conversation Export', {
          x: 50,
          y: 725,
          size: 24,
          font: helveticaBold,
          color: rgb(1, 1, 1),
        });
        
        // Report info
        coverPage.drawText(title || 'Investment Report Analysis', {
          x: 50,
          y: 620,
          size: 18,
          font: helveticaBold,
          color: primaryColor,
        });
        
        if (reportNames?.length) {
          coverPage.drawText(`Reports: ${reportNames.join(', ')}`, {
            x: 50,
            y: 590,
            size: 12,
            font: helvetica,
            color: textColor,
          });
        }
        
        coverPage.drawText(`Generated: ${new Date().toLocaleString('en-AU', { 
          dateStyle: 'full', 
          timeStyle: 'short' 
        })}`, {
          x: 50,
          y: 560,
          size: 11,
          font: helvetica,
          color: textColor,
        });
        
        // Footer
        coverPage.drawRectangle({
          x: 0,
          y: 0,
          width: 612,
          height: 60,
          color: lightGray,
        });
        
        const _brandPdf1 = await getBrandConfig();
        coverPage.drawText(_brandPdf1.companyName, {
          x: 50,
          y: 35,
          size: 10,
          font: helveticaBold,
          color: primaryColor,
        });
        
        coverPage.drawText(`${_brandPdf1.contactEmail}${_brandPdf1.contactPhone ? ' | ' + _brandPdf1.contactPhone : ''}`, {
          x: 50,
          y: 20,
          size: 9,
          font: helvetica,
          color: textColor,
        });
        
        startContentPage = 1;
      }

      // Embed fonts for content pages
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

      // Page dimensions and margins (matching template layout)
      const pageWidth = 612;
      const pageHeight = 792;
      const marginLeft = 50;
      const marginRight = 50;
      const marginTop = 60;
      const marginBottom = 80;
      const contentWidth = pageWidth - marginLeft - marginRight;
      
      // Helper function to wrap text
      const wrapText = (text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] => {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = '';
        
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const width = font.widthOfTextAtSize(testLine, fontSize);
          
          if (width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        
        if (currentLine) {
          lines.push(currentLine);
        }
        
        return lines;
      };

      // Pre-fetch brand for footer (used inside createContentPage closure)
      const _brandPdfFooter = await getBrandConfig();

      // Helper function to create a content page with header/footer
      const createContentPage = (pageNum: number): PDFPage => {
        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        
        // Header bar
        page.drawRectangle({
          x: 0,
          y: pageHeight - 45,
          width: pageWidth,
          height: 45,
          color: primaryColor,
        });
        
        // Gold accent
        page.drawRectangle({
          x: 0,
          y: pageHeight - 48,
          width: pageWidth,
          height: 3,
          color: accentColor,
        });
        
        // Header text
        page.drawText('Q&A Conversation Export', {
          x: marginLeft,
          y: pageHeight - 30,
          size: 12,
          font: helveticaBold,
          color: rgb(1, 1, 1),
        });
        
        // Footer line
        page.drawLine({
          start: { x: marginLeft, y: marginBottom - 10 },
          end: { x: pageWidth - marginRight, y: marginBottom - 10 },
          thickness: 1,
          color: lightGray,
        });
        
        // Page number
        page.drawText(`Page ${pageNum}`, {
          x: pageWidth - marginRight - 40,
          y: 30,
          size: 9,
          font: helvetica,
          color: textColor,
        });
        
        // Footer text
        page.drawText(`${_brandPdfFooter.companyName}${_brandPdfFooter.contactEmail ? ' | ' + _brandPdfFooter.contactEmail : ''}`, {
          x: marginLeft,
          y: 30,
          size: 8,
          font: helvetica,
          color: textColor,
        });
        
        return page;
      };

      // Parse markdown-style formatting
      const parseFormatting = (text: string): Array<{text: string; bold: boolean; italic: boolean}> => {
        const segments: Array<{text: string; bold: boolean; italic: boolean}> = [];
        
        // Simple parsing for **bold** and *italic*
        let remaining = text;
        
        while (remaining.length > 0) {
          // Check for bold (**text**)
          const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
          if (boldMatch) {
            segments.push({ text: boldMatch[1], bold: true, italic: false });
            remaining = remaining.slice(boldMatch[0].length);
            continue;
          }
          
          // Check for italic (*text*)
          const italicMatch = remaining.match(/^\*(.+?)\*/);
          if (italicMatch) {
            segments.push({ text: italicMatch[1], bold: false, italic: true });
            remaining = remaining.slice(italicMatch[0].length);
            continue;
          }
          
          // Find next formatting marker
          const nextBold = remaining.indexOf('**');
          const nextItalic = remaining.indexOf('*');
          const nextMarker = Math.min(
            nextBold === -1 ? Infinity : nextBold,
            nextItalic === -1 ? Infinity : nextItalic
          );
          
          if (nextMarker === Infinity) {
            segments.push({ text: remaining, bold: false, italic: false });
            break;
          } else if (nextMarker > 0) {
            segments.push({ text: remaining.slice(0, nextMarker), bold: false, italic: false });
            remaining = remaining.slice(nextMarker);
          } else {
            // Edge case: marker at start but no closing marker
            segments.push({ text: remaining.charAt(0), bold: false, italic: false });
            remaining = remaining.slice(1);
          }
        }
        
        return segments;
      };

      // Process messages and create content pages
      let currentPage = createContentPage(1);
      let pageCount = 1;
      let yPosition = pageHeight - marginTop - 50;
      const lineHeight = 14;
      const paragraphSpacing = 20;

      for (const msg of messages as Array<{ role: string; content: string; timestamp?: string }>) {
        const isUser = msg.role === 'user';
        const roleLabel = isUser ? 'You' : 'Assistant';
        const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-AU', { 
          hour: '2-digit', 
          minute: '2-digit' 
        }) : '';
        
        // Check if we need a new page for the header
        if (yPosition < marginBottom + 100) {
          pageCount++;
          currentPage = createContentPage(pageCount);
          yPosition = pageHeight - marginTop - 50;
        }
        
        // Draw role header with colored background
        const headerBgColor = isUser ? rgb(0.93, 0.95, 0.98) : rgb(0.95, 0.98, 0.95);
        currentPage.drawRectangle({
          x: marginLeft - 5,
          y: yPosition - 5,
          width: contentWidth + 10,
          height: 22,
          color: headerBgColor,
        });
        
        // Role label
        currentPage.drawText(roleLabel, {
          x: marginLeft,
          y: yPosition,
          size: 11,
          font: helveticaBold,
          color: isUser ? rgb(0.2, 0.4, 0.6) : rgb(0.2, 0.5, 0.3),
        });
        
        // Timestamp
        if (timestamp) {
          const labelWidth = helveticaBold.widthOfTextAtSize(roleLabel, 11);
          currentPage.drawText(`  ${timestamp}`, {
            x: marginLeft + labelWidth + 5,
            y: yPosition,
            size: 9,
            font: helvetica,
            color: rgb(0.5, 0.5, 0.5),
          });
        }
        
        yPosition -= lineHeight + 10;
        
        // Process message content by lines
        const contentLines = msg.content.split('\n');
        
        for (const line of contentLines) {
          // Skip empty lines but add spacing
          if (!line.trim()) {
            yPosition -= lineHeight / 2;
            continue;
          }
          
          // Check for headers (## or ###)
          let font = helvetica;
          let fontSize = 10;
          let lineColor = textColor;
          let indent = 0;
          let processedLine = line;
          
          if (line.startsWith('### ')) {
            font = helveticaBold;
            fontSize = 11;
            processedLine = line.slice(4);
            lineColor = primaryColor;
          } else if (line.startsWith('## ')) {
            font = helveticaBold;
            fontSize = 12;
            processedLine = line.slice(3);
            lineColor = primaryColor;
          } else if (line.startsWith('# ')) {
            font = helveticaBold;
            fontSize = 14;
            processedLine = line.slice(2);
            lineColor = primaryColor;
          } else if (line.startsWith('- ') || line.startsWith('• ')) {
            // Bullet point
            processedLine = line.slice(2);
            indent = 15;
            
            // Check if we need new page
            if (yPosition < marginBottom + lineHeight) {
              pageCount++;
              currentPage = createContentPage(pageCount);
              yPosition = pageHeight - marginTop - 50;
            }
            
            // Draw bullet
            currentPage.drawText('•', {
              x: marginLeft,
              y: yPosition,
              size: 10,
              font: helvetica,
              color: accentColor,
            });
          } else if (line.match(/^\d+\. /)) {
            // Numbered list
            const match = line.match(/^(\d+)\. (.*)$/);
            if (match) {
              indent = 20;
              
              // Check if we need new page
              if (yPosition < marginBottom + lineHeight) {
                pageCount++;
                currentPage = createContentPage(pageCount);
                yPosition = pageHeight - marginTop - 50;
              }
              
              // Draw number
              currentPage.drawText(`${match[1]}.`, {
                x: marginLeft,
                y: yPosition,
                size: 10,
                font: helveticaBold,
                color: accentColor,
              });
              
              processedLine = match[2];
            }
          }
          
          // Wrap and draw text
          const wrappedLines = wrapText(processedLine, font, fontSize, contentWidth - indent);
          
          for (const wrappedLine of wrappedLines) {
            // Check if we need a new page
            if (yPosition < marginBottom + lineHeight) {
              pageCount++;
              currentPage = createContentPage(pageCount);
              yPosition = pageHeight - marginTop - 50;
            }
            
            // Parse and draw formatted text
            const segments = parseFormatting(wrappedLine);
            let xPos = marginLeft + indent;
            
            for (const segment of segments) {
              const segmentFont = segment.bold ? helveticaBold : 
                                  segment.italic ? helveticaOblique : font;
              
              currentPage.drawText(segment.text, {
                x: xPos,
                y: yPosition,
                size: fontSize,
                font: segmentFont,
                color: lineColor,
              });
              
              xPos += segmentFont.widthOfTextAtSize(segment.text, fontSize);
            }
            
            yPosition -= lineHeight;
          }
        }
        
        // Add spacing between messages
        yPosition -= paragraphSpacing;
      }

      // Add final page with disclaimer
      if (yPosition > marginBottom + 100) {
        // Add disclaimer on current page
        yPosition -= 30;
        currentPage.drawLine({
          start: { x: marginLeft, y: yPosition },
          end: { x: pageWidth - marginRight, y: yPosition },
          thickness: 1,
          color: lightGray,
        });
        
        yPosition -= 20;
        
        currentPage.drawText('Disclaimer', {
          x: marginLeft,
          y: yPosition,
          size: 10,
          font: helveticaBold,
          color: textColor,
        });
        
        yPosition -= 15;
        
        const disclaimer = 'This document is generated from an AI-powered conversation and is intended for informational purposes only. The analysis provided should not be considered as financial advice. Please consult with qualified professionals before making any investment decisions.';
        const disclaimerLines = wrapText(disclaimer, helvetica, 8, contentWidth);
        
        for (const line of disclaimerLines) {
          currentPage.drawText(line, {
            x: marginLeft,
            y: yPosition,
            size: 8,
            font: helvetica,
            color: rgb(0.5, 0.5, 0.5),
          });
          yPosition -= 10;
        }
      }

      // Save PDF
      const pdfBytes = await pdfDoc.save();
      const fileName = `qa-export-${conversationId}-${Date.now()}.pdf`;
      
      console.log(`[report-qa] PDF generated: ${pdfBytes.length} bytes, ${pageCount + 1} pages`);
      
      // Upload to qa_exports bucket
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('qa_exports')
        .upload(fileName, pdfBytes, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (uploadError) {
        console.error('[report-qa] Upload error:', uploadError);
        throw new Error(`Failed to upload PDF: ${uploadError.message}`);
      }

      // WP-06 Phase B — bind the export object to the conversation owner so
      // future reads authorize through storage_object_bindings.
      // (WP-07 fix: report_qa_conversations owner column is `created_by`.)
      const { data: convRow } = await supabase
        .from('report_qa_conversations')
        .select('created_by, client_id')
        .eq('id', conversationId)
        .maybeSingle();
      // Bindings are immutable security metadata: this new random object path
      // must be inserted once, never upserted/rebound by a later request.
      const { error: qaBindErr } = await supabase.from('storage_object_bindings').insert({
        bucket: 'qa_exports',
        object_path: fileName,
        resource_type: 'qa_export',
        resource_id: conversationId,
        client_id: convRow?.client_id ?? null,
        owner_user_id: convRow?.created_by ?? userId ?? null,
        sensitivity: 'sensitive',
        created_by: convRow?.created_by ?? userId ?? null,
      });

      if (qaBindErr) {
        await supabase.storage.from('qa_exports').remove([fileName]).catch(() => {});
        throw new Error(`Failed to bind PDF object: ${qaBindErr.message}`);
      }

      // STOR-004: qa_exports is private — store a short-lived SIGNED URL plus the
      // object path (so the frontend can re-sign via secure-storage), not a
      // permanent public URL.
      const { data: signedData } = await supabase.storage
        .from('qa_exports')
        .createSignedUrl(fileName, 60 * 60 * 24 * 7); // 7 days
      const fileUrl = signedData?.signedUrl || '';
      console.log(`[report-qa] PDF uploaded (signed): ${fileName}`);

      // Create attachment object
      const attachment = {
        url: fileUrl,
        storagePath: fileName,
        storageBucket: 'qa_exports',
        fileName: fileName,
        fileSize: pdfBytes.length,
        createdAt: new Date().toISOString(),
        conversationId: conversationId,
      };

      // Store the message with attachment in the conversation
      const { data: msgData, error: msgError } = await supabase
        .from('report_qa_messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: `📄 I've generated a PDF summary of our conversation using ${activeTemplate ? `the "${activeTemplate.name}" template` : 'default styling'}. You can download it or send it via email using the options below.`,
          attachments: [attachment],
        })
        .select()
        .single();

      if (msgError) {
        console.error('[report-qa] Message insert error:', msgError);
        // Don't fail - PDF was still generated
      }

      return new Response(
        JSON.stringify({
          success: true,
          attachment,
          messageId: msgData?.id || null,
          templateUsed: activeTemplate?.name || 'Default',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle knowledge base stats
    if (action === "get-knowledge-stats") {
      const { conversationId } = body;
      
      let query = supabase
        .from('document_chunks')
        .select('document_name, chunk_index', { count: 'exact' });
      
      if (conversationId) {
        query = query.eq('conversation_id', conversationId);
      }
      
      const { data, count, error } = await query;
      
      if (error) throw error;
      
      // Group by document
      const documents = data?.reduce((acc: any, chunk: any) => {
        if (!acc[chunk.document_name]) {
          acc[chunk.document_name] = 0;
        }
        acc[chunk.document_name]++;
        return acc;
      }, {}) || {};
      
      return new Response(
        JSON.stringify({
          success: true,
          totalChunks: count || 0,
          documents: Object.entries(documents).map(([name, chunks]) => ({ name, chunks })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[report-qa] Error:", error);
    return new Response(
      JSON.stringify(internalError(error, 'report-qa')),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
