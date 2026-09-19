import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface ReportSection {
  id: string;
  title: string;
  content: string;
  order?: number;
}

interface SchemaValidationResult {
  isValid: boolean;
  schemaVersion: string;
  missingSections: string[];
  misorderedSections: string[];
  missingSubsections: Array<{ section: string; subsection: string }>;
  incompleteTables: string[];
  qualityScore: number;
  issues: SchemaIssue[];
}

interface SchemaIssue {
  type: 'missing_section' | 'missing_subsection' | 'missing_table' | 'misordered' | 'insufficient_content' | 'invalid_table';
  severity: 'critical' | 'high' | 'medium' | 'low';
  section?: string;
  subsection?: string;
  message: string;
  recommendation: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('Report schema validator invoked with method:', req.method);
  
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
    const { reportContent } = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[report-schema-validator] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[report-schema-validator] Authenticated user: ${userId}`);
    
    if (!reportContent) {
      return new Response(JSON.stringify({ 
        error: 'Report content is required',
        success: false 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Validating report structure against schema...');
    const validationResult = validateReportSchema(reportContent);
    
    return new Response(JSON.stringify({ 
      success: true, 
      data: validationResult 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in schema validation service:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to validate report schema';
    return new Response(JSON.stringify({ 
      error: errorMessage,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function validateReportSchema(reportContent: string): SchemaValidationResult {
  const issues: SchemaIssue[] = [];
  const missingSections: string[] = [];
  const misorderedSections: string[] = [];
  const missingSubsections: Array<{ section: string; subsection: string }> = [];
  const incompleteTables: string[] = [];

  // Define required sections in expected order
  // NOTE: Data Sources, Market Data Sources, and Methodology sections have been removed
  const requiredSections = [
    { id: 'executive_summary', title: 'Executive Summary', order: 1 },
    { id: 'property_details', title: 'Property Details', order: 2 },
    { id: 'market_analysis', title: 'Market Analysis', order: 3 },
    { id: 'financial_analysis', title: 'Financial Analysis', order: 4 },
    { id: 'location_intelligence', title: 'Location', order: 5 },
    { id: 'demographics', title: 'Demographics', order: 6 },
    { id: 'risk_assessment', title: 'Risk Assessment', order: 7 },
    { id: 'investment_score', title: 'Investment Score', order: 8 },
    { id: 'projections', title: 'Projections', order: 9 }
  ];

  // Check for required sections
  for (const requiredSection of requiredSections) {
    const regex = new RegExp(`#{1,3}\\s*${requiredSection.title}`, 'i');
    const found = regex.test(reportContent);
    
    if (!found) {
      missingSections.push(requiredSection.title);
      issues.push({
        type: 'missing_section',
        severity: 'critical',
        section: requiredSection.title,
        message: `Required section "${requiredSection.title}" is missing from report`,
        recommendation: `Add ${requiredSection.title} section at position ${requiredSection.order}`
      });
    }
  }

  // Check for required subsections within major sections
  const requiredSubsections = [
    { section: 'Executive Summary', subsection: 'Property Overview' },
    { section: 'Executive Summary', subsection: 'Investment Highlights' },
    { section: 'Executive Summary', subsection: 'Key Findings' },
    { section: 'Financial Analysis', subsection: 'Initial Purchase Costs' },
    { section: 'Financial Analysis', subsection: 'Annual Costs' },
    { section: 'Financial Analysis', subsection: 'Cash Flow' },
    { section: 'Location', subsection: 'Transport' },
    { section: 'Location', subsection: 'Schools' },
    { section: 'Risk Assessment', subsection: 'Natural Hazards' },
    { section: 'Investment Score', subsection: 'SWOT Analysis' }
  ];

  for (const { section, subsection } of requiredSubsections) {
    const sectionRegex = new RegExp(`#{1,3}\\s*${section}`, 'i');
    const subsectionRegex = new RegExp(`#{3,4}\\s*${subsection}`, 'i');
    
    const hasSectionIndex = reportContent.search(sectionRegex);
    const hasSubsectionIndex = reportContent.search(subsectionRegex);
    
    if (hasSectionIndex !== -1 && hasSubsectionIndex === -1) {
      missingSubsections.push({ section, subsection });
      issues.push({
        type: 'missing_subsection',
        severity: 'high',
        section,
        subsection,
        message: `Required subsection "${subsection}" missing from ${section}`,
        recommendation: `Add ${subsection} subsection to ${section} section`
      });
    }
  }

  // Check for required tables
  const requiredTables = [
    'Initial Purchase Costs',
    'Annual Operating Costs',
    'Cash Flow'
  ];

  for (const tableName of requiredTables) {
    // Check for markdown table after the section heading
    const tableRegex = new RegExp(`${tableName}[\\s\\S]{0,200}\\|[\\s\\S]{0,500}\\|`, 'i');
    const hasTable = tableRegex.test(reportContent);
    
    if (!hasTable) {
      incompleteTables.push(tableName);
      issues.push({
        type: 'missing_table',
        severity: 'high',
        section: tableName,
        message: `Required table "${tableName}" not found or incomplete`,
        recommendation: `Ensure ${tableName} table is properly formatted with all required columns`
      });
    }
  }

  // Check section ordering
  const foundSections: Array<{ title: string; index: number; expectedOrder: number }> = [];
  
  for (const section of requiredSections) {
    const regex = new RegExp(`#{1,3}\\s*${section.title}`, 'i');
    const match = reportContent.match(regex);
    
    if (match && match.index !== undefined) {
      foundSections.push({
        title: section.title,
        index: match.index,
        expectedOrder: section.order
      });
    }
  }

  // Sort by actual position in document
  foundSections.sort((a, b) => a.index - b.index);
  
  // Check if order matches expected order
  for (let i = 0; i < foundSections.length; i++) {
    const actualOrder = i + 1;
    const expectedOrder = foundSections[i].expectedOrder;
    
    if (actualOrder !== expectedOrder) {
      misorderedSections.push(foundSections[i].title);
      issues.push({
        type: 'misordered',
        severity: 'medium',
        section: foundSections[i].title,
        message: `Section "${foundSections[i].title}" appears at position ${actualOrder} but should be at position ${expectedOrder}`,
        recommendation: `Reorder sections to match standard report structure`
      });
    }
  }

  // Check for content quality - sections should have substantial content
  const checkContentLength = (sectionTitle: string, minLength: number) => {
    const sectionRegex = new RegExp(`#{1,3}\\s*${sectionTitle}([\\s\\S]*?)(?=#{1,3}\\s|$)`, 'i');
    const match = reportContent.match(sectionRegex);
    
    if (match && match[1]) {
      const content = match[1].trim();
      if (content.length < minLength) {
        issues.push({
          type: 'insufficient_content',
          severity: 'low',
          section: sectionTitle,
          message: `Section "${sectionTitle}" has insufficient content (${content.length} chars, expected ${minLength}+)`,
          recommendation: `Expand ${sectionTitle} section with more detailed analysis`
        });
      }
    }
  };

  // Validate content length for key sections
  checkContentLength('Executive Summary', 300);
  checkContentLength('Market Analysis', 400);
  checkContentLength('Financial Analysis', 500);
  checkContentLength('Location', 300);
  checkContentLength('Risk Assessment', 300);
  checkContentLength('Investment Score', 250);

  // Calculate quality score
  let qualityScore = 100;
  
  // Deduct points based on severity
  for (const issue of issues) {
    switch (issue.severity) {
      case 'critical':
        qualityScore -= 15;
        break;
      case 'high':
        qualityScore -= 10;
        break;
      case 'medium':
        qualityScore -= 5;
        break;
      case 'low':
        qualityScore -= 2;
        break;
    }
  }
  
  qualityScore = Math.max(0, qualityScore);

  const isValid = issues.filter(i => i.severity === 'critical').length === 0;

  return {
    isValid,
    schemaVersion: '1.0.0',
    missingSections,
    misorderedSections,
    missingSubsections,
    incompleteTables,
    qualityScore,
    issues
  };
}
