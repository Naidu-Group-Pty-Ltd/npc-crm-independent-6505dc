/**
 * The Investment report PDF, drawn in the browser.
 *
 * This is the generation core of `PixelPerfectPDFGenerator` — pdf-lib, vector
 * text, embedded fonts, the cover, the tables, the disclaimer page — lifted out
 * of the React component **unchanged** so that two callers can share one
 * document rather than agreeing to produce the same one twice:
 *
 *  * the component itself, which still renders the button and still uploads;
 *  * `deliverInvestmentPdf`, the unified delivery contract every surface goes
 *    through (primary download, Send to Client, the premium button, the
 *    flatten copy).
 *
 * ## Why it stops at the Blob
 *
 * The component's `generateCore` used to upload to Supabase Storage and write
 * `pdf_url` itself, and `publishInvestmentPdf` does exactly the same thing at
 * the other end of the delivery contract. Sharing the generator without
 * splitting there would mean two uploads and two writes for one document. So
 * this returns the bytes and the name, and **storage is the caller's**:
 * `secureStorageUpload` → `manage-investment-reports` → `pdf_url`, once.
 *
 * ## What was NOT changed
 *
 * The drawing is byte-for-byte the code that produced 263 of the 275
 * Investment PDFs this product has delivered. No layout, no typography, no
 * section logic, no branding and no disclaimer wording moved. The only edits
 * this extraction required were a `useRef` that was a mutable map becoming a
 * plain one, and the return.
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  filterSections,
  resolvePresentationOptions,
  type InvestmentPresentationOptions,
} from './presentationOptions';
import {
  drawProjectionLineChart,
  drawScoreBars,
  drawSparkline,
  readProjectionSeries,
  readScoreComponents,
  sparklineSeries,
  type FigurePalette,
} from './investmentPdfFigures';
import { tabulateVizDirectives } from '@/lib/reports/vizDirectiveTables.pure';
import { rentIsEstablished } from '@/lib/reports/investment/rentalEvidence.pure';
import { presenceOf } from '../../../../supabase/functions/_shared/reports/contract/visibilityPolicy.pure';
import { contentPolicyFor } from './tierContent.pure';
import { audiencePolicyFor } from './audienceContent.pure';
import { documentTitleForTier } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import { meaningfulPropertyType } from '@/lib/reports/investment/propertyRecord.pure';
import {
  ANONYMOUS_GRID_NOTICE,
  alignTableRows,
  looksAnonymousNumericGrid,
  prepareMarkdownForPlainRenderer,
  splitPipeRun,
  splitTableRow,
} from '@/lib/reports/investment/plainMarkdownHygiene.pure';
import { investmentReportFileName } from '@/lib/reports/investment/reportFileName.pure';
import { fetchGlobalReportSettings, type GlobalReportSettings } from '@/hooks/useGlobalReportSettings';
import { drawPdfLibDisclaimerPage } from '@/utils/pdfDisclaimerPage';

/**
 * The five tiers this presentation draws. `strategic` was missing, so the
 * unvalidated cast in `investmentPdfSource` let it through to a four-branch
 * title map whose `else` said "Snapshot Report" — the identity defect the
 * audit of 291 Stone Mason Drive recorded as QA-32.
 */
export type ReportTier = 'compass' | 'briefing' | 'snapshot' | 'financial' | 'strategic';

export interface InvestmentReportData {
  id: string;
  address: string;
  content: string;
  created_at: string;
  enhanced_data?: {
    domainData?: any;
    absData?: any;
    rbaData?: any;
    financialData?: any;
    locationData?: any;
    investmentScore?: any;
  };
  pdf_url?: string | null;
}


/** Which machinery drew the bytes. Recorded so telemetry can prove the path. */
export const BROWSER_PDF_RENDERER = 'browser_pdf_lib' as const;

/**
 * The caption under the weekly-rent tile: where the figure came from, never a
 * certification of it. "Current market rate" was printed under an
 * operator-supplied figure on every document of 291 Stone Mason Drive
 * (QA-23) while the record held no dated lease, appraisal or comparison that
 * would earn those words. The generator stamps `weeklyRentSource` when it
 * resolves the rent; a record without one is captioned as supplied.
 */
export function rentProvenanceCaption(
  income: { weeklyRentSource?: unknown; rentSource?: unknown; source?: unknown } | null | undefined,
): string {
  const source = String(income?.weeklyRentSource ?? income?.rentSource ?? income?.source ?? '').trim().toLowerCase();
  if (source.startsWith('sqm')) return 'Market estimate (SQM Research)';
  if (source === 'listing' || source === 'advertised') return 'Advertised rent';
  if (source === 'appraisal' || source === 'agent_appraisal') return 'Agent appraisal';
  if (source === 'lease' || source === 'achieved' || source === 'current_lease') return 'Current lease';
  return 'Rent as supplied';
}

export interface InvestmentPdfBlob {
  blob: Blob;
  /** `<reportId>_<suburb>_<state>_<epoch>.pdf` — the name storage has always used. */
  fileName: string;
  suburb: string;
  state: string;
}

export interface InvestmentPdfDocument extends InvestmentPdfBlob {
  renderer: typeof BROWSER_PDF_RENDERER;
}

export interface GenerateInvestmentPdfOptions {
  report: InvestmentReportData;
  reportTier?: ReportTier;
  /**
   * The export panel's five controls. Two of them are content-inclusion rules
   * and three are presentation rules; `presentationOptions.ts` is where that
   * distinction is stated and where the content rules' section lists live, so
   * a chosen template and this document apply the same ones.
   */
  presentation?: Partial<InvestmentPresentationOptions>;
  /**
   * Imagery already stored against this report, resolved by the caller.
   *
   * Passed in rather than fetched: this module draws, and a renderer that
   * reached for a network of its own would be a second place a document could
   * fail to be produced. An empty list is the ordinary state — a report has
   * hero imagery only once somebody has placed some.
   */
  heroImages?: readonly InvestmentHeroImage[];
}

/** One placed hero image, already fetched and decoded by the caller. */
export interface InvestmentHeroImage {
  /** The section heading it was placed against, matched case-insensitively. */
  sectionKey: string;
  /** PNG or JPEG bytes. */
  bytes: Uint8Array;
  format: 'png' | 'jpeg';
}

/**
 * Draw the document and hand back the bytes.
 *
 * Throws on any failure; there is no fallback here, deliberately. A caller
 * that silently downgraded to a lesser renderer would ship a client a document
 * that does not look like the one that was approved.
 */
export async function generateInvestmentPdfBlob(
  options: GenerateInvestmentPdfOptions,
): Promise<InvestmentPdfDocument> {
  const {
    report,
    reportTier = 'compass',
    heroImages = [],
  } = options;
  const presentation = resolvePresentationOptions(options.presentation);
  const { includeSources, includeScoring } = presentation;

  const extractSuburbState = (address: string | undefined | null): { suburb: string; state: string } => {
    // Handle undefined/null address gracefully
    if (!address || typeof address !== 'string' || address.trim() === '') {
      console.warn('extractSuburbState: Address is undefined, not a string, or empty, using fallback');
      return { suburb: 'PROPERTY', state: '' };
    }
    
    // Safe split with null-check on each element
    const parts = address.split(',').map(p => (p ?? '').trim()).filter(p => p.length > 0);
    
    // If no valid parts after filtering, return fallback
    if (parts.length === 0) {
      console.warn('extractSuburbState: No valid address parts found, using fallback');
      return { suburb: 'PROPERTY', state: '' };
    }
    
    // Map full state names to abbreviations
    const stateMapping: Record<string, string> = {
      'new south wales': 'NSW',
      'victoria': 'VIC',
      'queensland': 'QLD',
      'south australia': 'SA',
      'western australia': 'WA',
      'tasmania': 'TAS',
      'northern territory': 'NT',
      'australian capital territory': 'ACT',
    };
    
    // Search entire address for state (abbreviation first, then full name)
    let state = '';
    const addressLower = address.toLowerCase();
    
    // Try to find state abbreviation anywhere in address
    const stateAbbrevMatch = address.match(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i);
    if (stateAbbrevMatch) {
      state = stateAbbrevMatch[0].toUpperCase();
    } else {
      // Try full state names
      for (const [fullName, abbrev] of Object.entries(stateMapping)) {
        if (addressLower.includes(fullName)) {
          state = abbrev;
          break;
        }
      }
    }
    
    // Extract suburb - find the first meaningful part that's not a postcode, state, or "Australia"
    let suburb = '';
    for (const part of parts) {
      // part is guaranteed to be a non-empty string due to filter above
      const trimmedPart = part;
      const partLower = trimmedPart.toLowerCase();
      
      // Skip if it's "Australia", a postcode (4 digits), or contains the state
      const isAustralia = partLower === 'australia';
      const isPostcode = /^\d{4}$/.test(trimmedPart);
      const isState = /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i.test(trimmedPart) || 
                      Object.keys(stateMapping).some(s => partLower === s);
      const containsPostcode = /\b\d{4}\b/.test(trimmedPart);
      
      // For suburb reports, the first part is usually the suburb name
      if (!isAustralia && !isPostcode && !isState) {
        // If this part contains a postcode but also text, extract just the suburb name
        if (containsPostcode) {
          const suburbOnly = trimmedPart.replace(/\b\d{4}\b/, '').replace(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/gi, '').trim();
          if (suburbOnly) {
            suburb = suburbOnly;
            break;
          }
        } else {
          suburb = trimmedPart;
          break;
        }
      }
    }
    
    // Fallback: use first part if nothing else worked
    if (!suburb && parts.length > 0) {
      const firstPart = parts[0] || '';
      suburb = firstPart.replace(/\b\d{4}\b/, '').replace(/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/gi, '').trim();
    }
    
    // Final fallback if suburb is still empty
    if (!suburb) {
      suburb = 'PROPERTY';
    }
    
    return { suburb: suburb.toUpperCase(), state };
  };

  // Helper to strip word count markers from content - these are AI instruction artifacts
  const stripWordCountMarkers = (text: string): string => {
    return text
      // Remove patterns like "(Word count: 812)", "(word count: 500)"
      .replace(/\(\s*Word\s*count\s*:\s*\d+[\d,]*\s*\)/gi, '')
      // Remove patterns like "(500 words)", "(500-1000 words)", "(min 500 words)", "(450+ words total)"
      .replace(/\(\s*(?:minimum|min|max|maximum)?\s*\d+\s*(?:\+|-|\s*-\s*\d+)?\s*words?\s*(?:total|required|minimum|min|max|maximum)?\s*\)/gi, '')
      // Remove patterns like "(Minimum 400 words for this section)" or any parenthesized phrase containing "words"
      .replace(/\(\s*[^)]*\d+\s*words?\s*[^)]*\)/gi, '')
      // Remove standalone "**Top 3 Risks (450+ words total):**" style markers - strip just the word count part
      .replace(/\(\s*\d+\+?\s*words?\s*(?:total)?\s*\)\s*:?/gi, '')
      // Remove patterns like "(312 words)[1][2]" - word count before reference markers
      .replace(/\(\s*\d+\s*words?\s*\)\s*(?:\[\d+\])+/gi, '')
      // Clean up any double spaces left behind
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  // Helper to sanitize AI-generated content - fix word merges, duplicates, and malformed text
  const sanitizeAIContent = (text: string): string => {
    return text
      // ===== ISSUE 8: word-merge corrections, narrowed to what they repair =====
      //
      // Two of these split a name apart wherever they found a case boundary,
      // and a name is the commonest thing a case boundary means. Measured over
      // the completed corpus, the camelCase splitter's own hit list is
      // essentially a list of this product's data sources and of Australian
      // agencies: CoreLogic 3,975, OpenAgent 447, AreaSearch 160, OnTheHouse
      // 97, PropTrack 83, QuickStats, MacKillop, MidCoast, VicRoads, VicPlan,
      // VicPol, VicEmergency, TrainLink, FloodCheck, OpenStreetMap. Every
      // standard-presentation PDF printed "Core Logic" and "Prop Track", so
      // the report misnamed the sources it cites. The letter-digit splitter is
      // the same story on units and codes — `988 m2` came out `988 m 2` — and
      // the letter+digit tokens the corpus actually holds are statistical
      // geography and zoning: SA2 1,290, SA4 778, SA3 776, FY21, GRZ2, Yr10.
      // A merged word is a defect in the model's output; splitting a proper
      // noun is a defect this renderer introduces into a client's document,
      // and the template presentation repairs neither, so the two were not
      // even producing the same prose from one record.
      //
      // Number-letter is kept: it only fires where a digit runs straight into
      // a capital, which is a merge rather than a name.
      .replace(/(\d)([A-Z])/g, '$1 $2')
      // Sentence boundaries only. `([.!?:,;])([A-Za-z])` split anything with a
      // full stop in it — `e.g.,` became `e. g.`, and a contact line came out
      // as `www. npcservices. com. au` and `admin@example. com. au`, which is
      // a URL a reader cannot use. A lowercase letter, then punctuation, then
      // a CAPITAL is the shape of "done.The"; a lowercase letter after the
      // stop is the shape of a domain, an abbreviation or a file name.
      .replace(/([a-z])([.!?:,;])([A-Z])/g, '$1$2 $3')
      // Fix possessive merges: "Vale'sdemographic" -> "Vale's demographic", "City'sinfrastructure" -> "City's infrastructure"
      .replace(/([a-z])'s([a-z])/gi, "$1's $2")
      // Fix closing paren merges: ")The" -> ") The", ")and" -> ") and"
      .replace(/(\))([A-Za-z])/g, '$1 $2')
      // Fix opening paren merges after words: "word(example" -> "word (example"
      .replace(/([a-z])(\([A-Za-z])/g, '$1 $2')
      // Fix compound words that got mashed: "Westernfreeway" -> "Western freeway".
      // Case-SENSITIVE, because a capital is what tells a merge apart from a
      // name: `/gi` matched the `Road` in `VicRoads` and the `Street` in
      // `OpenStreetMap`, and printed the two agencies as "Vic Roads" and
      // "Open StreetMap" in every client document. A genuine merge is all
      // lower case on the second half; a compound name is not.
      .replace(/([a-z]{3,})(freeway|highway|road|street|avenue|drive|boulevard|upgrades?|improvements?|developments?)/g, '$1 $2')
      // Fix common infrastructure word merges
      .replace(/(infrastructure|developments?|projects?|investments?)([A-Z])/g, '$1 $2')
      // ===== ISSUE 3 FIX: Remove broken/repeated phrases with data =====
      // Remove duplicate "Purchase Price: $X" patterns: "Purchase Price: $717,400 median" or "Purchase Price: $X, Purchase Price: $Y"
      .replace(/Purchase Price:\s*\$[\d,]+\s*(?:Purchase Price:\s*\$[\d,]+|median)/gi, (match) => {
        const priceMatch = match.match(/\$[\d,]+/);
        return priceMatch ? `Purchase Price: ${priceMatch[0]}` : match;
      })
      // Remove duplicate percentage/ratio patterns like "LVR:90%:90%" or "80% LVR:90%"
      .replace(/(\d+%?\s*(?:LVR|lvr))\s*:\s*\d+%?\s*(?:LVR|lvr)?\s*:\s*\d+%/gi, '$1')
      .replace(/(\d+%\s+LVR)\s*:\s*\d+%\s*LVR/gi, '$1')
      // Remove repeated field patterns like "Interest Rate: 6% Interest Rate: 6%"
      .replace(/(Interest Rate:\s*[\d.]+%)\s+Interest Rate:\s*[\d.]+%/gi, '$1')
      .replace(/(Loan Term:\s*\d+\s*years?)\s+Loan Term:\s*\d+\s*years?/gi, '$1')
      .replace(/(Weekly Rent:\s*\$[\d,]+)\s+Weekly Rent:\s*\$[\d,]+/gi, '$1')
      // Remove "At $X, the [Field]: $X" redundancy: "At $717,400, the Purchase Price: $717,400"
      .replace(/At\s+\$[\d,]+,?\s*the\s+(Purchase Price|Property Value|Loan Amount):\s*\$[\d,]+/gi, (match) => {
        const priceMatch = match.match(/\$[\d,]+/);
        const fieldMatch = match.match(/(Purchase Price|Property Value|Loan Amount)/i);
        return priceMatch && fieldMatch ? `${fieldMatch[0]}: ${priceMatch[0]}` : match;
      })
      // Clean up any resulting double spaces
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  // Helper to truncate text at word boundary for TOC entries
  const truncateAtWordBoundary = (text: string, maxWidth: number, font: any, fontSize: number): string => {
    if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) {
      return text;
    }
    
    const words = text.split(' ');
    let result = '';
    const ellipsis = '...';
    const ellipsisWidth = font.widthOfTextAtSize(ellipsis, fontSize);
    
    for (let i = 0; i < words.length; i++) {
      const testText = result ? `${result} ${words[i]}` : words[i];
      const testWidth = font.widthOfTextAtSize(testText + ellipsis, fontSize);
      
      if (testWidth > maxWidth) {
        break;
      }
      result = testText;
    }
    
    return result ? `${result}${ellipsis}` : `${text.substring(0, 20)}${ellipsis}`;
  };

  // Helper to break long words that exceed maxWidth
  const breakLongWord = (word: string, maxWidth: number, font: any, fontSize: number): string[] => {
    // A "word" that is one punctuation character repeated is a separator run,
    // not a word. Hyphenating it letter by letter is how one delimiter row of
    // thousands of dashes became seven full pages of the Executive Briefing
    // (QA-35); three of the character stand for the run.
    if (word.length > 8 && /^([^\w\s])\1+$/.test(word)) return [word.slice(0, 3)];
    const wordWidth = font.widthOfTextAtSize(word, fontSize);
    if (wordWidth <= maxWidth) {
      return [word];
    }
    
    // Break the word into chunks that fit
    const chunks: string[] = [];
    let currentChunk = '';
    
    for (const char of word) {
      const testChunk = currentChunk + char;
      const testWidth = font.widthOfTextAtSize(testChunk + '-', fontSize);
      
      if (testWidth > maxWidth && currentChunk.length > 0) {
        chunks.push(currentChunk + '-');
        currentChunk = char;
      } else {
        currentChunk = testChunk;
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  };

  /**
   * The two content rules, from the one module that states them.
   *
   * These were two inline pattern lists here, which meant the rule applied to
   * THIS document and to nothing else: a report delivered through a chosen
   * template carried its source notes and its scoring sections however the
   * switches were set, and nobody was told. `presentationOptions.ts` holds the
   * lists now and the delivery module applies them to the report content
   * before either renderer sees it, so this is the same rule applied a second
   * time to a document whose sections have usually already been filtered —
   * which is harmless, and is what keeps this function correct for a caller
   * that draws from an unfiltered record.
   */
  const applyContentRules = (sections: Record<string, string>): Record<string, string> =>
    filterSections(sections, presentation);

  /**
   * A chart directive this presentation cannot draw is TABULATED, never printed.
   *
   * The generator's prompt tells the model to write its figures as
   * `{{bars: …}}`, `{{gauge: …}}`, `{{glance: …}}` and nine more kinds, and
   * `markdown.pure.ts` states the rule for them: a directive is an instruction
   * to the renderer — it is drawn or it is dropped, and either way its source
   * is never printed. The design-system presentation draws them through
   * `vizFigures.pure.ts`. This one had never heard of them, so it set each one
   * as body copy: measured on report 783bb982, THIRTY-SIX raw directives on a
   * client's pages. It then DROPPED them, which was half right: the source no
   * longer printed, but the prose that introduced the figure did — "The
   * matrix below groups the main amenities by type" on two of the audited 291
   * Stone Mason Drive documents, with nothing below it (QA-33) — and the data
   * the model had gathered went out with the drawing.
   *
   * `tabulateVizDirectives` writes every parseable directive back as the
   * table its data already is (labels and values, phases and milestones, a
   * grid), in the directive's own numbers; the standard presentation sets a
   * Markdown table natively. A directive the shared parser refuses is
   * removed as before, because an unparseable payload holds no data to keep.
   * The figures this presentation draws itself still come from the record
   * ("AT A GLANCE"), never from a directive, and are never recomputed.
   */
  const stripUndrawableDirectives = (content: string): string => {
    const { markdown, tabulated, removed } = tabulateVizDirectives(content);
    if (tabulated) console.log(`📋 Tabulated ${tabulated} chart directive(s) this presentation cannot draw`);
    if (removed) console.log(`🧹 Removed ${removed} unparseable chart directive(s)`);
    return markdown;
  };

  const injectOverridesIntoContent = (content: string, financialData: any): string => {
    if (!financialData) {
      console.log('⚠️ No financialData provided, skipping injection');
      return content;
    }

    console.log('💉 Injecting override values into markdown content');
    console.log('📊 Input financialData structure:', JSON.stringify(financialData, null, 2).substring(0, 2000));
    console.log('🔍 Direct value checks:', {
      'financialData.income': financialData?.income,
      'financialData.income.weeklyRent': financialData?.income?.weeklyRent,
      'financialData.income.annualRent': financialData?.income?.annualRent,
    });

    // Calculate annual rent from weekly rent (weekly × 52)
    // Use ?? 0 to handle null/undefined but preserve explicit 0 values
    const weeklyRentRaw = financialData?.income?.weeklyRent;
    const weeklyRent = Number(weeklyRentRaw) || 0;
    console.log('📌 weeklyRent:', { raw: weeklyRentRaw, resolved: weeklyRent });
    const annualRent = weeklyRent * 52;
    console.log('📌 annualRent calculated:', annualRent);

    // Recalculate property management based on overridden values
    const propertyManagementPercent = Number(financialData?.annualCosts?.propertyManagementPercent) || 7;
    const propertyManagementFee = Math.floor(annualRent * (propertyManagementPercent / 100));
    console.log('📌 propertyManagement:', { percent: propertyManagementPercent, calculatedFee: propertyManagementFee });

    // Calculate total annual costs dynamically from overridden values (excluding letting fees)
    // IMPORTANT: Use ?? (nullish coalescing) not || to properly handle 0 values as valid overrides
    const councilRates = financialData?.annualCosts?.councilRates ?? 0;
    const waterRates = financialData?.annualCosts?.waterRates ?? 0;
    const strataFees = financialData?.annualCosts?.strataFees ?? 0;
    const landlordInsurance = financialData?.annualCosts?.landlordInsurance ?? 0;
    const propertyManagement = propertyManagementFee; // Use dynamically calculated value
    // CRITICAL FIX: Use ?? 0 to respect explicit $0 override, don't default to 1500
    // The 1500 default was causing conflicts with user-specified $0 maintenance
    const maintenance = financialData?.annualCosts?.maintenance ?? 0;
    const landTax = financialData?.annualCosts?.landTax ?? 0;
    
    // Total annual costs WITHOUT land tax - used for net yield calculation (pages 14-15)
    const totalAnnualCostsExcludingLandTax = councilRates + waterRates + strataFees + landlordInsurance + propertyManagement + maintenance;
    
    // Total annual costs WITH land tax - used for page 10 ongoing costs table display
    const totalAnnualCostsWithLandTax = totalAnnualCostsExcludingLandTax + landTax;
    
    console.log('📊 Computed values from overrides:', {
      weeklyRent,
      annualRent,
      councilRates,
      waterRates,
      strataFees,
      landlordInsurance,
      propertyManagementPercent,
      propertyManagement,
      maintenance,
      landTax,
      totalAnnualCostsExcludingLandTax,
      totalAnnualCostsWithLandTax
    });
    
    // Debug: Log the raw maintenance value from financialData
    console.log('🔧 Maintenance debug:', {
      rawValue: financialData?.annualCosts?.maintenance,
      resolvedValue: maintenance
    });
    
    // Debug: Log specific content snippets we're trying to match
    const annualIncomeMatch = content.match(/Annual Income[^\n]{0,100}/gi);
    const annualExpensesMatch = content.match(/Annual Expenses[^\n]{0,100}/gi);
    const propertyMgmtMatch = content.match(/Property Management[^\n]{0,100}/gi);
    console.log('🔍 Content snippets found:', {
      annualIncome: annualIncomeMatch,
      annualExpenses: annualExpensesMatch,
      propertyMgmt: propertyMgmtMatch
    });

    // Calculate loan amount from property value and deposit
    const propertyValue = financialData?.initialCosts?.propertyValue || 0;
    const stampDuty = financialData?.initialCosts?.stampDuty || 0;
    const interestRate = financialData?.loanDetails?.interestRate || 6;
    const loanTerm = financialData?.loanDetails?.loanTerm || 30;
    
    // Calculate deposit: use explicit value if set, otherwise derive from LVR
    // Formula: Deposit = Purchase Price × (100% - LVR%)
    const lvr = financialData?.keyMetrics?.lvr || financialData?.loanDetails?.lvr || 80;
    const explicitDeposit = financialData?.initialCosts?.deposit;
    const depositValue = (explicitDeposit !== undefined && explicitDeposit !== null && explicitDeposit !== 0)
      ? Number(explicitDeposit)
      : Math.round(propertyValue * (1 - lvr / 100));
    const loanAmount = propertyValue - depositValue;
    
    console.log('💰 Deposit calculation:', {
      propertyValue,
      lvr,
      explicitDeposit,
      calculatedDeposit: depositValue,
      loanAmount
    });

    // Map of field paths to regex patterns that match them in markdown tables
    const fieldReplacements: Array<{ pattern: RegExp; getValue: () => any; format: (v: any) => string; isFullLineReplacement?: boolean }> = [
      // === BASE ASSUMPTIONS SECTION - Bullet point format ===
      // Property Price: $XXX,XXX
      {
        pattern: /[-•]\s*Property Price:[^\n]*/gi,
        getValue: () => propertyValue,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '- Property Price: $' + str;
        },
        isFullLineReplacement: true
      },
      // Deposit: $XXX,XXX
      {
        pattern: /[-•]\s*Deposit:[^\n]*/gi,
        getValue: () => depositValue,
        format: (v) => {
          const str = Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
          return '- Deposit: $' + str;
        },
        isFullLineReplacement: true
      },
      // Loan Amount: $XXX,XXX
      {
        pattern: /[-•]\s*Loan Amount:[^\n]*/gi,
        getValue: () => loanAmount,
        format: (v) => {
          const str = Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
          return '- Loan Amount: $' + str;
        },
        isFullLineReplacement: true
      },
      // Interest Rate: X%
      {
        pattern: /[-•]\s*Interest Rate:[^\n]*/gi,
        getValue: () => interestRate,
        format: (v) => '- Interest Rate: ' + (v || 0) + '%',
        isFullLineReplacement: true
      },
      // Loan Term: XX years
      {
        pattern: /[-•]\s*Loan Term:[^\n]*/gi,
        getValue: () => loanTerm,
        format: (v) => '- Loan Term: ' + (v || 30) + ' years',
        isFullLineReplacement: true
      },
      // Weekly Rent: $XXX ($XX,XXX annually)
      {
        pattern: /[-•]\s*Weekly Rent:[^\n]*/gi,
        getValue: () => ({ weeklyRent, annualRent }),
        format: (v) => {
          // Explicit type conversion and validation
          const weeklyNum = typeof v.weeklyRent === 'number' ? v.weeklyRent : Number(v.weeklyRent) || 0;
          const annualNum = typeof v.annualRent === 'number' ? v.annualRent : Number(v.annualRent) || 0;
          
          // Format with explicit locale
          const weeklyFormatted = weeklyNum.toLocaleString('en-AU', { maximumFractionDigits: 0 });
          const annualFormatted = annualNum.toLocaleString('en-AU', { maximumFractionDigits: 0 });
          
          // Build the result string
          const result = '- Weekly Rent: $' + weeklyFormatted + ' ($' + annualFormatted + ' annually)';
          
          console.log('📝 WEEKLY RENT INJECTION:', {
            inputWeekly: v.weeklyRent,
            inputAnnual: v.annualRent,
            weeklyNum,
            annualNum,
            weeklyFormatted,
            annualFormatted,
            finalResult: result
          });
          
          return result;
        },
        isFullLineReplacement: true
      },
      // Property Management: X% of $XX,XXX annual rent = $X,XXX
      {
        pattern: /[-•]\s*Property Management:[^\n]*/gi,
        getValue: () => ({ percent: propertyManagementPercent, annualRent, fee: propertyManagement }),
        format: (v) => {
          const percentNum = typeof v.percent === 'number' ? v.percent : Number(v.percent) || 7;
          const annualNum = typeof v.annualRent === 'number' ? v.annualRent : Number(v.annualRent) || 0;
          const feeNum = typeof v.fee === 'number' ? v.fee : Number(v.fee) || 0;
          
          const annualFormatted = annualNum.toLocaleString('en-AU', { maximumFractionDigits: 0 });
          const feeFormatted = feeNum.toLocaleString('en-AU', { maximumFractionDigits: 0 });
          
          // IMPORTANT: Use "= $feeFormatted" NOT "Annual Rent: $annualFormatted"
          const result = '- Property Management: ' + percentNum + '% of $' + annualFormatted + ' annual rent = $' + feeFormatted;
          
          console.log('📝 PROPERTY MANAGEMENT INJECTION:', {
            inputPercent: v.percent,
            inputAnnual: v.annualRent,
            inputFee: v.fee,
            percentNum,
            annualNum,
            feeNum,
            annualFormatted,
            feeFormatted,
            finalResult: result
          });
          
          return result;
        },
        isFullLineReplacement: true
      },
      // Maintenance: $X annually (fixed)
      {
        pattern: /[-•]\s*Maintenance:[^\n]*/gi,
        getValue: () => maintenance,
        format: (v) => {
          const maintenanceNum = Number(v) || 0;
          const formatted = maintenanceNum.toLocaleString('en-AU', { maximumFractionDigits: 0 });
          console.log('📝 Maintenance format:', { rawValue: v, maintenanceNum, formatted });
          // Use array join
          const parts = ['- Maintenance: ', '$', formatted, ' annually (fixed)'];
          return parts.join('');
        },
        isFullLineReplacement: true
      },
      // Council Rates: $X,XXX annually
      {
        pattern: /[-•]\s*Council Rates:[^\n]*/gi,
        getValue: () => councilRates,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '- Council Rates: $' + str + ' annually';
        },
        isFullLineReplacement: true
      },
      // Water Rates: $X,XXX annually
      {
        pattern: /[-•]\s*Water Rates:[^\n]*/gi,
        getValue: () => waterRates,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '- Water Rates: $' + str + ' annually';
        },
        isFullLineReplacement: true
      },
      // Insurance: $X,XXX annually
      {
        pattern: /[-•]\s*Insurance:[^\n]*/gi,
        getValue: () => landlordInsurance,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '- Insurance: $' + str + ' annually';
        },
        isFullLineReplacement: true
      },

      // === OTHER SECTIONS - Non-bullet patterns ===
      {
        pattern: /Purchase Price.*?\$[\d,]+/gi,
        getValue: () => propertyValue,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return 'Purchase Price: $' + str;
        }
      },
      {
        pattern: /Property Value.*?\$[\d,]+/gi,
        getValue: () => propertyValue,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return 'Property Value: $' + str;
        }
      },
      {
        pattern: /Stamp Duty.*?\$[\d,]+/gi,
        getValue: () => financialData?.initialCosts?.stampDuty,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return 'Stamp Duty: $' + str;
        }
      },
      {
        pattern: /Deposit(?:.*?20%)?[:\s-]+\$[\d,]+/gi,
        getValue: () => depositValue,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return 'Deposit: $' + str;
        }
      },
      // Non-bullet Weekly Rent patterns - only for contexts NOT starting with bullets
      // IMPORTANT: These should NOT match after the bullet patterns have already run
      {
        pattern: /^\s*Weekly Rent:\s*\$[\d,]+\s*\(\$[\d,]+\s*annually\)/gim,
        getValue: () => ({ weeklyRent, annualRent }),
        format: (v) => {
          const weeklyNum = Number(v.weeklyRent) || 0;
          const annualNum = Number(v.annualRent) || 0;
          const weeklyFormatted = weeklyNum.toLocaleString('en-AU', { maximumFractionDigits: 0 });
          const annualFormatted = annualNum.toLocaleString('en-AU', { maximumFractionDigits: 0 });
          return 'Weekly Rent: $' + weeklyFormatted + ' ($' + annualFormatted + ' annually)';
        },
        isFullLineReplacement: true
      },
      // Table format Weekly Rent
      {
        pattern: /\|\s*Weekly Rent\s*\|[^\|]*\|\s*\$[\d,]+\s*\|/gi,
        getValue: () => weeklyRent,
        format: (v) => {
          const weeklyNum = Number(v) || 0;
          const weeklyFormatted = weeklyNum.toLocaleString('en-AU', { maximumFractionDigits: 0 });
          return '| Weekly Rent | | $' + weeklyFormatted + ' |';
        },
        isFullLineReplacement: true
      },
      // Standalone Annual Rent patterns - ONLY match bullet-point format in Base Assumptions
      // Must require bullet point prefix to avoid matching "Annual" in table cells
      {
        pattern: /^[•\-]\s*Annual Rent:\s*\$[\d,]+/gim,
        getValue: () => annualRent,
        format: (v) => {
          const str = Number(v || 0).toLocaleString('en-AU', { maximumFractionDigits: 0 });
          return '• Annual Rent: $' + str;
        },
        isFullLineReplacement: true
      },
      {
        pattern: /\|\s*Annual Rent\s*\|[^\|]*\|\s*\$[\d,]+\s*\|/gi,
        getValue: () => annualRent,
        format: (v) => {
          const str = Number(v || 0).toLocaleString('en-AU', { maximumFractionDigits: 0 });
          return '| Annual Rent | | $' + str + ' |';
        },
        isFullLineReplacement: true
      },
      // Annual Income row in Gross & Net Yield table
      {
        pattern: /\|\s*Annual Income\s*\|\s*\$[\d,]+\s*[×x]\s*52\s*weeks?\s*\|\s*\$[\d,]+\s*\|/gi,
        getValue: () => ({ weeklyRent, annualRent }),
        format: (v) => {
          const weeklyStr = String(v.weeklyRent || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          const annualStr = String(v.annualRent || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| Annual Income | $' + weeklyStr + ' x 52 weeks | $' + annualStr + ' |';
        },
        isFullLineReplacement: true
      },
      // Table format patterns for ongoing costs - COLUMN ORDER: Cost Category | Amount (AUD) | Calculation Method
      // Each row has a meaningful, contextual description in Calculation Method
      
      // Fix malformed Stamp Duty row where amount is merged into category name
      {
        pattern: /\|\s*Stamp Duty:\s*\$[\d,]+\.?\d*\s*\|[^\n]*/gi,
        getValue: () => stampDuty,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| Stamp Duty | $' + str + ' | State Revenue Office calculator (2025) |';
        },
        isFullLineReplacement: true
      },
      // Fix malformed Purchase Price row where value is merged into attribute name
      {
        pattern: /\|\s*(?:Estimated\s+)?Purchase Price:\s*\$[\d,]+\.?\d*\s*\|[^\n]*/gi,
        getValue: () => propertyValue,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| Estimated Purchase Price | $' + str + ' |';
        },
        isFullLineReplacement: true
      },
      // Fix Net Rental Yield showing formula instead of percentage
      {
        pattern: /\|\s*Net Rental Yield\s*\|\s*\$[\d,]+\.?\d*\s*[÷\/]\s*\$[\d,]+\.?\d*\s*[×x\*]\s*\d+[^\n]*/gi,
        getValue: () => financialData?.keyMetrics?.netRentalYield,
        format: (v) => {
          const yieldVal = parseFloat(v) || 0;
          return '| Net Rental Yield | ' + yieldVal.toFixed(2) + '% |';
        },
        isFullLineReplacement: true
      },
      // A malformed Property Type row is repaired FROM THE RECORD, or left as
      // the author wrote it. This rule used to substitute the literal
      // "Residential Property" — the one rule in this table that read no
      // figure — so a row the model correctly wrote as "Strata Townhouse" was
      // rewritten to a placeholder classification, and the document became
      // less specific as it went on (QA-22). `meaningfulPropertyType` refuses
      // the placeholder family, and a null here means no replacement.
      {
        pattern: /\|\s*Property Type:\s*[^\|]+\|[^\n]*/gi,
        getValue: () => meaningfulPropertyType(
          financialData?.propertyType ?? financialData?.propertyDetails?.propertyType ?? financialData?.property?.propertyType,
        ),
        format: (v) => '| Property Type | ' + v + ' |',
        isFullLineReplacement: true
      },
      {
        pattern: /\|\s*Council Rates\s*\|\s*\$[^\n]*/gi,
        getValue: () => councilRates,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| Council Rates | $' + str + ' | Local council rates notice (2024/25) |';
        },
        isFullLineReplacement: true
      },
      {
        pattern: /\|\s*Water Rates\s*\|\s*\$[^\n]*/gi,
        getValue: () => waterRates,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| Water Rates | $' + str + ' | Estimated based on local water authority |';
        },
        isFullLineReplacement: true
      },
      {
        pattern: /\|\s*(?:Building\s*(?:&|and)\s*)?(?:Landlord\s*)?Insurance\s*\|\s*\$[^\n]*/gi,
        getValue: () => landlordInsurance,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| Insurance | $' + str + ' | Industry average for investment property |';
        },
        isFullLineReplacement: true
      },
      {
        pattern: /\|\s*Strata Fees\s*\|\s*\$[^\n]*/gi,
        getValue: () => strataFees,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| Strata Fees | $' + str + ' | Body corporate/strata levy |';
        },
        isFullLineReplacement: true
      },
      {
        pattern: /\|\s*Body Corporate\s*\|\s*\$[^\n]*/gi,
        getValue: () => strataFees,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| Body Corporate | $' + str + ' | Body corporate/strata levy |';
        },
        isFullLineReplacement: true
      },
      // Property Management Fee table row - Amount column = fee, Calculation Method = formula
      {
        pattern: /\|?\s*Property Management Fee?\s*\|\s*\$[^\n]*/gi,
        getValue: () => ({ percent: propertyManagementPercent, annualRent, fee: propertyManagement }),
        format: (v) => {
          const annualStr = String(v.annualRent || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          const feeStr = String(v.fee || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| Property Management Fee | $' + feeStr + ' | ' + (v.percent || 7) + '% x $' + annualStr + ' annual rent |';
        },
        isFullLineReplacement: true
      },
      {
        pattern: /\|\s*Maintenance\s*\|\s*\$[^\n]*/gi,
        getValue: () => maintenance,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| Maintenance | $' + str + ' | Fixed amount per instructions |';
        },
        isFullLineReplacement: true
      },
      // These three used to match `Label.*?NN%` — the label, ANYTHING, then
      // the next percentage on the line — and rewrote the span with the
      // record's base figure. Measured on the audited Financial report
      // (QA-08): every sensitivity row, composed as "Interest rate 7.5%
      // (+1.0 pt)", printed as "Interest Rate: 6.5% (+1.0 pt)"; and the
      // scorecard's "Serviceability (LVR proxy) | 22% |" printed as
      // "Serviceability (LVR: 80%". A rewrite that reaches past a label into
      // somebody else's figure is a fabrication, so each now matches the
      // explicit `Label: NN%` form and nothing else.
      {
        pattern: /\bInterest Rate\s*:\s*[\d.]+%/gi,
        getValue: () => interestRate,
        format: (v) => 'Interest Rate: ' + (v || 0) + '%'
      },
      {
        pattern: /\bCapital Growth\s*:\s*[\d.]+%/gi,
        getValue: () => financialData?.assumptions?.capitalGrowth,
        format: (v) => 'Capital Growth: ' + (v || 0) + '%'
      },
      {
        pattern: /\bLVR\s*:\s*[\d.]+%/gi,
        getValue: () => financialData?.keyMetrics?.lvr,
        format: (v) => 'LVR: ' + (v || 0) + '%'
      },
      // Land Tax row in page 10 table - Amount column then Calculation column
      {
        pattern: /\|\s*Land Tax\s*\|\s*\$[^\n]*/gi,
        getValue: () => landTax,
        format: (v) => {
          const str = String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| Land Tax | $' + str + ' | State land tax threshold for investors |';
        },
        isFullLineReplacement: true
      },
      // Total Annual Costs table row - handle malformed format where amount is in Cost Category column
      // Pattern: | $X,XXX | Sum of ALL ongoing costs | (empty) |
      // Note: Include \.?\d* to match decimal amounts like $11,848.99 to prevent duplicate decimals
      {
        pattern: /\|\s*\$[\d,]+\.?\d*\s*\|\s*Sum of ALL ongoing costs[^\n]*/gi,
        getValue: () => totalAnnualCostsWithLandTax,
        format: (v) => {
          const rounded = Math.round(v || 0);
          const str = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| **Total Annual Costs** | **$' + str + '** | **Sum of ALL ongoing costs** |';
        },
        isFullLineReplacement: true
      },
      {
        pattern: /\|\s*\*?\*?Total Annual Costs\*?\*?\s*\|[^\n]*/gi,
        getValue: () => totalAnnualCostsWithLandTax,
        format: (v) => {
          const rounded = Math.round(v || 0);
          const str = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          return '| **Total Annual Costs** | **$' + str + '** | **Sum of ALL ongoing costs** |';
        },
        isFullLineReplacement: true
      },
      {
        pattern: /\*\*Total Annual Costs\*\*.*?\$[\d,]+\.?\d*/gi,
        getValue: () => totalAnnualCostsWithLandTax,
        format: (v) => `$${Math.round(v || 0).toLocaleString('en-AU')}`
      },
      {
        pattern: /Total Annual Costs.*?\$[\d,]+\.?\d*/gi,
        getValue: () => totalAnnualCostsWithLandTax,
        format: (v) => `$${Math.round(v || 0).toLocaleString('en-AU')}`
      },
      // Annual Expenses row in Gross & Net Yield table - handle table rows starting with |
      {
        pattern: /\|?\s*Annual Expenses\s*\|[^\n]*/gi,
        getValue: () => {
          // Build breakdown components for display (include strataFees if present)
          const components = [];
          if (councilRates > 0) components.push(`$${councilRates.toLocaleString('en-AU')}`);
          if (waterRates > 0) components.push(`$${waterRates.toLocaleString('en-AU')}`);
          if (strataFees > 0) components.push(`$${strataFees.toLocaleString('en-AU')}`);
          if (propertyManagement > 0) components.push(`$${propertyManagement.toLocaleString('en-AU')}`);
          if (landlordInsurance > 0) components.push(`$${landlordInsurance.toLocaleString('en-AU')}`);
          if (maintenance > 0) components.push(`$${maintenance.toLocaleString('en-AU')}`);
          
          console.log('📊 Annual Expenses breakdown:', {
            councilRates,
            waterRates,
            strataFees,
            propertyManagement,
            landlordInsurance,
            maintenance,
            totalAnnualCostsExcludingLandTax,
            breakdown: components.join(' + ')
          });
          
          return { 
            breakdown: components.join(' + ') || '$0',
            total: totalAnnualCostsExcludingLandTax 
          };
        },
        format: (v) => `| Annual Expenses | ${v.breakdown} | $${v.total?.toLocaleString('en-AU') || '0'} |`,
        isFullLineReplacement: true
      },
      // Note: Removed generic "Annual Expenses" pattern that was corrupting table breakdown display
      // The table-specific pattern above handles the yield table; no fallback needed
      // Net Annual Return row in Gross & Net Yield table - handle table rows starting with |
      {
        pattern: /\|?\s*Net Annual Return\s*\|[^\n]*/gi,
        getValue: () => {
          const netAnnualReturn = annualRent - totalAnnualCostsExcludingLandTax;
          return { annualRent, totalExpenses: totalAnnualCostsExcludingLandTax, netReturn: netAnnualReturn };
        },
        format: (v) => `| Net Annual Return | $${v.annualRent?.toLocaleString('en-AU') || '0'} - $${v.totalExpenses?.toLocaleString('en-AU') || '0'} | $${v.netReturn?.toLocaleString('en-AU') || '0'} |`,
        isFullLineReplacement: true
      },
      // Net Rental Yield row in Gross & Net Yield table - handle table rows starting with |
      {
        pattern: /\|?\s*Net Rental Yield\s*\|[^\n]*/gi,
        getValue: () => {
          const purchasePrice = financialData?.initialCosts?.propertyValue || 0;
          const netAnnualReturn = annualRent - totalAnnualCostsExcludingLandTax;
          const netYield = purchasePrice > 0 ? ((netAnnualReturn / purchasePrice) * 100).toFixed(2) : '0.00';
          return { netReturn: netAnnualReturn, purchasePrice, netYield };
        },
        format: (v) => `| Net Rental Yield | $${v.netReturn?.toLocaleString('en-AU') || '0'} ÷ $${v.purchasePrice?.toLocaleString('en-AU') || '0'} × 100 | ${v.netYield}% |`,
        isFullLineReplacement: true
      },
    ];

    let updatedContent = content;
    let replacementCount = 0;

    for (const { pattern, getValue, format, isFullLineReplacement } of fieldReplacements) {
      const value = getValue();
      if (value !== undefined && value !== null) {
        const formattedValue = format(value);
        const beforeReplace = updatedContent;
        // Use a function replacement to ensure the value is returned verbatim
        updatedContent = updatedContent.replace(pattern, () => {
          // If explicitly marked as full line replacement, return formatted value directly
          if (isFullLineReplacement) {
            console.log(`  🔄 Full line replacement → "${formattedValue.substring(0, 60)}..."`);
            replacementCount++;
            return formattedValue;
          }
          // If formattedValue contains ' | ' (table row) or starts with '- ' (bullet point line), return as-is
          if (formattedValue.includes(' | ') || formattedValue.startsWith('- ')) {
            replacementCount++;
            return formattedValue;
          }
          // Otherwise, this shouldn't happen with current patterns
          replacementCount++;
          return formattedValue;
        });
        
        if (beforeReplace !== updatedContent) {
          console.log(`  ✓ Injected value for pattern: ${pattern.source.substring(0, 30)}...`);
        }
      }
    }

    console.log(`✓ Completed: ${replacementCount} value replacements in markdown content`);
    return updatedContent;
  };

  // Structure to track section hierarchy for TOC
  interface ParsedSection {
    content: string;
    level: number; // 2 = H2 (main section), 3 = H3 (subsection)
    parentSection?: string;
  }
  
  // Store section metadata for TOC hierarchy
  // Was a `useRef` when this lived in a component. It is a mutable map and
  // nothing more — never read during render, never a dependency — so the ref
  // shape is kept (every call site below says `.current`) without React.
  const sectionMetadata = { current: new Map<string, ParsedSection>() };

  const parseReportContent = (content: string): Record<string, string> => {
    const sections: Record<string, string> = {};
    const lines = content.split('\n');
    let currentH2Section = '';
    let currentH3Subsection = '';
    let currentContent: string[] = [];
    
    // Clear previous metadata
    sectionMetadata.current.clear();

    const saveCurrentSection = () => {
      if (currentH2Section && currentContent.length > 0) {
        const sectionKey = currentH3Subsection || currentH2Section;
        // Strip word count markers from content before saving
        const rawContent = currentContent.join('\n').trim();
        sections[sectionKey] = stripWordCountMarkers(rawContent);
        
        // Store metadata for TOC hierarchy
        sectionMetadata.current.set(sectionKey, {
          content: sections[sectionKey],
          level: currentH3Subsection ? 3 : 2,
          parentSection: currentH3Subsection ? currentH2Section : undefined
        });
      }
    };

    for (const line of lines) {
      // Check for H2 heading (## Heading) - Main sections
      const h2Match = line.match(/^##\s+(.+)$/);
      // Check for H3 heading (### Heading) - Subsections
      const h3Match = line.match(/^###\s+(.+)$/);
      // Check for H1 heading (# Heading) - Treat as H2 for compatibility
      const h1Match = line.match(/^#\s+(.+)$/);
      
      if (h2Match || h1Match) {
        // Save previous section before starting new one
        saveCurrentSection();
        
        // Extract section name and strip word count markers
        const rawName = (h2Match?.[1] || h1Match?.[1] || '').trim();
        currentH2Section = stripWordCountMarkers(rawName)
          .replace(/^\d+(\.\d+)*\.?\s+/, '') // Remove all numbered prefixes (e.g., "1 ", "1. ", "11 ", "11. ", "11.1 ", "11.1. ", "11.1.1 ")
          .replace(/:\s*$/, '') // Remove trailing colon
          .trim();
        currentH3Subsection = ''; // Reset subsection
        currentContent = [];
        
        // Store H2 metadata
        sectionMetadata.current.set(currentH2Section, {
          content: '',
          level: 2,
          parentSection: undefined
        });
      } else if (h3Match && currentH2Section) {
        // Save previous section/subsection before starting new subsection
        saveCurrentSection();
        
        // Extract subsection name and strip word count markers
        currentH3Subsection = stripWordCountMarkers(h3Match[1])
          .replace(/^\d+(\.\d+)*\.?\s+/, '') // Remove all numbered prefixes (e.g., "1 ", "1. ", "11 ", "11. ", "11.1 ", "11.1. ", "11.1.1 ")
          .replace(/:\s*$/, '') // Remove trailing colon
          .trim();
        currentContent = [];
      } else if (currentH2Section && line.trim()) {
        // Regular content line - add to current section
        currentContent.push(line);
      }
    }

    // Don't forget the last section
    saveCurrentSection();

    return sections;
  };
  
  // Helper to get section level for TOC rendering
  const getSectionLevel = (sectionName: string): number => {
    return sectionMetadata.current.get(sectionName)?.level || 2;
  };
  
  // Helper to get parent section for TOC hierarchy
  const getParentSection = (sectionName: string): string | undefined => {
    return sectionMetadata.current.get(sectionName)?.parentSection;
  };

  const findSection = (sections: Record<string, string>, possibleNames: string[]): string => {
    for (const name of possibleNames) {
      const exactMatch = sections[name];
      if (exactMatch) return exactMatch;

      const partialMatch = Object.keys(sections).find(key => 
        key.toLowerCase().includes(name.toLowerCase())
      );
      if (partialMatch) return sections[partialMatch];
    }
    return '';
  };

  const extractMarketData = (sections: Record<string, string>, enhancedData: any) => {
    const domainData = enhancedData?.domainData || {};
    const financialData = enhancedData?.financialData || {};
    const investmentScore = enhancedData?.investmentScore || {};
    const absData = enhancedData?.absData || {};
    const locationData = enhancedData?.locationData || {};

    console.log('📊 Extracting market data with financial calculations:', {
      hasFinancialData: !!financialData,
      hasInitialCosts: !!financialData?.initialCosts,
      hasKeyMetrics: !!financialData?.keyMetrics,
      propertyValue: financialData?.initialCosts?.propertyValue,
      weeklyRent: financialData?.income?.weeklyRent
    });

    // Helper to extract numeric values from text
    const extractNumber = (text: string, pattern: RegExp): number | null => {
      const match = text.match(pattern);
      if (match) {
        const numStr = match[1].replace(/,/g, '');
        const num = parseFloat(numStr);
        return isNaN(num) ? null : num;
      }
      return null;
    };

    // CRITICAL: Prioritize structured financial data over markdown-parsed values
    // This ensures manual overrides are reflected in the PDF
    let medianPrice = financialData?.initialCosts?.propertyValue || domainData.medianPrice;
    // `grossRentalYield` is the key every producer writes: measured over the
    // 204 completed reports that carry a `keyMetrics` block, 188 hold
    // `grossRentalYield` and ZERO hold `grossYield`. Reading the name that was
    // never written made this fall through to a SCORE where a yield belongs.
    let rentalYield = financialData?.keyMetrics?.grossRentalYield
      ?? financialData?.keyMetrics?.grossYield
      ?? investmentScore.cashFlowScore;
    let growthRate = financialData?.assumptions?.capitalGrowth || domainData.growthRate || investmentScore.capitalGrowthScore;

    // Only fall back to parsing markdown if structured data is not available
    if (!medianPrice || !rentalYield) {
      const marketKPIs = findSection(sections, ['Market KPIs', 'Market Performance', 'Key Metrics']);
      
      if (marketKPIs) {
        if (!medianPrice) {
          const priceMatch = extractNumber(marketKPIs, /median.*price.*\$?([\d,]+)/i);
          if (priceMatch) medianPrice = priceMatch;
        }
        
        if (!rentalYield) {
          const yieldMatch = extractNumber(marketKPIs, /rental.*yield.*?([\d.]+)%/i);
          if (yieldMatch) rentalYield = yieldMatch;
        }
        
        if (!growthRate) {
          const growthMatch = extractNumber(marketKPIs, /growth.*?([\d.]+)%/i);
          if (growthMatch) growthRate = growthMatch;
        }
      }
    }

    // Parse Demographics section
    const demographics = findSection(sections, ['Demographics & Demand Drivers', 'Demographics', 'Population']);
    let population = absData.population || domainData.population;
    let medianAge = absData.medianAge || domainData.medianAge;
    let medianIncome = absData.medianIncome || domainData.medianIncome;

    if (demographics) {
      const popMatch = extractNumber(demographics, /population.*?([\d,]+)/i);
      if (popMatch) population = popMatch;
      
      const ageMatch = extractNumber(demographics, /median age.*?([\d.]+)/i);
      if (ageMatch) medianAge = ageMatch;
      
      const incomeMatch = extractNumber(demographics, /median.*income.*\$?([\d,]+)/i);
      if (incomeMatch) medianIncome = incomeMatch;
    }

    console.log('✓ Market data extracted:', {
      medianPrice,
      rentalYield,
      growthRate,
      source: financialData?.initialCosts?.propertyValue ? 'structured_data' : 'markdown_parsed'
    });

    return {
      medianPrice,
      rentalYield,
      growthRate,
      population,
      medianAge,
      medianIncome,
      demographics: absData.demographics || {},
      infrastructure: locationData.nearbyAmenities || locationData.infrastructure || {},
      financialData, // Pass through full financial data for detailed sections
    };
  };

  const replaceTextInElement = (element: HTMLElement, placeholder: string, value: string) => {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null
    );

    const nodesToReplace: { node: Text; newValue: string }[] = [];

    let node;
    while ((node = walker.nextNode())) {
      const textNode = node as Text;
      if (textNode.nodeValue?.includes(placeholder)) {
        nodesToReplace.push({
          node: textNode,
          newValue: textNode.nodeValue.replace(new RegExp(placeholder, 'g'), value)
        });
      }
    }

    nodesToReplace.forEach(({ node, newValue }) => {
      node.nodeValue = newValue;
    });
  };

  const replaceContentSection = (container: HTMLElement, sectionIdentifiers: string[], content: string, maxLength: number = 500) => {
    if (!content) return;

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    );

    const nodesToReplace: { node: Text; newValue: string }[] = [];
    let node;
    
    while ((node = walker.nextNode())) {
      const textNode = node as Text;
      const text = textNode.nodeValue || '';
      
      // Check if text matches any section identifier or is placeholder
      const matchesIdentifier = sectionIdentifiers.some(id => 
        text.toLowerCase().includes(id.toLowerCase())
      );
      const isPlaceholder = text.includes('Lorem ipsum') || 
                           text.includes('Sample text') ||
                           text.includes('placeholder') ||
                           text.trim().length > 50 && text.includes('dolor sit amet');
      
      if (matchesIdentifier || isPlaceholder) {
        // Clean markdown, bullets, and word count markers from content
        const cleanContent = content
          .replace(/^[#*\-•]\s*/gm, '') // Remove markdown headers and bullets
          .replace(/\(\s*\d+\s*(?:-\s*\d+)?\s*words?\s*\)/gi, '') // Remove word count markers like "(500 words)" or "(500-1000 words)"
          .replace(/\(\s*(?:minimum|min|max|maximum)?\s*\d+\s*(?:\+|-)?\s*words?\s*(?:required|minimum|min)?\s*\)/gi, '') // Remove "(min 500 words)" variants
          .replace(/\n+/g, ' ') // Replace newlines with spaces
          .trim()
          .substring(0, maxLength);
        
        nodesToReplace.push({
          node: textNode,
          newValue: cleanContent
        });
      }
    }

    nodesToReplace.forEach(({ node, newValue }) => {
      node.nodeValue = newValue;
    });
  };

  const generateCore = async (): Promise<InvestmentPdfBlob> => {
    console.log('🚀 Starting PDF generation for report:', report.id);
    
      // Fetch global report settings (contact details and disclaimer)
      console.log('⚙️ Step 0: Fetching global report settings...');
      const globalSettings = await fetchGlobalReportSettings();
      console.log('✓ Global settings loaded:', {
        company: globalSettings.contactDetails.company_name,
        disclaimerEnabled: globalSettings.disclaimer.is_enabled
      });

      console.log('📍 Step 1: Extracting suburb and state from address:', report.address);
      const { suburb, state } = extractSuburbState(report.address);
      console.log('✓ Extracted:', { suburb, state });
      
      console.log('📄 Step 2: Injecting override values and parsing report content...');
      // Inject override values from structured financial data into markdown content
      const contentWithOverrides = injectOverridesIntoContent(
        report.content,
        report.enhanced_data?.financialData
      );

      // Parse report content into sections
      const parsedSections = parseReportContent(contentWithOverrides);
      console.log('✓ Parsed sections:', Object.keys(parsedSections));
      
      // Filter out sources sections if toggle is off (AFTER parsing for reliability)
      const sectionsWithoutSources = applyContentRules(parsedSections);
      
      // Filter out scoring sections if toggle is off
      const sections = sectionsWithoutSources;
      console.log('✓ Final sections for PDF:', Object.keys(sections));

      // Load the PDF template
      console.log('📥 Step 3: Loading PDF template from /templates/npc_template.pdf...');
      const templateResponse = await fetch('/templates/npc_template.pdf');
      if (!templateResponse.ok) {
        throw new Error(`Failed to load template: ${templateResponse.status} ${templateResponse.statusText}`);
      }
      const templateBytes = await templateResponse.arrayBuffer();
      console.log('✓ Template loaded, size:', templateBytes.byteLength, 'bytes');
      
      // Load the template PDF
      console.log('📋 Step 4: Parsing PDF template...');
      const pdfDoc = await PDFDocument.load(templateBytes);
      console.log('✓ PDF template parsed successfully');
      
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      console.log('✓ Fonts embedded');

      // Get the second page from template to use as content template
      console.log('📑 Step 5: Preparing template pages...');
      const templatePages = pdfDoc.getPages();
      console.log('✓ Template has', templatePages.length, 'pages');
      
      if (templatePages.length < 2) {
        throw new Error('Template must have at least 2 pages');
      }

      // Remove the original second page since we'll duplicate it as needed
      pdfDoc.removePage(1); // Remove index 1 (second page)
      console.log('✓ Template pages configured');

      // ========================================
      // PAGE BREAK SETTINGS (Global Configuration)
      // ========================================
      const pageWidth = 595; // A4 width in points
      const pageHeight = 842; // A4 height in points
      const margin = 55; // Left/right margin — slightly wider content area
      const topMargin = 75; // Top margin (space for template header)
      const bottomMargin = 65; // Bottom margin
      const lineHeight = 15; // Tighter line spacing for professional look

      // ─── Premium Design Tokens (Dark & Gold) ────────────────────────────
      const GOLD_RGB = rgb(191 / 255, 155 / 255, 80 / 255);     // #BF9B50
      const GOLD_LIGHT_RGB = rgb(245 / 255, 235 / 255, 210 / 255); // #F5EBD2
      const NAVY_RGB = rgb(13 / 255, 38 / 255, 77 / 255);       // #0D264D
      const DARK_BG_RGB = rgb(20 / 255, 20 / 255, 20 / 255);    // #141414
      const WHITE_RGB = rgb(1, 1, 1);
      const BODY_TEXT_RGB = rgb(55 / 255, 55 / 255, 55 / 255);   // #373737
      const SECTION_BG_RGB = rgb(250 / 255, 247 / 255, 240 / 255); // Warm off-white for callouts
      const TABLE_HEADER_BG = NAVY_RGB;
      const TABLE_HEADER_TEXT = WHITE_RGB;
      const TABLE_ALT_ROW = rgb(252 / 255, 249 / 255, 242 / 255); // Very light gold tint
      const TABLE_BORDER = rgb(210 / 255, 195 / 255, 160 / 255);  // Gold-tinted border
      const FOOTER_TEXT_RGB = rgb(128 / 255, 128 / 255, 128 / 255);
      const titleSize = 14;
      const textSize = 9.5; // Slightly smaller for more content per page
      
      // Smart page break thresholds
      const PAGE_BREAK_CONFIG = {
        // Minimum space required before starting a new element
        MIN_SPACE_FOR_TABLE: 120, // Reduced — allow tables to start lower on page
        MIN_SPACE_FOR_SECTION: 90, // Minimum space for a new section title + some content
        MIN_SPACE_FOR_PARAGRAPH: 50, // Minimum space for a paragraph
        MIN_SPACE_FOR_HEADING: 70, // Minimum space for headings
        // Table-specific settings
        TABLE_ORPHAN_ROWS: 3, // Minimum rows to keep together (avoid orphan rows)
        PREFER_FULL_TABLES: true, // If true, move entire table to new page rather than split
        TABLE_SAFETY_MARGIN: 30, // Extra margin to ensure table fits
      };
      
      // Sections that MUST start on a new page (forced page breaks)
      const FORCED_NEW_PAGE_SECTIONS = [
        'employment & industry breakdown',
        'employment and industry breakdown',
        'recreational amenities',
        'property-level information',
        'property level information',
      ];
      
      // Headers that must stay attached to their following table (no orphan headers)
      const KEEP_WITH_TABLE_HEADERS = [
        'property snapshot',
        'ongoing annual costs',
        'ongoing annual ongoing costs',
        'annual ongoing costs',
        'water rates justification',
        'yield comparison to benchmarks',
        'interest only loan',
        'interest-only loan',
        'alternative structure',
        'loan serviceability assessment',
        'rental income projections',
      ];

      let currentPage: any = null;
      let yPosition = 0;

      // Helper to group content into paragraphs and tables
      const groupContentBlocks = (content: string): string[] => {
        const lines = content.split('\n');
        const blocks: string[] = [];
        let i = 0;
        
        while (i < lines.length) {
          const line = lines[i].trim();
          
          // Skip empty lines
          if (!line) {
            i++;
            continue;
          }
          
          // Check if this line is part of a table (contains |)
          if (line.includes('|')) {
            // Accumulate all consecutive table lines
            const tableLines: string[] = [];
            while (i < lines.length && lines[i].trim().includes('|')) {
              tableLines.push(lines[i]);
              i++;
            }
            // One run of pipe lines can hold more than one table: a second
            // header+delimiter pair starts a second block, so a two-column
            // assumptions table written directly under a seven-column
            // projection is drawn as its own table rather than padded out to
            // seven columns with its labels over its values (QA-34).
            for (const table of splitPipeRun(tableLines)) blocks.push(table.join('\n'));
          } else {
            // Regular paragraph line
            blocks.push(line);
            i++;
          }
        }
        
        return blocks;
      };

      // Helper function to sanitize text for WinAnsi encoding (removes emojis, newlines, and special chars)
      const stripEmojis = (text: string): string => {
        // Remove emojis and other non-WinAnsi characters
        return text
          // Replace smart/curly quotes with straight quotes
          .replace(/[\u2018\u2019\u201B]/g, "'") // Single curly quotes to straight
          .replace(/[\u201C\u201D\u201F]/g, '"') // Double curly quotes to straight
          // Replace special dashes and hyphens
          .replace(/[\u2013\u2014\u2015]/g, '-') // En-dash, em-dash, horizontal bar
          .replace(/[\u2010\u2011\u2012]/g, '-') // Various hyphens
          // A minus sign is a SIGN: dropping it as "non-WinAnsi" turned the
          // composed "Interest rate 5.5% (−1.0 pt)" into "(1.0 pt)" and
          // "−$10,392 a year" into "$10,392 a year" on the regenerated
          // Financial report — a wrong figure, not a missing glyph.
          .replace(/\u2212/g, '-') // Minus sign
          .replace(/\u2265/g, '>=').replace(/\u2264/g, '<=').replace(/\u2248/g, '~')
          .replace(/\u00AD/g, '') // Soft hyphen
          // Replace ellipsis
          .replace(/\u2026/g, '...')
          // Replace bullet points
          .replace(/[\u2022\u2023\u2043\u204C\u204D]/g, '-')
          // Replace non-breaking spaces and other space variants
          .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
          // Remove zero-width characters
          .replace(/[\u200C\u200D\uFEFF]/g, '')
          // Remove emojis - comprehensive ranges
          .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu, '')
          .replace(/[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{231A}-\u{231B}]/gu, '')
          .replace(/[\u{FE00}-\u{FE0F}]|[\u{E0020}-\u{E007F}]/gu, '') // Variation selectors
          // Remove other problematic Unicode symbols
          .replace(/[\u2190-\u21FF]/g, '') // Arrows
          .replace(/[\u2500-\u257F]/g, '') // Box drawing
          .replace(/[\u2580-\u259F]/g, '') // Block elements
          .replace(/[\u25A0-\u25FF]/g, '') // Geometric shapes
          .replace(/[\u2600-\u26FF]/g, '') // Miscellaneous symbols
          .replace(/[\u2700-\u27BF]/g, '') // Dingbats
          // Replace any remaining non-ASCII characters that aren't in WinAnsi
          .replace(/[^\x00-\x7F\xA0-\xFF]/g, '')
          // Replace newlines, carriage returns, tabs with spaces
          .replace(/[\n\r\t]/g, ' ')
          // Normalize multiple spaces to single space
          .replace(/\s+/g, ' ')
          .trim();
      };

      // Helper function to add a new content page by copying from template
      const addContentPage = async () => {
        // Load template again to get a fresh page 2
        const freshTemplate = await PDFDocument.load(templateBytes);
        const [copiedPage] = await pdfDoc.copyPages(freshTemplate, [1]);
        pdfDoc.addPage(copiedPage);
        return pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
      };

      // Helper function to add a contact/disclaimer page with global settings
      const addContactDisclaimerPage = async (settings: GlobalReportSettings) => {
        const page = drawPdfLibDisclaimerPage(
          pdfDoc,
          pageWidth,
          pageHeight,
          helveticaFont,
          helveticaBold,
          settings.contactDetails,
          settings.disclaimer,
        );
        console.log('✓ Added contact/disclaimer page with global settings');
        return page;
      };

      // Helper to check if text is a markdown table
      const isMarkdownTable = (text: string): boolean => {
        const lines = text.trim().split('\n');
        // A table has at least 2 lines (header + separator)
        if (lines.length < 2) return false;
        // Check if it has pipe separators
        return lines.some(line => line.includes('|'));
      };

      // Helper to calculate TOTAL table height without drawing (for smart page breaks)
      const calculateTableHeight = (tableText: string, maxWidth: number, normalFont: any, boldFont: any, size: number): number => {
        const lines = tableText.trim().split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length === 0) return 0;

        // Parse table rows (same rules as drawTable: interior empty cells are
        // kept, and the header decides the column count)
        const rows = lines
          .filter(line => {
            const withoutPipes = line.replace(/\|/g, '').trim();
            const isSeparator = /^[\s\-:]+$/.test(withoutPipes);
            return !isSeparator;
          })
          .map((line) => splitTableRow(line))
          .filter(row => row.some((cell) => cell.length > 0));

        if (rows.length === 0) return 0;

        const alignedForHeight = alignTableRows(rows);
        // An omitted grid costs one line of notice, not a table's height.
        if (looksAnonymousNumericGrid(alignedForHeight.header, alignedForHeight.body)) return size + 12;
        const normalizedRows = [alignedForHeight.header, ...alignedForHeight.body];

        const columnCount = Math.max(...normalizedRows.map(r => r.length));
        const cellPadding = 5;
        const tableLineHeight = size + 4;
        
        // Calculate column widths (simplified version for estimation)
        const colWidth = maxWidth / columnCount;
        
        let totalHeight = 0;
        
        // Calculate height for each row
        for (let i = 0; i < normalizedRows.length; i++) {
          const row = normalizedRows[i];
          const isHeader = i === 0;
          let maxRowHeight = tableLineHeight + 8;
          
          for (let j = 0; j < row.length; j++) {
            const cellText = sanitizeAIContent(stripEmojis(row[j] || ''));
            const maxCellWidth = colWidth - 2 * cellPadding;
            
            // Estimate lines needed
            let currentLineWidth = 0;
            let cellLines = 1;
            const font = isHeader ? boldFont : normalFont;
            const words = cellText.replace(/\*+/g, '').split(' ').filter(w => w.length > 0);
            
            for (const word of words) {
              const wordWidth = font.widthOfTextAtSize(word + ' ', size);
              if (currentLineWidth + wordWidth > maxCellWidth && currentLineWidth > 0) {
                cellLines++;
                currentLineWidth = wordWidth;
              } else {
                currentLineWidth += wordWidth;
              }
            }
            
            const cellHeight = (cellLines * tableLineHeight) + 8;
            maxRowHeight = Math.max(maxRowHeight, cellHeight);
          }
          
          totalHeight += maxRowHeight;
        }
        
        return totalHeight + 25; // Add spacing after table
      };

      // Helper to parse and draw markdown table
      const buildMarkdownTableFromRows = (tableRows: string[][]): string => {
        if (!tableRows.length) return '';
        const colCount = Math.max(...tableRows.map(r => r.length));
        const normalized = tableRows.map(r => {
          const padded = [...r];
          while (padded.length < colCount) padded.push('');
          return padded;
        });
        const header = `| ${normalized[0].join(' | ')} |`;
        const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;
        const body = normalized.slice(1).map(r => `| ${r.join(' | ')} |`);
        return [header, separator, ...body].join('\n');
      };

      const drawTable = (
        page: any,
        tableText: string,
        x: number,
        startY: number,
        maxWidth: number,
        normalFont: any,
        boldFont: any,
        size: number
      ): { lastY: number; needsNewPage: boolean; remainingTableText?: string } => {
        const lines = tableText.trim().split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length === 0) return { lastY: startY, needsNewPage: false };

        console.log('Drawing table with lines:', lines);

        // Parse table structure - filter out separator lines more carefully
        // Track if first row is header for column removal logic
        let isFirstDataRow = true;
        const rows = lines
          .filter(line => {
            // Keep lines that have content other than just |, -, :, and spaces
            const withoutPipes = line.replace(/\|/g, '').trim();
            const isSeparator = /^[\s\-:]+$/.test(withoutPipes);
            return !isSeparator;
          })
          .map((line, lineIndex) => {
            // Split by | into cells, KEEPING interior empty cells — a blank
            // cell is a column, and dropping it is how a row came to report a
            // different width from its header (QA-36). Emojis are stripped
            // when drawing, not here.
            const cells = splitTableRow(line);

            // Check if this is a total row (contains "Total" and has amount in the text)
            const lineText = line.toLowerCase();
            const isTotalRow = lineText.includes('total') && /\$[\d,]+\.?\d*/.test(line);
            
            // Determine if this is the header row (first row after filtering)
            const isHeaderRow = lineIndex === 0;
            
            // FIX: Handle malformed Total row where amount is in first cell and description in second
            // Pattern: | $X,XXX | Sum of ALL ongoing costs | (empty) |
            // Note: The content might have partial bold markers like "$8,908**" or "**Sum of..."
            // Strip bold markers before checking
            const firstCellClean = (cells[0] ?? '').trim().replace(/\*+/g, '');
            const secondCellClean = cells.length >= 2 ? (cells[1] ?? '').replace(/\*+/g, '').toLowerCase() : '';
            const firstCellIsDollarAmount = /^\$[\d,\.]+$/.test(firstCellClean);
            const secondCellIsOngoingCosts = secondCellClean.includes('sum of') || secondCellClean.includes('ongoing costs');
            
            console.log('Checking row for malformed Total:', { 
              cells, 
              firstCellClean, 
              firstCellIsDollarAmount, 
              secondCellIsOngoingCosts,
              cellsLength: cells.length
            });
            
            if (cells.length >= 2 && firstCellIsDollarAmount && secondCellIsOngoingCosts) {
              console.log('✅ Fixing malformed Total row:', cells);
              // Extract the numeric value, parse it, round it, and reformat to prevent duplicate decimals
              const numericValue = parseFloat(firstCellClean.replace(/[$,]/g, '')) || 0;
              const formattedValue = Math.round(numericValue).toLocaleString('en-AU');
              // Restructure to: [Label, Amount, Description]
              return ['**Total Annual Costs**', '**$' + formattedValue + '**', '**Sum of ALL ongoing costs**'];
            }
            
            // For total rows, preserve all cells including amounts
            // For normal data rows (NOT headers), remove the last column (Source/Methodology) to simplify layout
            // ISSUE 6 FIX: When we remove the last column from data rows, we must also remove it from the header
            // to keep column counts aligned. Track this via a flag we'll apply after the map.
            // For now, return all cells - we'll normalize column counts after parsing all rows.
            
            // For rows with amount in first cell like "Total Initial Costs $48,269", split it properly
            if (isTotalRow && cells.length === 1 && cells[0].includes('$')) {
              const match = cells[0].match(/^(.*?)(\$[\d,]+)$/);
              if (match) {
                return [match[1].trim(), '', match[2].trim()];
              }
            }
            
            return cells;
          })
          .filter(row => row.some((cell) => cell.length > 0));

        console.log('Parsed table rows (before normalization):', rows);

        if (rows.length === 0) return { lastY: startY, needsNewPage: false };

        // The header states the column count; rows are aligned under it. A
        // header one cell short of every row is missing its label column and
        // gains it on the left — the amenity matrix drew its category names
        // under "Close" and a blank fifth header because the old rule let the
        // data rows outvote the header (QA-36).
        const aligned = alignTableRows(rows);
        if (aligned.labelColumnAdded) console.log('  Header gained its label column');

        // A grid of bare integers under headers naming no unit, destination or
        // source cannot tell a reader what its numbers measure. It is omitted
        // with a visible note rather than drawn as though it were distances or
        // minutes (QA-36).
        if (looksAnonymousNumericGrid(aligned.header, aligned.body)) {
          console.warn('[investmentPdfDocument] table omitted: anonymous numeric grid', aligned.header);
          const notice = drawTextWithWrap(
            page, `*${ANONYMOUS_GRID_NOTICE}*`, x, startY, maxWidth, normalFont, boldFont, size, size + 5, 'left',
          );
          return { lastY: notice.lastY - 6, needsNewPage: false };
        }

        const normalizedRows = [aligned.header, ...aligned.body];
        console.log('Normalized table rows:', normalizedRows);

        const columnCount = Math.max(...normalizedRows.map(r => r.length));
        const cellPadding = 6; // Slightly more padding for readability
        const lineHeight = size + 5; // Better line spacing within cells
        
        // Calculate dynamic column widths based on content
        const calculateColumnWidths = (): number[] => {
          const minColWidth = 50; // Better minimum column width
          const contentWidths: number[] = [];
          
          // Detect if this is a scenario table (Conservative/Base Case/Optimistic)
          const headerRow = normalizedRows[0] || [];
          const isScenarioTable = headerRow.some((cell: string) => 
            cell?.toLowerCase().includes('conservative') || 
            cell?.toLowerCase().includes('base case') || 
            cell?.toLowerCase().includes('optimistic')
          );
          
          // Detect if first column is "Year" - these can be much narrower
          const firstColHeader = (headerRow[0] || '').toLowerCase().trim();
          const isFirstColYear = firstColHeader === 'year' || firstColHeader.includes('year');
          
          // Calculate content width for each column
          for (let col = 0; col < columnCount; col++) {
            // For Year columns, use a fixed narrow width
            if (col === 0 && isFirstColYear) {
              contentWidths.push(35); // Fixed narrow width for Year column
              continue;
            }
            
            let maxContentWidth = minColWidth;
            
            for (const row of normalizedRows) {
              if (row[col]) {
                const cellText = stripEmojis(row[col]);
                const parts = parseMarkdownText(cellText);
                
                // Calculate max word/segment width in this cell
                for (const part of parts) {
                  const partFont = part.bold ? boldFont : normalFont;
                  const words = part.text.split(' ');
                  
                  for (const word of words) {
                    const wordWidth = partFont.widthOfTextAtSize(word + ' ', size);
                    maxContentWidth = Math.max(maxContentWidth, wordWidth + 2 * cellPadding);
                  }
                }
              }
            }
            
            contentWidths.push(maxContentWidth);
          }
          
          // Calculate total desired width
          const totalDesiredWidth = contentWidths.reduce((sum, w) => sum + w, 0);
          
          // For scenario tables, ensure equal distribution for scenario columns
          if (isScenarioTable && columnCount >= 4) {
            const yearColWidth = isFirstColYear ? 35 : contentWidths[0];
            const remainingWidth = maxWidth - yearColWidth;
            const scenarioColCount = columnCount - 1;
            const scenarioColWidth = remainingWidth / scenarioColCount;
            
            return contentWidths.map((w, i) => {
              if (i === 0 && isFirstColYear) return yearColWidth;
              return Math.max(minColWidth, scenarioColWidth);
            });
          }
          
          // If desired width fits, use it; otherwise scale proportionally
          if (totalDesiredWidth <= maxWidth) {
            // Distribute extra space proportionally
            const extraSpace = maxWidth - totalDesiredWidth;
            return contentWidths.map(w => w + (w / totalDesiredWidth) * extraSpace);
          } else {
            // Scale down proportionally to fit, but preserve Year column narrow width
            const scale = maxWidth / totalDesiredWidth;
            return contentWidths.map((w, i) => {
              if (i === 0 && isFirstColYear) return Math.max(35, w * scale);
              return Math.max(minColWidth, w * scale);
            });
          }
        };
        
        const columnWidths = calculateColumnWidths();

        let currentY = startY;

        // Helper to draw text with wrapping and markdown within a cell
        const drawCellText = (
          cellText: string, 
          cellX: number, 
          cellY: number, 
          cellWidth: number, 
          font: any,
          isHeader: boolean,
          textColor?: any
        ): number => {
          const maxCellWidth = cellWidth - 2 * cellPadding;
          const parts = parseMarkdownText(sanitizeAIContent(stripEmojis(cellText)));
          
          let currentLineY = cellY;
          let currentLineX = cellX + cellPadding;
          let lineWords: Array<{text: string, font: any}> = [];
          let lineWidth = 0;

          const drawLine = () => {
            if (lineWords.length === 0) return;
            let drawX = currentLineX;
            for (const word of lineWords) {
              page.drawText(word.text, {
                x: drawX,
                y: currentLineY,
                size,
                font: word.font,
                color: textColor || rgb(0.2, 0.2, 0.2),
              });
              drawX += word.font.widthOfTextAtSize(word.text, size);
            }
            lineWords = [];
            lineWidth = 0;
            currentLineY -= lineHeight;
          };

          for (const part of parts) {
            const partFont = (part.bold || isHeader) ? boldFont : normalFont;
            
            // Check if this is a URL (contains :// or www. or long string without spaces)
            const isURL = part.text.includes('://') || part.text.includes('www.') || 
                         (part.text.length > 40 && !part.text.includes(' '));
            
            if (isURL) {
              // Break URLs at slashes, question marks, and other delimiters
              // BUT skip breaking at the protocol (https://, http://)
              let currentSegment = '';
              const protocolEndIndex = part.text.indexOf('://') !== -1 ? part.text.indexOf('://') + 3 : 0;
              
              for (let i = 0; i < part.text.length; i++) {
                const char = part.text[i];
                currentSegment += char;
                
                // Only break at / if we're past the protocol part
                const isBreakableSlash = char === '/' && i >= protocolEndIndex;
                const shouldBreakAfter = (isBreakableSlash || ['?', '&', '='].includes(char));
                const segmentWidth = partFont.widthOfTextAtSize(currentSegment, size);
                
                if ((shouldBreakAfter && i < part.text.length - 1) || segmentWidth > maxCellWidth * 0.95) {
                  // Draw current segment
                  if (lineWidth + segmentWidth > maxCellWidth && lineWords.length > 0) {
                    drawLine();
                  }
                  
                  lineWords.push({ text: currentSegment, font: partFont });
                  lineWidth += segmentWidth;
                  
                  // Start new line for next segment
                  if (shouldBreakAfter) {
                    drawLine();
                  }
                  
                  currentSegment = '';
                }
              }
              
              // Draw any remaining segment
              if (currentSegment) {
                const segmentWidth = partFont.widthOfTextAtSize(currentSegment, size);
                if (lineWidth + segmentWidth > maxCellWidth && lineWords.length > 0) {
                  drawLine();
                }
                lineWords.push({ text: currentSegment, font: partFont });
                lineWidth += segmentWidth;
              }
            } else {
              // Normal text wrapping by words
              const words = part.text.split(' ').filter(w => w.length > 0);
              
              for (const word of words) {
                const wordWithSpace = word + ' ';
                const wordWidth = partFont.widthOfTextAtSize(wordWithSpace, size);
                
                if (lineWidth + wordWidth > maxCellWidth && lineWords.length > 0) {
                  drawLine();
                }
                
                lineWords.push({ text: wordWithSpace, font: partFont });
                lineWidth += wordWidth;
              }
            }
          }
          
          if (lineWords.length > 0) {
            drawLine();
          }

          return cellY - currentLineY;
        };

        // Calculate row height based on tallest cell
        const calculateRowHeight = (row: string[], isHeader: boolean): number => {
          let maxHeight = lineHeight + 10; // Minimum height with better padding
          
          for (let j = 0; j < row.length; j++) {
            const cellText = row[j];
            const maxCellWidth = columnWidths[j] - 2 * cellPadding;
            
            // Calculate how many lines this cell needs
            const parts = parseMarkdownText(stripEmojis(cellText));
            let currentLineWidth = 0;
            let lines = 1;
            
            for (const part of parts) {
              const partFont = (part.bold || isHeader) ? boldFont : normalFont;
              
              // Check if this is a URL (same logic as drawCellText)
              const isURL = part.text.includes('://') || part.text.includes('www.') || 
                           (part.text.length > 40 && !part.text.includes(' '));
              
              if (isURL) {
                // Calculate lines needed for URL with breaking
                // BUT skip breaking at the protocol (https://, http://)
                let currentSegment = '';
                const protocolEndIndex = part.text.indexOf('://') !== -1 ? part.text.indexOf('://') + 3 : 0;
                
                for (let i = 0; i < part.text.length; i++) {
                  const char = part.text[i];
                  currentSegment += char;
                  
                  // Only break at / if we're past the protocol part
                  const isBreakableSlash = char === '/' && i >= protocolEndIndex;
                  const shouldBreakAfter = (isBreakableSlash || ['?', '&', '='].includes(char));
                  const segmentWidth = partFont.widthOfTextAtSize(currentSegment, size);
                  
                  if ((shouldBreakAfter && i < part.text.length - 1) || segmentWidth > maxCellWidth * 0.95) {
                    if (currentLineWidth + segmentWidth > maxCellWidth && currentLineWidth > 0) {
                      lines++;
                      currentLineWidth = segmentWidth;
                    } else {
                      currentLineWidth += segmentWidth;
                    }
                    
                    if (shouldBreakAfter) {
                      lines++;
                      currentLineWidth = 0;
                    }
                    
                    currentSegment = '';
                  }
                }
                
                if (currentSegment) {
                  const segmentWidth = partFont.widthOfTextAtSize(currentSegment, size);
                  if (currentLineWidth + segmentWidth > maxCellWidth && currentLineWidth > 0) {
                    lines++;
                    currentLineWidth = segmentWidth;
                  } else {
                    currentLineWidth += segmentWidth;
                  }
                }
              } else {
                // Normal word-based calculation
                const words = part.text.split(' ').filter(w => w.length > 0);
                
                for (const word of words) {
                  const wordWithSpace = word + ' ';
                  const wordWidth = partFont.widthOfTextAtSize(wordWithSpace, size);
                  
                  if (currentLineWidth + wordWidth > maxCellWidth && currentLineWidth > 0) {
                    lines++;
                    currentLineWidth = wordWidth;
                  } else {
                    currentLineWidth += wordWidth;
                  }
                }
              }
            }
            
            const cellHeight = (lines * lineHeight) + 8;
            maxHeight = Math.max(maxHeight, cellHeight);
          }
          
          return maxHeight;
        };

        // Draw each row
        for (let i = 0; i < normalizedRows.length; i++) {
          let row = normalizedRows[i];
          const isHeader = i === 0;
          
          // BACKUP FIX: Check for malformed Total row right before drawing
          // If first cell is a dollar amount and second cell mentions ongoing costs, fix it
          // Strip bold markers before checking
          if (!isHeader && row.length >= 2) {
            const firstCellClean = (row[0]?.trim() || '').replace(/\*+/g, '');
            const secondCellClean = (row[1] || '').replace(/\*+/g, '').toLowerCase();
            if (/^\$[\d,\.]+$/.test(firstCellClean) && (secondCellClean.includes('sum of') || secondCellClean.includes('ongoing costs'))) {
              console.log('🔧 BACKUP FIX: Restructuring malformed Total row at draw time:', row);
              // Extract the numeric value, parse it, round it, and reformat to prevent duplicate decimals
              const numericValue = parseFloat(firstCellClean.replace(/[$,]/g, '')) || 0;
              const formattedValue = Math.round(numericValue).toLocaleString('en-AU');
              row = ['**Total Annual Costs**', '**$' + formattedValue + '**', '**Sum of ALL ongoing costs**'];
            }
          }
          
          const rowHeight = calculateRowHeight(row, isHeader);
          
          // Check if we need a new page
          if (currentY - rowHeight < bottomMargin + 40) {
            // IMPORTANT: Return the remaining table content so it can continue on the next page
            // Re-include the header row on the next page for readability.
            const remainingRows = [normalizedRows[0], ...normalizedRows.slice(i)];
            const remainingTableText = buildMarkdownTableFromRows(remainingRows);
            return { lastY: currentY, needsNewPage: true, remainingTableText };
          }

          // Draw cell backgrounds — premium styled
          if (isHeader) {
            // Navy header background
            page.drawRectangle({
              x: x,
              y: currentY - rowHeight + 2,
              width: maxWidth,
              height: rowHeight,
              color: TABLE_HEADER_BG,
            });
          } else if (i % 2 === 0) {
            // Gold-tinted alternating rows
            page.drawRectangle({
              x: x,
              y: currentY - rowHeight + 2,
              width: maxWidth,
              height: rowHeight,
              color: TABLE_ALT_ROW,
            });
          }

          // Draw cells
          for (let j = 0; j < row.length; j++) {
            const cellX = x + columnWidths.slice(0, j).reduce((sum, w) => sum + w, 0);
            const cellText = row[j];
            const font = isHeader ? boldFont : normalFont;
            const cellTextY = currentY - size - 6; // Better vertical centering within cell
            
            if (isHeader) {
              // Use drawCellText with white color and word-wrapping for headers
              drawCellText(cellText, cellX, cellTextY, columnWidths[j], boldFont, true, TABLE_HEADER_TEXT);
            } else {
              drawCellText(cellText, cellX, cellTextY, columnWidths[j], font, isHeader);
            }

            // Draw vertical cell border (gold-tinted)
            if (j < row.length - 1) {
              page.drawLine({
                start: { x: cellX + columnWidths[j], y: currentY },
                end: { x: cellX + columnWidths[j], y: currentY - rowHeight },
                thickness: 0.5,
                color: TABLE_BORDER,
              });
            }
          }

          // Draw horizontal border (gold-tinted)
          page.drawLine({
            start: { x: x, y: currentY - rowHeight },
            end: { x: x + maxWidth, y: currentY - rowHeight },
            thickness: isHeader ? 1.5 : 0.5,
            color: isHeader ? GOLD_RGB : TABLE_BORDER,
          });

          if (isHeader) {
            // Draw top border for header (gold accent)
            page.drawLine({
              start: { x: x, y: currentY },
              end: { x: x + maxWidth, y: currentY },
              thickness: 1.5,
              color: GOLD_RGB,
            });
          }

          currentY -= rowHeight;
        }

        return { lastY: currentY - 18, needsNewPage: false }; // Clean spacing after table
      };

      // Helper to draw horizontal rule (gold accent)
      const drawHorizontalRule = (page: any, x: number, y: number, width: number): number => {
        page.drawLine({
          start: { x: x, y: y },
          end: { x: x + width, y: y },
          thickness: 1.5,
          color: GOLD_RGB,
        });
        return y - 20; // Space after rule
      };

      // ─── Premium KPI Boxes (gold-bordered metric cards) ─────────────────
      const drawKPIBoxes = (
        page: any,
        startY: number,
        metrics: Array<{ label: string; value: string; subtitle?: string }>,
        maxWidth: number
      ): number => {
        const boxCount = Math.min(metrics.length, 4); // Max 4 boxes per row
        if (boxCount === 0) return startY;
        
        const boxGap = 10;
        const boxWidth = (maxWidth - (boxCount - 1) * boxGap) / boxCount;
        const boxHeight = 72; // Increased for better spacing
        const cornerRadius = 4;
        
        for (let i = 0; i < boxCount; i++) {
          const metric = metrics[i];
          const boxX = margin + i * (boxWidth + boxGap);
          const boxY = startY - boxHeight;
          
          // Draw warm off-white background
          page.drawRectangle({
            x: boxX,
            y: boxY,
            width: boxWidth,
            height: boxHeight,
            color: SECTION_BG_RGB,
            borderColor: GOLD_RGB,
            borderWidth: 1.2,
          });
          
          // Draw gold top accent strip
          page.drawRectangle({
            x: boxX,
            y: boxY + boxHeight - 4,
            width: boxWidth,
            height: 4,
            color: GOLD_RGB,
          });
          
          // Draw label (small, gray, centered) — at top below gold strip
          const labelText = stripEmojis(metric.label).toUpperCase();
          const labelSize = 7;
          const labelWidth = helveticaBold.widthOfTextAtSize(labelText, labelSize);
          page.drawText(labelText, {
            x: boxX + (boxWidth - labelWidth) / 2,
            y: boxY + boxHeight - 18,
            size: labelSize,
            font: helveticaBold,
            color: FOOTER_TEXT_RGB,
          });
          
          // Draw value (large, navy, centered vertically)
          const valueText = stripEmojis(metric.value);
          const valueSize = metric.subtitle ? 15 : 16;
          const valueWidth = helveticaBold.widthOfTextAtSize(valueText, valueSize);
          const valueY = metric.subtitle ? boxY + 28 : boxY + 24;
          page.drawText(valueText, {
            x: boxX + (boxWidth - valueWidth) / 2,
            y: valueY,
            size: valueSize,
            font: helveticaBold,
            color: NAVY_RGB,
          });
          
          // Draw subtitle if present
          if (metric.subtitle) {
            const subText = stripEmojis(metric.subtitle);
            const subSize = 6.5;
            const subWidth = helveticaFont.widthOfTextAtSize(subText, subSize);
            page.drawText(subText, {
              x: boxX + (boxWidth - subWidth) / 2,
              y: boxY + 10,
              size: subSize,
              font: helveticaFont,
              color: FOOTER_TEXT_RGB,
            });
          }
        }
        
        return startY - boxHeight - 16; // Return new Y position
      };

      // ─── Premium Callout Panel (gold left border + warm background) ─────
      const drawCalloutPanel = (
        page: any,
        text: string,
        startY: number,
        maxWidth: number
      ): { lastY: number; needsNewPage: boolean } => {
        const panelPadding = 14;
        const borderWidth = 3;
        const innerWidth = maxWidth - borderWidth - panelPadding * 2;
        const textSize = 9.5;
        const lineSpacing = 14;
        
        // Calculate text height
        const textHeight = calculateTextHeight(
          text, innerWidth, helveticaFont, helveticaBold, textSize, lineSpacing
        );
        const panelHeight = textHeight + panelPadding * 2;
        
        // Check if panel fits on current page
        if (startY - panelHeight < bottomMargin + 40) {
          return { lastY: startY, needsNewPage: true };
        }
        
        const panelY = startY - panelHeight;
        
        // Draw warm off-white background
        page.drawRectangle({
          x: margin,
          y: panelY,
          width: maxWidth,
          height: panelHeight,
          color: SECTION_BG_RGB,
        });
        
        // Draw gold left border
        page.drawRectangle({
          x: margin,
          y: panelY,
          width: borderWidth,
          height: panelHeight,
          color: GOLD_RGB,
        });
        
        // Draw "What This Means" label at top
        const labelText = 'WHAT THIS MEANS';
        page.drawText(labelText, {
          x: margin + borderWidth + panelPadding,
          y: startY - panelPadding - 2,
          size: 7.5,
          font: helveticaBold,
          color: GOLD_RGB,
        });
        
        // Draw the callout text
        const textStartY = startY - panelPadding - 16;
        const result = drawTextWithWrap(
          page,
          text,
          margin + borderWidth + panelPadding,
          textStartY,
          innerWidth,
          helveticaFont,
          helveticaBold,
          textSize,
          lineSpacing,
          'left'
        );
        
        return { lastY: panelY - 15, needsNewPage: false };
      };

      // Helper to detect and extract "What This Means" callout content
      const isCalloutParagraph = (text: string): { isCallout: boolean; content: string } => {
        const calloutPatterns = [
          /^\*?\*?\s*#{0,6}\s*What\s*This\s*Means(?:\s*for\s*you)?\*?\*?[:\s\-–—]*([\s\S]*)/i,
          /^\*?\*?\s*#{0,6}\s*Key\s*Takeaway\*?\*?[:\s\-–—]*([\s\S]*)/i,
          /^\*?\*?\s*#{0,6}\s*Practical\s*Implication\*?\*?[:\s\-–—]*([\s\S]*)/i,
          /^\*?\*?\s*#{0,6}\s*Bottom\s*Line\*?\*?[:\s\-–—]*([\s\S]*)/i,
          /^\*?\*?\s*#{0,6}\s*In\s*Practice\*?\*?[:\s\-–—]*([\s\S]*)/i,
        ];

        for (const pattern of calloutPatterns) {
          const match = text.match(pattern);
          if (match) {
            let content = (match[1] ?? '').trim();
            // Strip nested/repeated label prefixes (e.g. "**What This Means**\nWhat This Means: ...")
            for (let i = 0; i < 3; i++) {
              const inner = content.match(
                /^\*?\*?\s*#{0,6}\s*(?:What\s*This\s*Means(?:\s*for\s*you)?|Key\s*Takeaway|Practical\s*Implication|Bottom\s*Line|In\s*Practice)\*?\*?[:\s\-–—]*([\s\S]*)/i,
              );
              if (!inner) break;
              content = (inner[1] ?? '').trim();
            }
            // Strip citation/placeholder noise
            const stripped = content
              .replace(/\[(?:provided[^\]]*|citation[^\]]*|n\/?a|tbd|todo|pending|placeholder)\]/gi, '')
              .replace(/\((?:citation[^)]*|provided[^)]*)\)/gi, '')
              .trim();
            const junk = /^(?:[-–—_*•\s]+|n\/?a|tbd|todo|pending|placeholder)$/i;
            if (!stripped || junk.test(stripped) || stripped.length < 15) {
              // Empty/junk body → drop the entire paragraph so we never render an empty box or orphan label.
              return { isCallout: true, content: '' };
            }
            return { isCallout: true, content: stripped };
          }
        }
        return { isCallout: false, content: text };
      };

      // Helper to detect KPI-style content and extract metrics
      /**
       * Which section names invite the KPI band, when the report has one.
       *
       * Named rather than inline because the band's PLACEMENT is now decided
       * before the section loop as well as inside it.
       */
      const sectionInvitesKpiBand = (name: string): boolean => {
        const n = name.toLowerCase();
        return n.includes('financial') || n.includes('investment snapshot')
          || n.includes('key metric') || n.includes('market kpi')
          || n.includes('property snapshot') || n.includes('executive summary');
      };

      /**
       * The basic investment KPIs, from the canonical record and nowhere else.
       *
       * ## The tier no longer decides
       *
       * This opened with `if (reportTier !== 'financial') return null`, under a
       * comment saying purchase price, LVR, yield and rent "must never render"
       * outside the Financial tier. A selected template, meanwhile, binds
       * `financials.*` unconditionally — so on report 783bb982 eleven correct
       * figures appeared in all three selectable templates and in none of the
       * standard document, and which core facts a client saw depended on which
       * presentation was chosen. 1,124 of 1,195 completed reports are Compass
       * tier, so that was almost the whole corpus.
       *
       * The architecture says the Report Engine decides substance and the
       * template decides presentation, so a presentation may not withhold a
       * fact the record holds. The rule is availability, not tier: **an
       * authoritative value exists → it may be presented; it is absent → that
       * one KPI is omitted.** Nothing here calculates, derives, substitutes or
       * fetches — every tile is a stored value formatted.
       *
       * The per-KPI checks below were already that rule and are untouched. They
       * omit a zero as well as a null, which is correct for these fields and is
       * this programme's "absent is never zero": measured over the 204 reports
       * carrying a `keyMetrics` block, none holds a zero price, rent or LVR,
       * and the five with a zero gross yield are the reports whose rent was
       * never established.
       *
       * The Financial tier is not flattened into Compass — it keeps its deeper
       * modelling, its extra sections and its specialist commentary. What it
       * stops having is a monopoly on the basic facts.
       */
      const extractKPIMetrics = (sectionName: string, content: string, enhancedData: any, isBandHost = false): { row1: Array<{ label: string; value: string; subtitle?: string }>; row2?: Array<{ label: string; value: string; subtitle?: string }> } | null => {
        const sectionLower = sectionName.toLowerCase();
        if (!isBandHost && !sectionInvitesKpiBand(sectionLower)) return null;
        const financialData = enhancedData?.financialData || {};
        const keyMetrics = financialData?.keyMetrics || {};
        const assumptions = financialData?.assumptions || {};
        const initialCosts = financialData?.initialCosts || {};
        const loanDetails = financialData?.loanDetails || {};
        const income = financialData?.income || {};
        const absData = enhancedData?.absData || {};
        
        const row1: Array<{ label: string; value: string; subtitle?: string }> = [];

        /*
         * Presence, never truthiness.
         *
         * `presenceOf` is this platform's authority on the three states —
         * `absent` (null/undefined/''/NaN), `zero` (a measured 0) and `value`
         * — and the whole reason it exists is that `if (v)` collapses the
         * middle one into the first. Every tile below asked `if (v)`, so a
         * genuine zero was indistinguishable from an unknown: a **breakeven**
         * weekly cash flow, a **cash purchase** carrying no loan, a rate held
         * at **0%** all vanished from the client's band as though the record
         * did not know them.
         *
         * The two are opposite failures and both are forbidden here. A zero
         * that is a finding must print as `$0` / `0.0%`; an absence must take
         * its whole tile with it rather than printing `N/A`, a dash, or a
         * fabricated `$0`.
         */
        const has = (v: unknown): boolean => presenceOf(v) !== 'absent';
        /*
         * And what the TIER may publish, which is a separate question from
         * what the record holds.
         *
         * This band used to open `if (reportTier !== 'financial') return null`
         * — so a Compass drew no band while every selectable template bound
         * `financials.*` and printed the same figures from the same record.
         * The fix made the rule availability rather than tier, and both
         * presentations then showed everything, which is how the Investment
         * Compass came to open on purchase price, gross yield, LVR and a
         * ten-year projection. `compassSectionRegistry` has said since v2.0
         * that a Compass carries none of it.
         *
         * `tierContent.pure.ts` decides it now, once, and the projection the
         * templates bind reads the same module — so the parity this test file
         * exists to protect holds, and what the two presentations agree ABOUT
         * is the tier's own content. Withholding the modelling is not
         * withholding the price: `identityFigures` keeps the price and the
         * rent on every tier.
         */
        const tierPolicy = contentPolicyFor(reportTier);
        /*
         * And who the document is FOR. An owner-occupier's copy draws no tile
         * that describes the property as a letting — the rent, the yields, the
         * weekly net position — the same keys the projection withholds from a
         * chosen template (`audienceContent.pure.ts`), so the two
         * presentations of one choice lead with the same figures.
         */
        const letting = audiencePolicyFor(presentation.audience).lettingFigures;
        const modelled = (v: unknown): boolean => tierPolicy.financialModelling && has(v);
        const identity = (v: unknown): boolean => tierPolicy.identityFigures && has(v);
        const money = (v: unknown) => {
          const n = Number(v);
          return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-AU', { maximumFractionDigits: 0 });
        };
        const pct = (v: unknown, dp: number) => Number(v).toFixed(dp) + '%';

        // Purchase Price. Absent is omitted rather than drawn as $0 — a
        // fabricated price is worse than a shorter band, and a report missing
        // one materially is the readiness layer's to stop, not this band's to
        // paper over.
        if (identity(initialCosts?.propertyValue)) {
          row1.push({ label: 'Purchase Price', value: money(initialCosts.propertyValue) });
        }

        // Weekly Rent, through the rent authority rather than a local test.
        if (letting && tierPolicy.identityFigures && rentIsEstablished(income) && has(income?.weeklyRent)) {
          row1.push({
            label: 'Weekly Rent',
            value: money(income.weeklyRent),
            // Named by its provenance, never certified by a fixed caption.
            // "Current market rate" was printed under an operator-supplied
            // figure on every document (QA-23); the record does not hold a
            // dated lease, appraisal or comparison that would earn the words.
            subtitle: rentProvenanceCaption(income),
          });
        }

        // LVR. `metrics.lvr ?? loan.lvr` is the order
        // `reportBindingProjection.pure.ts` reads it in, and reading it in a
        // different order is how one record comes to state two LVRs. An
        // authoritative 0% is an unleveraged acquisition and is preserved:
        // converting it to "missing" would describe a cash purchase as an
        // unknown one.
        const lvr = has(keyMetrics?.lvr) ? keyMetrics.lvr : loanDetails?.lvr;
        if (modelled(lvr)) {
          row1.push({ label: 'LVR', value: pct(lvr, 1), subtitle: 'Loan-to-Value Ratio' });
        }

        /*
         * A yield rests on a rent, and `rentIsEstablished` is the one rule
         * that decides whether this record has one — the same rule
         * `reportBindingProjection.pure.ts` gates both yields with.
         *
         * Where no rent is established the tile is omitted ENTIRELY. It is
         * never `0.00%`: 84 of 1,072 stored reports print exactly that because
         * the rent was unknown, and that defect is the reason this rule
         * exists. Where a rent IS established, a computed 0.00% is a finding
         * and prints.
         */
        const yieldIsFounded = rentIsEstablished(income);
        const grossYield = has(keyMetrics?.grossRentalYield)
          ? keyMetrics.grossRentalYield
          : keyMetrics?.grossYield;
        if (letting && tierPolicy.financialModelling && yieldIsFounded && has(grossYield)) {
          row1.push({ label: 'Gross Yield', value: pct(grossYield, 2), subtitle: 'Annual rental return' });
        }

        if (letting && tierPolicy.financialModelling && yieldIsFounded && has(keyMetrics?.netRentalYield)) {
          row1.push({ label: 'Net Yield', value: pct(keyMetrics.netRentalYield, 2), subtitle: 'After all costs' });
        }

        // Deposit and loan. A $0 loan is a cash acquisition — a fact about the
        // transaction, not a gap in the record — so it is stated.
        if (modelled(initialCosts?.deposit)) {
          row1.push({ label: 'Deposit', value: money(initialCosts.deposit), subtitle: 'Cash contribution' });
        }

        const loanAmount = has(loanDetails?.loanAmount) ? loanDetails.loanAmount : initialCosts?.loanAmount;
        if (modelled(loanAmount)) {
          row1.push({ label: 'Loan Amount', value: money(loanAmount), subtitle: 'At settlement' });
        }

        // The rate the whole projection rests on. Every selectable template
        // states it ("Interest rate assumed 6.50%") and the standard document
        // stated it nowhere, so a reader could not tell what the cash-flow
        // figures beside it had been modelled at.
        if (modelled(loanDetails?.interestRate)) {
          row1.push({ label: 'Interest Rate', value: pct(loanDetails.interestRate, 2), subtitle: 'Assumed for modelling' });
        }

        // The holding position. An authoritative $0 is a breakeven investment
        // outcome and is one of the most consequential things this band can
        // say, so it must survive.
        if (letting && modelled(keyMetrics?.weeklyNet)) {
          row1.push({
            label: 'Weekly Net Cash Flow',
            value: money(keyMetrics.weeklyNet),
            subtitle: 'After costs and finance',
          });
        }

        /*
         * Stamp duty, and the one tile where a zero needs a second question.
         *
         * `$0` duty is a real liability in some jurisdictions and concession
         * cases, but a zero also arrives when the duty was simply never
         * calculated. The canonical engine stamps every figure it produces
         * with the schedule it used (`stampDutyScheduleYear` /
         * `stampDutyScheduleSource`), so that stamp — not the number — is what
         * says a calculation happened. Nothing is recomputed here.
         */
        const dutyWasCalculated = has(initialCosts?.stampDutyScheduleYear)
          || has(initialCosts?.stampDutyScheduleSource);
        if (modelled(initialCosts?.stampDuty) && (Number(initialCosts.stampDuty) !== 0 || dutyWasCalculated)) {
          row1.push({ label: 'Stamp Duty', value: money(initialCosts.stampDuty), subtitle: 'Transfer duty payable' });
        }

        if (modelled(initialCosts?.totalUpfront)) {
          row1.push({ label: 'Total Upfront', value: money(initialCosts.totalUpfront), subtitle: 'Cash required to settle' });
        }

        // Capital growth is last because it describes the forecast rather
        // than the property. A stated 0% forecast is a position, not a gap.
        if (modelled(assumptions?.capitalGrowth)) {
          // An assumption is Recorded; a forecast is Computed from a method
          // and a date. The value is read from `assumptions`, so it is
          // captioned as one (QA-24 found it labelled "Annual forecast" here
          // and "Assumed" in the Snapshot — one figure, two evidence types).
          row1.push({ label: 'Capital Growth', value: pct(assumptions.capitalGrowth, 1), subtitle: 'Scenario assumption' });
        }

        // An owner-occupier's Compass publishes one identity figure, the price,
        // because the other is the rent; the chosen template draws that one
        // tile, so this band does too rather than dropping it and disagreeing
        // with the template about whether the price is on the page.
        if (row1.length < (letting ? 2 : 1)) return null;

        // ─── Row 2: Demographic KPIs ───
        const row2: Array<{ label: string; value: string; subtitle?: string }> = [];
        
        // Extract demographic data from absData
        const demographics = absData?.demographics || absData?.populationData || absData;
        
        // The same presence rule as the financial row. `||` chains are kept as
        // ALIAS resolution — three spellings of one field — but each candidate
        // is tested for presence rather than truthiness, so a measured zero
        // resolves instead of falling through to the next spelling.
        const firstPresent = (...candidates: unknown[]): unknown =>
          candidates.find((c) => has(c));

        // Population
        const population = firstPresent(
          demographics?.population, demographics?.totalPopulation, demographics?.total_population,
        );
        if (has(population)) {
          row2.push({
            label: 'Population',
            value: Number(population).toLocaleString('en-AU', { maximumFractionDigits: 0 }),
            subtitle: 'Local area',
          });
        }
        
        // Median Age
        const medianAge = firstPresent(demographics?.medianAge, demographics?.median_age);
        if (has(medianAge)) {
          row2.push({
            label: 'Median Age',
            value: String(Math.round(Number(medianAge))),
            subtitle: 'Years',
          });
        }
        
        // Median Income
        const medianIncome = firstPresent(
          demographics?.medianIncome, demographics?.median_income,
          demographics?.medianHouseholdIncome, demographics?.median_household_income,
        );
        if (has(medianIncome)) {
          row2.push({
            label: 'Median Income',
            value: '$' + Number(medianIncome).toLocaleString('en-AU', { maximumFractionDigits: 0 }),
            subtitle: 'Household p.a.',
          });
        }
        
        // Median House Price (bonus demographic)
        const medianHousePrice = firstPresent(
          demographics?.medianHousePrice, demographics?.median_house_price,
        );
        if (has(medianHousePrice) && row2.length < 4) {
          row2.push({
            label: 'Median House Price',
            value: '$' + Number(medianHousePrice).toLocaleString('en-AU', { maximumFractionDigits: 0 }),
            subtitle: 'Local market',
          });
        }
        
        return { row1: row1.slice(0, 12), row2: row2.length >= 2 ? row2.slice(0, 4) : undefined };
      };


      const parseMarkdownText = (text: string): Array<{text: string, bold: boolean, italic: boolean}> => {
        // Strip emojis first to prevent encoding errors
        text = stripEmojis(text);
        const parts: Array<{text: string, bold: boolean, italic: boolean}> = [];
        let remaining = text
          .replace(/^#{1,6}\s+/gm, '') // Remove markdown headers
          .replace(/^[\*\-\+]\s+/gm, '• ') // Convert markdown bullets
          .replace(/^\d+\.\s+/gm, '') // Remove numbered lists
          .replace(/^>\s+/gm, '') // Remove blockquotes
          .replace(/`{1,3}(.*?)`{1,3}/g, '$1') // Remove code formatting
          .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'); // Remove links, keep text

        // Parse bold and italic
        const boldItalicRegex = /\*\*\*(.*?)\*\*\*/g;
        const boldRegex = /\*\*(.*?)\*\*/g;
        const italicRegex = /\*(.*?)\*/g;

        let lastIndex = 0;
        const segments: Array<{text: string, start: number, end: number, bold: boolean, italic: boolean}> = [];

        // Find all bold+italic
        let match;
        while ((match = boldItalicRegex.exec(remaining)) !== null) {
          segments.push({text: match[1], start: match.index, end: match.index + match[0].length, bold: true, italic: true});
        }

        // Find all bold
        boldItalicRegex.lastIndex = 0;
        remaining = text
          .replace(/^#{1,6}\s+/gm, '')
          .replace(/^[\*\-\+]\s+/gm, '• ')
          .replace(/^\d+\.\s+/gm, '')
          .replace(/^>\s+/gm, '')
          .replace(/`{1,3}(.*?)`{1,3}/g, '$1')
          .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
        
        while ((match = boldRegex.exec(remaining)) !== null) {
          // Don't overlap with bold+italic
          if (!segments.some(s => match.index >= s.start && match.index < s.end)) {
            segments.push({text: match[1], start: match.index, end: match.index + match[0].length, bold: true, italic: false});
          }
        }

        // Find all italic
        boldRegex.lastIndex = 0;
        while ((match = italicRegex.exec(remaining)) !== null) {
          // Don't overlap with bold or bold+italic
          if (!segments.some(s => match.index >= s.start && match.index < s.end)) {
            segments.push({text: match[1], start: match.index, end: match.index + match[0].length, bold: false, italic: true});
          }
        }

        // Sort segments by position
        segments.sort((a, b) => a.start - b.start);

        // Build parts array with normal text between segments
        segments.forEach((seg, i) => {
          // Add normal text before this segment
          if (seg.start > lastIndex) {
            const normalText = remaining.substring(lastIndex, seg.start)
              .replace(/\*\*\*/g, '').replace(/\*\*/g, '').replace(/\*/g, '');
            if (normalText) parts.push({text: normalText, bold: false, italic: false});
          }
          // Add formatted segment
          parts.push({text: seg.text, bold: seg.bold, italic: seg.italic});
          lastIndex = seg.end;
        });

        // Add remaining normal text
        if (lastIndex < remaining.length) {
          const normalText = remaining.substring(lastIndex)
            .replace(/\*\*\*/g, '').replace(/\*\*/g, '').replace(/\*/g, '');
          if (normalText) parts.push({text: normalText, bold: false, italic: false});
        }

        // If no formatting found, return whole text as normal
        if (parts.length === 0) {
          parts.push({text: remaining.replace(/\*\*\*/g, '').replace(/\*\*/g, '').replace(/\*/g, ''), bold: false, italic: false});
        }

        return parts;
      };

      // Helper to calculate text height without drawing
      const calculateTextHeight = (text: string, maxWidth: number, normalFont: any, boldFont: any, size: number, lineSpacing: number): number => {
        const sanitizedText = stripEmojis(text); // Sanitize text first
        const parts = parseMarkdownText(sanitizedText);
        let lines = 1;
        let currentLineWidth = 0;
        
        for (const part of parts) {
          const words = part.text.split(' ');
          const font = part.bold ? boldFont : normalFont;
          
          for (const word of words) {
            const wordWithSpace = word + ' ';
            const wordWidth = font.widthOfTextAtSize(wordWithSpace, size);
            
            if (currentLineWidth + wordWidth > maxWidth && currentLineWidth > 0) {
              lines++;
              currentLineWidth = wordWidth;
            } else {
              currentLineWidth += wordWidth;
            }
          }
        }
        
        return lines * lineSpacing;
      };

      // Helper to draw text with word wrapping, markdown formatting, and JUSTIFIED alignment
      const drawTextWithWrap = (page: any, text: string, x: number, startY: number, maxWidth: number, normalFont: any, boldFont: any, size: number, lineSpacing: number, align: 'left' | 'justify' = 'justify') => {
        // Sanitize text: strip emojis AND fix AI content issues (word merges, duplicates)
        const sanitizedText = sanitizeAIContent(stripEmojis(text));
        const parts = parseMarkdownText(sanitizedText);
        let currentY = startY;
        
        // Collect all words with their fonts first
        /*
         * `glue` — this word takes no space before it.
         *
         * `parseMarkdownText` returns a run per emphasis span, and every run
         * was split on spaces into independent words. `**988 m² land size**,
         * paired with…` therefore drew the comma as its OWN word, with a space
         * in front of it: "988 m² land size , paired with". Every bold phrase
         * followed by punctuation had it — three on the first page of prose in
         * the certification render — and it is the most visible typographic
         * fault in the document.
         *
         * A run that does not begin with white space continues the previous
         * word. The punctuation keeps its own run's font, which is why this is
         * a flag rather than a string concatenation.
         */
        const allWords: Array<{word: string, font: any, glue: boolean}> = [];
        let openGap = true; // nothing drawn yet, so no gap to close
        for (const part of parts) {
          const words = part.text.split(' ').filter(w => w.length > 0);
          const font = part.bold ? boldFont : normalFont;
          /*
           * BOTH sides decide. A run's own text never begins with the space
           * that separates it from the run before — `…is a ` + `land-rich…`
           * keeps that space at the END of the first run — so asking only
           * whether this run starts with white space glues every bold phrase
           * onto the word in front of it: "is aland-rich".
           */
          const continues = allWords.length > 0 && !openGap && !/^\s/.test(part.text);
          for (let wi = 0; wi < words.length; wi++) {
            allWords.push({ word: words[wi], font, glue: wi === 0 && continues });
          }
          if (words.length > 0) openGap = /\s$/.test(part.text);
        }
        
        // Build lines for text wrapping
        type LineData = { words: Array<{word: string, font: any, glue: boolean}>, totalWidth: number };
        const lines: LineData[] = [];
        let currentLine: LineData = { words: [], totalWidth: 0 };
        const spaceWidth = normalFont.widthOfTextAtSize(' ', size);
        
        /** The width a line's words occupy, honouring glue. */
        const measureLine = (words: LineData['words']): number => words.reduce(
          (sum, w, i) => sum + w.font.widthOfTextAtSize(w.word, size) + (i > 0 && !w.glue ? spaceWidth : 0),
          0,
        );

        for (let i = 0; i < allWords.length; i++) {
          const { word, font, glue } = allWords[i];
          const wordWidth = font.widthOfTextAtSize(word, size);
          
          // Handle words that are wider than maxWidth by breaking them
          if (wordWidth > maxWidth) {
            const brokenParts = breakLongWord(word, maxWidth, font, size);
            for (const part of brokenParts) {
              const partWidth = font.widthOfTextAtSize(part, size);
              if (currentLine.words.length > 0) {
                lines.push(currentLine);
              }
              currentLine = { words: [{ word: part, font, glue: false }], totalWidth: partWidth };
            }
            continue;
          }
          
          const needsSpace = currentLine.words.length > 0 && !glue;
          const neededWidth = needsSpace ? wordWidth + spaceWidth : wordWidth;
          
          if (currentLine.totalWidth + neededWidth > maxWidth && currentLine.words.length > 0) {
            // Line is full. A glued word may not start one — it is punctuation
            // belonging to the word before it — so that word moves down with
            // it rather than being left with a comma on the next line.
            if (glue && currentLine.words.length > 1) {
              const carried = currentLine.words.pop()!;
              currentLine.totalWidth = measureLine(currentLine.words);
              lines.push(currentLine);
              currentLine = { words: [{ ...carried, glue: false }, { word, font, glue: true }], totalWidth: 0 };
              currentLine.totalWidth = measureLine(currentLine.words);
            } else {
              lines.push(currentLine);
              currentLine = { words: [{ word, font, glue: false }], totalWidth: wordWidth };
            }
          } else {
            currentLine.words.push({ word, font, glue });
            currentLine.totalWidth += neededWidth;
          }
        }
        // Push the last line
        if (currentLine.words.length > 0) {
          lines.push(currentLine);
        }
        
        // Draw each line with appropriate alignment
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
          const line = lines[lineIndex];
          const isLastLine = lineIndex === lines.length - 1;
          
          // Check if we need a new page
          if (currentY < bottomMargin + 40) {
            // CRITICAL FIX: Do NOT drop the rest of the paragraph.
            // Return the remaining text as markdown parts so the caller can continue on the next page.
            const remainingWords = lines
              .slice(lineIndex)
              .flatMap(l => l.words);

            // Reconstruct a markdown-ish string that preserves bold styling (italic is not rendered anyway).
            // Glue survives the hand-off: joining every word with a space here
            // is what would put the comma back on its own on the next page.
            const remainingText = remainingWords
              .map(({ word, font }) => (font === boldFont ? `**${word}**` : word))
              .reduce((acc, w, i) => (i === 0 ? w : acc + (remainingWords[i].glue ? '' : ' ') + w), '');

            return {
              needsNewPage: true,
              lastY: currentY,
              remainingParts: parseMarkdownText(remainingText),
            };
          }
          
          // For left alignment OR single word OR last line of justified text - use left alignment
          if (align === 'left' || line.words.length === 1 || isLastLine) {
            let drawX = x;
            for (let wi = 0; wi < line.words.length; wi++) {
              const { word, font } = line.words[wi];
              page.drawText(word, {
                x: drawX,
                y: currentY,
                size,
                font,
                color: rgb(0.2, 0.2, 0.2),
              });
              // The gap belongs to the word that FOLLOWS: a glued one takes none.
              const next = line.words[wi + 1];
              drawX += font.widthOfTextAtSize(word, size) + (next && !next.glue ? spaceWidth : 0);
            }
          } else {
            // Multiple words, not last line, justify alignment - distribute space evenly
            const totalWordsWidth = line.words.reduce((sum, { word, font }) => 
              sum + font.widthOfTextAtSize(word, size), 0);
            const extraSpace = maxWidth - totalWordsWidth;
            // Justification distributes the extra across the REAL gaps. A
            // glued word has no gap before it, so counting it would open one.
            const gaps = line.words.filter((w, i) => i > 0 && !w.glue).length;
            const spaceBetween = gaps > 0 ? extraSpace / gaps : 0;
            
            let drawX = x;
            for (let wi = 0; wi < line.words.length; wi++) {
              const { word, font } = line.words[wi];
              page.drawText(word, {
                x: drawX,
                y: currentY,
                size,
                font,
                color: rgb(0.2, 0.2, 0.2),
              });
              const next = line.words[wi + 1];
              drawX += font.widthOfTextAtSize(word, size) + (next && !next.glue ? spaceBetween : 0);
            }
          }
          
          currentY -= lineSpacing;
        }

        return { needsNewPage: false, lastY: currentY, remainingParts: [] };
      };

      // Get ALL sections from the report dynamically instead of hardcoded list
      // Filter out meta/cover/contents entries that should never appear as numbered TOC items
      const META_SECTION_PATTERNS: RegExp[] = [
        /^cover\s*page?$/i,
        /^cover$/i,
        /^contents?$/i,
        /^table\s+of\s+contents$/i,
        /^reading\s+guide$/i,
        /^naidu/i,
        /^title\s*page$/i,
        /^disclaimer$/i,
        /^back\s*cover$/i,
      ];
      // Compass / Compass-40 only: financial-leak sections that must never render.
      // These are still valid for the Financial Analysis tier.
      if (reportTier !== 'financial') {
        META_SECTION_PATTERNS.push(
          /^investment\s+highlights$/i,
          /^key\s+findings$/i,
          /^headline\s+scores?$/i,
          /^overall\s+investment\s+profile$/i,
          /^investment\s+score\s+analysis$/i,
          /^macro\s+investment\s+scorecard$/i,
          /^property\s+snapshot\s*[-–—]\s*non[-\s]?financial$/i,
        );
      }

      // Collapse adjacent repeated words/phrases that occasionally appear in
      // model-generated headings (e.g. "Industry 4 Industry & Employment",
      // "Amenity Amenity & Livability", "SEIFA IFA", "Key Strengths Key Strengths").
      const dedupeRepeatedWords = (s: string): string => {
        if (!s) return s;
        let out = s;
        out = out.replace(/\b(\w+)\s+\d+\s+\1\b/gi, '$1');
        out = out.replace(/\b((?:\w+\s+){1,3}\w+)\s+\d+\s+\1\b/gi, '$1');
        for (let i = 0; i < 2; i++) {
          out = out.replace(/\b((?:\w+\s+){0,3}\w+)\s+\1\b/gi, '$1');
        }
        out = out.replace(/(\b\w+\b)\s*,\s*\1\b/gi, '$1');
        out = out.replace(/\b(\w*?)(\w{3,})\s+\2\b/gi, '$1$2');
        return out.replace(/\s{2,}/g, ' ').trim();
      };
      const isMetaSectionName = (raw: string) => {
        const cleaned = dedupeRepeatedWords(raw
          .replace(/^#{1,6}\s*/, '')
          .replace(/^\d+(\.\d+)*\.?\s+/, '')
          .replace(/:\s*$/, '')
          .trim());
        return META_SECTION_PATTERNS.some((p) => p.test(cleaned));
      };
      // De-duplicate sections that the model produces twice (e.g. "Property
      // Snapshot" appears once on its own and once as "Property Snapshot —
      // Non-Financial"). Keep the first occurrence of each canonical name.
      const seenCanonical = new Set<string>();
      const seenTopic = new Set<string>();
      const topicOf = (name: string): string | null => {
        const n = name.toLowerCase();
        if (/\b(transport|connectivity|commute|rail access|road network|public transport)\b/.test(n)) return 'transport';
        if (/\bpopulation\s+(growth|trends|&|and)\b/.test(n)) return 'population';
        if (/\bfuture\s+infrastructure\b/.test(n)) return 'infrastructure';
        return null;
      };
      const allSectionNames = Object.keys(sections).filter(name => {
        if (!name || !sections[name] || sections[name].trim().length < 40) return false;
        if (isMetaSectionName(name)) return false;
        const canonical = dedupeRepeatedWords(name
          .replace(/^#{1,6}\s*/, '')
          .replace(/^\d+(\.\d+)*\.?\s+/, '')
          .replace(/:\s*$/, '')
          .trim()).toLowerCase();
        if (seenCanonical.has(canonical)) return false;
        seenCanonical.add(canonical);
        // Fuzzy topic dedup — only one H2 per topic group (Compass tier only).
        if (reportTier !== 'financial') {
          const t = topicOf(canonical);
          if (t) {
            if (seenTopic.has(t)) return false;
            seenTopic.add(t);
          }
        }
        return true;
      });


      console.log('Found sections to include in PDF:', allSectionNames);

      /*
       * Where the KPI band goes when the report never names a financial
       * section.
       *
       * The band has always attached to a section whose NAME invites it, and
       * that is a fact about how the model happened to title its chapters:
       * measured over the corpus, only 141 of 1,123 Compass reports carry such
       * a heading — the rest run "Executive Verdict", "Property & Locality
       * Snapshot", "Why This Location Matters", none of which match. Removing
       * the tier suppression alone would therefore have left the basic
       * investment facts off seven documents in eight while the selected
       * templates kept showing them.
       *
       * So a report with no inviting section hosts the band on its FIRST
       * section. Purely additive: every document that draws the band today
       * draws it in the same place, and one that drew none now draws one.
       */
      const kpiBandFallbackHost = allSectionNames.some((n) => sectionInvitesKpiBand(n))
        ? null
        : allSectionNames[0] ?? null;
      
      // Track section page numbers as we render (used for TOC in compass tier)
      const sectionPageNumbers: Map<string, number> = new Map();
      /** Sections that drew something; the contents page lists only these. */
      const paintedSections = new Set<string>();
      
      // ========== DYNAMIC TABLE OF CONTENTS - TWO-PASS APPROACH ==========
      // Only generate TOC for 'compass' tier (full Investor Compass reports)
      // Skip TOC for 'briefing' (Executive Brief) and 'snapshot' (Snapshot) tiers
      const shouldIncludeTOC = reportTier === 'compass';
      const tocPageIndices: number[] = [];
      
      if (shouldIncludeTOC) {
        console.log('📑 Step 5.0.5: Preparing dynamic Table of Contents (compass tier)...');
        
        // Reserve TOC pages (we'll come back and fill them in after rendering content)
        // Estimate 1-2 pages for TOC based on section count
        const tocEntriesPerPage = 28; // Approximate entries per TOC page
        const estimatedTocPages = Math.ceil(allSectionNames.length / tocEntriesPerPage);
        
        // Store the TOC page indices so we can draw on them later
        for (let i = 0; i < estimatedTocPages; i++) {
          currentPage = await addContentPage();
          tocPageIndices.push(pdfDoc.getPageCount() - 1);
        }
        
        console.log(`✓ Reserved ${estimatedTocPages} TOC page(s) at indices:`, tocPageIndices);
      } else {
        console.log(`📑 Step 5.0.5: Skipping TOC (${reportTier} tier does not require TOC)`);
      }
      
      // Content rendering starts AFTER TOC pages (if any)
      // The page number display will account for: cover (1) + TOC pages + content pages
      const contentStartPageIndex = pdfDoc.getPageCount();
      console.log(`📄 Content will start at page index ${contentStartPageIndex}`);
      
      // ========== END TOC RESERVATION ==========

      // Add content start page with report title
      currentPage = await addContentPage();
      yPosition = pageHeight - topMargin - 20;

      // Use the property address directly as the title (which admins can edit).
      // The tier is translated into words in exactly one place —
      // `DOCUMENT_IDENTITY` — so this document is called what the templated
      // one, the cover and the file name call it. A four-branch ternary here
      // titled the Due Diligence Report "Snapshot Report" (QA-32).
      const tierPrefix = documentTitleForTier(reportTier);
      const titleText = stripEmojis(`${tierPrefix}: ${report.address}`);
      let titleResult = drawTextWithWrap(
        currentPage,
        `**${titleText}**`,
        margin,
        yPosition,
        pageWidth - 2 * margin,
        helveticaFont,
        helveticaBold,
        18,
        24,
        'left' // Report title should be left-aligned
      );
      if (titleResult.needsNewPage) {
        currentPage = await addContentPage();
        yPosition = pageHeight - topMargin - 20;
        titleResult = drawTextWithWrap(
          currentPage,
          `**${titleText}**`,
          margin,
          yPosition,
          pageWidth - 2 * margin,
          helveticaFont,
          helveticaBold,
          18,
          24,
          'left' // Report title should be left-aligned
        );
      }
      yPosition = titleResult.lastY - 25;
      
      console.log('✏️ Step 5.1: Starting to render', allSectionNames.length, 'sections...');

      let sectionCount = 0;
      for (const sectionName of allSectionNames) {
        sectionCount++;
        /*
         * Stripped HERE, at paint time, and nowhere earlier.
         *
         * Removing the directives from the content before `parseReportContent`
         * cost the document FOUR CHAPTERS and the disclaimer: a chapter whose
         * own body is a single `{{glance: …}}` opener — "Why This Location
         * Matters", "Amenity & Access", "Property Fit Within the Suburb",
         * "Appendix, Source Notes & Disclaimer" — then had a body of nothing,
         * and `allSectionNames` drops anything under 40 characters, so the
         * heading, its table-of-contents entry and its H3 children's parentage
         * all went with it. Sectioning, the section filter and the contents
         * therefore see exactly what the record holds; only the painted text
         * loses the tokens.
         */
        // A chapter whose own body is blank because its prose lives in its H3
        // children is not empty — the guard below says so — but this early
        // exit ran first and skipped the heading before the children rule
        // could be asked (measured on the regenerated Due Diligence report:
        // "Property & Location Risk Dashboard" opened straight on its
        // "### Consolidated Risk Register" and lost its heading).
        const sectionHasChildren = [...sectionMetadata.current.values()].some((m) => m.parentSection === sectionName);
        let content = stripUndrawableDirectives(sections[sectionName]);
        if (!sections[sectionName] && !sectionHasChildren) continue;

        // Strip orphan "What This Means:" labels with no body before next heading/EOF.
        content = content.replace(
          /(^|\n)(?:>\s*)?\**\s*(?:#{1,4}\s*)?(?:WHAT\s+THIS\s+MEANS|What\s+This\s+Means)\s*:?\s*\**\s*(?=\n\s*(?:#{1,4}\s|$))/g,
          '$1'
        );
        // Strip leftover [citation] / (citation) tokens that slipped past the edge sanitizer.
        content = content
          .replace(/\[(citation(?:\s+needed)?|source(?:\s+needed)?|TBD|placeholder)\]/gi, '')
          .replace(/\((citation(?:\s+needed)?|source(?:\s+needed)?|TBD|placeholder)\)/gi, '')
          .replace(/\[\d+\](?:\[\d+\])*/g, '');

        // The plain renderer's Markdown hygiene — fences unwrapped, footnotes
        // numbered and listed, underscore emphasis converted, the echoed
        // authoring note removed, delimiter rows and separator runs tamed —
        // applied AFTER the citation scrub above so the numbered notes it
        // writes survive. See `plainMarkdownHygiene.pure.ts`.
        const prepared = prepareMarkdownForPlainRenderer(content);
        content = prepared.markdown;
        const hygieneNotes = Object.entries(prepared.notices).filter(([, n]) => n > 0);
        if (hygieneNotes.length) {
          console.log(`🧼 "${sectionName}": ${hygieneNotes.map(([k, n]) => `${k}=${n}`).join(', ')}`);
        }
        // A section left with nothing to paint draws no heading either: the
        // guard used to test the UNSTRIPPED value, so a chapter whose whole
        // body was directives this presentation cannot draw printed as a
        // heading over nothing (QA-33). A chapter whose prose lives in its
        // H3 children is not empty — its heading is their title and stays
        // (that is the chapter-survival rule `standardPresentationDirectives`
        // pins), so only a heading with neither body nor children goes.
        if (!content.trim()) {
          if (!sectionHasChildren) {
            console.log(`↷ "${sectionName}" has nothing to paint after hygiene; heading not drawn`);
            continue;
          }
        }
        paintedSections.add(sectionName);


        // Clean section name and strip emojis + dedupe repeated word/phrase artefacts
        const cleanSectionName = dedupeRepeatedWords(stripEmojis(
          sectionName
            .replace(/^#{1,6}\s*/, '')
            .replace(/:\s*$/, '')
            .trim()
        ));

        
        console.log(`  📝 Section ${sectionCount}/${allSectionNames.length}: "${cleanSectionName}"`);

        // Calculate total height needed for this section
        const paragraphs = groupContentBlocks(content);
        console.log(`     → ${paragraphs.length} content blocks`);
        const sectionTitleHeight = 30;
        let totalContentHeight = 0;
        
        // Calculate height of first content block (to ensure it stays with heading)
        let firstBlockHeight = 0;
        
        for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
          const paragraph = paragraphs[pIdx];
          if (!paragraph.trim()) continue;
          
          let blockHeight = 0;
          
          // Check for horizontal rule
          if (paragraph.trim().match(/^-{3,}$/)) {
            blockHeight = 20;
          } else if (isMarkdownTable(paragraph)) {
            // Estimate table height: count rows and multiply by row height
            const tableLines = paragraph.split('\n').filter(l => l.trim() && !l.match(/^[\|\s\-:]+$/));
            blockHeight = tableLines.length * (textSize + 12) + 16; // row height + padding
          } else {
            // Regular text - calculate height normally
            blockHeight = calculateTextHeight(
              paragraph,
              pageWidth - 2 * margin,
              helveticaFont,
              helveticaBold,
              textSize,
              lineHeight
            ) + 8; // paragraph spacing
          }
          
          totalContentHeight += blockHeight;
          
          // Capture first meaningful block height (skip horizontal rules)
          if (firstBlockHeight === 0 && !paragraph.trim().match(/^-{3,}$/)) {
            firstBlockHeight = blockHeight;
          }
        }
        
        // The KPI band draws BEFORE the first paragraph, so its height is part
        // of what must stay with the heading. Measured on the regenerated
        // Financial report: "Financial Investment Scorecard" printed alone at
        // the foot of a page while its band and table moved to the next,
        // because the band's own page-break check ran after the heading.
        const kpiMetricsForBand = extractKPIMetrics(
          cleanSectionName, content, report.enhanced_data,
          kpiBandFallbackHost !== null && sectionName === kpiBandFallbackHost,
        );
        const kpiBandHeight = kpiMetricsForBand
          ? Math.ceil(kpiMetricsForBand.row1.length / 4) * 88 + (kpiMetricsForBand.row2 ? 90 : 0)
          : 0;
        if (kpiBandHeight) {
          firstBlockHeight += kpiBandHeight;
          totalContentHeight += kpiBandHeight;
        }

        const totalSectionHeight = sectionTitleHeight + totalContentHeight + 15; // section spacing
        
        // IMPROVED PAGE BREAK LOGIC:
        // 1. SKIP page break logic for first section (it should stay with report title)
        // 2. Check for forced page break sections 
        // 3. Minimum content with heading = title + first content block (at least 120px)
        // 4. Never leave a heading orphaned at the bottom of a page
        const cleanSectionLower = cleanSectionName.toLowerCase();
        const shouldForceNewPage = FORCED_NEW_PAGE_SECTIONS.some(section => 
          cleanSectionLower.includes(section)
        );
        
        // First section should stay on the same page as the report title (no page break)
        const isFirstSection = sectionCount === 1;
        
        if (isFirstSection) {
          // Keep first section with the title - no page break
          console.log(`     → First section: keeping with report title (no page break)`);
        } else if (shouldForceNewPage) {
          console.log(`     → FORCED page break for section: "${cleanSectionName}"`);
          currentPage = await addContentPage();
          yPosition = pageHeight - topMargin - 20;
        } else {
          const minContentWithHeading = Math.max(sectionTitleHeight + firstBlockHeight + 30, 150);
          const remainingSpace = yPosition - bottomMargin;
          
          // Force new page if we can't fit heading + first content block together
          if (remainingSpace < minContentWithHeading) {
            console.log(`     → Page break: only ${Math.round(remainingSpace)}px remaining, need ${Math.round(minContentWithHeading)}px for heading + first block`);
            currentPage = await addContentPage();
            yPosition = pageHeight - topMargin - 20;
          }
          // Or if entire section fits and current space is tight, start fresh
          else if (totalSectionHeight < (pageHeight - topMargin - bottomMargin - 100) && 
              yPosition - totalSectionHeight < bottomMargin + 40) {
            console.log(`     → Page break: section fits on new page (${Math.round(totalSectionHeight)}px), starting fresh`);
            currentPage = await addContentPage();
            yPosition = pageHeight - topMargin - 20;
          }
        }

        // TRACK SECTION PAGE NUMBER for TOC
        // Record which page this section starts on (1-indexed for display)
        const currentPageNumber = pdfDoc.getPageCount(); // Current page we're about to draw on
        sectionPageNumbers.set(cleanSectionName, currentPageNumber);

        // ─── Premium Section Header: Gold accent bar + Navy text ───────────
        // Draw gold accent bar on the left
        currentPage.drawRectangle({
          x: margin - 8,
          y: yPosition - 6,
          width: 3,
          height: 18,
          color: GOLD_RGB,
        });
        
        // Draw subtle gold underline below the section title area
        const sectionTitleClean = stripEmojis(cleanSectionName);
        const sectionTitleWidth = helveticaBold.widthOfTextAtSize(sectionTitleClean, titleSize);
        
        // Draw section title in navy
        let titleResult = drawTextWithWrap(
          currentPage,
          `**${stripEmojis(cleanSectionName)}**`,
          margin,
          yPosition,
          pageWidth - 2 * margin,
          helveticaFont,
          helveticaBold,
          titleSize,
          20,
          'left' // Section headings should be left-aligned
        );
        
        // Draw gold underline after title
        currentPage.drawLine({
          start: { x: margin, y: titleResult.lastY + 6 },
          end: { x: margin + Math.min(sectionTitleWidth + 20, pageWidth - 2 * margin), y: titleResult.lastY + 6 },
          thickness: 1,
          color: GOLD_RGB,
        });
        
        if (titleResult.needsNewPage) {
          currentPage = await addContentPage();
          yPosition = pageHeight - topMargin - 20;
          
          // Re-draw accent bar on new page
          currentPage.drawRectangle({
            x: margin - 8,
            y: yPosition - 6,
            width: 3,
            height: 18,
            color: GOLD_RGB,
          });
          
          titleResult = drawTextWithWrap(
            currentPage,
            `**${stripEmojis(cleanSectionName)}**`,
            margin,
            yPosition,
            pageWidth - 2 * margin,
            helveticaFont,
            helveticaBold,
            titleSize,
            20,
            'left'
          );
          
          // Draw gold underline on new page
          currentPage.drawLine({
            start: { x: margin, y: titleResult.lastY + 6 },
            end: { x: margin + Math.min(sectionTitleWidth + 20, pageWidth - 2 * margin), y: titleResult.lastY + 6 },
            thickness: 1,
            color: GOLD_RGB,
          });
        }
        yPosition = titleResult.lastY - 10;

        // ─── KPI Boxes: Render gold-bordered metric cards for qualifying sections ───
        const kpiMetrics = kpiMetricsForBand;
        if (kpiMetrics) {
          // The band is drawn four to a row — `drawKPIBoxes` has always drawn
          // at most four and returns `startY - 88`. What changed is that the
          // financial set is no longer TRUNCATED to one row: the core facts the
          // record holds are carried over as many rows as they need.
          const financialRows: Array<Array<{ label: string; value: string; subtitle?: string }>> = [];
          for (let i = 0; i < kpiMetrics.row1.length; i += 4) {
            financialRows.push(kpiMetrics.row1.slice(i, i + 4));
          }
          const totalKPIHeight = financialRows.length * 88 + (kpiMetrics.row2 ? 90 : 0);
          if (yPosition - totalKPIHeight < bottomMargin + 40) {
            currentPage = await addContentPage();
            yPosition = pageHeight - topMargin - 20;
          }
          for (const financialRow of financialRows) {
            if (yPosition - 88 < bottomMargin + 40) {
              currentPage = await addContentPage();
              yPosition = pageHeight - topMargin - 20;
            }
            yPosition = drawKPIBoxes(currentPage, yPosition, financialRow, pageWidth - 2 * margin);
          }
          console.log(`     ✓ Rendered ${kpiMetrics.row1.length} financial KPI boxes for "${cleanSectionName}"`);
          
          // Row 2: Demographic KPIs
          if (kpiMetrics.row2) {
            if (yPosition - 80 < bottomMargin + 40) {
              currentPage = await addContentPage();
              yPosition = pageHeight - topMargin - 20;
            }
            // Draw a small "Demographics" label above row 2
            currentPage.drawText('DEMOGRAPHIC SNAPSHOT', {
              x: margin,
              y: yPosition - 5,
              size: 7,
              font: helveticaBold,
              color: GOLD_RGB,
            });
            yPosition -= 15;
            yPosition = drawKPIBoxes(currentPage, yPosition, kpiMetrics.row2, pageWidth - 2 * margin);
            console.log(`     ✓ Rendered ${kpiMetrics.row2.length} demographic KPI boxes for "${cleanSectionName}"`);
          }
        }

        // Draw paragraphs with header-table grouping
        for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
          const paragraph = paragraphs[pIdx];
          if (!paragraph.trim()) continue;
          
          // Check if this paragraph is a header that should stay with its table
          const paragraphLower = paragraph.toLowerCase().replace(/\*\*/g, '').trim();
          const isKeepWithTableHeader = KEEP_WITH_TABLE_HEADERS.some(header => 
            paragraphLower.includes(header)
          );
          
          // If this is a "keep with table" header, check if next paragraph is a table
          if (isKeepWithTableHeader && pIdx + 1 < paragraphs.length) {
            const nextParagraph = paragraphs[pIdx + 1];
            if (isMarkdownTable(nextParagraph)) {
              // Calculate combined height of header + table
              const headerHeight = calculateTextHeight(
                paragraph, pageWidth - 2 * margin, helveticaFont, helveticaBold, textSize, lineHeight
              ) + 16;
              const tableHeight = calculateTableHeight(
                nextParagraph, pageWidth - 2 * margin, helveticaFont, helveticaBold, textSize
              );
              const combinedHeight = headerHeight + tableHeight + 20;
              const availableSpace = yPosition - bottomMargin - PAGE_BREAK_CONFIG.TABLE_SAFETY_MARGIN;
              
              // If combined doesn't fit but WOULD fit on new page, move to new page
              if (combinedHeight > availableSpace && combinedHeight <= (pageHeight - topMargin - bottomMargin - 40)) {
                console.log(`     → Keeping header "${paragraphLower.substring(0, 30)}..." with its table (${Math.round(combinedHeight)}px)`);
                currentPage = await addContentPage();
                yPosition = pageHeight - topMargin - 20;
              }
            }
          }

          // Check for rank heading marker (___RANK_HEADING___) - used for comparison analysis rankings
          const isRankHeading = paragraph.includes('___RANK_HEADING___');
          if (isRankHeading) {
            // Remove the marker and get the actual heading text
            const rankText = paragraph.replace('___RANK_HEADING___', '').trim();
            
            // Force page break if we're below 200px from bottom (ensure rank + its content fits together)
            if (yPosition < bottomMargin + 200) {
              currentPage = await addContentPage();
              yPosition = pageHeight - topMargin - 20;
            }
            
            // Draw rank heading with larger font size (14pt vs 10pt for normal text)
            const rankHeadingSize = 13;
            const cleanRankText = stripEmojis(rankText.replace(/\*\*/g, ''));
            
            // Draw the text (bold)
            currentPage.drawText(cleanRankText, {
              x: margin,
              y: yPosition,
              size: rankHeadingSize,
              font: helveticaBold,
              color: NAVY_RGB,
            });
            
            // Calculate text width for underline
            const textWidth = helveticaBold.widthOfTextAtSize(cleanRankText, rankHeadingSize);
            
            // Draw underline below the text (gold)
            currentPage.drawLine({
              start: { x: margin, y: yPosition - 3 },
              end: { x: margin + textWidth, y: yPosition - 3 },
              thickness: 1,
              color: GOLD_RGB,
            });
            
            yPosition -= (rankHeadingSize + 12); // Space after rank heading
            continue;
          }

          // ─── Callout Panel: Detect "What This Means" paragraphs ───────────
          const calloutCheck = isCalloutParagraph(paragraph);
          if (calloutCheck.isCallout) {
            // Empty body: try to absorb the next paragraph as the body (model often emits the
            // label as its own paragraph then the prose after a blank line).
            if (!calloutCheck.content || calloutCheck.content.length < 15) {
              const next = paragraphs[pIdx + 1]?.trim() ?? '';
              const nextIsStructural =
                !next ||
                next.startsWith('#') ||
                next.startsWith('|') ||
                next.startsWith('- ') ||
                next.startsWith('* ') ||
                /^-{3,}$/.test(next) ||
                isCalloutParagraph(next).isCallout;
              if (next && !nextIsStructural && next.length >= 15) {
                calloutCheck.content = next.replace(/^\*+|\*+$/g, '').trim();
                pIdx += 1; // consume the absorbed paragraph
              } else {
                console.log('     ⏭ Skipping empty/junk "What This Means" callout');
                continue;
              }
            }
            console.log('     ✓ Detected callout paragraph, rendering styled panel');
            let calloutResult = drawCalloutPanel(
              currentPage,
              calloutCheck.content,
              yPosition,
              pageWidth - 2 * margin
            );
            if (calloutResult.needsNewPage) {
              currentPage = await addContentPage();
              yPosition = pageHeight - topMargin - 20;
              calloutResult = drawCalloutPanel(
                currentPage,
                calloutCheck.content,
                yPosition,
                pageWidth - 2 * margin
              );
            }
            yPosition = calloutResult.lastY;
            continue;
          }

          // Check for horizontal rule (---)
          if (paragraph.trim().match(/^-{3,}$/)) {
            // Check if we need a new page
            if (yPosition < bottomMargin + 60) {
              currentPage = await addContentPage();
              yPosition = pageHeight - topMargin - 20;
            }
            yPosition = drawHorizontalRule(currentPage, margin, yPosition - 10, pageWidth - 2 * margin);
            continue;
          }

          // Check if paragraph is a markdown table (but skip contact sections)
          if (isMarkdownTable(paragraph) && !cleanSectionName.toLowerCase().includes('contact')) {
            console.log('     ✓ Detected markdown table, rendering...');
            try {
              // SMART PAGE BREAKING FOR TABLES
              // Calculate the full table height BEFORE drawing
              const estimatedTableHeight = calculateTableHeight(
                paragraph,
                pageWidth - 2 * margin,
                helveticaFont,
                helveticaBold,
                textSize
              );
              
              const availableSpace = yPosition - bottomMargin - PAGE_BREAK_CONFIG.TABLE_SAFETY_MARGIN;
              const canFitOnCurrentPage = estimatedTableHeight <= availableSpace;
              const canFitOnNewPage = estimatedTableHeight <= (pageHeight - topMargin - bottomMargin - 40);
              
              console.log(`     📊 Table height analysis:`, {
                estimatedHeight: Math.round(estimatedTableHeight),
                availableSpace: Math.round(availableSpace),
                canFitOnCurrentPage,
                canFitOnNewPage,
                preferFullTables: PAGE_BREAK_CONFIG.PREFER_FULL_TABLES
              });
              
              // If PREFER_FULL_TABLES is true and table won't fit on current page but will fit on new page
              // Move the ENTIRE table to a new page rather than splitting
              if (PAGE_BREAK_CONFIG.PREFER_FULL_TABLES && !canFitOnCurrentPage && canFitOnNewPage) {
                console.log('     → Moving entire table to new page (smart page break)');
                currentPage = await addContentPage();
                yPosition = pageHeight - topMargin - 20;
              } else if (yPosition < bottomMargin + PAGE_BREAK_CONFIG.MIN_SPACE_FOR_TABLE) {
                // Minimal space check - always start new page if less than minimum threshold
                currentPage = await addContentPage();
                yPosition = pageHeight - topMargin - 20;
              }

              // Render tables across pages if needed.
              let tableToRender = paragraph;
              let guard = 0;
              while (guard < 20) {
                guard++;
                const tableResult = drawTable(
                  currentPage,
                  tableToRender,
                  margin,
                  yPosition,
                  pageWidth - 2 * margin,
                  helveticaFont,
                  helveticaBold,
                  textSize
                );

                if (tableResult.needsNewPage) {
                  currentPage = await addContentPage();
                  yPosition = pageHeight - topMargin - 20;
                  if (tableResult.remainingTableText && tableResult.remainingTableText.trim().length > 0) {
                    tableToRender = tableResult.remainingTableText;
                    continue;
                  }
                  // Safety: if we can't compute remaining content, stop to avoid infinite loops.
                  break;
                }

                yPosition = tableResult.lastY;
                break;
              }
              console.log('     ✓ Table rendered successfully with smart page breaking');
            } catch (tableError) {
              console.error('     ❌ Error rendering table:', tableError);
              console.error('     Table content:', paragraph.substring(0, 200));
              throw tableError;
            }
            continue;
          }

          // Regular paragraph with text wrapping
          let remainingParts = parseMarkdownText(paragraph);
          
          // Detect if this paragraph is an H3/H4 subsection heading
          const isSubsectionHeading = paragraph.trim().match(/^#{3,4}\s+/);
          const paragraphAlignment: 'left' | 'justify' = isSubsectionHeading ? 'left' : 'justify';
          
          // A paragraph that keeps asking for pages is a defect, not a long
          // paragraph: the table loop below guards its pages, and this loop
          // did not — which is how one line spilled across seven pages.
          let paragraphPages = 0;
          while (remainingParts.length > 0) {
            // Check if we need a new page before starting paragraph
            if (yPosition < bottomMargin + 60) {
              paragraphPages += 1;
              if (paragraphPages > 6) {
                console.warn('[investmentPdfDocument] paragraph abandoned after six pages');
                break;
              }
              currentPage = await addContentPage();
              yPosition = pageHeight - topMargin - 20;
            }

            const paragraphText = remainingParts.map(p => {
              if (p.bold && p.italic) return `***${p.text}***`;
              if (p.bold) return `**${p.text}**`;
              if (p.italic) return `*${p.text}*`;
              return p.text;
            }).join('');

            const result = drawTextWithWrap(
              currentPage,
              paragraphText,
              margin,
              yPosition,
              pageWidth - 2 * margin,
              helveticaFont,
              helveticaBold,
              textSize,
              lineHeight,
              paragraphAlignment // Left-align H3/H4 headings, justify body text
            );

            if (result.needsNewPage) {
              currentPage = await addContentPage();
              yPosition = pageHeight - topMargin - 20;
              remainingParts = result.remainingParts;
            } else {
              yPosition = result.lastY;
              remainingParts = [];
            }
          }

          yPosition -= 6; // Tighter spacing between paragraphs
        }

        yPosition -= 10; // Reduced spacing between sections
      }

      // ========== FIGURES ==========
      /*
       * Charts, sparklines and placed imagery — the three PRESENTATION
       * controls, drawn here because they are drawn from what the document has
       * already said. Every series is read from the stored record, nothing is
       * recomputed, and a series the record does not carry draws nothing.
       *
       * They sit after the sections deliberately: a figure is a second reading
       * of a figure already stated, so it follows the statement rather than
       * interrupting it, and turning them all off removes pages without
       * removing a single fact.
       */
      const figurePalette: FigurePalette = {
        ink: NAVY_RGB,
        muted: FOOTER_TEXT_RGB,
        accent: GOLD_RGB,
        rule: TABLE_BORDER,
        positive: rgb(46 / 255, 125 / 255, 50 / 255),
        negative: rgb(178 / 255, 34 / 255, 34 / 255),
      };
      const figureFonts = { regular: helveticaFont, bold: helveticaBold };
      // `enhanced_data` is where `projectRowForPdf` puts the healed financials
      // and the stored score — the same objects every figure in the prose above
      // was drawn from, so a chart cannot disagree with the table beside it.
      const projectionSeries = readProjectionSeries(report.enhanced_data?.financialData);
      const scoreComponents = readScoreComponents(report.enhanced_data?.investmentScore);

      const wantsCharts = presentation.includeCharts
        && ((projectionSeries?.length ?? 0) >= 2 || scoreComponents.length > 0);
      const wantsSparklines = presentation.includeSparklines && (projectionSeries?.length ?? 0) >= 2;
      const wantsHeroes = presentation.includeHeroImages && heroImages.length > 0;

      if (wantsCharts || wantsSparklines || wantsHeroes) {
        currentPage = await addContentPage();
        yPosition = pageHeight - topMargin - 20;

        const headingText = 'AT A GLANCE';
        currentPage.drawText(headingText, {
          x: margin, y: yPosition, size: 12, font: helveticaBold, color: NAVY_RGB,
        });
        yPosition -= 6;
        currentPage.drawLine({
          start: { x: margin, y: yPosition },
          end: { x: pageWidth - margin, y: yPosition },
          thickness: 1, color: GOLD_RGB,
        });
        yPosition -= 16;

        const contentWidth = pageWidth - 2 * margin;

        if (presentation.includeCharts && projectionSeries) {
          const chartHeight = 150;
          if (yPosition - chartHeight < bottomMargin) {
            currentPage = await addContentPage();
            yPosition = pageHeight - topMargin - 20;
          }
          if (drawProjectionLineChart(
            currentPage, projectionSeries, 'propertyValue',
            'Projected property value (moderate scenario)',
            { x: margin, y: yPosition - chartHeight, width: contentWidth, height: chartHeight },
            figureFonts, figurePalette,
          )) {
            yPosition -= chartHeight + 18;
          }

          if (yPosition - chartHeight < bottomMargin) {
            currentPage = await addContentPage();
            yPosition = pageHeight - topMargin - 20;
          }
          if (drawProjectionLineChart(
            currentPage, projectionSeries, 'cumulativeCashFlow',
            'Cumulative cash flow (moderate scenario)',
            { x: margin, y: yPosition - chartHeight, width: contentWidth, height: chartHeight },
            figureFonts, figurePalette,
          )) {
            yPosition -= chartHeight + 18;
          }
        }

        if (presentation.includeCharts && scoreComponents.length) {
          const barsHeight = 24 + scoreComponents.slice(0, 8).length * 14;
          if (yPosition - barsHeight < bottomMargin) {
            currentPage = await addContentPage();
            yPosition = pageHeight - topMargin - 20;
          }
          if (drawScoreBars(
            currentPage, scoreComponents, 'Scored dimensions',
            { x: margin, y: yPosition - barsHeight, width: contentWidth, height: barsHeight },
            figureFonts, figurePalette,
          )) {
            yPosition -= barsHeight + 18;
          }
        }

        /*
         * The sparkline strip: three series, each beside the words for what it
         * is. No axis and no scale — a sparkline says "rising" or "falling"
         * next to a figure the document has already printed, and the moment it
         * needs a label it wants to be a chart instead.
         */
        if (wantsSparklines && projectionSeries) {
          // An owner-occupier's copy draws no rent series: the rent is a
          // letting's, and the audience withholds it wherever it is drawn.
          const strip: Array<[string, 'propertyValue' | 'annualRent' | 'loanBalance']> = [
            ['Value', 'propertyValue'],
            ...(audiencePolicyFor(presentation.audience).lettingFigures
              ? [['Rent', 'annualRent'] as [string, 'annualRent']]
              : []),
            ['Loan balance', 'loanBalance'],
          ];
          const rowHeight = 16;
          const stripHeight = 14 + strip.length * rowHeight;
          if (yPosition - stripHeight < bottomMargin) {
            currentPage = await addContentPage();
            yPosition = pageHeight - topMargin - 20;
          }
          currentPage.drawText('Ten-year shape', {
            x: margin, y: yPosition - 9, size: 9, font: helveticaBold, color: NAVY_RGB,
          });
          let sparkY = yPosition - 22;
          for (const [label, field] of strip) {
            const values = sparklineSeries(projectionSeries, field);
            if (values.length < 2) continue;
            currentPage.drawText(label, {
              x: margin, y: sparkY, size: 7, font: helveticaFont, color: BODY_TEXT_RGB,
            });
            drawSparkline(
              currentPage, values,
              { x: margin + 76, y: sparkY - 1, width: 120, height: 9 },
              figurePalette,
            );
            sparkY -= rowHeight;
          }
          yPosition = sparkY - 8;
        }

        /*
         * Imagery a person placed against this report, drawn at the width of
         * the text block and never scaled up past its own pixels. Nothing is
         * generated here: a report has hero imagery only when somebody has
         * already put some there, and a report with none simply has one fewer
         * thing on this page.
         */
        if (wantsHeroes) {
          for (const hero of heroImages.slice(0, 6)) {
            let embedded;
            try {
              embedded = hero.format === 'png'
                ? await pdfDoc.embedPng(hero.bytes)
                : await pdfDoc.embedJpg(hero.bytes);
            } catch (err) {
              console.warn('[investmentPdfDocument] hero image could not be embedded', err);
              continue;
            }
            const scale = Math.min(contentWidth / embedded.width, 1);
            const drawWidth = embedded.width * scale;
            const drawHeight = embedded.height * scale;
            if (yPosition - drawHeight - 20 < bottomMargin) {
              currentPage = await addContentPage();
              yPosition = pageHeight - topMargin - 20;
            }
            if (hero.sectionKey) {
              currentPage.drawText(hero.sectionKey.slice(0, 80), {
                x: margin, y: yPosition - 8, size: 7.5,
                font: helveticaBold, color: FOOTER_TEXT_RGB,
              });
              yPosition -= 14;
            }
            currentPage.drawImage(embedded, {
              x: margin, y: yPosition - drawHeight, width: drawWidth, height: drawHeight,
            });
            yPosition -= drawHeight + 16;
          }
        }
      }

      // ========== SECOND PASS: DRAW TABLE OF CONTENTS WITH ACTUAL PAGE NUMBERS ==========
      // Only draw TOC for compass tier
      if (shouldIncludeTOC && tocPageIndices.length > 0) {
        console.log('📑 Step 5.4: Drawing Table of Contents with actual page numbers...');
        console.log(`   Section page mappings:`, Object.fromEntries(sectionPageNumbers));
        
        // Draw TOC on the reserved pages
        let tocPageIdx = 0;
        let tocPage = pdfDoc.getPages()[tocPageIndices[tocPageIdx]];
        let tocY = pageHeight - topMargin - 20;
        
        // TOC Title - Navy with gold accent
        const tocTitleText = 'TABLE OF CONTENTS';
        tocPage.drawText(tocTitleText, {
          x: margin,
          y: tocY,
          size: 20,
          font: helveticaBold,
          color: NAVY_RGB,
        });
        tocY -= 40;
        
        // Draw gold decorative line under title
        tocPage.drawLine({
          start: { x: margin, y: tocY + 15 },
          end: { x: pageWidth - margin, y: tocY + 15 },
          thickness: 2,
          color: GOLD_RGB,
        });
        tocY -= 25;
        
        // Draw TOC entries with hierarchical numbering
        // Pure sequential counters - no metadata lookup needed
        let h2Index = 0;
        let h3Index = 0;
        
        for (const sectionName of allSectionNames) {
          // sectionName is already cleaned (no ## or ### prefix) - it's the key from sections object
          const cleanName = dedupeRepeatedWords(stripEmojis(
            sectionName
              .replace(/^#{1,6}\s*/, '') // Remove markdown heading prefix (if any remaining)
              .replace(/^\d+(\.\d+)*\.?\s+/, '') // Remove all numbered prefixes (e.g., "1 ", "1. ", "11.1 ")
              .replace(/:\s*$/, '') // Remove trailing colon
              .trim()
          ));


          if (!cleanName || cleanName.length < 3) continue;
          // A section that painted nothing has no page to point at.
          if (!paintedSections.has(sectionName)) continue;

          // Use the sectionMetadata populated during parsing to get the correct level
          // The sectionName IS the key used in sectionMetadata (both come from sections object)
          const metadata = sectionMetadata.current.get(sectionName);
          const sectionLevel = metadata?.level ?? 2; // Default to H2 if not found
          
          // Update numbering based on hierarchy - pure sequential counters
          let sectionNumText: string;
          let indentation: number;
          let fontSize: number;
          let fontToUse: typeof helveticaFont;
          
          if (sectionLevel === 2) {
            // H2 = Main section
            h2Index++;
            h3Index = 0; // Reset subsection counter for new H2
            sectionNumText = `${h2Index}.`;
            indentation = 0;
            fontSize = 11;
            fontToUse = helveticaBold;
          } else {
            // H3 = Subsection - simple sequential increment
            h3Index++;
            sectionNumText = `${h2Index}.${h3Index}`;
            indentation = 15; // Indent subsections
            fontSize = 10;
            fontToUse = helveticaFont;
          }
          
          // Check if we need to move to next TOC page
          if (tocY < bottomMargin + 40) {
            tocPageIdx++;
            if (tocPageIdx < tocPageIndices.length) {
              tocPage = pdfDoc.getPages()[tocPageIndices[tocPageIdx]];
              tocY = pageHeight - topMargin - 20;
            }
          }
          
          // Get the actual page number for this section
          const actualPageNumber = sectionPageNumbers.get(cleanName) || 0;
          
          // Draw section number with gold accent
          tocPage.drawText(sectionNumText, {
            x: margin + indentation,
            y: tocY,
            size: fontSize,
            font: fontToUse,
            color: GOLD_RGB,
          });
          
          // Calculate number text width for positioning
          const numWidth = fontToUse.widthOfTextAtSize(sectionNumText, fontSize);
          
          // Draw section name (truncate if too long)
          const pageNumWidth = 30; // Reserve space for page number
          const textStartX = margin + indentation + numWidth + 8;
          const maxTocWidth = pageWidth - margin - pageNumWidth - textStartX - 10;
          const displayName = truncateAtWordBoundary(cleanName, maxTocWidth, helveticaFont, fontSize);
          
          tocPage.drawText(displayName, {
            x: textStartX,
            y: tocY,
            size: fontSize,
            font: sectionLevel === 2 ? helveticaFont : helveticaFont,
            color: sectionLevel === 2 ? NAVY_RGB : BODY_TEXT_RGB,
          });
          
          // Draw dotted leader line (gold dots)
          const nameWidth = helveticaFont.widthOfTextAtSize(displayName, fontSize);
          const startX = textStartX + nameWidth + 5;
          const endX = pageWidth - margin - pageNumWidth - 5;
          const dotSpacing = 6;
          
          for (let dx = startX; dx < endX; dx += dotSpacing) {
            tocPage.drawCircle({
              x: dx,
              y: tocY + 3,
              size: 0.5,
              color: GOLD_RGB,
            });
          }
          
          // Draw page number (right-aligned, navy)
          const pageNumText = String(actualPageNumber);
          const pageNumTextWidth = helveticaBold.widthOfTextAtSize(pageNumText, fontSize);
          tocPage.drawText(pageNumText, {
            x: pageWidth - margin - pageNumTextWidth,
            y: tocY,
            size: fontSize,
            font: helveticaBold,
            color: NAVY_RGB,
          });
          
          // Adjust vertical spacing based on section level
          tocY -= sectionLevel === 2 ? 24 : 18;
        }
        
        console.log(`✓ Table of Contents drawn with ${h2Index} main sections and page numbers`);
      } else {
        console.log(`📑 Step 5.4: Skipping TOC rendering (${reportTier} tier)`);
      }

      // Add contact/disclaimer page with global settings (replaces static template last page)
      console.log('📞 Step 5.5: Adding contact/disclaimer page with global settings...');
      await addContactDisclaimerPage(globalSettings);

      // Add page numbers to all pages except first and last
      console.log('🔢 Step 5.6: Adding page numbers...');
      const allPages = pdfDoc.getPages();
      const totalPages = allPages.length;
      console.log(`✓ Total pages in document: ${totalPages}`);
      
      // Add page numbers starting from page 2 (index 1), excluding last page
      for (let i = 1; i < totalPages - 1; i++) {
        const page = allPages[i];
        const pageNumber = i + 1; // Display page number (2, 3, 4, ...)
        
        // Draw gold accent line above footer
        page.drawLine({
          start: { x: margin, y: 52 },
          end: { x: pageWidth - margin, y: 52 },
          thickness: 0.5,
          color: GOLD_RGB,
        });
        
        // Draw branded footer text (left)
        page.drawText('Investment Report  |  Confidential', {
          x: margin,
          y: 40,
          size: 7,
          font: helveticaFont,
          color: FOOTER_TEXT_RGB,
        });
        
        // Draw page number (right-aligned)
        const pageNumStr = `Page ${pageNumber}`;
        const pageNumWidth = helveticaFont.widthOfTextAtSize(pageNumStr, 7);
        page.drawText(pageNumStr, {
          x: pageWidth - margin - pageNumWidth,
          y: 40,
          size: 7,
          font: helveticaFont,
          color: FOOTER_TEXT_RGB,
        });
        
        console.log(`  ✓ Added styled footer with page ${pageNumber} to page index ${i}`);
      }
      console.log(`✓ Page numbering complete (pages 2-${totalPages - 1})`);

      // Set clean PDF metadata (overrides any stray template metadata)
      try {
        const cleanSuburb = String(suburb || '').trim();
        const cleanState = String(state || '').trim();
        const locationLabel = [cleanSuburb, cleanState].filter(Boolean).join(', ');
        const documentTitle = documentTitleForTier(reportTier);
        const pdfTitle = locationLabel
          ? `${documentTitle} — ${locationLabel}`
          : documentTitle;
        pdfDoc.setTitle(pdfTitle);
        pdfDoc.setAuthor('NPC Services');
        pdfDoc.setSubject(`${documentTitle} — ${String(report.address || '').trim()}`);
        pdfDoc.setCreator('NPC Command Centre');
        pdfDoc.setProducer('NPC Command Centre');
        pdfDoc.setCreationDate(new Date());
        pdfDoc.setModificationDate(new Date());
      } catch (metaErr) {
        console.warn('⚠️ Failed to set PDF metadata:', metaErr);
      }

      // Save the PDF
      console.log('💾 Step 6: Saving PDF document...');
      const pdfBytes = await pdfDoc.save();
      console.log('✓ PDF saved, size:', pdfBytes.length, 'bytes');
      
      const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
      console.log('✓ Blob created');
      
      // Named by what it is, whose it is and when — see `reportFileName.pure.ts`.
      const fileName = investmentReportFileName({ tier: reportTier, address: report.address, at: new Date() });
      return { blob, fileName, suburb, state };
  };

  return { ...(await generateCore()), renderer: BROWSER_PDF_RENDERER };
}
