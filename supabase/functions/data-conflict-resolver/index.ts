import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface DataSource {
  name: string;
  value: any;
  confidence: number; // 0.0 - 1.0
  timestamp: string;
  dataType: string;
}

interface ConflictResolutionResult {
  resolvedValue: any;
  selectedSource: string;
  confidence: number;
  conflictDetected: boolean;
  alternativeValues: Array<{
    source: string;
    value: any;
    confidence: number;
    reason: string;
  }>;
  resolutionMethod: 'highest_confidence' | 'most_recent' | 'average' | 'median' | 'manual_review';
  recommendation?: string;
}

// Data source priority hierarchy
const SOURCE_PRIORITIES: Record<string, number> = {
  // Tier 1: Official government sources (highest priority)
  'abs': 10,           // Australian Bureau of Statistics
  'rba': 10,          // Reserve Bank of Australia
  'domain_api': 9,    // Domain (live API)
  
  // Tier 2: Reliable third-party APIs
  'google_maps': 8,
  'realestate_api': 8,
  
  // Tier 3: Calculated values (formula-based)
  'calculated': 7,
  
  // Tier 4: Cached data (still reliable but older)
  'cached': 6,
  
  // Tier 5: Aggregated/scraped data
  'openagent': 5,
  'property_dot_com': 5,
  
  // Tier 6: Estimated/inferred data (lowest priority)
  'estimated': 3,
  'inferred': 2,
  'fallback': 1
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('Data conflict resolver invoked with method:', req.method);
  
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
    const { dataSources, dataType, field } = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[data-conflict-resolver] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[data-conflict-resolver] Authenticated user: ${userId}`);
    
    if (!dataSources || !Array.isArray(dataSources) || dataSources.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'Data sources array is required',
        success: false 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Resolving conflicts for ${field} (${dataType}) with ${dataSources.length} sources`);
    
    const resolution = resolveDataConflict(dataSources, dataType, field);
    
    return new Response(JSON.stringify({ 
      success: true, 
      data: resolution 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in data conflict resolver:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to resolve data conflict';
    return new Response(JSON.stringify({ 
      error: errorMessage,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function resolveDataConflict(
  sources: DataSource[],
  dataType: string,
  field: string
): ConflictResolutionResult {
  
  // Remove null/undefined sources
  const validSources = sources.filter(s => s.value !== null && s.value !== undefined);
  
  if (validSources.length === 0) {
    return {
      resolvedValue: null,
      selectedSource: 'none',
      confidence: 0,
      conflictDetected: false,
      alternativeValues: [],
      resolutionMethod: 'manual_review',
      recommendation: 'No valid data sources available'
    };
  }
  
  // Single source - no conflict
  if (validSources.length === 1) {
    return {
      resolvedValue: validSources[0].value,
      selectedSource: validSources[0].name,
      confidence: validSources[0].confidence,
      conflictDetected: false,
      alternativeValues: [],
      resolutionMethod: 'highest_confidence'
    };
  }

  // Check if all values are similar (no real conflict)
  const hasConflict = detectConflict(validSources, dataType);
  
  if (!hasConflict) {
    // Values are similar, use highest confidence source
    const best = selectByConfidence(validSources);
    return {
      resolvedValue: best.value,
      selectedSource: best.name,
      confidence: best.confidence,
      conflictDetected: false,
      alternativeValues: validSources
        .filter(s => s.name !== best.name)
        .map(s => ({
          source: s.name,
          value: s.value,
          confidence: s.confidence,
          reason: 'Similar value, lower confidence'
        })),
      resolutionMethod: 'highest_confidence'
    };
  }

  // Real conflict detected - apply resolution strategy
  console.log(`⚠️ Conflict detected for ${field}: ${validSources.length} different values`);
  
  return applyResolutionStrategy(validSources, dataType, field);
}

function detectConflict(sources: DataSource[], dataType: string): boolean {
  if (sources.length < 2) return false;
  
  const values = sources.map(s => s.value);
  
  switch (dataType) {
    case 'number':
    case 'currency':
    case 'percentage':
      // Check if values differ by more than 10%
      const numValues = values.map(v => parseFloat(v));
      const min = Math.min(...numValues);
      const max = Math.max(...numValues);
      const variance = ((max - min) / min) * 100;
      return variance > 10; // Conflict if >10% difference
      
    case 'date':
      // Check if dates differ by more than 30 days
      const dates = values.map(v => new Date(v).getTime());
      const dateMin = Math.min(...dates);
      const dateMax = Math.max(...dates);
      const daysDiff = (dateMax - dateMin) / (1000 * 60 * 60 * 24);
      return daysDiff > 30;
      
    case 'text':
    case 'string':
      // Check if strings are substantially different (not just casing)
      const normalized = values.map(v => String(v).toLowerCase().trim());
      const unique = new Set(normalized);
      return unique.size > 1;
      
    default:
      // For unknown types, check strict equality
      const uniqueValues = new Set(values.map(v => JSON.stringify(v)));
      return uniqueValues.size > 1;
  }
}

function applyResolutionStrategy(
  sources: DataSource[],
  dataType: string,
  field: string
): ConflictResolutionResult {
  
  // Strategy 1: Priority-based selection (best for categorical/text data)
  if (dataType === 'text' || dataType === 'string' || dataType === 'category') {
    return resolveByPriority(sources, dataType);
  }
  
  // Strategy 2: Confidence-weighted average (best for numeric data)
  if (dataType === 'number' || dataType === 'currency' || dataType === 'percentage') {
    return resolveByWeightedAverage(sources, dataType);
  }
  
  // Strategy 3: Most recent (best for time-sensitive data)
  if (dataType === 'date' || field.includes('timestamp') || field.includes('updated')) {
    return resolveByRecency(sources);
  }
  
  // Default: highest confidence
  return resolveByConfidence(sources, dataType);
}

function resolveByPriority(sources: DataSource[], dataType: string): ConflictResolutionResult {
  // Sort by priority (from SOURCE_PRIORITIES) then confidence
  const sorted = [...sources].sort((a, b) => {
    const priorityA = SOURCE_PRIORITIES[a.name.toLowerCase()] || 0;
    const priorityB = SOURCE_PRIORITIES[b.name.toLowerCase()] || 0;
    
    if (priorityA !== priorityB) {
      return priorityB - priorityA; // Higher priority first
    }
    
    return b.confidence - a.confidence; // Higher confidence first
  });
  
  const selected = sorted[0];
  
  return {
    resolvedValue: selected.value,
    selectedSource: selected.name,
    confidence: selected.confidence,
    conflictDetected: true,
    alternativeValues: sorted.slice(1).map(s => ({
      source: s.name,
      value: s.value,
      confidence: s.confidence,
      reason: `Lower priority source (priority: ${SOURCE_PRIORITIES[s.name.toLowerCase()] || 0})`
    })),
    resolutionMethod: 'highest_confidence',
    recommendation: sorted.length > 2 
      ? `Consider verifying with additional sources. ${sorted.length} conflicting values found.`
      : undefined
  };
}

function resolveByWeightedAverage(sources: DataSource[], dataType: string): ConflictResolutionResult {
  const numericSources = sources.filter(s => !isNaN(parseFloat(s.value)));
  
  if (numericSources.length === 0) {
    return resolveByConfidence(sources, dataType);
  }
  
  // Calculate confidence-weighted average
  const totalWeight = numericSources.reduce((sum, s) => sum + s.confidence, 0);
  const weightedSum = numericSources.reduce((sum, s) => {
    return sum + (parseFloat(s.value) * s.confidence);
  }, 0);
  
  const weightedAverage = weightedSum / totalWeight;
  const avgConfidence = totalWeight / numericSources.length;
  
  // Find source closest to weighted average
  const closest = numericSources.reduce((best, curr) => {
    const currDiff = Math.abs(parseFloat(curr.value) - weightedAverage);
    const bestDiff = Math.abs(parseFloat(best.value) - weightedAverage);
    return currDiff < bestDiff ? curr : best;
  });
  
  return {
    resolvedValue: dataType === 'currency' 
      ? Math.round(weightedAverage) 
      : Math.round(weightedAverage * 100) / 100,
    selectedSource: 'weighted_average',
    confidence: avgConfidence,
    conflictDetected: true,
    alternativeValues: numericSources.map(s => ({
      source: s.name,
      value: parseFloat(s.value),
      confidence: s.confidence,
      reason: `Differs by ${Math.abs(parseFloat(s.value) - weightedAverage).toFixed(0)} from weighted average`
    })),
    resolutionMethod: 'average',
    recommendation: `Using confidence-weighted average of ${numericSources.length} sources. Closest match: ${closest.name}`
  };
}

function resolveByRecency(sources: DataSource[]): ConflictResolutionResult {
  const sorted = [...sources].sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
  
  const selected = sorted[0];
  
  return {
    resolvedValue: selected.value,
    selectedSource: selected.name,
    confidence: selected.confidence,
    conflictDetected: true,
    alternativeValues: sorted.slice(1).map(s => ({
      source: s.name,
      value: s.value,
      confidence: s.confidence,
      reason: `Older data (${new Date(s.timestamp).toLocaleDateString('en-AU')})`
    })),
    resolutionMethod: 'most_recent',
    recommendation: sorted.length > 1 
      ? `Using most recent data from ${new Date(selected.timestamp).toLocaleDateString('en-AU')}`
      : undefined
  };
}

function resolveByConfidence(sources: DataSource[], dataType: string): ConflictResolutionResult {
  const selected = selectByConfidence(sources);
  
  return {
    resolvedValue: selected.value,
    selectedSource: selected.name,
    confidence: selected.confidence,
    conflictDetected: true,
    alternativeValues: sources
      .filter(s => s.name !== selected.name)
      .sort((a, b) => b.confidence - a.confidence)
      .map(s => ({
        source: s.name,
        value: s.value,
        confidence: s.confidence,
        reason: `Lower confidence (${(s.confidence * 100).toFixed(0)}% vs ${(selected.confidence * 100).toFixed(0)}%)`
      })),
    resolutionMethod: 'highest_confidence',
    recommendation: sources.filter(s => s.confidence > 0.8).length < 2
      ? 'Low confidence across sources. Manual verification recommended.'
      : undefined
  };
}

function selectByConfidence(sources: DataSource[]): DataSource {
  return sources.reduce((best, curr) => {
    // If confidence is same, prefer higher priority source
    if (curr.confidence === best.confidence) {
      const currPriority = SOURCE_PRIORITIES[curr.name.toLowerCase()] || 0;
      const bestPriority = SOURCE_PRIORITIES[best.name.toLowerCase()] || 0;
      return currPriority > bestPriority ? curr : best;
    }
    return curr.confidence > best.confidence ? curr : best;
  });
}
