import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { getBrandConfig } from '../_shared/brand-config.ts';
import { withReportMetering, resolveUserId, buildIdempotencyKey } from '../_shared/reportMetering.ts';
import { internalError } from '../_shared/errorResponse.ts';
// The SAME prompt blocks the generator composes. This path used to render
// its own copies from the pre-2026-09 service shapes — `crime.safetyScore`
// (vocabulary deleted by the crime rework and banned by test) and
// `climate.climateZone` (deliberately removed, because naming a zone is
// exactly what the fabricator did) — so eight labelled rows resolved to
// "N/A" on every regenerated report. Two renderings of one reading is how
// they drift; there is one now.
import { crimeStatBlocks } from '../_shared/reports/crimePromptBlocks.pure.ts';
import { climateStatBlocks } from '../_shared/reports/climatePromptBlocks.pure.ts';
import { planningStatBlocks } from '../_shared/reports/planningPromptBlocks.pure.ts';
import { regionalTrendBlocks } from '../_shared/reports/regionalPromptBlocks.pure.ts';
import { macroEconomicBlock } from '../_shared/reports/macroPromptBlocks.pure.ts';
import {
  activateSafeGenerationInputs,
  subjectPostcodeOf,
  type SafeGenerationResult,
} from '../_shared/reports/contract/safeGenerationInputs.pure.ts';
import {
  auditGovernedNarrativeAuthority,
  remediateGovernedNarrative,
  governedRemediatedFlag,
  subjectPostcodeForAudit,
  type GovernedRemoval,
  governedAuthorityBlocks,
  governedCategoryDirective,
  governedFaultToFlag,
  GOVERNED_AUTHORITY_FLAG_TYPE,
} from '../_shared/reports/contract/governedNarrativeAuthority.pure.ts';
import { resolveOneReportGeography } from '../_shared/geography/resolveOneReportGeography.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const textEncoder = new TextEncoder();
const PERPLEXITY_MESSAGE_HARD_LIMIT_BYTES = 100_000;
const PERPLEXITY_SAFE_USER_MESSAGE_BYTES = 90_000;
const PERPLEXITY_SAFE_SYSTEM_MESSAGE_BYTES = 35_000;

function byteLength(value: string): number {
  return textEncoder.encode(value).length;
}

function sliceHeadByBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (byteLength(value.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return value.slice(0, lo);
}

function sliceTailByBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (byteLength(value.slice(value.length - mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return value.slice(value.length - lo);
}

function compactPromptContext(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function limitPromptContext(value: string, maxBytes: number, label: string, mode: 'head' | 'tail' | 'head-tail' = 'head-tail'): string {
  const compacted = compactPromptContext(value);
  const originalBytes = byteLength(compacted);
  if (originalBytes <= maxBytes) return compacted;

  const notice = `\n\n[${label} truncated from ${originalBytes.toLocaleString()} bytes to stay within Perplexity's ${PERPLEXITY_MESSAGE_HARD_LIMIT_BYTES / 1000}KB message limit.]\n\n`;
  const remaining = Math.max(0, maxBytes - byteLength(notice));
  if (mode === 'head') return sliceHeadByBytes(compacted, remaining) + notice;
  if (mode === 'tail') return notice + sliceTailByBytes(compacted, remaining);
  const headBudget = Math.floor(remaining * 0.62);
  const tailBudget = remaining - headBudget;
  const text = `${sliceHeadByBytes(compacted, headBudget)}${notice}${sliceTailByBytes(compacted, tailBudget)}`;
  console.log(`✂️ ${label} trimmed: ${originalBytes} → ${byteLength(text)} bytes`);
  return text;
}

interface RegenerateRequest {
  reportId: string;
  manualOverrides: Record<string, any>;
  currentReportContent: string;
  propertyAddress: string;
  financialCalculations?: Record<string, any>;
  continueFrom?: boolean; // Resume from last completed section
  singleSection?: boolean; // Generate only ONE section then return (chunked mode)
}

// Enhanced data interface - matches generate-investment-report
interface EnhancedData {
  demographics?: any;
  economics?: any;
  financials?: any;
  locationIntelligence?: any;
  investmentScore?: any;
  domainData?: any;
  riskAssessment?: any;
  seifaData?: any;
  crimeStatistics?: any;
  employmentData?: any;
  climateData?: any;
  schoolData?: any;
  planningData?: any;
  regionalTrends?: any;
  validation?: any;
}

// ============================================================================
// REPORT SECTION DEFINITIONS - SYNCED WITH DATABASE TEMPLATE STRUCTURE
// ============================================================================
// These section definitions match the "Investor Compass Structure v2" template
// stored in report_structure_templates table. They serve as:
// 1. Fallback when template parsing fails
// 2. Validation reference for dynamic parsing
// 3. Performance tuning (maxTokens, requiredKeywords)
// ============================================================================

interface ReportSectionDefinition {
  id: string;
  name: string;
  sections: string[];  // H2 headings from template that belong to this group
  maxTokens: number;
  minContentLength: number;
  requiredKeywords: string[];
}

// FALLBACK HARDCODED SECTIONS - Matches database template "Investor Compass Structure v2"
// These 12 groups contain all 26 H2 sections from the template, logically grouped for generation
const DEFAULT_REPORT_SECTIONS: ReportSectionDefinition[] = [
  {
    id: 'section0',
    name: 'Executive Summary',
    sections: ['Executive Summary'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['investment', 'property', 'recommendation', 'score'],
  },
  {
    id: 'section1',
    name: 'Location Overview',
    sections: ['Location Overview'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['suburb', 'community', 'transport', 'lifestyle'],
  },
  {
    id: 'section2',
    name: 'Market & Economics',
    sections: ['Current Market Performance', 'Current Economic Context'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['market', 'cash rate', 'inflation', 'growth'],
  },
  {
    id: 'section3',
    name: 'Demographics & Demand',
    sections: ['Demographics & Demand Drivers'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['population', 'income', 'employment', 'household'],
  },
  {
    id: 'section4',
    name: 'Education & Healthcare',
    sections: ['Schools & Education', 'Healthcare & Shopping'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['school', 'education', 'hospital', 'healthcare'],
  },
  {
    id: 'section5',
    name: 'Recreation & Transport',
    sections: ['Recreational Amenities', 'Transport & Accessibility'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['recreation', 'park', 'transport', 'commute'],
  },
  {
    id: 'section6',
    name: 'Environment & Safety',
    sections: ['Environmental Risks & Climate', 'Crime & Safety'],
    maxTokens: 4000,
    minContentLength: 3500,
    requiredKeywords: ['flood', 'bushfire', 'crime', 'safety'],
  },
  {
    id: 'section7',
    name: 'Property & Zoning',
    sections: ['Property-Level Information'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['property', 'zoning', 'land', 'building'],
  },
  {
    id: 'section8',
    name: 'Costs & Rental',
    sections: ['Purchase & Ongoing Costs (Annual)', 'Rental Assessment & Yield Calculation'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['purchase', 'stamp duty', 'rent', 'yield'],
  },
  {
    id: 'section9',
    name: 'Loan & Sensitivity',
    sections: ['Loan Structure & Repayment Analysis', 'Sensitivity Analysis'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['loan', 'repayment', 'cashflow', 'sensitivity'],
  },
  {
    id: 'section10',
    name: 'Projections & SWOT',
    sections: ['10-Year Investment Projections', 'Investment Score Analysis', 'SWOT Analysis Summary', 'Top 3 Investment Opportunities'],
    maxTokens: 3000,
    minContentLength: 3000,
    requiredKeywords: ['projection', 'swot', 'opportunity', 'score'],
  },
  {
    id: 'section11',
    name: 'Risks & Recommendations',
    sections: ['Top 3 Investment Risks', 'Investment Recommendations', 'Final Conclusion', 'PROFESSIONAL DISCLAIMER'],
    maxTokens: 5000,
    minContentLength: 4000,
    requiredKeywords: ['risk', 'recommendation', 'conclusion'],
  }
];

// Dynamic sections - populated from database template at runtime
let REPORT_SECTIONS: ReportSectionDefinition[] = [...DEFAULT_REPORT_SECTIONS];

// ============================================================================
// DYNAMIC TEMPLATE PARSING (shared with generate-investment-report)
// ============================================================================

interface ParsedTemplateStructure {
  headings: string[];
  sections: ReportSectionDefinition[];
  templateName: string;
  templateId: string;
}

/**
 * Parses the template content to extract H2 headings and create section definitions
 */
function parseTemplateStructure(
  templateContent: string,
  templateName: string = 'Unknown',
  templateId: string = ''
): ParsedTemplateStructure {
  try {
    const h2Pattern = /^## ([^\n]+)/gm;
    const headings: string[] = [];
    let match;
    
    while ((match = h2Pattern.exec(templateContent)) !== null) {
      const heading = match[1].trim();
      if (heading.length > 2) {
        headings.push(heading);
      }
    }
    
    console.log(`📋 Parsed ${headings.length} H2 headings from template "${templateName}"`);
    
    if (headings.length < 5) {
      console.log('⚠️ Too few headings found, using default sections');
      return { headings: [], sections: DEFAULT_REPORT_SECTIONS, templateName, templateId };
    }
    
    const sections = groupHeadingsIntoSections(headings);
    
    console.log(`✓ Created ${sections.length} generation sections from template`);
    
    return { headings, sections, templateName, templateId };
  } catch (error) {
    console.error('⚠️ Template parsing error:', error);
    return { headings: [], sections: DEFAULT_REPORT_SECTIONS, templateName, templateId };
  }
}

/**
 * Groups extracted headings into logical generation sections
 */
function groupHeadingsIntoSections(headings: string[]): ReportSectionDefinition[] {
  const sectionKeywordMap: Record<string, { keywords: string[], name: string, requiredKeywords: string[], maxTokens: number, minContentLength: number }> = {
    'executive': { keywords: ['executive', 'summary', 'overview report'], name: 'Executive Summary', requiredKeywords: ['investment', 'property', 'recommendation', 'score'], maxTokens: 2500, minContentLength: 2500 },
    'location': { keywords: ['location', 'suburb character'], name: 'Location Overview', requiredKeywords: ['suburb', 'community', 'lifestyle'], maxTokens: 2500, minContentLength: 2500 },
    'market': { keywords: ['market', 'economic', 'economy'], name: 'Market & Economics', requiredKeywords: ['market', 'cash rate', 'growth'], maxTokens: 2500, minContentLength: 2500 },
    'demographics': { keywords: ['demographic', 'demand', 'population'], name: 'Demographics & Demand', requiredKeywords: ['population', 'income', 'employment'], maxTokens: 2500, minContentLength: 2500 },
    'education': { keywords: ['school', 'education', 'healthcare', 'hospital', 'shopping'], name: 'Education & Healthcare', requiredKeywords: ['school', 'education', 'healthcare'], maxTokens: 2500, minContentLength: 2500 },
    'recreation': { keywords: ['recreation', 'transport', 'accessibility', 'amenities', 'commute'], name: 'Recreation & Transport', requiredKeywords: ['recreation', 'transport', 'commute'], maxTokens: 2500, minContentLength: 2500 },
    'environment': { keywords: ['environment', 'climate', 'crime', 'safety', 'flood', 'bushfire', 'risk'], name: 'Environment & Safety', requiredKeywords: ['flood', 'crime', 'safety'], maxTokens: 4000, minContentLength: 3500 },
    'property': { keywords: ['property-level', 'property level', 'zoning', 'land size', 'building'], name: 'Property & Zoning', requiredKeywords: ['property', 'zoning', 'land'], maxTokens: 2500, minContentLength: 2500 },
    'costs': { keywords: ['purchase', 'ongoing costs', 'rental', 'yield', 'stamp duty'], name: 'Costs & Rental', requiredKeywords: ['purchase', 'rent', 'yield'], maxTokens: 2500, minContentLength: 2500 },
    'loan': { keywords: ['loan', 'repayment', 'sensitivity', 'cashflow', 'mortgage'], name: 'Loan & Sensitivity', requiredKeywords: ['loan', 'repayment', 'cashflow'], maxTokens: 2500, minContentLength: 2500 },
    'projections': { keywords: ['projection', 'swot', 'opportunities', 'investment score', '10-year', 'ten year'], name: 'Projections & SWOT', requiredKeywords: ['projection', 'swot', 'opportunity'], maxTokens: 3000, minContentLength: 3000 },
    'recommendations': { keywords: ['risk', 'recommendation', 'conclusion', 'final', 'swot'], name: 'Risks & Recommendations', requiredKeywords: ['risk', 'recommendation', 'conclusion'], maxTokens: 5000, minContentLength: 4000 }
  };
  
  const groups: Record<string, string[]> = {};
  const usedHeadings = new Set<string>();
  
  for (const heading of headings) {
    const headingLower = heading.toLowerCase();
    for (const [groupKey, config] of Object.entries(sectionKeywordMap)) {
      if (config.keywords.some(kw => headingLower.includes(kw))) {
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(heading);
        usedHeadings.add(heading);
        break;
      }
    }
  }
  
  for (const heading of headings) {
    if (!usedHeadings.has(heading)) {
      if (!groups['recommendations']) groups['recommendations'] = [];
      groups['recommendations'].push(heading);
    }
  }
  
  const orderedKeys = ['executive', 'location', 'market', 'demographics', 'education', 'recreation', 'environment', 'property', 'costs', 'loan', 'projections', 'recommendations'];
  const sections: ReportSectionDefinition[] = [];
  
  for (let i = 0; i < orderedKeys.length; i++) {
    const key = orderedKeys[i];
    const config = sectionKeywordMap[key];
    const groupHeadings = groups[key] || [];
    
    if (groupHeadings.length > 0) {
      sections.push({ id: `section${i}`, name: config.name, sections: groupHeadings, maxTokens: config.maxTokens, minContentLength: config.minContentLength, requiredKeywords: config.requiredKeywords });
    } else {
      const defaultSection = DEFAULT_REPORT_SECTIONS.find(s => s.id === `section${i}`);
      if (defaultSection) sections.push(defaultSection);
    }
  }
  
  return sections;
}

// Helper function to fetch with timeout - MUST match generate-investment-report
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 90000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`⏱️ Request timeout after ${timeoutMs}ms, aborting...`);
    controller.abort();
  }, timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds`);
    }
    throw error;
  }
}

// Section validation helper - ensures content meets minimum requirements
// STRICTER validation for better quality control
function validateSectionContent(
  sectionDef: typeof REPORT_SECTIONS[0],
  content: string
): { isValid: boolean; issues: string[]; score: number } {
  const issues: string[] = [];
  let score = 100;
  
  const contentLength = content?.length || 0;
  
  // STRICTER length validation - must meet at least 70% of minimum
  const minThreshold = sectionDef.minContentLength * 0.7;
  if (contentLength < minThreshold) {
    issues.push(`Content critically short: ${contentLength} chars (need at least: ${Math.round(minThreshold)})`);
    score -= 50; // Increased penalty
  } else if (contentLength < sectionDef.minContentLength) {
    issues.push(`Content below target: ${contentLength} chars (target: ${sectionDef.minContentLength})`);
    score -= 20;
  }
  
  const contentLower = (content || '').toLowerCase();
  const missingKeywords = (sectionDef.requiredKeywords || []).filter(
    (kw) => !contentLower.includes(kw.toLowerCase()),
  );

  if (missingKeywords.length > 0) {
    issues.push(`Missing content areas: ${missingKeywords.join(', ')}`);
    score -= missingKeywords.length * 10;
  }

  // STRICT structure compliance: required subsection headings must exist
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const missingHeadings = (sectionDef.sections || []).filter((title) => {
    const re = new RegExp(`^#{2,3}\\s*${escapeRegExp(title)}\\b`, 'mi');
    return !re.test(content || '');
  });

  if (missingHeadings.length > 0) {
    issues.push(`Missing required headings: ${missingHeadings.join(', ')}`);
    score -= missingHeadings.length * 15;
  }
  
  const headingCount = (content?.match(/^#{1,3}\s+/gm) || []).length;
  if (headingCount < 4) { // Increased from 3
    issues.push(`Insufficient structure: only ${headingCount} headings found (need 4+)`);
    score -= 15;
  }
  
  // Check for data presentation (tables with |)
  const hasDataTables = content?.includes('|') && content?.includes('---');
  if (!hasDataTables && sectionDef.id !== 'section4') {
    issues.push('No data tables found');
    score -= 10;
  }
  
  // Check for inline citations/references
  const hasCitations = content?.includes('[') && content?.includes(']');
  if (!hasCitations) {
    issues.push('No inline citations found');
    score -= 5;
  }
  
  return {
    isValid: score >= 70, // Increased threshold from 60 to 70
    issues,
    score: Math.max(0, score)
  };
}

// Helper function to extract content for a specific section from the original report
function extractSectionContent(fullContent: string, sectionNames: string[]): string {
  let extractedContent = '';
  
  for (const sectionName of sectionNames) {
    const patterns = [
      new RegExp(`^#{1,3}\\s*${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=^#{1,3}\\s|$)`, 'gmi'),
      new RegExp(`\\*\\*${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*[\\s\\S]*?(?=\\*\\*[A-Z]|^#{1,3}|$)`, 'gmi'),
    ];
    
    for (const pattern of patterns) {
      const matches = fullContent.match(pattern);
      if (matches && matches.length > 0) {
        extractedContent += matches[0] + '\n\n';
        break;
      }
    }
  }
  
  return extractedContent.trim();
}

// Fetch all enhanced data from APIs - matches generate-investment-report
async function fetchEnhancedData(
  propertyAddress: string,
  manualOverrides: Record<string, any>,
  supabaseUrl: string,
  supabaseAnonKey: string,
  /** RF-7.2B.1 §2 — for the pre-gate geography resolution. */
  geographyContext?: { supabase: { from: (t: string) => any }; reportId: string } | null,
): Promise<{
  enhancedData: EnhancedData;
  suburb: string | null;
  postcode: string | null;
  state: string;
  safeGeneration: SafeGenerationResult;
}> {
  console.log('🔄 Fetching enhanced data from multiple APIs...');
  
  let enhancedData: EnhancedData = {};
  
  // Extract location details from property address
  let postcode: string | null = null;
  let state = 'NSW';
  let suburb: string | null = null;
  
  const postcodeMatch = propertyAddress.match(/\b(\d{4})\b/);
  if (postcodeMatch) {
    postcode = postcodeMatch[1];
  }
  
  const stateMatch = propertyAddress.match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT|Western Australia|New South Wales|Victoria|Queensland|South Australia|Tasmania|Northern Territory|Australian Capital Territory)\b/i);
  if (stateMatch) {
    const stateInput = stateMatch[1].toUpperCase();
    const stateMap: Record<string, string> = {
      'WESTERN AUSTRALIA': 'WA',
      'NEW SOUTH WALES': 'NSW',
      'VICTORIA': 'VIC',
      'QUEENSLAND': 'QLD',
      'SOUTH AUSTRALIA': 'SA',
      'TASMANIA': 'TAS',
      'NORTHERN TERRITORY': 'NT',
      'AUSTRALIAN CAPITAL TERRITORY': 'ACT'
    };
    state = stateMap[stateInput] || stateInput;
  }
  
  // Extract suburb from address
  const suburbMatch = propertyAddress.match(/,\s*([A-Za-z\s]+)(?:,|\s+(?:NSW|VIC|QLD|WA|SA|TAS|NT|ACT))/i);
  if (suburbMatch) {
    suburb = suburbMatch[1].trim().toLowerCase().replace(/\s+/g, '-');
  } else {
    // Try extracting from comma-separated parts
    const parts = propertyAddress.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      suburb = parts[1].replace(/\d{4}|\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/gi, '').trim().toLowerCase().replace(/\s+/g, '-');
    }
  }
  
  console.log('📍 Location extracted:', { suburb, postcode, state });

  // Get property details from manual overrides
  const propertyPrice = manualOverrides.purchasePrice || 0;
  const weeklyRent = manualOverrides.weeklyRent || 0;
  const propertyType = manualOverrides.propertyType || 'house';
  const bedrooms = manualOverrides.bedrooms || 3;
  const bathrooms = manualOverrides.bathrooms || 2;

  // Fetch enhanced data in parallel to avoid long sequential waits (prevents edge function timeouts)
  const tasks: Array<Promise<void>> = [];

  const run = (label: string, fn: () => Promise<void>) => {
    tasks.push(
      (async () => {
        const t0 = Date.now();
        try {
          await fn();
          console.log(`✓ ${label} (${Date.now() - t0}ms)`);
        } catch (error: any) {
          console.log(`⚠️ ${label} failed:`, error?.message);
        }
      })()
    );
  };

  // 1. Domain market data
  run('Domain market data', async () => {
    if (!suburb || !state) return;

    const domainResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/domain-data-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({
        suburb,
        state,
        postcode,
        propertyCategory: propertyType === 'unit' ? 'unit' : 'house'
      })
    }, 30000);

    if (!domainResponse.ok) return;
    const domainData = await domainResponse.json();
    if (domainData?.success && domainData?.data) {
      enhancedData.domainData = domainData.data;
    }
  });

  // 2. Risk assessment
  run('Risk assessment', async () => {
    if (!postcode || !state) return;

    const riskResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/risk-assessment-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({
        suburb: suburb || 'unknown',
        state,
        postcode
      })
    }, 30000);

    if (!riskResponse.ok) return;
    const riskData = await riskResponse.json();
    if (riskData?.success && riskData?.data) {
      enhancedData.riskAssessment = riskData.data;
    }
  });

  // 3. ABS demographics
  run('ABS demographics', async () => {
    if (!postcode) return;

    const absResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/abs-data-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({ postcode, state })
    }, 30000);

    if (!absResponse.ok) return;
    const absData = await absResponse.json();
    if (absData?.success && absData?.data) {
      enhancedData.demographics = absData.data;
    }
  });

  // 4. RBA economics
  run('RBA economics', async () => {
    const rbaResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/rba-data-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`
      }
    }, 30000);

    if (!rbaResponse.ok) return;
    const rbaData = await rbaResponse.json();
    // Attach only a real reading: an honest refusal is {success:false,
    // data:null} and must leave economics absent, never half-attached.
    if (rbaData?.success && rbaData?.data) {
      enhancedData.economics = rbaData.data;
    }
  });

  // 5. SEIFA
  run('SEIFA', async () => {
    if (!postcode) return;

    const seifaResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/abs-seifa-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({ postcode, state })
    }, 30000);

    if (!seifaResponse.ok) return;
    const seifaData = await seifaResponse.json();
    if (seifaData?.success && seifaData?.data) {
      enhancedData.seifaData = seifaData.data;
    }
  });

  // 6. Crime
  run('Crime statistics', async () => {
    if (!suburb || !state) return;

    const crimeResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/crime-statistics-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({ suburb, state, postcode })
    }, 30000);

    if (!crimeResponse.ok) return;
    const crimeData = await crimeResponse.json();
    if (crimeData?.success && crimeData?.data) {
      enhancedData.crimeStatistics = crimeData.data;
    }
  });

  // 7. Employment
  run('Employment', async () => {
    if (!state) return;

    const employmentResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/abs-employment-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({ suburb, state, postcode })
    }, 30000);

    if (!employmentResponse.ok) return;
    const employmentData = await employmentResponse.json();
    if (employmentData?.success && employmentData?.data) {
      enhancedData.employmentData = employmentData.data;
    }
  });

  // 8. Location intelligence — the coordinate every service below is keyed on
  const locationTask = (async () => {
    try {
      const locationResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/location-intelligence-service`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
          address: propertyAddress,
          postcode,
          state
        })
      }, 30000);

      if (!locationResponse.ok) return;
      const locationData = await locationResponse.json();
      if (locationData?.success && locationData?.data) {
        enhancedData.locationIntelligence = locationData.data;
      }
    } catch (error: any) {
      console.log('⚠️ Location intelligence failed:', error?.message);
    }
  })();

  tasks.push(locationTask);

  // 9. The coordinate-keyed services.
  //
  // Climate, planning and regional trends all take the property's verified
  // coordinate as their question — a locality string cannot answer any of
  // them. This block exists because the regeneration path had drifted out
  // of parity with the generator: climate was called with
  // `{suburb, state, postcode}` and no coordinate, so after the SILO
  // rewrite it refused EVERY regenerated report; planning and regional
  // were never called at all, so a regenerated report silently lost the
  // zoning block and the population trends a freshly generated one
  // carries. Each awaits `locationTask` the way the school fetch does.
  const coordinateTask = (async () => {
    await locationTask;
    const lat = enhancedData.locationIntelligence?.coordinates?.lat;
    const lng = enhancedData.locationIntelligence?.coordinates?.lng;
    if (!lat || !lng) return; // no verified coordinate → honest absence, not a locality guess

    // The URL is passed in FULL at each call site rather than assembled from
    // a name here: the security inventory's call graph is built by scanning
    // for literal `functions/v1/<name>` strings, so a variable specifier
    // makes an edge invisible to it — routing these three through a
    // name-taking helper silently dropped them from the recorded graph.
    const ask = async (url: string, body: Record<string, unknown>, timeout: number) => {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseAnonKey}` },
        body: JSON.stringify(body),
      }, timeout);
      if (!res.ok) return null;
      const parsed = await res.json();
      return parsed?.success && parsed?.data ? parsed.data : null;
    };

    await Promise.all([
      (async () => {
        try {
          const data = await ask(`${supabaseUrl}/functions/v1/climate-data-service`, { latitude: lat, longitude: lng, state, suburb, postcode }, 40000);
          if (data) enhancedData.climateData = data;
        } catch (error: any) { console.log('⚠️ Climate skipped:', error?.message?.substring(0, 80)); }
      })(),
      (async () => {
        try {
          const data = await ask(`${supabaseUrl}/functions/v1/planning-data-service`, { latitude: lat, longitude: lng, state, postcode }, 45000);
          if (data) enhancedData.planningData = data;
        } catch (error: any) { console.log('⚠️ Planning skipped:', error?.message?.substring(0, 80)); }
      })(),
      (async () => {
        try {
          const data = await ask(`${supabaseUrl}/functions/v1/abs-regional-service`, { latitude: lat, longitude: lng, state, suburb, postcode }, 30000);
          if (data) enhancedData.regionalTrends = data;
        } catch (error: any) { console.log('⚠️ Regional trends skipped:', error?.message?.substring(0, 80)); }
      })(),
    ]);

    // QLD's crime register is LGA-keyed, and the crime fetch above ran
    // before any LGA was known — the generator's second-chance ask, mirrored.
    const qldLga = enhancedData.planningData?.parcel?.status === 'ok'
      ? enhancedData.planningData?.parcel?.lga
      : null;
    if (!enhancedData.crimeStatistics && state === 'QLD' && qldLga) {
      try {
        const data = await ask(`${supabaseUrl}/functions/v1/crime-statistics-service`, { suburb, state, postcode, lga: qldLga }, 20000);
        if (data) enhancedData.crimeStatistics = data;
      } catch (error: any) { console.log('⚠️ QLD crime retry skipped:', error?.message?.substring(0, 80)); }
    }
  })();

  tasks.push(coordinateTask);

  // 10. Schools (waits for location coordinates when available)
  run('School data', async () => {
    if (!suburb || !state || !postcode) return;

    await locationTask;
    const latitude = enhancedData.locationIntelligence?.coordinates?.lat;
    const longitude = enhancedData.locationIntelligence?.coordinates?.lng;

    const schoolResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/school-data-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({
        suburb,
        state,
        postcode,
        latitude: latitude || undefined,
        longitude: longitude || undefined
      })
    }, 30000);

    if (!schoolResponse.ok) return;
    const schoolData = await schoolResponse.json();
    if (schoolData?.success && schoolData?.data) {
      enhancedData.schoolData = schoolData.data;
    }
  });

  // 11. Financial calculations
  run('Financial calculations', async () => {
    if (!propertyPrice || !weeklyRent) return;

    const effectiveLvr = manualOverrides.loanToValueRatio || 80;
    const effectiveDeposit = manualOverrides.depositValue || (propertyPrice * ((100 - effectiveLvr) / 100));
    const effectiveInterestRate = manualOverrides.interestRate || 6.5;
    const effectiveLoanTerm = manualOverrides.loanTermYears || 30;

    const financialResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/financial-calculator-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`
      },
      body: JSON.stringify({
        propertyValue: propertyPrice,
        deposit: effectiveDeposit,
        interestRate: effectiveInterestRate,
        loanTerm: effectiveLoanTerm,
        weeklyRent,
        weeklyRentSource: 'manual_override',
        state,
        propertyType,
        isFirstHomeBuyer: manualOverrides.isFirstHomeBuyer || false,
        isNewBuild: manualOverrides.buildType === 'new_build'
      })
    }, 30000);

    if (!financialResponse.ok) return;
    const financialData = await financialResponse.json();
    if (!financialData?.data) return;

    // Merge manual overrides with fresh financial calculations
    const mergedFinancials = JSON.parse(JSON.stringify(financialData.data));

    // Apply overrides to nested structure
    const overrideMapping: Record<string, string> = {
      'purchasePrice': 'initialCosts.propertyValue',
      'stampDuty': 'initialCosts.stampDuty',
      'depositValue': 'initialCosts.deposit',
      'loanToValueRatio': 'keyMetrics.lvr',
      'interestRate': 'loanDetails.interestRate',
      'weeklyRent': 'income.weeklyRent',
      'councilRates': 'annualCosts.councilRates',
      'waterRates': 'annualCosts.waterRates',
      'bodyCorporateFees': 'annualCosts.strataFees',
      'buildingLandlordInsurance': 'annualCosts.landlordInsurance',
      'propertyManagementFees': 'annualCosts.propertyManagementPercent',
      'repairsMaintenance': 'annualCosts.maintenance',
      'lettingFees': 'annualCosts.lettingFees',
      'capitalGrowth': 'assumptions.capitalGrowth',
      'landTax': 'annualCosts.landTax',
      'depreciation': 'taxBenefits.depreciation',
      'taxRate': 'taxBenefits.marginalTaxRate',
      'occupancyRate': 'assumptions.occupancyWeeks',
      'loanAmount': 'loanDetails.loanAmount'
    };

    for (const [flatKey, overrideValue] of Object.entries(manualOverrides)) {
      const nestedPath = overrideMapping[flatKey];
      if (nestedPath && overrideValue !== null && overrideValue !== undefined) {
        const keys = nestedPath.split('.');
        let current = mergedFinancials;

        for (let i = 0; i < keys.length - 1; i++) {
          if (!current[keys[i]]) current[keys[i]] = {};
          current = current[keys[i]];
        }

        current[keys[keys.length - 1]] = overrideValue;
      }
    }

    enhancedData.financials = mergedFinancials;
  });

  // Wait for all parallel tasks
  await Promise.allSettled(tasks);

  // 12. Investment score (depends on other data)
  if (propertyPrice) {
    try {
      console.log('⭐ Calculating investment score...');
      const scoreResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/investment-scoring-service`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
          property: {
            price: propertyPrice,
            weeklyRent: weeklyRent || 0,
            propertyType,
            bedrooms,
            bathrooms
          },
          demographics: enhancedData.demographics,
          locationIntelligence: enhancedData.locationIntelligence,
          financials: enhancedData.financials
        })
      }, 30000);

      if (scoreResponse.ok) {
        const scoreData = await scoreResponse.json();
        enhancedData.investmentScore = scoreData.data;
        console.log('✓ Investment score calculated:', {
          totalScore: scoreData.data?.totalScore,
          grade: scoreData.data?.grade
        });
      }
    } catch (error: any) {
      console.log('⚠️ Investment score calculation failed:', error?.message);
    }
  }

  console.log('📊 Enhanced data fetch complete. Data sources:', Object.keys(enhancedData).filter(k => enhancedData[k as keyof EnhancedData]).join(', '));

  // RF-7.2B.1 §2 — geography before the gate, from this run's own coordinate.
  //
  // Identical in intent to `generate-investment-report`, and through the SAME
  // module: a regeneration must not reach a different conclusion about where
  // the property is than a first generation of the same address did.
  let subjectGeography: Record<string, unknown> | null = null;
  let geographyProvenance = { source: 'none', status: 'unresolved', absRequeried: false };
  if (geographyContext) {
    const lat = Number(enhancedData.locationIntelligence?.coordinates?.lat);
    const lng = Number(enhancedData.locationIntelligence?.coordinates?.lng);
    try {
      const geoOutcome = await resolveOneReportGeography({
        supabase: geographyContext.supabase,
        reportId: geographyContext.reportId,
        latitude: Number.isFinite(lat) ? lat : null,
        longitude: Number.isFinite(lng) ? lng : null,
      });
      geographyProvenance = {
        source: 'pre_generation', status: geoOutcome.status, absRequeried: false,
      };
      if (geoOutcome.writeError) {
        console.warn(`⚠️ report_geography write failed (${geoOutcome.writeError}) — resolution still used.`);
      }
      subjectGeography = geoOutcome.row === null ? null : {
        postcode: geoOutcome.row.postcode,
        status: geoOutcome.row.status,
        suburb: geoOutcome.row.suburb,
        state: geoOutcome.row.state,
      };
      console.log(`🗺️ Geography resolved before the gate: ${geoOutcome.status}`);
    } catch (error: any) {
      console.warn('⚠️ Pre-generation geography resolution failed:', error?.message);
    }
  }

  // The trusted postal area, where it disagrees with the address-derived one.
  // Same rule as the generator, and all THREE postal-area payloads move
  // together: re-fetch for the subject's own POA, and where that cannot be
  // done DROP the wrong-area payload rather than carry it.
  const trustedPostcode = subjectPostcodeOf(subjectGeography);
  if (trustedPostcode && trustedPostcode !== postcode) {
    const trustedState = typeof subjectGeography?.state === 'string' && subjectGeography.state
      ? subjectGeography.state as string
      : state;
    console.log(
      `📍 Trusted POA ${trustedPostcode} differs from the address-derived `
      + `${postcode ?? '(none)'} — re-querying ABS demographics and SEIFA.`,
    );
    const requery = async (fn: string, payload: Record<string, unknown>) => {
      try {
        const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/${fn}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify(payload),
        }, 30000);
        if (!res.ok) return null;
        const body = await res.json();
        return body?.success ? body.data : null;
      } catch (_e) {
        return null;
      }
    };
    const [absAgain, seifaAgain, employmentAgain] = await Promise.all([
      requery('abs-data-service', { postcode: trustedPostcode, state: trustedState }),
      requery('abs-seifa-service', { postcode: trustedPostcode, state: trustedState }),
      requery('abs-employment-service', {
        suburb: typeof subjectGeography?.suburb === 'string' ? subjectGeography.suburb : null,
        state: trustedState,
        postcode: trustedPostcode,
      }),
    ]);
    enhancedData.demographics = absAgain ?? undefined;
    enhancedData.seifaData = seifaAgain ?? undefined;
    enhancedData.employmentData = employmentAgain ?? undefined;
    geographyProvenance = { ...geographyProvenance, absRequeried: true };
  }

  // RF-7.2B.1 — the Client-Safe Gate, on the same object and by the same rules
  // as `generate-investment-report`. This path builds its OWN prompt context
  // (`buildEnhancedDataContext` below), so gating only the other generator
  // would leave a second, fully-featured route to the model carrying every
  // disowned fact. It sits after the score call above for the same reason it
  // does there: the score engine reads three of the fields being withheld.
  const safeGeneration = activateSafeGenerationInputs({
    enhancedData,
    geography: subjectGeography,
    geographyProvenance,
    cashRateTarget: (enhancedData as any)?.economics?.cashRateTarget ?? null,
    cashRateMonthlyAverage: null,
    capturedAt: new Date().toISOString(),
  });
  enhancedData = safeGeneration.enhancedData as EnhancedData;
  const withheld = safeGeneration.removed.filter((r) => r.hadValue).map((r) => r.path);
  console.log(
    `🛡️ Client-Safe Gate active (${safeGeneration.snapshot.assuranceVersion}) — `
    + `${withheld.length} disowned fact(s) withheld${withheld.length ? `: ${withheld.join(', ')}` : ''}`
    + `; demographics ${safeGeneration.demographicsKept ? 'retained' : 'withheld'}.`,
  );

  return { enhancedData, suburb, postcode, state, safeGeneration };
}

// Build enhanced data context string - mirrors generate-investment-report
function buildEnhancedDataContext(enhancedData: EnhancedData, propertyAddress: string): string {
  let context = '';
  
  // Demographics context
  if (enhancedData.demographics) {
    const demo = enhancedData.demographics;
    // The gate above admits this block only where it is a recognised ABS Census
    // postal-area retrieval, so the label is now true rather than asserted —
    // and it names the payload's own source rather than a constant.
    const demoSource = (demo as { dataSource?: unknown }).dataSource;
    const demoLabel = typeof demoSource === 'string' && demoSource.trim() !== ''
      ? demoSource.trim()
      : 'ABS Census';
    context += `
**DEMOGRAPHIC DATA (${demoLabel}):**
- Population: ${demo.population?.total || 'N/A'}
- Population Growth (5yr): ${demo.population?.growth || 'N/A'}%
- Median Age: ${demo.population?.medianAge || 'N/A'} years
- Median Household Income: $${demo.income?.medianHouseholdIncome?.toLocaleString() || 'N/A'}
- Median Weekly Income: $${demo.income?.medianWeeklyIncome?.toLocaleString() || 'N/A'}
- Employment Rate: ${demo.employment?.employmentRate || 'N/A'}%
- Unemployment Rate: ${demo.income?.unemploymentRate || 'N/A'}%
- Owner Occupied: ${demo.housing?.ownerOccupied || 'N/A'}%
- Rental Properties: ${demo.housing?.renting || 'N/A'}%
`;
  }

  // Macro — the shared block, composed from the loaded RBA tables with
  // each figure's own reference period.
  if (enhancedData.economics) {
    context += `\n**ECONOMIC CONTEXT:**\n${macroEconomicBlock(enhancedData)}\n`;
  }

  // Location intelligence.
  //
  // Walk Score, the public-transport quality score and the CBD commute are
  // withheld by the Client-Safe Gate (RF-7.2B.1) and are therefore no longer
  // read here: they could only ever have printed "N/A", and a labelled row is
  // a promise that a figure follows it. What remains is counted amenities,
  // rendered only where they were measured.
  if (enhancedData.locationIntelligence) {
    const loc = enhancedData.locationIntelligence;
    const lines: string[] = [];
    const healthcare = loc.healthcare?.facilitiesWithin5km;
    if (typeof healthcare === 'number') lines.push(`- Healthcare facilities within 5km: ${healthcare}`);
    const shops = loc.lifestyle?.shoppingCenters;
    if (typeof shops === 'number') lines.push(`- Shopping centres nearby: ${shops}`);
    const nearestSchool = loc.schools?.nearestSchool;
    if (typeof nearestSchool === 'string' && nearestSchool.trim() !== '' && nearestSchool !== 'N/A') {
      lines.push(`- Nearest school: ${nearestSchool}`);
    }
    if (lines.length > 0) {
      context += `\n**LOCATION INTELLIGENCE:**\n${lines.join('\n')}\n`;
    }
  }

  // SEIFA data
  if (enhancedData.seifaData) {
    const seifa = enhancedData.seifaData;
    context += `
**SOCIOECONOMIC INDICES (SEIFA):**
- IRSAD Score: ${seifa.irsad?.score || 'N/A'} (Decile ${seifa.irsad?.decile || 'N/A'}/10)
- IRSD Score: ${seifa.irsd?.score || 'N/A'} (Decile ${seifa.irsd?.decile || 'N/A'}/10)
- IER Score: ${seifa.ier?.score || 'N/A'} (Decile ${seifa.ier?.decile || 'N/A'}/10)
- IEO Score: ${seifa.ieo?.score || 'N/A'} (Decile ${seifa.ieo?.decile || 'N/A'}/10)
`;
  }

  // Crime — the shared block, composed from the loaded registers.
  if (enhancedData.crimeStatistics) {
    context += `\n**CRIME & SAFETY:**\n${crimeStatBlocks(enhancedData)}\n`;
  }

  // Employment data — Census structure only. The old block listed 1/3/5-year
  // job growth here, which no integrated source measures; three "N/A" growth
  // lines beside real figures read as blanks a model should fill, which is
  // an invitation to invent. Growth is omitted and expressly forbidden.
  if (enhancedData.employmentData) {
    const emp = enhancedData.employmentData;
    const industries = (emp.majorIndustries ?? emp.industries)?.slice(0, 3)
      .map((i: any) => `${i.name} (${i.percentage}%)`).join(', ');
    context += `
**EMPLOYMENT (${emp.dataSource || 'ABS Census'}):**
- Employment Rate (of labour force): ${emp.employmentRate ?? 'N/A'}%
- Unemployment Rate: ${emp.unemploymentRate ?? 'N/A'}%
- Participation Rate: ${emp.participationRate ?? 'N/A'}%
- Labour Force Size: ${emp.laborForceSize ?? 'N/A'}
- Top Industries: ${industries || 'N/A'}
- No employment time-series is available: do NOT assert job-growth figures.
`;
  }

  // Climate & hazards — the shared block (SILO normals with their windows,
  // hazard rows only where a real level was assessed).
  if (enhancedData.climateData || enhancedData.riskAssessment) {
    context += `\n**CLIMATE & ENVIRONMENT:**\n${climateStatBlocks(enhancedData)}\n`;
  }

  // Planning & zoning, and the measured population trend for the SA2 —
  // both coordinate-keyed, both previously absent from this path entirely.
  if (enhancedData.planningData) {
    context += `\n**PLANNING & DEVELOPMENT:**\n${planningStatBlocks(enhancedData)}\n`;
  }
  if (enhancedData.regionalTrends) {
    context += `\n**POPULATION TREND:**\n${regionalTrendBlocks(enhancedData)}\n`;
  }

  // Risk assessment
  if (enhancedData.riskAssessment) {
    const risk = enhancedData.riskAssessment;
    context += `
**ENVIRONMENTAL RISKS:**
- Flood Risk: ${risk.floodRisk?.level || 'N/A'} (${risk.floodRisk?.description || ''})
- Bushfire Risk: ${risk.bushfireRisk?.level || 'N/A'} (${risk.bushfireRisk?.description || ''})
- Coastal Erosion: ${risk.coastalRisk?.level || 'N/A'}
- Overall Risk Score: ${risk.overallScore || 'N/A'}/100
`;
  }

  // School data
  if (enhancedData.schoolData) {
    const schools = enhancedData.schoolData;
    context += `
**EDUCATION:**
- Total Schools in Postcode: ${schools.summary?.totalSchools || 'N/A'}
- Average School Rating: ${schools.summary?.averageRating || 'N/A'}/5
- Nearest School: ${schools.nearestSchool?.name || 'N/A'} (${schools.nearestSchool?.distance || 'N/A'} km)
- Education Quality: ${schools.summary?.qualityAssessment || 'N/A'}
`;
  }

  // Financial data
  if (enhancedData.financials) {
    const fin = enhancedData.financials;
    context += `
**FINANCIAL CALCULATIONS:**
- Property Value: $${fin.initialCosts?.propertyValue?.toLocaleString() || 'N/A'}
- Stamp Duty: $${fin.initialCosts?.stampDuty?.toLocaleString() || 'N/A'}
- Loan Amount: $${fin.loanDetails?.loanAmount?.toLocaleString() || 'N/A'}
- Monthly Repayment (P&I): $${fin.loanDetails?.monthlyPayment?.toLocaleString() || 'N/A'}
- Monthly Repayment (IO): $${fin.loanDetails?.interestOnlyPayment?.toLocaleString() || 'N/A'}
- Gross Rental Yield: ${fin.keyMetrics?.grossRentalYield || 'N/A'}%
- Net Rental Yield: ${fin.keyMetrics?.netRentalYield || 'N/A'}%
- Annual Net Cashflow: $${fin.keyMetrics?.annualNet?.toLocaleString() || 'N/A'}
- Total Annual Costs: $${fin.annualCosts?.totalAnnual?.toLocaleString() || 'N/A'}
`;
  }

  // Investment score
  if (enhancedData.investmentScore) {
    const score = enhancedData.investmentScore;
    context += `
**INVESTMENT SCORE:**
- Total Score: ${score.totalScore || 'N/A'}/100
- Grade: ${score.grade || 'N/A'}
- Recommendation: ${score.recommendation || 'N/A'}
- Growth Score: ${score.breakdown?.growthScore?.score || 'N/A'}/100
- Location Score: ${score.breakdown?.locationScore?.score || 'N/A'}/100
- Yield Score: ${score.breakdown?.yieldScore?.score || 'N/A'}/100
- Demand Score: ${score.breakdown?.demandScore?.score || 'N/A'}/100
- Risk Score: ${score.breakdown?.riskScore?.score || 'N/A'}/100
${score.strengths?.length ? `- Strengths: ${score.strengths.join(', ')}` : ''}
${score.weaknesses?.length ? `- Weaknesses: ${score.weaknesses.join(', ')}` : ''}
`;
  }

  return context;
}

// Section-to-template mapping for extracting relevant portions
const SECTION_TEMPLATE_MARKERS: Record<string, { startPatterns: string[]; endPatterns: string[]; fallbackKeywords: string[] }> = {
  'section1': {
    startPatterns: ['# Location', '## Location Overview', '# LOCATION', '## LOCATION OVERVIEW', '# 1.', '## 1.'],
    endPatterns: ['# Amenities', '## Amenities', '# Schools', '## Schools', '# 2.', '## 2.', '# AMENITIES'],
    fallbackKeywords: ['location', 'market', 'demographic', 'population', 'economic context', 'demand drivers']
  },
  'section2': {
    startPatterns: ['# Amenities', '## Amenities', '# Schools', '## Schools', '# 2.', '## 2.', '# AMENITIES'],
    endPatterns: ['# Property', '## Property', '# Financial', '## Financial', '# Purchase', '# 3.', '## 3.'],
    fallbackKeywords: ['school', 'education', 'healthcare', 'transport', 'crime', 'safety', 'environmental', 'climate', 'recreational']
  },
  'section3': {
    startPatterns: ['# Property', '## Property', '# Financial', '## Financial', '# Purchase', '# 3.', '## 3.'],
    endPatterns: ['# Projection', '## Projection', '# SWOT', '## SWOT', '# 10-Year', '# 4.', '## 4.', '# Investment Score'],
    fallbackKeywords: ['property-level', 'purchase', 'stamp duty', 'rental', 'yield', 'loan', 'cashflow', 'repayment']
  },
  'section4': {
    startPatterns: ['# Projection', '## Projection', '# SWOT', '## SWOT', '# 10-Year', '# 4.', '## 4.', '# Investment Score'],
    endPatterns: ['# DATA SOURCES', '## DATA SOURCES', '# APPENDIX', '# END'],
    fallbackKeywords: ['projection', 'swot', 'opportunity', 'risk', 'recommendation', 'suitability', 'conclusion', 'score']
  }
};

// Extract relevant section from full template
function extractSectionFromTemplate(fullTemplate: string, sectionId: string): string {
  if (!fullTemplate || fullTemplate.length < 100) return '';
  
  const markers = SECTION_TEMPLATE_MARKERS[sectionId];
  if (!markers) return '';
  
  // Try to find start position using patterns
  let startPos = -1;
  for (const pattern of markers.startPatterns) {
    const idx = fullTemplate.toLowerCase().indexOf(pattern.toLowerCase());
    if (idx !== -1 && (startPos === -1 || idx < startPos)) {
      startPos = idx;
      break;
    }
  }
  
  // Try to find end position using patterns
  let endPos = fullTemplate.length;
  if (startPos !== -1) {
    for (const pattern of markers.endPatterns) {
      const idx = fullTemplate.toLowerCase().indexOf(pattern.toLowerCase(), startPos + 50);
      if (idx !== -1 && idx < endPos) {
        endPos = idx;
        break;
      }
    }
  }
  
  // Extract the section
  let sectionContent = '';
  if (startPos !== -1) {
    sectionContent = fullTemplate.substring(startPos, endPos).trim();
  }
  
  // If extraction failed or too short, use keyword-based extraction
  if (sectionContent.length < 200) {
    console.log(`⚠️ Section ${sectionId} pattern extraction failed, using keyword search`);
    sectionContent = extractByKeywords(fullTemplate, markers.fallbackKeywords);
  }
  
  return sectionContent;
}

// Extract content containing specific keywords
function extractByKeywords(template: string, keywords: string[]): string {
  const lines = template.split('\n');
  const relevantLines: string[] = [];
  let inRelevantSection = false;
  let headingBuffer = '';
  
  for (const line of lines) {
    const lineLower = line.toLowerCase();
    const isHeading = line.match(/^#{1,3}\s+/);
    
    if (isHeading) {
      // Check if heading contains any keywords
      const hasKeyword = keywords.some(kw => lineLower.includes(kw.toLowerCase()));
      if (hasKeyword) {
        inRelevantSection = true;
        if (headingBuffer) relevantLines.push(headingBuffer);
        relevantLines.push(line);
        headingBuffer = '';
      } else {
        // New heading without keyword - stop if we were in relevant section
        if (inRelevantSection && relevantLines.length > 10) {
          inRelevantSection = false;
        }
        headingBuffer = line;
      }
    } else if (inRelevantSection) {
      relevantLines.push(line);
    }
  }
  
  return relevantLines.join('\n').substring(0, 8000);
}

// Summarize template section into structural requirements
function summarizeTemplateStructure(sectionContent: string, sectionDef: typeof REPORT_SECTIONS[0]): string {
  if (!sectionContent || sectionContent.length < 100) {
    // Fallback: generate requirements from section definition
    return `
**REQUIRED STRUCTURE FOR ${sectionDef.name.toUpperCase()}:**
${sectionDef.sections.map((s, i) => `${i + 1}. ## ${s}`).join('\n')}

**MINIMUM REQUIREMENTS:**
- Content length: ${sectionDef.minContentLength}+ characters
- Must include: ${sectionDef.requiredKeywords.join(', ')}
- Use markdown tables for data presentation
- Include bullet points with detailed explanations
`;
  }
  
  // Extract headings from template section
  const headings: string[] = [];
  const tablePatterns: string[] = [];
  const bulletPatterns: string[] = [];
  
  const lines = sectionContent.split('\n');
  for (const line of lines) {
    // Extract headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      headings.push(`${headingMatch[1]} ${headingMatch[2].trim()}`);
    }
    
    // Detect table requirements
    if (line.includes('|') && line.includes('---')) {
      const tableContext = lines.slice(Math.max(0, lines.indexOf(line) - 3), lines.indexOf(line)).join(' ');
      if (tableContext.length > 0 && !tablePatterns.includes(tableContext.substring(0, 100))) {
        tablePatterns.push(tableContext.substring(0, 100));
      }
    }
    
    // Detect bullet list patterns
    if (line.match(/^[-*]\s+\*\*[^*]+\*\*/)) {
      bulletPatterns.push(line.substring(0, 80));
    }
  }
  
  // Build structured summary
  let summary = `
**REQUIRED STRUCTURE FOR ${sectionDef.name.toUpperCase()}:**

**Headings (in this exact order):**
${headings.slice(0, 15).join('\n')}

**Content Requirements:**
- Minimum content: ${sectionDef.minContentLength}+ characters
- Required topics: ${sectionDef.requiredKeywords.join(', ')}
`;

  if (tablePatterns.length > 0) {
    summary += `
**Tables Required:** ${tablePatterns.length} data tables expected
`;
  }

  // Add sample structure from template (limited)
  const sampleContent = sectionContent.substring(0, 3000);
  summary += `
**Template Sample (follow this style):**
${sampleContent}
`;

  return summary;
}

// Generate a single section with full context - matches generate-investment-report approach
async function regenerateSection(
  sectionDef: typeof REPORT_SECTIONS[0],
  originalSectionContent: string,
  overrideSummary: string,
  perplexityApiKey: string,
  previousSections: string,
  propertyAddress: string,
  enhancedData: EnhancedData,
  templateContext?: string,
  // RF-7.2B.1A — the withheld-category prohibition, composed by the caller
  // from the same snapshot the gate produced. Passed in rather than derived
  // here because this function does not hold the snapshot, and deriving it
  // from `enhancedData` would be a second opinion about what was withheld.
  governedDirective: string = '',
  maxRetries: number = 2
): Promise<{ content: string; citations: any[]; error?: string }> {
  
  // Build enhanced data context
  const enhancedDataContext = buildEnhancedDataContext(enhancedData, propertyAddress);
  
  // Build investment score context for Section 4
  let investmentScoreContext = '';
  if (sectionDef.id === 'section4' && enhancedData.investmentScore) {
    const score = enhancedData.investmentScore;
    console.log('📊 Injecting investment score data into section 4:', {
      totalScore: score.totalScore,
      grade: score.grade,
      recommendation: score.recommendation
    });
    
    investmentScoreContext = `
**INVESTMENT SCORE DATA (USE THESE EXACT VALUES):**
- Total Investment Score: ${score.totalScore}/100
- Investment Grade: ${score.grade}
- Recommendation: ${score.recommendation}
- Growth Score: ${score.breakdown?.growthScore?.score || 'N/A'}/100 (Weight: ${score.breakdown?.growthScore?.weight || 40}%)
- Location Score: ${score.breakdown?.locationScore?.score || 'N/A'}/100 (Weight: ${score.breakdown?.locationScore?.weight || 25}%)
- Yield Score: ${score.breakdown?.yieldScore?.score || 'N/A'}/100 (Weight: ${score.breakdown?.yieldScore?.weight || 15}%)
- Demand Score: ${score.breakdown?.demandScore?.score || 'N/A'}/100 (Weight: ${score.breakdown?.demandScore?.weight || 15}%)
- Risk Score: ${score.breakdown?.riskScore?.score || 'N/A'}/100 (Weight: ${score.breakdown?.riskScore?.weight || 5}%)
${score.strengths?.length ? `- Strengths: ${score.strengths.join(', ')}` : ''}
${score.weaknesses?.length ? `- Weaknesses: ${score.weaknesses.join(', ')}` : ''}
${score.opportunities?.length ? `- Opportunities: ${score.opportunities.join(', ')}` : ''}
${score.risks?.length ? `- Risks: ${score.risks.join(', ')}` : ''}

**CRITICAL: You MUST include the Investment Score Analysis section with the EXACT values above. Do NOT skip this section or use placeholder values.**

`;
  }

  // Extract and summarize relevant template section (hybrid approach)
  let templateSection = '';
  if (templateContext && templateContext.length > 100) {
    const extractedSection = extractSectionFromTemplate(templateContext, sectionDef.id);
    const structuredSummary = summarizeTemplateStructure(extractedSection, sectionDef);
    
    console.log(`📋 Template extraction for ${sectionDef.id}: ${extractedSection.length} chars extracted, summary: ${structuredSummary.length} chars`);
    
    templateSection = `
---
${structuredSummary}
---
`;
  } else {
    // No template - use section definition as fallback
    templateSection = `
---
**REQUIRED STRUCTURE FOR ${sectionDef.name.toUpperCase()}:**
${sectionDef.sections.map((s, i) => `${i + 1}. ## ${s}`).join('\n')}

**Requirements:**
- Minimum content: ${sectionDef.minContentLength}+ characters
- Must include: ${sectionDef.requiredKeywords.join(', ')}
- Use markdown tables for data
- Include detailed bullet points
---
`;
  }

  // IMPORTANT: This is a REGENERATION - we generate COMPLETELY FRESH content
  // DO NOT reference original content - this ensures truly new analysis each time
  const _brandRq = await getBrandConfig();
  let sectionPrompt = `You are an expert Australian property investment analyst for ${_brandRq.companyName}.
You are creating a FRESH, COMPREHENSIVE section for an investment report for: ${propertyAddress}

**SECTION TO CREATE:** ${sectionDef.name}
**Subsections to include:** ${sectionDef.sections.join(', ')}

${templateSection}

**LIVE DATA FROM AUTHORITATIVE SOURCES (USE THIS DATA):**
${enhancedDataContext}

**CLIENT-SPECIFIED VALUES (Use these EXACT values in calculations and analysis):**
${overrideSummary}

${investmentScoreContext}

${previousSections ? `**CONTEXT FROM PREVIOUS SECTIONS (for consistency only - DO NOT repeat this content):**
${previousSections.substring(0, 4000)}...
` : ''}

**CRITICAL INSTRUCTIONS:**
1. This is a REGENERATION: write FRESH content (new wording), but keep the REQUIRED structure
2. Follow the provided template section STRICTLY (headings, order, and required subsections) — do not add/remove/reorder headings
3. Generate ONLY this section; no extra introductions or conclusions beyond the template
4. Use markdown headings exactly: # for main section, ## for subsections, ### for sub-subsections
5. Use the LIVE DATA + client values above; do not use placeholders like "XX" or "N/A" when data is available
6. Include the tables required by the template using real numbers from the data context
7. Use horizontal rules (---) where the template expects them
8. Start immediately with the first required heading (no preamble)
9. Include inline citations in [Source] format (e.g., [ABS Census 2021], [RBA], [Domain], [SEIFA], [BOM])
${sectionDef.id === 'section4' ? '10. MUST include the Investment Score Analysis with the EXACT score values provided above' : ''}

**EDITORIAL PRIMITIVES (USE SPARINGLY — max 1 visualisation + 1 pull-quote per chapter)**
The renderer converts these shortcodes to print-quality typography and inline SVG. Each must sit on its own line(s) with a blank line before and after. Use REAL figures only — never fabricate to fill a chart.

- Pull quote: \`::: pullquote\\nOne striking sentence.\\n:::\`
- Sidenote (margin aside, ≤25 words): \`::: sidenote\\nShort aside.\\n:::\`
- Gauge: \`{{gauge: 78 | Label | Caption}}\`  (value 0–100 unless \`78/MAX\`)
- Waterfall: \`{{waterfall: Rent +28000, Interest -19500, Net =8500}}\`
- Heatmap: \`{{heatmap: 5.2,6.1 / 4.8,5.9 | rows=2025,2026 | cols=Q1,Q2 | title=Growth %}}\`
- Score wheel: \`{{wheel: 78,64,82,71 | labels=Yield,Growth,Risk,Demand | title=Breakdown}}\`
- Footnote: inline \`[^id]\` + def line \`[^id]: source text.\` (same section)
- Cross-ref: \`[[see:#ch-risk-analysis]]\` resolves to a real page number.
- Section divider (max 1/chapter, breaks page): \`::: divider stat="78" label="Composite score" eyebrow="Chapter 04"\\nHeadline thesis line.\\n:::\`
- Quote page (max 1/report, breaks page): \`::: quote-page attribution="RBA, May 2026" eyebrow="Market context"\\n"Single editorial line."\\n:::\`
- Inline stat block: \`::: stat label="Median yield" unit="%" sub="trailing 12mo"\\n4.8\\n:::\`

${governedDirective}

Generate the ${sectionDef.name} section now:`;

  // MUST match generate-investment-report, with regeneration note added
  // CRITICAL FIX: Removed hardcoded "$1,500 maintenance" instruction - use data-driven values from overrides
  const { resolvePrompt: _resolveRegenPrompt } = await import('../_shared/engine-prompts.ts');
  const systemMessage = limitPromptContext((await _resolveRegenPrompt('regenerate.qualitative_system', { brand_name: _brandRq.companyName })).text, PERPLEXITY_SAFE_SYSTEM_MESSAGE_BYTES, 'Regeneration system prompt', 'head');
  if (byteLength(sectionPrompt) > PERPLEXITY_SAFE_USER_MESSAGE_BYTES) {
    const previousBlock = previousSections
      ? `\n\n**CONTEXT FROM PREVIOUS SECTIONS (tail only for consistency — do not repeat):**\n${sliceTailByBytes(previousSections, 3_500)}\n`
      : '';
    sectionPrompt = limitPromptContext(
      `You are an expert Australian property investment analyst for ${_brandRq.companyName}.\nCreate a fresh section for: ${propertyAddress}\n\n**SECTION:** ${sectionDef.name}\n**Subsections:** ${sectionDef.sections.join(', ')}\n\n${templateSection}\n\n**LIVE DATA:**\n${enhancedDataContext}\n\n**CLIENT VALUES:**\n${overrideSummary}\n\n${investmentScoreContext}${previousBlock}\n\nGenerate only this section using exact markdown headings and no placeholders.`,
      PERPLEXITY_SAFE_USER_MESSAGE_BYTES,
      `Regeneration prompt for ${sectionDef.name}`,
      'head-tail'
    );
  }
  console.log(`📏 Regeneration prompt size for ${sectionDef.name}: user=${byteLength(sectionPrompt)} bytes, system=${byteLength(systemMessage)} bytes`);

  // Retry loop - matches generate-investment-report
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📝 Regenerating section: ${sectionDef.name}... (attempt ${attempt}/${maxRetries})`);
      
      const response = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${perplexityApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sonar-pro',
          max_tokens: sectionDef.maxTokens,
          temperature: 0.1, // Match generate-investment-report temperature
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: sectionPrompt }
          ]
        }),
      }, 120000); // 120 second timeout per section (matches generate-investment-report)

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Section ${sectionDef.id} API error (attempt ${attempt}):`, response.status, errorText);
        
        // If rate limited or server error, wait and retry
        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          const waitTime = attempt * 5000; // 5s, 10s
          console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        return { content: '', citations: [], error: `API error ${response.status}: ${errorText}` };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const citations = data.citations || [];
      
      // Log Perplexity API usage
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sbLog = createClient(supabaseUrl, supabaseKey);
      const pUsage = data.usage;
      await logApiUsage(sbLog, {
        service_name: 'perplexity',
        endpoint: '/chat/completions',
        model_used: 'sonar-pro',
        prompt_tokens: pUsage?.prompt_tokens || 0,
        completion_tokens: pUsage?.completion_tokens || 0,
        tokens_used: pUsage?.total_tokens || 0,
        status: 'success',
        metadata: { function: 'regenerate-report-qualitative', section: sectionDef.name },
      });
      
      console.log(`✓ Section ${sectionDef.name} regenerated: ${content.length} chars`);
      
      return { content, citations };
    } catch (error: any) {
      console.error(`❌ Error regenerating section ${sectionDef.id} (attempt ${attempt}):`, error?.message);
      
      // Retry on timeout or network errors
      if (attempt < maxRetries) {
        const waitTime = attempt * 3000; // 3s, 6s
        console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      return { content: '', citations: [], error: error?.message };
    }
  }
  
  return { content: '', citations: [], error: 'Max retries exceeded' };
}

const __regenerateQualHandler = async (req: Request): Promise<Response> => {
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
    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
    if (!PERPLEXITY_API_KEY) {
      throw new Error('PERPLEXITY_API_KEY is not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { 
      reportId, 
      manualOverrides, 
      currentReportContent, 
      propertyAddress,
      financialCalculations,
      continueFrom = false,
      singleSection = false // NEW: chunked mode - only one section per call
    }: RegenerateRequest = body;

    // SECURITY: Verify authentication
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[regenerate-report-qualitative] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[regenerate-report-qualitative] Authenticated user: ${userId}`);

    console.log('=== ENHANCED MULTI-SECTION REPORT REGENERATION ===');
    console.log('📝 Report ID:', reportId);
    console.log('📍 Property:', propertyAddress);
    console.log('📊 Manual overrides:', Object.keys(manualOverrides).length, 'fields');
    console.log('📄 Original content length:', currentReportContent?.length || 0, 'chars');
    console.log('🔄 Continue from last section:', continueFrom);
    console.log('🔧 Single section mode:', singleSection);

    // ========== RESUME LOGIC ==========
    let resumeFromSection = 0;
    let existingContent = '';
    
    if (continueFrom) {
      // Fetch existing report state
      const { data: existingReport, error: fetchError } = await supabase
        .from('investment_reports')
        .select('report_content, last_completed_section, status')
        .eq('id', reportId)
        .single();
      
      if (fetchError) {
        console.error('Failed to fetch existing report for resume:', fetchError.message);
      } else if (existingReport) {
        resumeFromSection = (existingReport.last_completed_section || 0);
        existingContent = existingReport.report_content || '';
        
        console.log(`📌 Resuming from section ${resumeFromSection + 1}/${REPORT_SECTIONS.length}`);
        console.log(`📄 Existing content: ${existingContent.length} chars`);
        
        // If already complete (12 sections done), skip regeneration
        if (resumeFromSection >= REPORT_SECTIONS.length) {
          console.log('✅ Report already fully regenerated, skipping...');
          
          // Just update status to completed
          await supabase
            .from('investment_reports')
            .update({ status: 'completed', updated_at: new Date().toISOString() })
            .eq('id', reportId);
          
          return new Response(JSON.stringify({
            success: true,
            message: 'Report was already complete',
            resumed: true,
            contentLength: existingContent.length
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        // Strip any partial content from the interrupted section to prevent garbling
        // Find the last complete section separator and trim after it
        if (resumeFromSection > 0 && existingContent) {
          const sectionSeparators = existingContent.match(/\n---\n/g) || [];
          const expectedSeparators = resumeFromSection;
          
          if (sectionSeparators.length >= expectedSeparators) {
            // Find position after the Nth separator (where N = last completed section)
            let separatorCount = 0;
            let lastValidPosition = 0;
            let searchPos = 0;
            
            while (separatorCount < expectedSeparators) {
              const nextSep = existingContent.indexOf('\n---\n', searchPos);
              if (nextSep === -1) break;
              lastValidPosition = nextSep + 5; // Position after "---\n"
              searchPos = nextSep + 1;
              separatorCount++;
            }
            
            if (lastValidPosition > 0) {
              existingContent = existingContent.substring(0, lastValidPosition);
              console.log(`📏 Trimmed to ${existingContent.length} chars (after section ${resumeFromSection})`);
            }
          }
        }
      }
    }
    // ========== END RESUME LOGIC ==========

    // IMPORTANT: Mark as processing (only if not already processing during resume)
    // - This triggers version archiving ONCE (DB trigger)
    // - Prevents timeouts from happening *before* we even archive the old version
    if (!continueFrom) {
      await supabase
        .from('investment_reports')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', reportId);
    }

    // ========== FETCH ENHANCED DATA FROM ALL APIs ==========
    const { enhancedData, suburb, postcode, state, safeGeneration } = await fetchEnhancedData(
      propertyAddress,
      manualOverrides,
      supabaseUrl,
      supabaseAnonKey,
      { supabase, reportId },
    );

    // ========== FETCH TEMPLATE FROM DATABASE ==========
    let templateContext = '';
    try {
      console.log('🔍 Fetching AI structure template from database...');
      
      // Get report tier from the report if available
      const { data: reportData } = await supabase
        .from('investment_reports')
        .select('report_tier, report_scope')
        .eq('id', reportId)
        .single();
      
      const reportTier = reportData?.report_tier || 'compass';
      const reportCategory = reportData?.report_scope === 'suburb' ? 'suburb_snapshot' : 'investment';
      
      // Query report_structure_templates for the matching template
      const { data: templates, error: templateError } = await supabase
        .from('report_structure_templates')
        .select('id, name, parsed_content, report_tier, report_category')
        .eq('template_type', 'ai_structure')
        .eq('is_active', true)
        .order('priority', { ascending: false });
      
      if (templateError) {
        console.log('⚠️ Template query error:', templateError.message);
      } else if (templates && templates.length > 0) {
        let selectedTemplate = templates.find(t => 
          t.report_tier === reportTier && t.report_category === reportCategory
        ) || templates.find(t => 
          t.report_tier === reportTier && !t.report_category
        ) || templates.find(t => 
          !t.report_tier && t.report_category === reportCategory
        ) || templates.find(t => 
          !t.report_tier && !t.report_category
        ) || templates[0];
        
        if (selectedTemplate?.parsed_content) {
          templateContext = selectedTemplate.parsed_content;
          console.log(`✓ Template loaded: "${selectedTemplate.name}"`);
          console.log(`  Tier: ${selectedTemplate.report_tier || 'any'}, Category: ${selectedTemplate.report_category || 'any'}`);
        }
      }
    } catch (templateError: any) {
      console.log('⚠️ Template fetch failed (non-critical):', templateError?.message);
    }
    // ========== END TEMPLATE FETCH ==========

    // Build override summary for the AI
    const overrideSummary = buildOverrideSummary(manualOverrides, financialCalculations);
    console.log('📋 Override summary built:', overrideSummary.split('\n').length, 'lines');
    console.log('📊 Enhanced data sources loaded:', Object.keys(enhancedData).filter(k => enhancedData[k as keyof EnhancedData]).length);

    // Generate report header (only if starting fresh)
    const _brandHdr = await getBrandConfig();
    const reportHeader = `# ${_brandHdr.companyNameUpper}

YOUR DEDICATED PROPERTY PARTNER

# Investment Report: ${propertyAddress}

---

`;

    // Use existing content if resuming, otherwise start with header
    let combinedContent = (continueFrom && existingContent.length > 0) ? existingContent : reportHeader;
    let allCitations: any[] = [];
    let generationErrors: string[] = [];

    console.log('🔄 Regenerating report in', REPORT_SECTIONS.length, 'sections with enhanced data...');
    if (resumeFromSection > 0) {
      console.log(`📌 Skipping first ${resumeFromSection} sections (already complete)`);
    }

    // Track section quality for validation
    const sectionResults: Array<{ id: string; name: string; content: string; valid: boolean; score: number; attempts: number }> = [];
    
    // Status is already 'processing' (set immediately after request parsing).
    // Do not re-update here to avoid unnecessary DB writes.
    
    for (let i = resumeFromSection; i < REPORT_SECTIONS.length; i++) {
      const sectionDef = REPORT_SECTIONS[i];
      console.log(`\n📄 Regenerating section ${i + 1}/${REPORT_SECTIONS.length}: ${sectionDef.name} [FRESH GENERATION]`);
      
      // NOTE: We intentionally DO NOT pass original content to ensure fresh generation
      // The originalSectionContent is no longer used - this ensures truly new content
      console.log(`  Generating fresh content (not referencing original)`);
      
      // Pass context from previously regenerated sections for consistency only
      const previousContext = combinedContent.length > 500 ? combinedContent.substring(combinedContent.length - 2000) : '';
      
      // === SECTION GENERATION WITH VALIDATION AND RETRY ===
      let bestContent = '';
      let bestScore = 0;
      let sectionAttempts = 0;

      // Keep regeneration under the function request_timeout by avoiding multi-pass rewrites.
      // Perplexity already retries internally on network/timeout errors.
      const maxSectionAttempts = 1;
      
      for (let attempt = 1; attempt <= maxSectionAttempts; attempt++) {
        sectionAttempts = attempt;
        
        // Pass empty string for originalSectionContent to force fresh generation
        const result = await regenerateSection(
          sectionDef,
          '', // IMPORTANT: Empty string to force fresh content generation
          overrideSummary,
          PERPLEXITY_API_KEY,
          previousContext,
          propertyAddress,
          enhancedData,
          templateContext,
          governedCategoryDirective(safeGeneration.snapshot)
        );
        
        if (result.error) {
          console.error(`⚠️ Section ${sectionDef.name} attempt ${attempt} failed:`, result.error);
          if (attempt === maxSectionAttempts) {
            generationErrors.push(`${sectionDef.name}: ${result.error}`);
            // DO NOT fall back to original content - we want fresh content only
            // If generation fails, leave bestContent empty and log the error
            console.log(`  Section ${sectionDef.name} failed after ${maxSectionAttempts} attempts - no fallback used`);
          }
          continue;
        }
        
        if (result.content) {
          let cleanContent = result.content
            .replace(/^(Here|I will|Let me|Now|The following).*?:\s*/im, '')
            .replace(/^(Certainly|Sure|Of course).*?\n/im, '')
            .trim();
          
          // Validate section content
          const validation = validateSectionContent(sectionDef, cleanContent);
          console.log(`📊 Section ${sectionDef.name} validation (attempt ${attempt}):`, {
            contentLength: cleanContent.length,
            minRequired: sectionDef.minContentLength,
            score: validation.score,
            isValid: validation.isValid
          });
          
          if (validation.score > bestScore) {
            bestContent = cleanContent;
            bestScore = validation.score;
            allCitations = [...allCitations, ...result.citations];
          }
          
          if (validation.isValid) {
            console.log(`✓ Section ${sectionDef.name} passed validation with score ${validation.score}`);
            break;
          } else if (attempt < maxSectionAttempts) {
            console.log(`⚠️ Section ${sectionDef.name} below threshold, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      // === END SECTION GENERATION WITH VALIDATION ===
      
      if (bestContent) {
        combinedContent += bestContent + '\n\n---\n\n';
        sectionResults.push({
          id: sectionDef.id,
          name: sectionDef.name,
          content: bestContent,
          valid: bestScore >= 60,
          score: bestScore,
          attempts: sectionAttempts
        });
        
        // === PROGRESSIVE SAVE AFTER EACH SECTION ===
        // Note: Status is already 'processing', so these updates will NOT re-trigger archiving
        // Update last_completed_section for resume capability
        console.log(`💾 Progressive save after section ${i + 1}...`);
        const { error: progressError } = await supabase
          .from('investment_reports')
          .update({
            report_content: combinedContent,
            last_completed_section: i + 1, // Track completed section index (1-based for display)
            // Do NOT update status here - it stays 'processing', preventing additional archive triggers
            updated_at: new Date().toISOString()
          })
          .eq('id', reportId);
        
        if (progressError) {
          console.error(`⚠️ Progressive save failed:`, progressError.message);
        } else {
          console.log(`✓ Progress saved: ${combinedContent.length} chars (section ${i + 1}/${REPORT_SECTIONS.length})`);
        }

        // === SINGLE SECTION MODE: Return after completing one section ===
        if (singleSection) {
          const completedSection = i + 1;
          const isFullyComplete = completedSection >= REPORT_SECTIONS.length;
          
          console.log(`🔧 Single-section mode: Completed section ${completedSection}/${REPORT_SECTIONS.length}`);
          
          // If all sections done, mark as completed and add sources
          if (isFullyComplete) {
            console.log('✅ All sections complete in single-section mode, finalizing...');
            // Will continue to post-processing below
          } else {
            // Return immediately - UI will call again for next section
            return new Response(JSON.stringify({
              success: true,
              message: `Section ${completedSection}/${REPORT_SECTIONS.length} completed`,
              sectionCompleted: completedSection,
              totalSections: REPORT_SECTIONS.length,
              isComplete: false,
              contentLength: combinedContent.length
            }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }
      
      // Small delay between sections to avoid rate limiting
      if (!singleSection && i < REPORT_SECTIONS.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // === FINAL VALIDATION SUMMARY ===
    const totalScore = sectionResults.reduce((sum, s) => sum + s.score, 0);
    const avgScore = Math.round(totalScore / Math.max(sectionResults.length, 1));
    
    console.log('\n📊 === REGENERATION QUALITY SUMMARY ===');
    console.log(`Total content length: ${combinedContent.length} chars`);
    console.log(`Average section score: ${avgScore}/100`);
    console.log(`Sections regenerated: ${sectionResults.length}/${REPORT_SECTIONS.length}`);
    console.log(`Enhanced data sources used: ${Object.keys(enhancedData).filter(k => enhancedData[k as keyof EnhancedData]).length}`);

    // Check if we have substantial content (skip check for single-section mode partial completion)
    if (!singleSection && combinedContent.length < 5000) {
      const errorMsg = `Regeneration produced insufficient content (${combinedContent.length} chars). Errors: ${generationErrors.join('; ')}`;
      console.error('❌', errorMsg);
      throw new Error(errorMsg);
    }

    console.log(`\n✓ Enhanced multi-section regeneration complete`);
    console.log(`  Total content length: ${combinedContent.length} chars`);
    console.log(`  Total citations: ${allCitations.length}`);
    console.log(`  Sections with errors: ${generationErrors.length}`);

    // ========== POST-PROCESSING SANITIZATION ==========
    // Fix HTML entities and formatting artifacts
    combinedContent = combinedContent
      // Fix common HTML entities
      .replace(/&#x26;/g, '&')
      .replace(/&#x27;/g, "'")
      .replace(/&#x22;/g, '"')
      .replace(/&#x3C;/g, '<')
      .replace(/&#x3E;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      // Fix erroneous semicolons in text
      .replace(/(\w);(\s)/g, '$1,$2')
      // Remove stray page numbers appearing as standalone lines
      .replace(/^\d{1,3}\s*$/gm, '')
      // Remove pagination artifacts like "Page X of Y"
      .replace(/^Page\s+\d+\s*(of\s+\d+)?\s*$/gim, '')
      // Remove empty methodology sections (heading with no content before next heading)
      .replace(/#{2,3}\s*Methodology\s*Notes?\s*\n+(?=#{1,3}\s|\n*$)/gi, '')
      // Clean up excessive whitespace left after removals
      .replace(/\n{4,}/g, '\n\n\n')
      .replace(/(\n---\s*){2,}/g, '\n---\n')
      .trim();
    console.log('✓ Post-processing sanitization complete');
    // ========== END POST-PROCESSING SANITIZATION ==========

    // Build comprehensive sources section with enhanced data attribution
    combinedContent += '\n\n---\n\n## DATA SOURCES & REFERENCES\n\n';
    combinedContent += '### Primary Data Sources\n\n';
    combinedContent += 'This report utilises data from the following authoritative sources:\n\n';
    
    // Add explicit enhanced data source attributions
    const dataSources: string[] = [];
    
    if (enhancedData.demographics) {
      dataSources.push('**Australian Bureau of Statistics (ABS)** - Census 2021 demographic data including population, income, employment, and housing statistics');
    }
    if (enhancedData.economics) {
      dataSources.push('**Reserve Bank of Australia (RBA)** - Statistical tables F1.1, G1 and F5: cash rate target, consumer price inflation, and housing lending rates');
    }
    if (enhancedData.seifaData) {
      dataSources.push('**SEIFA (Socio-Economic Indexes for Areas)** - ABS socioeconomic advantage/disadvantage indices');
    }
    // Each line names the register that actually served the block. Five of
    // these used to name a source the pipeline does not read: climate was
    // attributed straight to the Bureau of Meteorology (it is SILO, the
    // Queensland Government's BoM-derived grid, whose CC BY 4.0 licence
    // asks for its own attribution), schools to ACARA/NAPLAN (a schools
    // directory and Google Places), employment to the Labour Force Survey
    // (the Census), market data to "Domain/CoreLogic" (CoreLogic is
    // deliberately not integrated), and crime to "safety scores" that no
    // longer exist. A misnamed source is a fabricated citation.
    if (enhancedData.crimeStatistics) {
      dataSources.push('**NSW BOCSAR / Queensland Police Service open data** - Recorded criminal incident counts by area and offence, with the register\'s own reference period');
    }
    if (enhancedData.employmentData) {
      dataSources.push('**Australian Bureau of Statistics** - Census 2021 employment structure: labour-force status, industry and occupation composition');
    }
    if (enhancedData.climateData) {
      dataSources.push('**SILO Data Drill (Queensland Government)** - Climate normals interpolated from Bureau of Meteorology observations, CC BY 4.0');
    }
    if (enhancedData.regionalTrends) {
      dataSources.push('**ABS Regional population** - Estimated resident population at 30 June by Statistical Area Level 2');
    }
    if (enhancedData.planningData) {
      dataSources.push('**State planning and cadastre services** - Zoning, overlays and parcel detail queried at the property coordinate, plus the council development-application register where published');
    }
    if (enhancedData.locationIntelligence) {
      dataSources.push('**Google Places and Distance Matrix** - Amenities, walk score and commute times measured from the property coordinate');
    }
    if (enhancedData.schoolData) {
      dataSources.push('**Schools directory and Google Places** - Nearby schools measured from the property coordinate');
    }
    if (enhancedData.financials) {
      dataSources.push('**Legislated state duty schedules** - Stamp duty computed from the schedule in force');
    }
    if (enhancedData.riskAssessment) {
      dataSources.push('**Geoscience Australia (AFRIP) and state fire authorities** - Flood and bushfire mapping queried at the property coordinate');
    }
    if (enhancedData.domainData) {
      dataSources.push('**Domain** - Property market data, median prices and rental yields');
    }
    
    dataSources.forEach((source, index) => {
      combinedContent += `${index + 1}. ${source}\n`;
    });
    
    // Add Perplexity web search citations if available
    if (allCitations.length > 0) {
      combinedContent += '\n### Additional Research Sources\n\n';
      const uniqueCitations = [...new Set(allCitations.map((c: any) => c.url || c.title || c))];
      uniqueCitations.slice(0, 15).forEach((citation: any, index: number) => { // Limit to 15 most relevant
        combinedContent += `${index + 1}. ${citation}\n`;
      });
    }
    
    // Add data disclaimer
    combinedContent += '\n### Data Disclaimer\n\n';
    combinedContent += `*Data sources accessed: ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}. `;
    combinedContent += 'All data is sourced from reputable government and industry databases. Market conditions may change. ';
    combinedContent += 'This report should be used as a guide only and does not constitute financial advice. ';
    combinedContent += 'We recommend consulting with qualified professionals before making investment decisions.*\n';

    // Update the report in the database with enhanced data and mark as completed
    const updatePayload: any = {
      report_content: combinedContent,
      status: 'completed',
      updated_at: new Date().toISOString()
    };

    // Store enhanced data in the report (using correct column names from schema)
    if (Object.keys(enhancedData).length > 0) {
      updatePayload.demographics_data = enhancedData.demographics || null;
      updatePayload.economic_data = enhancedData.economics || null;
      // A qualitative regeneration rewrites the prose from freshly-fetched
      // facts, so the report-time snapshot is refreshed with it. Leaving the
      // old one would leave the document and its provenance describing
      // different runs. This is an explicit rewrite, not a reopen — reopening
      // still reads the stored snapshot and re-queries nothing.
      updatePayload.market_fact_snapshot = safeGeneration.snapshot;

      // RF-7.2B.1A — this path rewrites the prose with the same
      // search-grounded model the first generation uses, so it can re-source a
      // withheld category exactly as that one did. Protecting only the first
      // generation would leave regeneration as an open door to the same
      // defect. Same shared module, same rule, same blocking flag.
      //
      // Prior governed verdicts are dropped rather than merged: they describe
      // prose this run has just replaced. Every other flag type is left alone,
      // because nothing here recomputes those.
      const governedContext = {
        // RF-7.2B.1A.1 — same context the first generation uses; two audits of
        // one document must not judge the subject's own postcode differently.
        subjectPostcode: subjectPostcodeForAudit(safeGeneration.snapshot, propertyAddress),
      };
      let governedFaults = auditGovernedNarrativeAuthority(
        combinedContent, safeGeneration.snapshot, governedContext,
      );
      // RF-7.2B.1A.2 — the same repair the first generation performs, because
      // this path rewrites the prose with the same search-grounded model and
      // can reproduce the same claim. `updatePayload.report_content` was
      // assigned BEFORE this point, so the remediated text has to be written
      // back over it — mutating `combinedContent` alone would store the
      // unrepaired document.
      const governedRemovals: GovernedRemoval[] = [];
      if (governedFaults.length > 0) {
        const pass1 = remediateGovernedNarrative(
          combinedContent, safeGeneration.snapshot, governedContext,
        );
        if (pass1.changed) {
          combinedContent = pass1.text;
          updatePayload.report_content = combinedContent;
          governedRemovals.push(...pass1.removed);
          governedFaults = auditGovernedNarrativeAuthority(
            combinedContent, safeGeneration.snapshot, governedContext,
          );
        }
        if (governedFaults.length > 0) {
          const pass2 = remediateGovernedNarrative(
            combinedContent, safeGeneration.snapshot, governedContext, { disclose: false },
          );
          if (pass2.changed) {
            combinedContent = pass2.text;
            updatePayload.report_content = combinedContent;
            governedRemovals.push(...pass2.removed);
            governedFaults = auditGovernedNarrativeAuthority(
              combinedContent, safeGeneration.snapshot, governedContext,
            );
          }
        }
        console.log(
          `\u2713 Governed-authority remediation (regeneration): ${governedRemovals.length} `
          + `claim(s) removed, ${governedFaults.length} finding(s) remain`,
        );
      }
      const { data: priorFlagRow } = await supabase
        .from('investment_reports')
        .select('validation_flags')
        .eq('id', reportId)
        .maybeSingle();
      const priorFlags = Array.isArray(priorFlagRow?.validation_flags)
        ? priorFlagRow.validation_flags as unknown[]
        : [];
      updatePayload.validation_flags = [
        ...priorFlags.filter((f: unknown) => {
          const row = f as Record<string, unknown> | null;
          return !(row && typeof row === 'object' && row.type === GOVERNED_AUTHORITY_FLAG_TYPE);
        }),
        ...governedRemovals.map(governedRemediatedFlag),
        ...governedFaults.map(governedFaultToFlag),
      ];
      if (governedAuthorityBlocks(governedFaults)) {
        console.error(
          `⛔ Governed-authority audit (regeneration): ${governedFaults.length} BLOCKING finding(s) — `
          + governedFaults.map((f) => `${f.category}/${f.kind}`).join(', ')
          + '. This report asserts a governed fact it does not hold; it is not client-ready.',
        );
      }
      updatePayload.investment_score = enhancedData.investmentScore || null;
      
      // Merge enhanced financials with any existing data
      if (enhancedData.financials) {
        updatePayload.financial_calculations = {
          ...(financialCalculations || {}),
          ...enhancedData.financials
        };
      }
    }

    const { error: updateError } = await supabase
      .from('investment_reports')
      .update(updatePayload)
      .eq('id', reportId);

    if (updateError) {
      console.error('❌ Database update error:', updateError);
      // Try to mark as failed if update fails
      await supabase
        .from('investment_reports')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', reportId);
      throw updateError;
    }

    // Add success notification for regeneration
    try {
      await supabase
        .from('notifications')
        .insert({
          type: 'report_regeneration_completed',
          title: 'Report Regenerated',
          message: `Report for ${propertyAddress} has been regenerated with updated analysis`,
          report_id: reportId,
          entity_id: reportId,
          read: false
        });
      console.log('✓ Regeneration success notification created');
    } catch (notifError) {
      console.error('Failed to create notification:', notifError);
    }

    console.log('✅ Report regeneration complete - status set to completed');

    return new Response(JSON.stringify({
      success: true,
      message: 'Report regenerated successfully with enhanced data from all API sources',
      citations: allCitations,
      contentLength: combinedContent.length,
      sectionsGenerated: REPORT_SECTIONS.length,
      sectionsWithErrors: generationErrors.length,
      enhancedDataSources: Object.keys(enhancedData).filter(k => enhancedData[k as keyof EnhancedData]).length,
      averageQualityScore: avgScore
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Regenerate report error:', error);
    
    // Try to mark report as failed in the database
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const failureClient = createClient(supabaseUrl, supabaseServiceKey);
      
      // Extract reportId from the request if possible
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`⚠️ Attempting to mark report as failed: ${errorMessage}`);
      
    } catch (dbError) {
      console.error('Could not update report status:', dbError);
    }
    
    // Try to add failure notification
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const failureClient = createClient(supabaseUrl, supabaseServiceKey);
      
      await failureClient
        .from('notifications')
        .insert({
          type: 'report_regeneration_failed',
          title: 'Report Regeneration Failed',
          message: `Failed to regenerate report: ${error instanceof Error ? error.message : 'Unknown error'}`,
          read: false
        });
    } catch (notifError) {
      console.error('Could not create failure notification:', notifError);
    }
    
    return new Response(JSON.stringify({
      ...internalError(error, 'regenerate-report-qualitative'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

function buildOverrideSummary(overrides: Record<string, any>, financials?: Record<string, any>): string {
  const summaryLines: string[] = [];
  
  const fieldLabels: Record<string, string> = {
    purchasePrice: 'Purchase Price',
    weeklyRent: 'Weekly Rent',
    interestRate: 'Interest Rate',
    loanToValueRatio: 'Loan to Value Ratio (LVR)',
    capitalGrowth: 'Expected Capital Growth',
    stampDuty: 'Stamp Duty',
    councilRates: 'Council Rates',
    waterRates: 'Water Rates',
    bodyCorporateFees: 'Body Corporate/Strata Fees',
    landTax: 'Land Tax',
    buildingLandlordInsurance: 'Building & Landlord Insurance',
    propertyManagementFees: 'Property Management Fees',
    repairsMaintenance: 'Repairs & Maintenance',
    lettingFees: 'Letting Fees',
    depreciation: 'Annual Depreciation',
    taxRate: 'Marginal Tax Rate',
    occupancyRate: 'Occupancy Rate',
    loanAmount: 'Loan Amount',
    depositValue: 'Deposit Value',
    landPrice: 'Land Price',
    buildPrice: 'Build Price',
    buildType: 'Build Type',
    loanTermYears: 'Loan Term (Years)',
    isNewBuild: 'New Build Property',
    isFirstHomeBuyer: 'First Home Buyer',
    landSizeSqm: 'Land Size (sqm)',
    buildSizeSqm: 'Build Size (sqm)',
    bedrooms: 'Bedrooms',
    bathrooms: 'Bathrooms',
    carSpaces: 'Car Spaces',
    propertyType: 'Property Type',
  };

  const currencyFields = [
    'purchasePrice', 'weeklyRent', 'stampDuty', 'councilRates', 'waterRates',
    'bodyCorporateFees', 'landTax', 'buildingLandlordInsurance', 'repairsMaintenance',
    'lettingFees', 'depreciation', 'loanAmount', 'depositValue', 'landPrice', 'buildPrice'
  ];

  const percentFields = [
    'interestRate', 'loanToValueRatio', 'capitalGrowth', 'propertyManagementFees',
    'taxRate', 'occupancyRate'
  ];

  for (const [key, value] of Object.entries(overrides)) {
    // Skip internal toggle/config fields
    if (key.includes('Toggle') || key === 'cashFlowFieldToggles' || 
        key === 'includeDepreciationInCashFlow' || key === 'schedulePreset' ||
        key === 'customStageMonths' || key === 'cashFlowYearlyOverrides' ||
        key === 'depreciationSchedule' || key === 'depreciationMethod') {
      continue;
    }

    const label = fieldLabels[key] || key;
    
    if (value === null || value === undefined || value === '') continue;

    let formattedValue: string;
    if (currencyFields.includes(key)) {
      formattedValue = `$${Number(value).toLocaleString()}`;
    } else if (percentFields.includes(key)) {
      formattedValue = `${value}%`;
    } else if (typeof value === 'boolean') {
      formattedValue = value ? 'Yes' : 'No';
    } else {
      formattedValue = String(value);
    }

    summaryLines.push(`- ${label}: ${formattedValue}`);
  }

  // Add calculated metrics if available
  if (financials) {
    summaryLines.push('\n**Calculated Financial Metrics:**');
    if (financials.grossRentalYield) {
      summaryLines.push(`- Gross Rental Yield: ${financials.grossRentalYield}%`);
    }
    if (financials.netRentalYield) {
      summaryLines.push(`- Net Rental Yield: ${financials.netRentalYield}%`);
    }
    if (financials.annualCashFlow !== undefined) {
      const cashFlowStr = financials.annualCashFlow >= 0 
        ? `$${Number(financials.annualCashFlow).toLocaleString()}`
        : `($${Math.abs(Number(financials.annualCashFlow)).toLocaleString()})`;
      summaryLines.push(`- Annual Cash Flow: ${cashFlowStr}`);
    }
    if (financials.weeklyCashFlow !== undefined) {
      const weeklyCashFlowStr = financials.weeklyCashFlow >= 0 
        ? `$${Number(financials.weeklyCashFlow).toLocaleString()}`
        : `($${Math.abs(Number(financials.weeklyCashFlow)).toLocaleString()})`;
      summaryLines.push(`- Weekly Cash Flow: ${weeklyCashFlowStr}`);
    }
    if (financials.totalAnnualExpenses) {
      summaryLines.push(`- Total Annual Expenses: $${Number(financials.totalAnnualExpenses).toLocaleString()}`);
    }
    if (financials.annualRentalIncome) {
      summaryLines.push(`- Annual Rental Income: $${Number(financials.annualRentalIncome).toLocaleString()}`);
    }
  }

  return summaryLines.length > 0 
    ? summaryLines.join('\n') 
    : 'No specific overrides provided - regenerate based on original report data.';
}

Deno.serve(withReportMetering(async (body, req) => {
  if (!body) return null;
  const userId = await resolveUserId(req, body);
  if (!userId) return null;
  const overrideKeys = body?.manualOverrides ? Object.keys(body.manualOverrides).sort().join(',') : '';
  const idempotencyKey = buildIdempotencyKey('regen-qual', [
    body?.reportId,
    overrideKeys,
    body?.currentReportContent ? body.currentReportContent.length : 0,
  ]);
  return {
    kind: 'report.qualitative-regen' as const,
    userId,
    idempotencyKey,
    estimateOptions: { aiNarrative: true },
    requestPayload: { reportId: body?.reportId, propertyAddress: body?.propertyAddress },
  };
}, __regenerateQualHandler));
