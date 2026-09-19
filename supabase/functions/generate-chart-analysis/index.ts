import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage, extractOpenAIUsage } from '../_shared/logApiUsage.ts';
import { callLLMRaw } from '../_shared/llmRouter.ts';
import { withReportMetering, resolveUserId, buildIdempotencyKey } from '../_shared/reportMetering.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface ChartAnalysisRequest {
  chartId: string;
  chartData: {
    title: string;
    type: string;
    data: any;
    config?: any;
  };
  reportContext?: {
    title: string;
    description?: string;
    listingCount: number;
    dateRange?: string;
    geography?: string;
    marketConditions?: string;
  };
}

interface ProcessedChartData {
  summary: string;
  keyMetrics: string[];
  patterns: string[];
  outliers: string[];
  dataQuality: string;
}

// Process chart data to extract meaningful insights
function processChartData(chartData: any): ProcessedChartData {
  const { data, type, title } = chartData;
  
  if (!data || !Array.isArray(data)) {
    return {
      summary: 'Limited data available for analysis',
      keyMetrics: [],
      patterns: [],
      outliers: [],
      dataQuality: 'Low - insufficient data'
    };
  }

  const keyMetrics: string[] = [];
  const patterns: string[] = [];
  const outliers: string[] = [];
  
  try {
    if (type === 'bar' || type === 'column') {
      // Process bar/column chart data
      const values = data.map(item => {
        const val = item.value || item.count || 0;
        return typeof val === 'number' ? val : parseInt(val) || 0;
      });
      const total = values.reduce((sum, val) => sum + val, 0);
      const max = Math.max(...values);
      const min = Math.min(...values);
      const avg = total / values.length;
      
      keyMetrics.push(`Total: ${total.toLocaleString()}`);
      keyMetrics.push(`Average: ${Math.round(avg).toLocaleString()}`);
      keyMetrics.push(`Range: ${min.toLocaleString()} - ${max.toLocaleString()}`);
      
      // Find top performers
      const sortedData = [...data].sort((a, b) => (b.value || b.count || 0) - (a.value || a.count || 0));
      if (sortedData.length > 0) {
        const topItem = sortedData[0];
        const topValue = topItem.value || topItem.count || 0;
        const topPercentage = total > 0 ? (topValue / total * 100).toFixed(1) : '0';
        patterns.push(`${topItem.name || topItem.label} leads with ${topPercentage}% of total`);
      }
      
      // Identify outliers
      values.forEach((value, index) => {
        if (value > avg * 2) {
          outliers.push(`${data[index].name || data[index].label}: significantly above average`);
        }
      });
      
    } else if (type === 'pie' || type === 'doughnut') {
      // Process pie chart data
      const values = data.map(item => {
        const val = item.value || item.count || 0;
        return typeof val === 'number' ? val : parseInt(val) || 0;
      });
      const total = values.reduce((sum, val) => sum + val, 0);
      
      keyMetrics.push(`Total segments: ${data.length}`);
      keyMetrics.push(`Total value: ${total.toLocaleString()}`);
      
      // Calculate percentages and find dominant segments
      data.forEach(item => {
        const value = item.value || item.count || 0;
        const percentage = total > 0 ? (value / total * 100) : 0;
        if (percentage > 25) {
          patterns.push(`${item.name || item.label} dominates at ${percentage.toFixed(1)}%`);
        } else if (percentage < 5 && percentage > 0) {
          patterns.push(`${item.name || item.label} represents small segment at ${percentage.toFixed(1)}%`);
        }
      });
      
    } else if (type === 'line') {
      // Process line chart data with improved structure handling
      let values: number[] = [];
      
      if (data[0] && data[0].data && Array.isArray(data[0].data)) {
        // Handle line chart with nested data structure
        values = data[0].data.map((point: any) => {
          const val = point.y || point.value || 0;
          return typeof val === 'number' ? val : parseInt(val) || 0;
        });
      } else if (data.every(item => item.x !== undefined && item.y !== undefined)) {
        // Handle direct line chart data points
        values = data.map(point => {
          const val = point.y || point.value || 0;
          return typeof val === 'number' ? val : parseInt(val) || 0;
        });
      }
      
      if (values.length > 0) {
        const trend = calculateTrend(values);
        const max = Math.max(...values);
        const min = Math.min(...values);
        const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
        
        keyMetrics.push(`Data points: ${values.length}`);
        keyMetrics.push(`Trend: ${trend.direction} (${trend.strength})`);
        keyMetrics.push(`Range: ${min.toLocaleString()} - ${max.toLocaleString()}`);
        keyMetrics.push(`Average: ${Math.round(avg).toLocaleString()}`);
        
        if (trend.direction === 'increasing') {
          patterns.push('Positive upward trend observed across the time period');
        } else if (trend.direction === 'decreasing') {
          patterns.push('Declining trend identified in the data series');
        } else {
          patterns.push('Stable trend with minimal fluctuation observed');
        }
      }
      
    } else if (type === 'scatter') {
      // Process scatter plot data
      const xValues = data.map(item => item.x || item.volume || 0).filter(val => typeof val === 'number');
      const yValues = data.map(item => item.y || item.price || item.value || 0).filter(val => typeof val === 'number');
      
      if (xValues.length > 0 && yValues.length > 0) {
        const xMax = Math.max(...xValues);
        const xMin = Math.min(...xValues);
        const yMax = Math.max(...yValues);
        const yMin = Math.min(...yValues);
        
        keyMetrics.push(`Data points: ${data.length}`);
        keyMetrics.push(`X-axis range: ${xMin.toLocaleString()} - ${xMax.toLocaleString()}`);
        keyMetrics.push(`Y-axis range: ${yMin.toLocaleString()} - ${yMax.toLocaleString()}`);
        
        // Find outliers in scatter data
        const xAvg = xValues.reduce((sum, val) => sum + val, 0) / xValues.length;
        const yAvg = yValues.reduce((sum, val) => sum + val, 0) / yValues.length;
        
        data.forEach(item => {
          const x = item.x || item.volume || 0;
          const y = item.y || item.price || item.value || 0;
          if (x > xAvg * 2 || y > yAvg * 2) {
            const label = item.label || item.suburb || 'data point';
            outliers.push(`${label}: exceptional values detected`);
          }
        });
        
        patterns.push('Scatter distribution shows relationship between variables');
      }
    }
    
    // Handle categorical/string data with numeric mapping
    if (keyMetrics.length === 0 && data.some(item => item.category || typeof item.value === 'string')) {
      keyMetrics.push(`Categories analyzed: ${data.length}`);
      
      // Convert string values to insights
      data.forEach(item => {
        if (item.category && item.value) {
          patterns.push(`${item.label}: ${item.category} (Score: ${item.value})`);
        }
      });
    }
    
    const summary = keyMetrics.length > 0 
      ? `Chart contains ${data.length} data points with ${keyMetrics.length} key metrics identified`
      : `Chart contains ${data.length} data elements ready for qualitative analysis`;
    
    return {
      summary,
      keyMetrics,
      patterns,
      outliers,
      dataQuality: data.length > 5 ? 'High' : data.length > 2 ? 'Medium' : 'Low'
    };
    
  } catch (error) {
    console.error('Error processing chart data:', error);
    return {
      summary: 'Error processing chart data',
      keyMetrics: [],
      patterns: [],
      outliers: [],
      dataQuality: 'Low - processing error'
    };
  }
}

// Calculate trend direction for line charts
function calculateTrend(values: number[]) {
  if (values.length < 2) return { direction: 'stable', strength: 'insufficient data' };
  
  const first = values[0];
  const last = values[values.length - 1];
  const change = ((last - first) / first) * 100;
  
  let direction = 'stable';
  let strength = 'weak';
  
  if (Math.abs(change) > 20) strength = 'strong';
  else if (Math.abs(change) > 10) strength = 'moderate';
  
  if (change > 5) direction = 'increasing';
  else if (change < -5) direction = 'decreasing';
  
  return { direction, strength };
}

// Generate chart-type specific system prompts (overridable via engine-prompts catalog)
async function getSystemPrompt(chartType: string): Promise<string> {
  const { resolvePrompt } = await import('../_shared/engine-prompts.ts');
  const base = (await resolvePrompt('chart_analysis.base')).text;
  let specKey = 'chart_analysis.default';
  switch (chartType) {
    case 'bar':
    case 'column':
      specKey = 'chart_analysis.bar'; break;
    case 'pie':
    case 'doughnut':
      specKey = 'chart_analysis.pie'; break;
    case 'line':
      specKey = 'chart_analysis.line'; break;
  }
  const spec = (await resolvePrompt(specKey)).text;
  return `${base} ${spec}`;
}

// Generate enhanced, context-aware analysis prompts
function generateAnalysisPrompt(chartData: any, processedData: ProcessedChartData, reportContext?: any): string {
  const { title, type } = chartData;
  
  const contextSection = reportContext ? `
MARKET CONTEXT:
• Report: ${reportContext.title || 'Property Market Analysis'}
• Description: ${reportContext.description || 'Comprehensive market analysis'}
• Total Listings Analyzed: ${reportContext.listingCount?.toLocaleString() || 'N/A'}
• Geographic Focus: ${reportContext.geography || 'Regional market'}
• Time Period: ${reportContext.dateRange || 'Recent period'}
• Market Conditions: ${reportContext.marketConditions || 'Current market state'}
` : '';

  const dataInsightsSection = `
DATA INSIGHTS:
• Summary: ${processedData.summary}
• Key Metrics: ${processedData.keyMetrics.join(' | ')}
• Identified Patterns: ${processedData.patterns.join(' | ') || 'No clear patterns identified'}
• Notable Outliers: ${processedData.outliers.join(' | ') || 'No significant outliers'}
• Data Quality: ${processedData.dataQuality}
`;

  const chartSpecificGuidance = getChartSpecificGuidance(type);

  return `Analyze this ${type} chart titled "${title}" and provide professional market analysis.

${contextSection}
${dataInsightsSection}

ANALYSIS FRAMEWORK:
${chartSpecificGuidance}

REQUIREMENTS:
• Write medium-density analysis of 120-220 words
• Use this exact structure: Key finding, Evidence, Implication, Consideration
• Base every value and category only on the structured chart data supplied
• Do not invent suburbs, property types, causal explanations, or trends not present in the data
• State a limitation or data-quality consideration when the dataset is sparse, concentrated, or single-period
• Keep the tone concise, commercial, and data-grounded

Provide your analysis now:`;
}

// Get chart-type specific analysis guidance
function getChartSpecificGuidance(chartType: string): string {
  switch (chartType) {
    case 'bar':
    case 'column':
      return `• Identify market leaders and their competitive advantages
• Analyze distribution patterns and market concentration
• Highlight performance gaps and opportunities
• Comment on market share dynamics and competitive positioning`;
    
    case 'pie':
    case 'doughnut':
      return `• Interpret market composition and segment dominance
• Identify emerging or declining property categories
• Assess market diversification and concentration risks
• Highlight niche opportunities or oversaturated segments`;
    
    case 'line':
      return `• Analyze trend direction, momentum, and sustainability
• Identify seasonal patterns or cyclical behavior
• Assess market volatility and stability indicators
• Provide forward-looking insights based on trend analysis`;
    
    default:
      return `• Interpret the data's market implications
• Identify key trends and patterns
• Assess opportunities and risks
• Provide actionable recommendations`;
  }
}

const __chartAnalysisHandler = async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // SECURITY: Verify authentication
    const body = await req.json();
    const { chartId }: ChartAnalysisRequest = body;
    
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[generate-chart-analysis] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[generate-chart-analysis] Authenticated user: ${userId}`);

    const authorization = await requireModulePermission(
      supabase,
      { userId, authMethod },
      'charts',
      'can_edit',
    );
    if (!authorization.ok) {
      return new Response(JSON.stringify({ error: authorization.error, success: false }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The service-role client bypasses RLS, so bind analysis inputs to the
    // authorized target instead of trusting chart content supplied by callers.
    const { data: chart, error: chartError } = await supabase
      .from('charts')
      .select('id, report_id, title, chart_type, dataset, chart_config')
      .eq('id', chartId)
      .maybeSingle();
    if (chartError) throw new Error(`Failed to load chart: ${chartError.message}`);
    if (!chart) {
      return new Response(JSON.stringify({ error: 'Chart not found', success: false }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: report, error: reportError } = await supabase
      .from('generated_reports')
      .select('title, description')
      .eq('id', chart.report_id)
      .maybeSingle();
    if (reportError) throw new Error(`Failed to load chart report: ${reportError.message}`);

    const storedConfig = chart.chart_config && typeof chart.chart_config === 'object'
      ? chart.chart_config as Record<string, unknown>
      : {};
    const storedData = Array.isArray(chart.dataset)
      ? chart.dataset
      : Array.isArray(storedConfig.data)
        ? storedConfig.data
        : [];
    const chartData = {
      title: chart.title,
      type: chart.chart_type,
      data: storedData,
      config: chart.chart_config,
    };
    const reportContext = report
      ? { title: report.title, description: report.description, listingCount: storedData.length }
      : undefined;

    console.log('Generating analysis for chart:', chartId, 'Type:', chartData.type);

    // Process chart data for better analysis
    const processedData = processChartData(chartData);
    
    // Generate chart-type specific prompt
    const prompt = generateAnalysisPrompt(chartData, processedData, reportContext);

    console.log('Generated prompt for analysis');

    // Call OpenAI API with enhanced configuration
    const openAIResponse = await callLLMRaw({
      agentKey: 'chart_analysis',
      // This function already writes its own api_usage_log row for this call;
      // letting the router log it too would bill the tenant twice.
      meterUsage: false,
      messages: [
        { role: 'system', content: await getSystemPrompt(chartData.type) },
        { role: 'user', content: prompt },
      ],
      maxTokens: 520,
      temperature: 0.35,
    });

    if (!openAIResponse.ok) {
      const errorData = await openAIResponse.text();
      console.error('OpenAI API error status:', openAIResponse.status);
      console.error('OpenAI API error body:', errorData);
      throw new Error(`OpenAI API error: ${openAIResponse.status} - ${errorData}`);
    }

    const openAIData = await openAIResponse.json();
    console.log('OpenAI response structure:', JSON.stringify(openAIData, null, 2));

    // Log API usage
    const usage = extractOpenAIUsage(openAIData);
    await logApiUsage(supabase, {
      service_name: 'openai',
      endpoint: '/v1/chat/completions',
      model_used: 'gpt-4o-mini',
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      tokens_used: usage.total_tokens,
      status: 'success',
      user_id: userId || undefined,
      metadata: { function: 'generate-chart-analysis', chartType: chartData.type },
    });
    
    const analysisText = openAIData.choices?.[0]?.message?.content;

    if (!analysisText || analysisText.trim().length === 0) {
      console.error('Empty or missing analysis text from OpenAI');
      console.error('Full OpenAI response:', JSON.stringify(openAIData, null, 2));
      throw new Error('No analysis generated from OpenAI - empty response');
    }

    console.log('Analysis text generated successfully:', analysisText.substring(0, 100) + '...');

    // Store analysis in Supabase
    const { data, error } = await supabase
      .from('chart_analysis')
      .insert({
        chart_id: chartId,
        analysis_text: analysisText,
        model_used: 'gpt-4o-mini',
        confidence_score: 0.85
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      throw new Error(`Failed to store analysis: ${error.message}`);
    }

    const { error: updateError } = await supabase
      .from('charts')
      .update({
        analysis_text: analysisText,
        summary_text: analysisText.split('\n')[0]?.replace(/^Key finding:\s*/i, '').slice(0, 500) || null,
      })
      .eq('id', chartId);
    if (updateError) throw new Error(`Failed to update chart: ${updateError.message}`);

    console.log('Analysis generated and stored successfully');

    return new Response(JSON.stringify({
      success: true,
      analysis: data,
      analysisText
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-chart-analysis function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      error: errorMessage,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};
Deno.serve(withReportMetering(async (body, req) => {
  if (!body) return null;
  const userId = await resolveUserId(req, body);
  if (!userId) return null;
  const idempotencyKey = buildIdempotencyKey('chart-analysis', [
    body?.chartId,
    body?.chartData?.title,
    body?.chartData?.type,
  ]);
  return {
    kind: 'report.chart-analysis' as const,
    userId,
    idempotencyKey,
    estimateOptions: { aiNarrative: true },
    requestPayload: { chartId: body?.chartId, type: body?.chartData?.type },
  };
}, __chartAnalysisHandler));
