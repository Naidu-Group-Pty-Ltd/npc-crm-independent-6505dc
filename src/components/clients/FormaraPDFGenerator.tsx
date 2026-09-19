import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, FileText, Home, Loader2, Mail, Send, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { logReportRenderEvent } from '@/lib/reports/renderEvent';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { secureStorageUpload } from '@/hooks/useSecureStorage';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { drawBorrowingCapacitySections, transformAssessmentToSectionData } from '@/utils/borrowingCapacityPdfSections';
import { fetchLatestBorrowingCapacity } from '@/lib/fetchLatestBorrowingCapacity';
import { fetchGlobalReportSettings, type ContactDetails, type ProfessionalDisclaimer } from '@/hooks/useGlobalReportSettings';
import { getBrandPdfPalette } from '@/branding/brandPalette';
import { useBrand } from '@/branding/BrandProvider';
import { smartCapitalize } from '@/lib/nameUtils';
import { escapeHtml } from '@/utils/escapeHtml';
import { sanitizePdfHtml } from '@/utils/sanitizePdfHtml';
import {
  buildHouseholdIncome,
  buildPropertyExpenditure,
  buildLiabilityServicing,
} from '@/utils/householdFinance';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { FinanceRecipientPicker } from '@/components/clients/FinanceRecipientPicker';
import type { FinanceReportRecipient } from '@/hooks/useFinanceReportRecipients';

interface ClientData {
  id: string;
  primary_first_name: string;
  primary_middle_name?: string | null;
  primary_surname: string;
  primary_mobile?: string | null;
  primary_email?: string | null;
  primary_gender?: string | null;
  primary_dob?: string | null;
  secondary_first_name?: string | null;
  secondary_middle_name?: string | null;
  secondary_surname?: string | null;
  secondary_mobile?: string | null;
  secondary_email?: string | null;
  secondary_gender?: string | null;
  secondary_dob?: string | null;
  current_address?: string | null;
  current_suburb?: string | null;
  current_state?: string | null;
  current_postcode?: string | null;
  country?: string | null;
  living_situation?: string | null;
  residential_status?: string | null;
  marital_status?: string | null;
  dependents_count?: number | null;
  secondary_same_address_as_primary?: boolean | null;
  secondary_current_address?: string | null;
  secondary_current_suburb?: string | null;
  secondary_current_state?: string | null;
  secondary_current_postcode?: string | null;
  secondary_country?: string | null;
  secondary_living_situation?: string | null;
  secondary_residential_status?: string | null;
  total_portfolio_value?: number | null;
  total_debt?: number | null;
  total_monthly_expenditure?: number | null;
  total_monthly_income?: number | null;
  total_monthly_rental_income?: number | null;
  net_monthly_cash_flow?: number | null;
}

// Format an AU address with safe fallback. Returns '-' when nothing usable.
const formatAUAddress = (
  street: string | null | undefined,
  suburb: string | null | undefined,
  state: string | null | undefined,
  postcode: string | null | undefined,
): string => {
  const parts: string[] = [];
  if (street) parts.push(String(street).trim());
  const locality = [suburb?.trim(), state?.trim()?.toUpperCase(), postcode?.trim()]
    .filter(Boolean)
    .join(' ');
  if (locality) parts.push(locality);
  const joined = parts.filter(Boolean).join(', ');
  return joined || '-';
};

// Normalize common provider/lender brand names so the PDF doesn't show typos
// like "Common Wealth Bank" or inconsistent casing across cards.
// Each entry: [matcher, canonical]. Matchers consume the ENTIRE brand phrase
// (incl. optional "Bank/Banking Corporation" suffix) so we never double-append.
const PROVIDER_NORMALIZATION: Array<[RegExp, string]> = [
  [/\b(?:cba|common\s*wealth(?:\s*bank(?:ing)?(?:\s*corp(?:oration)?)?)?|commonwealth(?:\s*bank(?:ing)?(?:\s*corp(?:oration)?)?)?)\b/i, 'Commonwealth Bank'],
  [/\bwest\s*pac(?:\s*banking(?:\s*corp(?:oration)?)?)?\b/i, 'Westpac'],
  [/\b(?:nab|national\s*australia\s*bank)\b/i, 'NAB'],
  [/\banz(?:\s*bank)?\b/i, 'ANZ'],
  [/\bing(?:\s*direct)?\b/i, 'ING'],
  [/\bmacquarie(?:\s*bank)?\b/i, 'Macquarie Bank'],
  [/\bafterpay\b/i, 'Afterpay'],
  [/\bzip(?:\s*pay|\s*money)?\b/i, 'Zip'],
  [/\bhumm\b/i, 'Humm'],
  [/\blatitude(?:\s*financial)?\b/i, 'Latitude'],
];
const normalizeProvider = (raw: string | null | undefined): string => {
  if (!raw) return '-';
  let v = String(raw).trim().replace(/\s+/g, ' ');
  if (!v) return '-';
  for (const [pattern, replacement] of PROVIDER_NORMALIZATION) {
    if (pattern.test(v)) { v = v.replace(pattern, replacement); break; }
  }
  return v;
};

interface PropertyData {
  property_type: string;
  address: string;
  value?: number | null;
  loan_remaining?: number | null;
  interest_rate?: number | null;
  ownership_percentage?: number | null;
  monthly_interest_repayment?: number | null;
  monthly_body_corporate?: number | null;
  monthly_council_rates?: number | null;
  monthly_water_rates?: number | null;
  monthly_repairs_maintenance?: number | null;
  monthly_property_management?: number | null;
  monthly_landlord_insurance?: number | null;
  monthly_building_insurance?: number | null;
  monthly_rental_income?: number | null;
  weekly_rental_income?: number | null;
  total_monthly_expenditure?: number | null;
  net_monthly_cashflow?: number | null;
  // Loan repayment & lender fields
  loan_repayment_amount?: number | null;
  loan_repayment_frequency?: string | null;
  lender_name?: string | null;
  repayment_type?: string | null;
  purchase_price?: number | null;
  // SMSF-specific fields
  smsf_fund_name?: string | null;
  smsf_trustee_name?: string | null;
  smsf_trustee_type?: string | null;
  smsf_abn?: string | null;
  smsf_compliance_status?: string | null;
  smsf_auditor_name?: string | null;
}

interface EmploymentData {
  contact_type: string;
  employer_name?: string | null;
  employment_type?: string | null;
  occupation_role?: string | null;
  start_date?: string | null;
  is_current?: boolean | null;
  salary_amount?: number | null;
  salary_frequency?: string | null;
  gross_annual_salary?: number | null;
  bonus?: number | null;
  allowance?: number | null;
  commission?: number | null;
  overtime_essential?: number | null;
  overtime_non_essential?: number | null;
  other_taxable_income?: number | null;
}

interface IncomeData {
  contact_type: string;
  gross_salary?: number | null;
  salary_frequency?: string | null;
  bonus?: number | null;
  allowance?: number | null;
  commission?: number | null;
  overtime_essential?: number | null;
  overtime_non_essential?: number | null;
  other_taxable_income?: number | null;
}

interface AssetData {
  asset_type: string;
  vehicle_type?: string | null;
  make_model?: string | null;
  institution_name?: string | null;
  description?: string | null;
  value?: number | null;
}

interface LiabilityData {
  liability_type: string;
  provider_name?: string | null;
  current_balance?: number | null;
  credit_limit?: number | null;
  interest_rate?: number | null;
  monthly_repayment?: number | null;
  repayment_type?: string | null;
}

interface IncomeSourceData {
  contact_type?: string | null;
  source_category?: string | null;
  source_type?: string | null;
  source_name?: string | null;
  gross_annual_amount?: number | null;
  input_amount?: number | null;
  input_frequency?: string | null;
  is_active?: boolean | null;
}

export interface FormaraPDFData {
  client: ClientData;
  properties: PropertyData[];
  employment?: EmploymentData[];
  income?: IncomeData[];
  incomeSources?: IncomeSourceData[];
  assets?: AssetData[];
  liabilities?: LiabilityData[];
  expenses?: ExpenseData[];
}

interface ExpenseData {
  id?: string;
  expense_category?: string;
  expense_name?: string;
  monthly_amount?: number;
  frequency?: string;
  is_essential?: boolean;
}

interface FormaraPDFGeneratorProps {
  data: FormaraPDFData;
  clientName: string;
  /**
   * Hand the produced PDF to a compose window.
   *
   * Audit item 12 — this menu item lives under "Send to Finance", and the
   * compose window it opened was addressed to the CLIENT: their email in To,
   * "Dear <client>" in the body, "Please find attached your updated portfolio
   * documentation". Nothing carried who the mail was for, so the dialog fell
   * back to the only party it knew about.
   *
   * The chosen finance partner travels with the document now. A caller that
   * passes no recipient (the client-details download button) keeps the client
   * defaults it has always had.
   */
  onEmailClick?: (pdfBlob: Blob, fileName: string, recipient?: FinanceReportRecipient) => void;
  onQuickSendComplete?: () => void;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  buttonLabel?: string;
  action?: 'finance' | 'download';
}

// Helper functions
const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  // Always render negatives as -$X,XXX (never $-X,XXX)
  if (value < 0) {
    return '-$' + Math.abs(value).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return '$' + value.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const NOT_RECORDED = '<span style="color:#9ca3af;font-style:italic;">Not recorded</span>';
const textOrNotRecorded = (v: string | null | undefined): string => (v && String(v).trim() ? String(v) : NOT_RECORDED);
const currencyOrNotRecorded = (v: number | null | undefined): string => (v === null || v === undefined ? NOT_RECORDED : formatCurrency(v));

const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '-';
  // Format interest rates properly (e.g., 5.9 -> 5.9%, not 250%)
  return value.toFixed(1) + '%';
};

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('en-AU');
  } catch {
    return dateStr;
  }
};

// Helper to properly capitalize names
const properCase = (str: string | null | undefined): string => {
  if (!str) return '';
  return str.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
};

// Friendly labels for enum-style values stored as snake_case in the DB.
// Falls back to a Title Case version of the raw value so new enums never
// leak unmapped strings into the client-facing PDF.
const ENUM_LABEL_OVERRIDES: Record<string, string> = {
  // Living situation
  home_with_mortgage: 'Home with Mortgage',
  home_owned_outright: 'Home Owned Outright',
  renting: 'Renting',
  living_with_parents: 'Living with Parents',
  boarding: 'Boarding',
  other: 'Other',
  // Residential status
  citizen: 'Australian Citizen',
  permanent_resident: 'Permanent Resident',
  temporary_resident: 'Temporary Resident',
  visa_holder: 'Visa Holder',
  // Marital status
  single: 'Single',
  married: 'Married',
  de_facto: 'De Facto',
  defacto: 'De Facto',
  divorced: 'Divorced',
  separated: 'Separated',
  widowed: 'Widowed',
  // Gender
  male: 'Male',
  female: 'Female',
  non_binary: 'Non-binary',
  prefer_not_to_say: 'Prefer not to say',
  // Repayment type
  interest_only: 'Interest Only',
  principal_and_interest: 'Principal & Interest',
  pi: 'Principal & Interest',
  p_and_i: 'Principal & Interest',
  // Frequency
  annual: 'Annual',
  annually: 'Annual',
  monthly: 'Monthly',
  fortnightly: 'Fortnightly',
  weekly: 'Weekly',
  quarterly: 'Quarterly',
};

const humanizeEnum = (raw: string | null | undefined): string => {
  if (raw === null || raw === undefined) return '-';
  const v = String(raw).trim();
  if (!v) return '-';
  const key = v.toLowerCase().replace(/[\s-]+/g, '_');
  if (ENUM_LABEL_OVERRIDES[key]) return ENUM_LABEL_OVERRIDES[key];
  return key
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const enumOrNotRecorded = (raw: string | null | undefined): string => {
  if (!raw || !String(raw).trim() || String(raw).trim() === '-') return NOT_RECORDED;
  return humanizeEnum(raw);
};

// ISO-2 / common country codes → display name. Falls back to humanizeEnum.
const COUNTRY_LABEL_OVERRIDES: Record<string, string> = {
  au: 'Australia',
  aus: 'Australia',
  australia: 'Australia',
  nz: 'New Zealand',
  nzl: 'New Zealand',
  uk: 'United Kingdom',
  gb: 'United Kingdom',
  gbr: 'United Kingdom',
  us: 'United States',
  usa: 'United States',
  in: 'India',
  ind: 'India',
};

const formatCountry = (raw: string | null | undefined, fallback: string = 'Australia'): string => {
  if (!raw || !String(raw).trim()) return fallback;
  const k = String(raw).trim().toLowerCase();
  if (COUNTRY_LABEL_OVERRIDES[k]) return COUNTRY_LABEL_OVERRIDES[k];
  return humanizeEnum(raw);
};

export function FormaraPDFGenerator({ 
  data, 
  clientName,
  onEmailClick,
  onQuickSendComplete,
  variant = 'outline',
  size = 'sm',
  buttonLabel = 'Send to Finance',
  action = 'finance'
}: FormaraPDFGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const actionLock = useRef(false);
  const [isSending, setIsSending] = useState(false);
  const [includeOwnerOccupied, setIncludeOwnerOccupied] = useState(true);
  const [includeBorrowingCapacity, setIncludeBorrowingCapacity] = useState(false);
  const [financePickerOpen, setFinancePickerOpen] = useState(false);
  // Which act the picker was opened for. Both go through the same dialog
  // because both answer the same question — who at the finance partner — and
  // two pickers is how two answers drift.
  const [pickerIntent, setPickerIntent] = useState<'quick_send' | 'compose'>('quick_send');
  const { settings: brand } = useBrand();

  // Persist Formara PDF to storage + client_files in background
  const persistFormaraPdf = async (blob: Blob, fileName: string, clientIdVal: string) => {
    try {
      const storagePath = `formara-forms/${clientIdVal}/${fileName}`;
      const file = new File([blob], fileName, { type: 'application/pdf' });
      const uploadResult = await secureStorageUpload('client-files', storagePath, file, {
        contentType: 'application/pdf',
        upsert: true,
        resourceId: clientIdVal,
      });

      if (uploadResult?.success) {
        const persistedPath = uploadResult.path || storagePath;
        await invokeSecureFunction('manage-client-data', {
          operation: 'create',
          table: 'client_files',
          clientId: clientIdVal,
          data: {
            category: 'formara',
            file_name: fileName,
            file_path: persistedPath,
            file_type: 'application/pdf',
            file_size: blob.size,
            is_formara_form: true,
            description: `Client Details Form - ${new Date().toLocaleDateString('en-AU')}`,
          },
        });
        console.log('✓ Formara PDF persisted to storage + client_files');
      } else {
        console.error('Formara PDF upload failed:', uploadResult?.error);
      }
    } catch (err) {
      console.error('Failed to persist Formara PDF:', err);
      // Non-blocking — the user already has their download
    }
  };

  // Helper: preload an image and convert to data URL for html2canvas compatibility
  // Adds timeout + content-type validation to avoid indefinite hangs.
  const preloadImageAsDataUrl = async (src: string, timeoutMs = 5000): Promise<string | null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(src, { signal: controller.signal });
      if (!response.ok) return null;

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('image/')) return null;

      const blob = await response.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Helper: html2canvas with a timeout to prevent infinite hangs
  const html2canvasWithTimeout = (
    element: HTMLElement,
    options: Parameters<typeof html2canvas>[1],
    timeoutMs = 15000
  ): Promise<HTMLCanvasElement> => {
    return Promise.race([
      html2canvas(element, options),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('html2canvas timed out')), timeoutMs)
      ),
    ]);
  };

  const generatePDF = async (forEmail: boolean = false): Promise<Blob | null> => {
    if (!data.client?.id) {
      toast.error('Client details are not available yet. Please try again.');
      return null;
    }
    if (actionLock.current) return null;
    actionLock.current = true;
    setIsGenerating(true);
    applyBrandGold(brand.brandColor);
    let iframe: HTMLIFrameElement | null = null;

    try {
      const generationDeadline = Date.now() + 120000; // 2-min hard cap
      const ensureWithinBudget = () => {
        if (Date.now() > generationDeadline) {
          throw new Error('PDF generation timed out');
        }
      };

      // Pre-load cover image as data URL to avoid cross-origin / hanging issues
      const coverDataUrl = await preloadImageAsDataUrl('/templates/npc-formara-cover.jpg', 5000);

      // ── Render inside an isolated iframe to avoid dashboard DOM interference ──
      // The main page has 1000+ DOM nodes (charts, listings, modals) that cause
      // html2canvas to crawl or crash. An iframe gives a clean, lightweight document.
      iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:210mm;height:1123px;border:none;visibility:hidden;';
      document.body.appendChild(iframe);

      // Wait for iframe to be ready
      await new Promise<void>((resolve) => {
        iframe!.onload = () => resolve();
        // Some browsers fire onload immediately for about:blank
        if (iframe!.contentDocument?.readyState === 'complete') resolve();
      });

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) throw new Error('Could not access iframe document');

      // Fetch white-label brand settings for the contact/disclaimer page
      const __brandSettings = await fetchGlobalReportSettings();
      // Generate HTML content (with dynamic brand)
      const htmlContent = sanitizePdfHtml(
        generateHTMLContent(data, includeOwnerOccupied, __brandSettings?.contactDetails, __brandSettings?.disclaimer),
      );

      // Parse only sanitized HTML in this same-origin document. html2canvas needs
      // DOM access, so an opaque-origin iframe sandbox cannot be used here.
      iframeDoc.open();
      iframeDoc.write(htmlContent);
      iframeDoc.close();

      // Replace cover background-image with preloaded data URL
      if (coverDataUrl) {
        const coverEl = iframeDoc.querySelector('.cover-page-image') as HTMLElement;
        if (coverEl) {
          coverEl.style.backgroundImage = `url('${coverDataUrl}')`;
        }
      }

      // Wait for styles to apply inside the iframe
      await new Promise(resolve => setTimeout(resolve, 300));

      // Select both fixed-height pages and auto-height property pages
      const fixedPages = iframeDoc.querySelectorAll('.page');
      const autoPages = iframeDoc.querySelectorAll('.page-auto');
      const allElements = iframeDoc.querySelectorAll('.page, .page-auto');
      const totalHtmlElements = allElements.length;
      if (totalHtmlElements === 0) {
        throw new Error('No PDF pages were generated from template');
      }

      console.log(`[FormaraPDF] Starting render: ${totalHtmlElements} elements (${fixedPages.length} fixed, ${autoPages.length} auto-height) in isolated iframe`);

      // Create PDF
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      // The last fixed page is the disclaimer/contact page — render it AFTER BC pages
      const lastFixedPage = fixedPages[fixedPages.length - 1] as HTMLElement;
      const isDisclaimerPage = lastFixedPage?.classList.contains('final-page');
      
      // Build ordered render list: all elements except the final disclaimer page
      const renderList: HTMLElement[] = [];
      allElements.forEach((el) => {
        if (el === lastFixedPage && isDisclaimerPage) return; // skip disclaimer for now
        renderList.push(el as HTMLElement);
      });

      // Adaptive render scale
      const navWithMemory = navigator as Navigator & { deviceMemory?: number };
      const deviceMemory = navWithMemory.deviceMemory ?? 4;
      const renderScale = totalHtmlElements > 8
        ? 1
        : deviceMemory <= 4
          ? 1.25
          : 1.6;

      const PAGE_HEIGHT_PX = 1123;

      const renderOptions: Parameters<typeof html2canvas>[1] = {
        scale: renderScale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        width: 794,
        height: PAGE_HEIGHT_PX,
        logging: false,
      };

      let pdfPageIndex = 0;

      // Render all content pages
      for (let i = 0; i < renderList.length; i++) {
        ensureWithinBudget();
        await new Promise(resolve => setTimeout(resolve, 0));

        const pageStart = Date.now();
        const page = renderList[i];
        const isAutoPage = page.classList.contains('page-auto');

        if (isAutoPage) {
          // ── Fluid-height page: single PDF page sized to fit ALL content ──
          // No tiling, no splits → no truncated tables, no orphan pages.
          // Content rendered at 80% wholesale (20% smaller) and centred.
          // A malformed/long client record can otherwise create an enormous canvas
          // and crash Chromium. Keep the client-side capture bounded to three A4 pages.
          const naturalHeight = Math.min(page.scrollHeight, PAGE_HEIGHT_PX * 3);
          const canvas = await html2canvasWithTimeout(page, {
            ...renderOptions,
            height: naturalHeight,
          }, 25000);

          const PAGE_WIDTH_MM = 210;
          const SHRINK = 0.8;                              // 20% wholesale reduction
          const CONTENT_WIDTH_MM = PAGE_WIDTH_MM * SHRINK; // 168mm
          const SIDE_MARGIN_MM = (PAGE_WIDTH_MM - CONTENT_WIDTH_MM) / 2;
          const TOP_MARGIN_MM = 8;
          const FOOTER_BAND_MM = 14;

          // Convert captured pixel height → mm at the shrunk width.
          // Source width is 794px → 168mm when shrunk.
          const contentHeightMm = (naturalHeight / 794) * CONTENT_WIDTH_MM;
          const pageHeightMm = TOP_MARGIN_MM + contentHeightMm + FOOTER_BAND_MM;

          console.log(`[FormaraPDF] Auto page ${i + 1} rendered in ${Date.now() - pageStart}ms (${naturalHeight}px → fluid ${pageHeightMm.toFixed(1)}mm)`);

          if (pdfPageIndex > 0) {
            pdf.addPage([PAGE_WIDTH_MM, pageHeightMm], 'portrait');
          } else {
            // First page: replace the default A4 with our fluid format
            pdf.deletePage(1);
            pdf.addPage([PAGE_WIDTH_MM, pageHeightMm], 'portrait');
          }

          pdf.addImage(canvas, 'JPEG', SIDE_MARGIN_MM, TOP_MARGIN_MM, CONTENT_WIDTH_MM, contentHeightMm, undefined, 'FAST');

          // Footer band at bottom of the fluid page
          const footerY = pageHeightMm - 6;
          const lineY = footerY - 5;
          pdf.setDrawColor(200, 200, 200);
          pdf.setLineWidth(0.4);
          pdf.setFillColor(248, 249, 250);
          pdf.rect(0, lineY - 1, PAGE_WIDTH_MM, pageHeightMm - lineY + 1, 'F');
          pdf.line(10, lineY, 200, lineY);

          const _bPhone = __brandSettings?.contactDetails?.phone || '';
          const _bEmail = __brandSettings?.contactDetails?.email || '';
          const _bWeb = __brandSettings?.contactDetails?.website || '';
          const footerDiv = document.createElement('div');
          footerDiv.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;background:#f8f9fa;padding:4px 40px;font-family:Arial,sans-serif;display:flex;justify-content:space-between;align-items:center;';

          const contactDetails = document.createElement('div');
          contactDetails.style.cssText = 'display:flex;gap:18px;font-size:7.5pt;color:#4a5568;';
          [
            [_bPhone, '\u{1F4DE}'],
            [_bEmail, '\u{2709}\u{FE0F}'],
            [_bWeb, '\u{1F310}'],
          ].forEach(([value, icon]) => {
            if (!value) return;
            const detail = document.createElement('span');
            detail.textContent = `${icon} ${value}`;
            contactDetails.appendChild(detail);
          });

          const confidentiality = document.createElement('div');
          confidentiality.style.cssText = 'font-size:6pt;color:#b48c32;font-weight:700;letter-spacing:1.5px;';
          confidentiality.textContent = 'CONFIDENTIAL';

          const pageNumber = document.createElement('div');
          pageNumber.style.cssText = 'font-size:7.5pt;color:#4a5568;';
          pageNumber.textContent = `Page ${pdfPageIndex + 1}`;

          footerDiv.append(contactDetails, confidentiality, pageNumber);
          document.body.appendChild(footerDiv);
          try {
            const footerCanvas = await html2canvas(footerDiv, { scale: 2, backgroundColor: '#f8f9fa', useCORS: true });
            const footerImgH = (footerCanvas.height / footerCanvas.width) * 190;
            pdf.addImage(footerCanvas, 'PNG', 10, lineY + 0.5, 190, footerImgH);
            footerCanvas.width = 1;
            footerCanvas.height = 1;
          } catch (e) {
            pdf.setFontSize(7);
            pdf.setTextColor(74, 85, 104);
            pdf.text([_bPhone && `Ph: ${_bPhone}`, _bEmail, _bWeb].filter(Boolean).join('  |  '), 10, footerY);
            pdf.setFontSize(6);
            pdf.setTextColor(180, 140, 50);
            pdf.setFont('helvetica', 'bold');
            pdf.text('CONFIDENTIAL', 105, footerY + 4, { align: 'center' });
            pdf.setFontSize(7);
            pdf.setTextColor(74, 85, 104);
            pdf.setFont('helvetica', 'normal');
            pdf.text(`Page ${pdfPageIndex + 1}`, 200, footerY, { align: 'right' });
          }
          document.body.removeChild(footerDiv);

          canvas.width = 1;
          canvas.height = 1;
          pdfPageIndex++;
        } else {
          // Fixed-height page (cover): standard A4 single-page render
          const canvas = await html2canvasWithTimeout(page, renderOptions, 15000);
          console.log(`[FormaraPDF] Page ${i + 1}/${renderList.length} rendered in ${Date.now() - pageStart}ms`);

          if (pdfPageIndex > 0) {
            pdf.addPage('a4', 'portrait');
          }
          // pdfPageIndex === 0 → use the default A4 page jsPDF created
          pdf.addImage(canvas, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
          canvas.width = 1;
          canvas.height = 1;
          pdfPageIndex++;
        }
      }

      // ── Append Borrowing Capacity pages BEFORE disclaimer ──
      if (includeBorrowingCapacity && data.client.id) {
        try {
          ensureWithinBudget();
          console.log('📊 Fetching borrowing capacity data for Formara PDF...');
          const { latestAssessment } = await fetchLatestBorrowingCapacity(data.client.id);

          if (latestAssessment) {
            const bcPdfData = transformAssessmentToSectionData(latestAssessment);
            const pageNum = { value: pdf.getNumberOfPages() + 1 };

            pdf.addPage();
            drawBorrowingCapacitySections(pdf, bcPdfData, 20, pageNum, false);

            console.log('✓ Borrowing capacity pages appended to Formara PDF');
          } else {
            console.log('ℹ No borrowing capacity data found — skipping BC pages');
          }
        } catch (bcErr) {
          console.warn('Could not append borrowing capacity pages:', bcErr);
        }
      }

      // ── Render the disclaimer/contact page LAST (always the final page) ──
      if (isDisclaimerPage && lastFixedPage) {
        ensureWithinBudget();
        await new Promise(resolve => setTimeout(resolve, 0));

        const disclaimerCanvas = await html2canvasWithTimeout(lastFixedPage, {
          ...renderOptions,
          backgroundColor: '#141414',
        }, 15000);

        pdf.addPage();
        pdf.addImage(disclaimerCanvas, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
        disclaimerCanvas.width = 1;
        disclaimerCanvas.height = 1;
      }

      const generatedStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `Formara_Form_${clientName.replace(/\s+/g, '_')}_${generatedStamp}.pdf`;

      console.log(`[FormaraPDF] Generation complete: ${pdf.getNumberOfPages()} total PDF pages`);

      if (forEmail) {
        const pdfBlob = pdf.output('blob');
        persistFormaraPdf(pdfBlob, fileName, data.client.id);
        return pdfBlob;
      } else {
        const pdfBlob = pdf.output('blob');
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        persistFormaraPdf(pdfBlob, fileName, data.client.id);
        toast.success('Formara PDF downloaded & saved to Reports');
        logReportRenderEvent({ format: 'client_details', engine: 'browser', source: 'formara_generator', reportId: data.client?.id ?? undefined, entityName: clientName });
        return null;
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(message.toLowerCase().includes('timed out')
        ? 'PDF generation timed out. Please try again.'
        : 'Failed to generate PDF');
      return null;
    } finally {
      if (iframe && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      actionLock.current = false;
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    await generatePDF(false);
  };

  const handleEmailSend = async (recipient?: FinanceReportRecipient) => {
    if (isDisabled) return;
    const pdfBlob = await generatePDF(true);
    if (pdfBlob && onEmailClick) {
      const fileName = `Formara_Form_${clientName.replace(/\s+/g, '_')}_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
      onEmailClick(pdfBlob, fileName, recipient);
    }
  };

  /**
   * Quick Send, to the partner the picker returned.
   *
   * It used to accept an optional id and fall back to `defaultContact` — the
   * first `finance_agent_contacts` row, since production flags none as default
   * — so the menu named a partner nobody had chosen and, in this deployment,
   * one with no Finance Portal account for the send to reach.
   */
  const handleQuickSend = async (recipient: FinanceReportRecipient) => {
    if (isDisabled) return;

    setIsSending(true);
    
    try {
      const pdfBlob = await generatePDF(true);
      if (!pdfBlob) {
        throw new Error('Failed to generate PDF');
      }

      const fileName = `Formara_Form_${clientName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      // Convert blob to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(pdfBlob);
      const base64Data = await base64Promise;

      // Quick Send is a Finance Portal delivery channel. It deliberately does
      // not call the personal-mailbox email service; Compose Email remains the
      // explicit action for sending from a user's connected mailbox.
      const { data: shareResult, error } = await invokeSecureFunction('share-report-with-finance', {
        client_id: data.client.id,
        finance_contact_id: recipient.id,
        filename: fileName,
        content_base64: base64Data,
        mime_type: 'application/pdf',
      });
      if (error || !shareResult?.success) throw new Error(error?.message || shareResult?.error || 'Finance Portal share failed');

      setFinancePickerOpen(false);
      toast.success(`Report securely shared with ${recipient.name} through the Finance Portal`);
      
      onQuickSendComplete?.();
      
    } catch (error: any) {
      console.error('Quick send error:', error);
      toast.error('Failed to send: ' + error.message);
    } finally {
      setIsSending(false);
    }
  };

  const isDisabled = isGenerating || isSending;

  if (action === 'download') {
    return (
      <Button type="button" variant={variant === 'default' ? 'outline' : variant} size={size} onClick={handleDownload} disabled={isDisabled} title="Download the current client details as a PDF (legacy raster layout)">
        {isGenerating ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
        {isGenerating ? 'Downloading…' : buttonLabel}
      </Button>
    );
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant={variant} size={size} disabled={isDisabled}>
          {isDisabled ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <FileText className="h-4 w-4 mr-2" />
          )}
          {isSending ? 'Sending...' : buttonLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/* Owner Occupied Toggle - affects Portfolio Summary calculations only */}
        <div className="flex items-center justify-between px-2 py-2 border-b">
          <div className="flex items-center gap-2">
            <Home className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="include-owner-occupied" className="text-sm cursor-pointer leading-tight">
              <span className="block">Owner Occupied in Summary</span>
              <span className="text-xs text-muted-foreground">Include in portfolio calculations</span>
            </Label>
          </div>
          <Switch
            id="include-owner-occupied"
            checked={includeOwnerOccupied}
            onCheckedChange={setIncludeOwnerOccupied}
          />
        </div>

        {/* Borrowing Capacity Toggle */}
        <div className="flex items-center justify-between px-2 py-2 border-b">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="include-bc-formara" className="text-sm cursor-pointer leading-tight">
              <span className="block">Borrowing Capacity</span>
              <span className="text-xs text-muted-foreground">Append detailed BC assessment</span>
            </Label>
          </div>
          <Switch
            id="include-bc-formara"
            checked={includeBorrowingCapacity}
            onCheckedChange={setIncludeBorrowingCapacity}
          />
        </div>
        
        {onEmailClick && (
          <>
            <DropdownMenuSeparator />
            {/* Audit item 12: asks WHO before composing, through the picker
                that "Quick Send" already uses. It used to compose straight
                away, and the only party the dialog knew about was the client
                — so a menu item under "Send to Finance" produced an email to
                the customer. */}
            <DropdownMenuItem
              onSelect={(e) => { e.preventDefault(); setPickerIntent('compose'); setFinancePickerOpen(true); }}
              disabled={isDisabled}
            >
              <Mail className="h-4 w-4 mr-2" />
              Compose Email with PDF
            </DropdownMenuItem>
            {/* One item whatever the organisation's partner list looks like.
                The submenu it replaces listed every finance contact with no
                indication that most of them cannot receive this client's
                report — and collapsed to a person's name when there was one. */}
            <DropdownMenuItem
              onSelect={(e) => { e.preventDefault(); setPickerIntent('quick_send'); setFinancePickerOpen(true); }}
              disabled={isDisabled}
            >
              <Send className="h-4 w-4 mr-2" />
              Quick Send to Finance
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>

    {/* Outside the menu: Radix unmounts the menu's content when it closes, and
        a dialog rendered inside would close with it. */}
    <FinanceRecipientPicker
      open={financePickerOpen}
      onOpenChange={setFinancePickerOpen}
      clientId={data.client.id}
      clientName={clientName}
      documentLabel="this client details report"
      deliveryMode={pickerIntent === 'compose' ? 'email' : 'portal'}
      busy={isSending}
      onConfirm={(recipient) => {
        if (pickerIntent === 'compose') {
          setFinancePickerOpen(false);
          void handleEmailSend(recipient);
          return;
        }
        void handleQuickSend(recipient);
      }}
    />
    </>
  );
}

// Brand colors. The gold ramp is centralised on the shared brand palette
// (src/branding/brandPalette.ts) so it stays consistent with the app and the
// other PDF templates instead of being hardcoded here. (Making it re-resolve
// per generation from the live White-Label brand colour is a follow-up — this
// async string builder would need the brand colour threaded in.)
const NPC_GOLD = getBrandPdfPalette();
const NPC_COLORS = {
  gold: NPC_GOLD.gold,
  goldLight: NPC_GOLD.goldLight,
  goldDark: NPC_GOLD.goldDeep,
  goldTint: NPC_GOLD.cream,
  darkBlue: '#113361',
  navy: '#0d264d',
  black: '#0a0a0a',
  darkGray: '#2d3748',
  mediumGray: '#4a5568',
  lightGray: '#f7fafc',
  borderGray: '#e2e8f0',
  white: '#ffffff',
  success: '#16a34a',
  successLight: '#dcfce7',
  warning: '#d97706',
  warningLight: '#fef3c7',
  danger: '#dc2626',
  dangerLight: '#fef2f2',
};

/**
 * Re-resolve the gold ramp from the active White-Label brand colour just before
 * a PDF is generated, so exported documents cascade with the brand. NPC_COLORS
 * is a module singleton read by the HTML builders; PDF generation is sequential
 * (user-triggered), so mutating it here is safe.
 */
function applyBrandGold(brandColorHsl?: string | null) {
  const p = getBrandPdfPalette(brandColorHsl);
  NPC_COLORS.gold = p.gold;
  NPC_COLORS.goldLight = p.goldLight;
  NPC_COLORS.goldDark = p.goldDeep;
  NPC_COLORS.goldTint = p.cream;
}

// Generate the full HTML content for the PDF
function generateHTMLContent(
  data: FormaraPDFData,
  includeOwnerOccupied: boolean = true,
  brandContact?: ContactDetails,
  brandDisclaimer?: ProfessionalDisclaimer,
): string {
  // Brand-aware values with safe fallbacks
  const _company = (brandContact?.company_name || 'Property Consulting').trim();
  const _companyParts = _company.split(' ');
  const _companyLine1 = _companyParts.length > 1 ? _companyParts.slice(0, -1).join(' ').toUpperCase() : _company.toUpperCase();
  const _companyLine2 = _companyParts.length > 1 ? _companyParts[_companyParts.length - 1].toUpperCase() : '';
  const _website = brandContact?.website || '';
  const _email = brandContact?.email || '';
  const _phone = brandContact?.phone || '';
  const _address = brandContact?.address || '';
  const _abn = brandContact?.abn || '';
  const _disclaimerText = (brandDisclaimer?.is_enabled === false)
    ? ''
    : (brandDisclaimer?.text || 'This information is provided for general informational purposes only and does not constitute financial, legal, or investment advice.');
  const { client, properties, employment = [], income = [], incomeSources = [], assets = [], liabilities = [], expenses = [] } = data;
  const reportDate = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
  
  // Always find owner occupied property (shown on page 1 regardless of toggle)
  const ownerOccupied = properties.find(p => p.property_type === 'owner_occupied');
  const investmentProperties = properties.filter(p => p.property_type === 'investment');
  const smsfProperties = properties.filter(p => p.property_type === 'smsf');
  const rentalProperties = properties.filter(p => p.property_type === 'rental');
  
  // Filter properties for Portfolio Summary calculations based on toggle
  // When toggle is OFF, only investment properties are included in summary calculations
  const summaryProperties = includeOwnerOccupied 
    ? properties 
    : properties.filter(p => p.property_type !== 'owner_occupied');
  
  // Helper to format SMSF compliance status
  const formatComplianceStatus = (status: string | null | undefined): string => {
    if (!status) return '-';
    switch (status) {
      case 'compliant': return '✓ Compliant';
      case 'non_compliant': return '✗ Non-Compliant';
      case 'pending_audit': return '⏳ Pending Audit';
      default: return status;
    }
  };

  // Helper to format trustee type
  const formatTrusteeType = (type: string | null | undefined): string => {
    if (!type) return '-';
    return type === 'corporate' ? 'Corporate Trustee' : 'Individual Trustee';
  };

  // Helper for cashflow indicator
  const getCashflowIndicator = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    if (value > 0) return `<span class="cf-indicator cf-positive">▲</span>`;
    if (value < 0) return `<span class="cf-indicator cf-negative">▼</span>`;
    return `<span class="cf-indicator cf-neutral">●</span>`;
  };

  // Helper for property type badge (with emoji icons for character)
  const getPropertyTypeBadge = (type: string): string => {
    switch (type) {
      case 'owner_occupied': return `<span class="prop-badge prop-badge-owner">🏠 Owner Occupied</span>`;
      case 'investment': return `<span class="prop-badge prop-badge-invest">📈 Investment</span>`;
      case 'smsf': return `<span class="prop-badge prop-badge-smsf">🏛️ SMSF</span>`;
      default: return `<span class="prop-badge">${type}</span>`;
    }
  };

  // Helper for equity progress bar
  const getEquityProgressBar = (value: number | null | undefined, loan: number | null | undefined): string => {
    const v = value || 0;
    const l = loan || 0;
    if (v === 0) return '<div class="equity-bar-container"><div class="equity-bar" style="width: 0%"></div></div>';
    const equityPercent = Math.max(0, Math.min(100, ((v - l) / v) * 100));
    return `
      <div class="equity-bar-container">
        <div class="equity-bar" style="width: ${equityPercent}%"></div>
        <span class="equity-label">${equityPercent.toFixed(0)}% equity</span>
      </div>
    `;
  };

  // Generate investment property HTML for a single property
  // Helper to calculate weekly rental from monthly
  const calculateWeeklyRental = (monthlyRental: number | null | undefined): number | null => {
    if (monthlyRental === null || monthlyRental === undefined || monthlyRental === 0) return null;
    return Math.round(monthlyRental * (12 / 52));
  };

  const generateInvestmentPropertyHTML = (prop: PropertyData, index: number) => {
    // Calculate weekly rental from monthly if not provided
    const weeklyRental = prop.weekly_rental_income || calculateWeeklyRental(prop.monthly_rental_income);
    
    return `
    <div class="property-card">
      <div class="section-header">
        <span class="section-header-text">📈 Investment Property ${index}</span>
        <span class="prop-badge prop-badge-invest">INVESTMENT</span>
      </div>
      <div class="property-address-bar">
        <span class="property-address-icon">📍</span>
        <span class="property-address-text">${prop.address || '-'}</span>
      </div>
      <div class="equity-display">
        ${getEquityProgressBar(prop.value, prop.loan_remaining)}
      </div>
      <table class="data-table alt-rows">
        <tr><td class="label">Value</td><td class="value currency">${formatCurrency(prop.value)}</td></tr>
        <tr><td class="label">Loan Remaining</td><td class="value currency">${formatCurrency(prop.loan_remaining)}</td></tr>
        <tr><td class="label">Interest Rate</td><td class="value percent">${formatPercent(prop.interest_rate)}</td></tr>
        <tr><td class="label">Ownership</td><td class="value percent">${formatPercent(prop.ownership_percentage)}</td></tr>
        <tr><td class="label">Lender / Bank</td><td class="value">${textOrNotRecorded(prop.lender_name)}</td></tr>
        <tr><td class="label">Loan Repayment</td><td class="value currency">${prop.loan_repayment_amount ? `${formatCurrency(prop.loan_repayment_amount)}${prop.loan_repayment_frequency ? ` <span style="font-size:7px;color:#999">(${prop.loan_repayment_frequency})</span>` : ''}` : NOT_RECORDED}</td></tr>
        <tr><td class="label">Repayment Type</td><td class="value">${enumOrNotRecorded(prop.repayment_type)}</td></tr>
      </table>
      <div class="subsection-header">Monthly Expenses</div>
      <table class="data-table compact alt-rows">
        <tr><td class="label">Interest Repayment</td><td class="value currency">${formatCurrency(prop.monthly_interest_repayment)}</td></tr>
        <tr><td class="label">Body Corporate</td><td class="value currency">${formatCurrency(prop.monthly_body_corporate)}</td></tr>
        <tr><td class="label">Council Rates</td><td class="value currency">${formatCurrency(prop.monthly_council_rates)}</td></tr>
        <tr><td class="label">Water Rates</td><td class="value currency">${formatCurrency(prop.monthly_water_rates)}</td></tr>
        <tr><td class="label">Repairs & Maintenance</td><td class="value currency">${formatCurrency(prop.monthly_repairs_maintenance)}</td></tr>
        <tr><td class="label">Property Management</td><td class="value currency">${formatCurrency(prop.monthly_property_management)}</td></tr>
        <tr><td class="label">Landlord Insurance</td><td class="value currency">${formatCurrency(prop.monthly_landlord_insurance)}</td></tr>
        <tr><td class="label">Building Insurance</td><td class="value currency">${formatCurrency(prop.monthly_building_insurance)}</td></tr>
        <tr class="expense-total"><td class="label">Total Expenditure</td><td class="value currency">${formatCurrency(prop.total_monthly_expenditure)}</td></tr>
      </table>
      <div class="subsection-header">Income & Cashflow</div>
      <table class="data-table compact">
        <tr><td class="label">Weekly Rental Income</td><td class="value currency income-value">${formatCurrency(weeklyRental)}</td></tr>
        <tr><td class="label">Monthly Rental Income</td><td class="value currency income-value">${formatCurrency(prop.monthly_rental_income)}</td></tr>
        <tr class="cashflow-row ${(prop.net_monthly_cashflow || 0) >= 0 ? 'cf-positive-row' : 'cf-negative-row'}">
          <td class="label"><strong>Net Monthly Cashflow</strong></td>
          <td class="value currency">
            ${getCashflowIndicator(prop.net_monthly_cashflow)}
            <strong>${formatCurrency(prop.net_monthly_cashflow)}</strong>
          </td>
        </tr>
      </table>
    </div>
  `;
  };

  // ALL investment properties go to their own individual pages now
  // Each investment property gets a dedicated page for better readability

  // Generate SMSF property HTML for a single property
  const generateSmsfPropertyHTML = (prop: PropertyData, index: number) => {
    // Calculate weekly rental from monthly if not provided
    const weeklyRental = prop.weekly_rental_income || calculateWeeklyRental(prop.monthly_rental_income);
    
    return `
    <div class="property-card smsf-card">
      <div class="section-header gold">
        <span class="section-header-text">🏛️ SMSF Property ${index}</span>
        <span class="prop-badge prop-badge-smsf">SMSF</span>
      </div>
      
      <div class="property-address-bar">
        <span class="property-address-icon">📍</span>
        <span class="property-address-text">${prop.address || '-'}</span>
      </div>
      
      <!-- SMSF Fund Details -->
      <div class="subsection-header">Fund Details & Compliance</div>
      <table class="data-table alt-rows">
        <tr><td class="label">Fund Name</td><td class="value">${prop.smsf_fund_name || '-'}</td></tr>
        <tr><td class="label">ABN</td><td class="value"><code class="abn-code">${prop.smsf_abn || '-'}</code></td></tr>
        <tr><td class="label">Trustee Name</td><td class="value">${prop.smsf_trustee_name || '-'}</td></tr>
        <tr><td class="label">Trustee Type</td><td class="value">${formatTrusteeType(prop.smsf_trustee_type)}</td></tr>
        <tr><td class="label">Compliance Status</td><td class="value"><span class="compliance-badge ${prop.smsf_compliance_status === 'compliant' ? 'compliant' : prop.smsf_compliance_status === 'non_compliant' ? 'non-compliant' : 'pending'}">${formatComplianceStatus(prop.smsf_compliance_status)}</span></td></tr>
        <tr><td class="label">Auditor</td><td class="value">${prop.smsf_auditor_name || '-'}</td></tr>
      </table>

      <div class="equity-display">
        ${getEquityProgressBar(prop.value, prop.loan_remaining)}
      </div>
      
      <!-- Property Details -->
      <div class="subsection-header">Property Financials</div>
      <table class="data-table compact alt-rows">
        <tr><td class="label">Value</td><td class="value currency">${formatCurrency(prop.value)}</td></tr>
        <tr><td class="label">Loan Remaining</td><td class="value currency">${formatCurrency(prop.loan_remaining)}</td></tr>
        <tr><td class="label">Interest Rate</td><td class="value percent">${formatPercent(prop.interest_rate)}</td></tr>
        <tr><td class="label">Ownership</td><td class="value percent">${formatPercent(prop.ownership_percentage)}</td></tr>
        <tr><td class="label">Lender / Bank</td><td class="value">${textOrNotRecorded(prop.lender_name)}</td></tr>
        <tr><td class="label">Loan Repayment</td><td class="value currency">${prop.loan_repayment_amount ? `${formatCurrency(prop.loan_repayment_amount)}${prop.loan_repayment_frequency ? ` <span style="font-size:7px;color:#999">(${prop.loan_repayment_frequency})</span>` : ''}` : NOT_RECORDED}</td></tr>
        <tr><td class="label">Repayment Type</td><td class="value">${enumOrNotRecorded(prop.repayment_type)}</td></tr>
      </table>
      
      <div class="subsection-header">Monthly Expenses</div>
      <table class="data-table compact alt-rows">
        <tr><td class="label">Interest Repayment</td><td class="value currency">${formatCurrency(prop.monthly_interest_repayment)}</td></tr>
        <tr><td class="label">Body Corporate</td><td class="value currency">${formatCurrency(prop.monthly_body_corporate)}</td></tr>
        <tr><td class="label">Council Rates</td><td class="value currency">${formatCurrency(prop.monthly_council_rates)}</td></tr>
        <tr><td class="label">Water Rates</td><td class="value currency">${formatCurrency(prop.monthly_water_rates)}</td></tr>
        <tr><td class="label">Repairs & Maintenance</td><td class="value currency">${formatCurrency(prop.monthly_repairs_maintenance)}</td></tr>
        <tr><td class="label">Property Management</td><td class="value currency">${formatCurrency(prop.monthly_property_management)}</td></tr>
        <tr><td class="label">Landlord Insurance</td><td class="value currency">${formatCurrency(prop.monthly_landlord_insurance)}</td></tr>
        <tr><td class="label">Building Insurance</td><td class="value currency">${formatCurrency(prop.monthly_building_insurance)}</td></tr>
        <tr class="expense-total"><td class="label">Total Expenditure</td><td class="value currency">${formatCurrency(prop.total_monthly_expenditure)}</td></tr>
      </table>
      
      <div class="subsection-header">Income & Cashflow</div>
      <table class="data-table compact">
        <tr><td class="label">Weekly Rental Income</td><td class="value currency income-value">${formatCurrency(weeklyRental)}</td></tr>
        <tr><td class="label">Monthly Rental Income</td><td class="value currency income-value">${formatCurrency(prop.monthly_rental_income)}</td></tr>
        <tr class="cashflow-row ${(prop.net_monthly_cashflow || 0) >= 0 ? 'cf-positive-row' : 'cf-negative-row'}">
          <td class="label"><strong>Net Monthly Cashflow</strong></td>
          <td class="value currency">
            ${getCashflowIndicator(prop.net_monthly_cashflow)}
            <strong>${formatCurrency(prop.net_monthly_cashflow)}</strong>
          </td>
        </tr>
      </table>
    </div>
  `;
  };

  // Calculate total pages dynamically
  // ALL investment properties now get their own individual page (one property per page)
  const investmentPropertyPages: Array<{prop: PropertyData, index: number}> = investmentProperties.map((prop, idx) => ({
    prop,
    index: idx + 1 // Start from 1
  }));
  
  // SMSF properties also get their own pages
  const smsfPropertyPages: Array<{prop: PropertyData, index: number}> = smsfProperties.map((prop, idx) => ({
    prop,
    index: idx + 1
  }));
  
  // Total pages: Cover + Page 1 (Personal Details) + Investment Property Pages + SMSF Pages + Employment + Assets + Summary + Final
  const basePages = 5; // Cover, Page 1, Employment, Assets, Summary
  const totalPages = basePages + investmentPropertyPages.length + smsfPropertyPages.length + 1; // +1 for Final page

  // Employment tables
  const primaryEmployment = employment.filter(e => e.contact_type === 'primary');
  const secondaryEmployment = employment.filter(e => e.contact_type === 'secondary');
  
  const generateEmploymentTable = (empList: EmploymentData[], isPrimary: boolean = false) => {
    if (empList.length === 0) {
      return `
        <div class="empty-state-compact ${isPrimary ? 'primary' : ''}">
          <div class="empty-state-icon">💼</div>
          <p class="empty-state-text">No employment records</p>
        </div>
      `;
    }
    return empList.map((emp, idx) => {
      // Calculate tenure
      let tenureStr = '-';
      if (emp.start_date) {
        const start = new Date(emp.start_date);
        const now = new Date();
        const totalMonths = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
        const years = Math.floor(totalMonths / 12);
        const months = totalMonths % 12;
        tenureStr = years > 0 ? `${years}yr${years > 1 ? 's' : ''} ${months}mo` : `${months} month${months !== 1 ? 's' : ''}`;
      }
      
      // Calculate total annual from employment record
      const annualSalary = emp.gross_annual_salary || (emp.salary_amount ? (() => {
        const freq = emp.salary_frequency || 'annually';
        if (freq === 'weekly') return (emp.salary_amount || 0) * 52;
        if (freq === 'fortnightly') return (emp.salary_amount || 0) * 26;
        if (freq === 'monthly') return (emp.salary_amount || 0) * 12;
        return emp.salary_amount || 0;
      })() : 0);
      
      return `
      <div class="info-card ${idx > 0 ? 'mt-2' : ''}">
        <div class="info-card-header">
          <span class="employer-icon">🏢</span>
          <span class="employer-name">${emp.employer_name || 'Unknown Employer'}</span>
          ${emp.is_current !== false
            ? '<span class="status-pill status-pill-current">CURRENT</span>'
            : '<span class="status-pill status-pill-previous">PREVIOUS</span>'}
        </div>
        <table class="data-table compact alt-rows">
          <tr><td class="label">Employment Type</td><td class="value"><span class="emp-type-badge">${emp.employment_type ? humanizeEnum(emp.employment_type).toUpperCase() : '-'}</span></td></tr>
          <tr><td class="label">Role</td><td class="value">${emp.occupation_role || '-'}</td></tr>
          <tr><td class="label">Start Date</td><td class="value">${formatDate(emp.start_date)}</td></tr>
          <tr><td class="label">Tenure</td><td class="value">${tenureStr}</td></tr>
          ${annualSalary > 0 ? `<tr><td class="label">Gross Annual Salary</td><td class="value currency">${formatCurrency(annualSalary)}</td></tr>` : ''}
          ${emp.salary_amount && emp.salary_frequency ? `<tr><td class="label">Pay Cycle</td><td class="value">${formatCurrency(emp.salary_amount)} <span style="font-size:7px;color:#666;">(${humanizeEnum(emp.salary_frequency)})</span></td></tr>` : ''}
        </table>
      </div>
    `;}).join('');
  };

  // Income tables — prefer client_income, fall back to aggregated client_employment so
  // secondary income appears even when the dedicated income row is missing (audit fix).
  const employmentToIncome = (empList: EmploymentData[], contactType: 'primary' | 'secondary'): IncomeData | undefined => {
    if (!empList.length) return undefined;
    const current = empList.filter(e => e.is_current !== false);
    const totals = current.reduce((acc, e) => {
      const annual = e.gross_annual_salary || (e.salary_amount ? (() => {
        const freq = e.salary_frequency || 'annually';
        if (freq === 'weekly') return (e.salary_amount || 0) * 52;
        if (freq === 'fortnightly') return (e.salary_amount || 0) * 26;
        if (freq === 'monthly') return (e.salary_amount || 0) * 12;
        return e.salary_amount || 0;
      })() : 0);
      acc.gross_salary += annual;
      acc.bonus += e.bonus || 0;
      acc.allowance += e.allowance || 0;
      acc.commission += e.commission || 0;
      acc.overtime_essential += e.overtime_essential || 0;
      acc.overtime_non_essential += e.overtime_non_essential || 0;
      acc.other_taxable_income += e.other_taxable_income || 0;
      return acc;
    }, { gross_salary: 0, bonus: 0, allowance: 0, commission: 0, overtime_essential: 0, overtime_non_essential: 0, other_taxable_income: 0 });
    if (Object.values(totals).every(v => !v)) return undefined;
    return { contact_type: contactType, salary_frequency: 'annually', ...totals };
  };

  const primaryIncome = income.find(i => i.contact_type === 'primary') ?? employmentToIncome(primaryEmployment, 'primary');
  const secondaryIncome = income.find(i => i.contact_type === 'secondary') ?? employmentToIncome(secondaryEmployment, 'secondary');
  
  const generateIncomeTable = (inc: IncomeData | undefined) => {
    if (!inc) {
      return `
        <div class="empty-state-compact">
          <div class="empty-state-icon">💰</div>
          <p class="empty-state-text">No income records</p>
        </div>
      `;
    }
    const totalIncome = (inc.gross_salary || 0) + (inc.bonus || 0) + (inc.allowance || 0) + (inc.commission || 0) + (inc.overtime_essential || 0) + (inc.overtime_non_essential || 0) + (inc.other_taxable_income || 0);
    return `
      <div class="income-highlight">
        <span class="income-highlight-label">TOTAL ANNUAL INCOME</span>
        <span class="income-highlight-value">${formatCurrency(totalIncome)}</span>
      </div>
      <table class="data-table alt-rows compact">
        <tr><td class="label">Gross Salary</td><td class="value currency income-value">${formatCurrency(inc.gross_salary)}</td></tr>
        <tr><td class="label">Salary Frequency</td><td class="value"><span class="freq-badge">${inc.salary_frequency ? humanizeEnum(inc.salary_frequency).toUpperCase() : '-'}</span></td></tr>
        <tr><td class="label">Bonus</td><td class="value currency">${formatCurrency(inc.bonus)}</td></tr>
        <tr><td class="label">Allowance</td><td class="value currency">${formatCurrency(inc.allowance)}</td></tr>
        <tr><td class="label">Commission</td><td class="value currency">${formatCurrency(inc.commission)}</td></tr>
        <tr><td class="label">Overtime (Essential)</td><td class="value currency">${formatCurrency(inc.overtime_essential)}</td></tr>
        <tr><td class="label">Overtime (Non-Essential)</td><td class="value currency">${formatCurrency(inc.overtime_non_essential)}</td></tr>
        <tr><td class="label">Other Taxable Income</td><td class="value currency">${formatCurrency(inc.other_taxable_income)}</td></tr>
      </table>
    `;
  };

  // Assets table - with emoji icons for character
  const getAssetEmoji = (type: string): string => {
    const lowerType = type.toLowerCase();
    if (lowerType.includes('vehicle') || lowerType.includes('car')) return '🚗';
    if (lowerType.includes('savings') || lowerType.includes('bank')) return '🏦';
    if (lowerType.includes('super') || lowerType.includes('retirement')) return '💎';
    if (lowerType.includes('shares') || lowerType.includes('stock')) return '📈';
    if (lowerType.includes('property') || lowerType.includes('real')) return '🏠';
    return '💰';
  };

  const generateAssetsTable = () => {
    // Filter out credit cards from assets - check all relevant fields
    const filteredAssets = assets.filter(asset => {
      const type = (asset.asset_type || '').toLowerCase();
      const desc = (asset.description || '').toLowerCase();
      const institution = (asset.institution_name || '').toLowerCase();
      const isCreditCard = type.includes('credit') || type.includes('card') ||
                          desc.includes('credit') || desc.includes('card') ||
                          institution.includes('credit') || institution.includes('card');
      return !isCreditCard;
    });
    
    if (filteredAssets.length === 0) {
      return `
        <div class="empty-state-compact">
          <div class="empty-state-icon">💎</div>
          <p class="empty-state-text">No assets recorded</p>
        </div>
      `;
    }
    
    const totalAssets = filteredAssets.reduce((sum, a) => sum + (a.value || 0), 0);
    
    // Separate SMSF/super fund assets from others
    const smsfAssets: AssetData[] = [];
    const regularAssets: AssetData[] = [];
    
    filteredAssets.forEach(asset => {
      const type = (asset.asset_type || '').toLowerCase();
      const desc = (asset.description || asset.institution_name || '').toLowerCase();
      if (type.includes('super') || type.includes('smsf') || 
          desc.includes('super') || desc.includes('smsf') || desc.includes('cbus')) {
        smsfAssets.push(asset);
      } else {
        regularAssets.push(asset);
      }
    });
    
    // Group regular assets by type
    const assetsByType: Record<string, AssetData[]> = {};
    regularAssets.forEach(asset => {
      const type = asset.asset_type || 'Other';
      if (!assetsByType[type]) assetsByType[type] = [];
      assetsByType[type].push(asset);
    });
    
    // Generate SMSF section if there are SMSF assets
    const smsfSection = smsfAssets.length > 0 ? `
      <div class="asset-category">
        <div class="asset-category-header">
          <span class="category-icon">🏛️</span>
          <span class="category-title">Self-Managed Super Fund</span>
        </div>
        <table class="data-table compact alt-rows asset-table">
          ${smsfAssets.map(asset => `
            <tr>
              <td class="label">${asset.description || asset.make_model || asset.institution_name || '-'}</td>
              <td class="value currency">${formatCurrency(asset.value)}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    ` : '';
    
    return `
      <div class="assets-summary">
        <span class="assets-summary-label">TOTAL ASSETS VALUE</span>
        <span class="assets-summary-value">${formatCurrency(totalAssets)}</span>
      </div>
      ${Object.entries(assetsByType).map(([type, assetList]) => `
        <div class="asset-category">
          <div class="asset-category-header">
            <span class="category-icon">${getAssetEmoji(type)}</span>
            <span class="category-title">${type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
          </div>
          <table class="data-table compact alt-rows asset-table">
            ${assetList.map(asset => `
              <tr>
                <td class="label">${asset.description || asset.make_model || asset.institution_name || '-'}</td>
                <td class="value currency">${formatCurrency(asset.value)}</td>
              </tr>
            `).join('')}
          </table>
        </div>
      `).join('')}
      ${smsfSection}
    `;
  };

  // Liabilities table - with emoji icons for character
  const getLiabilityEmoji = (type: string): string => {
    const lowerType = type.toLowerCase();
    if (lowerType.includes('credit') || lowerType.includes('card')) return '💳';
    if (lowerType.includes('mortgage') || lowerType.includes('home')) return '🏠';
    if (lowerType.includes('car') || lowerType.includes('vehicle')) return '🚗';
    if (lowerType.includes('personal') || lowerType.includes('loan')) return '📝';
    if (lowerType.includes('student') || lowerType.includes('education')) return '🎓';
    return '📋';
  };

  const generateLiabilitiesTable = () => {
    if (liabilities.length === 0) {
      return `
        <div class="empty-state-compact">
          <div class="empty-state-icon">📋</div>
          <p class="empty-state-text">No liabilities recorded</p>
        </div>
      `;
    }
    
    const totalLiabilities = liabilities.reduce((sum, l) => sum + (l.current_balance || 0), 0);
    // Source of truth = user-entered monthly_repayment from the dashboard.
    // Only fall back to the shared servicing engine when the value is genuinely
    // missing (null/undefined). An explicit 0 means "TBC" and must be respected.
    const servicingById = new Map<string, { monthlyServicing: number; isEstimated: boolean; calculationNote: string }>();
    liabilityServicingSummary.items.forEach((s: any) => {
      if (s.id) servicingById.set(s.id, { monthlyServicing: s.monthlyServicing, isEstimated: s.isEstimated, calculationNote: s.calculationNote });
    });
    const totalRepayments = liabilities.reduce((sum, l) => {
      const v = (l as any).monthly_repayment;
      if (v === null || v === undefined) {
        const srv = (l as any).id ? servicingById.get((l as any).id) : undefined;
        return sum + (srv?.monthlyServicing || 0);
      }
      return sum + (Number(v) || 0);
    }, 0);
    const liabsByType: Record<string, LiabilityData[]> = {};
    liabilities.forEach(liab => {
      const type = liab.liability_type || 'Other';
      if (!liabsByType[type]) liabsByType[type] = [];
      liabsByType[type].push(liab);
    });
    
    const totalCreditLimit = liabilities.reduce((sum, l) => sum + (l.credit_limit || 0), 0);
    
    return `
      <div class="liabilities-summary">
        <div class="liab-summary-item">
          <span class="liab-label">TOTAL OWED</span>
          <span class="liab-value negative">${formatCurrency(totalLiabilities)}</span>
        </div>
        <div class="liab-summary-item">
          <span class="liab-label">MONTHLY REPAYMENTS${liabilityServicingSummary.hasEstimated ? ' <span style="font-size:6.5pt;color:#9ca3af;font-weight:500;">(incl. est.)</span>' : ''}</span>
          <span class="liab-value">${formatCurrency(totalRepayments)}</span>
        </div>
      </div>
      ${totalCreditLimit > 0 ? `
        <div class="liabilities-summary" style="margin-top: 6px; background: #f0f4f8; border-left: 3px solid ${NPC_COLORS.darkBlue};">
          <div class="liab-summary-item">
            <span class="liab-label">TOTAL CREDIT LIMIT</span>
            <span class="liab-value" style="color: ${NPC_COLORS.darkBlue};">${formatCurrency(totalCreditLimit)}</span>
          </div>
          <div class="liab-summary-item">
            <span class="liab-label">AVAILABLE CREDIT</span>
            <span class="liab-value" style="color: #2d8a4e;">${formatCurrency(totalCreditLimit - totalLiabilities > 0 ? totalCreditLimit - totalLiabilities : 0)}</span>
          </div>
        </div>
      ` : ''}
      ${Object.entries(liabsByType).map(([type, liabList]) => {
        const isCreditCard = type === 'credit_card';
        const hasAnyLimit = liabList.some(l => (l.credit_limit || 0) > 0);
        const hasAnyRate = liabList.some(l => (l.interest_rate || 0) > 0);
        const typeLabel = humanizeEnum(type);
        
        return `
        <div class="liability-category">
          <div class="liability-category-header">
            <span class="category-icon">${getLiabilityEmoji(type)}</span>
            <span class="category-title">${typeLabel}</span>
          </div>
          <table class="data-table financial-mini alt-rows">
            <thead>
              <tr>
                <th>PROVIDER</th>
                ${(isCreditCard || hasAnyLimit) ? '<th class="text-right">LIMIT</th>' : ''}
                <th class="text-right">BALANCE</th>
                ${hasAnyRate ? '<th class="text-right">RATE</th>' : ''}
                <th class="text-right">REPAYMENT</th>
              </tr>
            </thead>
            <tbody>
              ${liabList.map(liab => {
                const utilisation = (isCreditCard && (liab.credit_limit || 0) > 0) 
                  ? Math.round(((liab.current_balance || 0) / liab.credit_limit!) * 100) 
                  : null;
                const liabId = (liab as any).id as string | undefined;
                const rawRepayment = (liab as any).monthly_repayment;
                const hasUserValue = rawRepayment !== null && rawRepayment !== undefined;
                const servicing = (!hasUserValue && liabId) ? servicingById.get(liabId) : undefined;
                const effectiveRepayment = hasUserValue ? Number(rawRepayment) : (servicing?.monthlyServicing || 0);
                const isTbc = hasUserValue && Number(rawRepayment) === 0;
                const isEst = !!servicing?.isEstimated;
                const estNote = servicing?.calculationNote || '';
                const repaymentCell = isTbc
                  ? `<span style="color:#9ca3af;font-style:italic;">TBC</span>`
                  : `${formatCurrency(effectiveRepayment)}/mo${isEst ? ` <span style="font-size:6.5pt;color:#9ca3af;font-style:italic;" title="${estNote}">est.</span>` : ''}`;
                return `
                <tr>
                  <td class="value provider-cell">${normalizeProvider(liab.provider_name)}</td>
                  ${(isCreditCard || hasAnyLimit) ? `<td class="value currency">${(liab.credit_limit || 0) > 0 ? formatCurrency(liab.credit_limit) : '-'}</td>` : ''}
                  <td class="value currency" style="${utilisation !== null && utilisation > 80 ? 'color: #dc2626; font-weight: 600;' : ''}">${formatCurrency(liab.current_balance)}${utilisation !== null ? ` <span style="font-size: 7px; color: #666;">(${utilisation}%)</span>` : ''}</td>
                  ${hasAnyRate ? `<td class="value currency">${(liab.interest_rate || 0) > 0 ? liab.interest_rate + '%' : '-'}</td>` : ''}
                  <td class="value currency">${repaymentCell}</td>
                </tr>
              `;}).join('')}
            </tbody>
          </table>
        </div>
      `;}).join('')}
    `;
  };

  // Personal Expenses table - rental properties where client pays rent
  const generateExpensesTable = () => {
    if (rentalProperties.length === 0) {
      return `
        <div class="empty-state-compact">
          <div class="empty-state-icon">🏠</div>
          <p class="empty-state-text">No personal expenses recorded</p>
        </div>
      `;
    }
    
    // For rental properties, monthly_rental_income stores the rent they PAY (as expense)
    const totalMonthlyRent = rentalProperties.reduce((sum, p) => sum + (p.monthly_rental_income || 0), 0);
    const totalWeeklyRent = rentalProperties.reduce((sum, p) => {
      const weekly = p.weekly_rental_income || (p.monthly_rental_income ? Math.round(p.monthly_rental_income * (12 / 52)) : 0);
      return sum + weekly;
    }, 0);
    
    return `
      <div class="expenses-summary">
        <div class="expense-summary-item">
          <span class="expense-label">TOTAL WEEKLY RENT</span>
          <span class="expense-value">${formatCurrency(totalWeeklyRent)}</span>
        </div>
        <div class="expense-summary-item">
          <span class="expense-label">TOTAL MONTHLY RENT</span>
          <span class="expense-value negative">${formatCurrency(totalMonthlyRent)}</span>
        </div>
      </div>
      <div class="expense-category">
        <div class="expense-category-header">
          <span class="category-icon">🏠</span>
          <span class="category-title">Rental Accommodation</span>
        </div>
        <table class="data-table financial-mini alt-rows">
          <thead>
            <tr>
              <th>ADDRESS</th>
              <th class="text-right">WEEKLY</th>
              <th class="text-right">MONTHLY</th>
            </tr>
          </thead>
          <tbody>
            ${rentalProperties.map(prop => {
              const weeklyRent = prop.weekly_rental_income || (prop.monthly_rental_income ? Math.round(prop.monthly_rental_income * (12 / 52)) : 0);
              return `
                <tr>
                  <td class="value">${prop.address?.substring(0, 30) || '-'}${(prop.address?.length || 0) > 30 ? '...' : ''}</td>
                  <td class="value currency">${formatCurrency(weeklyRent)}/wk</td>
                  <td class="value currency">${formatCurrency(prop.monthly_rental_income)}/mo</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  // Properties summary rows - show more of address (uses filtered properties based on toggle)
  const propertiesSummaryRows = summaryProperties.map(prop => `
    <tr>
      <td class="property-address-cell">${prop.address?.substring(0, 45) || '-'}${(prop.address?.length || 0) > 45 ? '...' : ''}</td>
      <td class="text-right compact-col">${formatCurrency(prop.value)}</td>
      <td class="text-right compact-col">${formatCurrency(prop.loan_remaining)}</td>
      <td class="text-right compact-col">${formatCurrency(prop.monthly_rental_income)}</td>
      <td class="text-right compact-col ${(prop.net_monthly_cashflow || 0) >= 0 ? 'text-green' : 'text-red'}">${formatCurrency(prop.net_monthly_cashflow)}</td>
    </tr>
  `).join('');

  // Calculate totals (uses filtered properties based on toggle)
  const totalValue = summaryProperties.reduce((sum, p) => sum + (p.value || 0), 0);
  const totalLoans = summaryProperties.reduce((sum, p) => sum + (p.loan_remaining || 0), 0);
  const totalRental = summaryProperties.reduce((sum, p) => sum + (p.monthly_rental_income || 0), 0);
  const totalNetCF = summaryProperties.reduce((sum, p) => sum + (p.net_monthly_cashflow || 0), 0);

  // ─── Household finance: single source of truth (src/utils/householdFinance.ts) ──
  const householdIncome = buildHouseholdIncome({
    employment: employment as any[],
    income: income as any[],
    incomeSources: incomeSources as any[],
    monthlyRentalIncome: totalRental,
  });
  const primaryEmploymentIncome = householdIncome.primaryEmploymentMonthly;
  const secondaryEmploymentIncome = householdIncome.secondaryEmploymentMonthly;
  const totalEmploymentIncome = householdIncome.totalEmploymentMonthly;
  const otherIncomeBreakdown = householdIncome.otherIncome;
  const totalOtherIncome = householdIncome.totalOtherIncomeMonthly;
  const calculatedMonthlyIncome = householdIncome.totalMonthly;

  const propertyExpenditure = buildPropertyExpenditure(summaryProperties as any[]);
  const homeLoanRepayments = propertyExpenditure.homeLoanRepayments;
  const totalPropertyHoldingCosts = propertyExpenditure.totalHoldingCosts;

  const liabilityServicingSummary = buildLiabilityServicing(
    liabilities as any[],
    { totalGrossAnnualIncome: householdIncome.totalGrossAnnual }
  );
  const totalLiabilityRepayments = liabilityServicingSummary.totalMonthly;
  const hasEstimatedLiabilities = liabilityServicingSummary.hasEstimated;
  const hasAnyLiability = liabilityServicingSummary.hasAny;

  const totalLivingExpenses = expenses.reduce((sum, e) => sum + (e.monthly_amount || 0), 0);

  const calculatedMonthlyExpenditure =
    totalPropertyHoldingCosts + homeLoanRepayments + totalLiabilityRepayments + totalLivingExpenses;

  // Use calculated values, falling back to client record only if no source data exists
  const displayMonthlyIncome = calculatedMonthlyIncome > 0 ? calculatedMonthlyIncome : (client.total_monthly_income || 0);
  const displayMonthlyExpenditure = calculatedMonthlyExpenditure > 0 ? calculatedMonthlyExpenditure : (client.total_monthly_expenditure || 0);
  const displayNetCashFlow = displayMonthlyIncome - displayMonthlyExpenditure;

  // Properly capitalize client names
  const primaryName = `${smartCapitalize(client.primary_first_name)} ${smartCapitalize(client.primary_surname)}`;
  const secondaryName = client.secondary_first_name 
    ? `${smartCapitalize(client.secondary_first_name)} ${smartCapitalize(client.secondary_surname || client.primary_surname)}`
    : '';
  const clientFullName = secondaryName ? `${primaryName} & ${secondaryName}` : primaryName;
  
  // Calculate equity based on filtered properties (respects toggle setting)
  const summaryEquity = totalValue - totalLoans;

  // Check if secondary contact has any data
  const hasSecondaryContact = !!(
    client.secondary_first_name || client.secondary_surname || 
    client.secondary_middle_name || client.secondary_mobile || 
    client.secondary_email || client.secondary_gender || client.secondary_dob
  );

  // Check if owner occupied property has any meaningful data
  const hasOwnerOccupied = !!(
    ownerOccupied && (
      ownerOccupied.address || ownerOccupied.value || ownerOccupied.loan_remaining ||
      ownerOccupied.interest_rate || ownerOccupied.ownership_percentage ||
      ownerOccupied.monthly_interest_repayment || ownerOccupied.net_monthly_cashflow
    )
  );

  // Generate individual investment property pages HTML (one per page)
  const investmentPropertyPagesHTML = investmentPropertyPages.map((item, pageIndex) => `
    <!-- INVESTMENT PROPERTY PAGE ${pageIndex + 1} -->
    <div class="page-auto" data-property-page="true">
      <div class="page-header">
        <div class="header-title-group">
          <div class="header-title">Investment Property ${item.index}</div>
          <div class="header-subtitle">CLIENT PORTFOLIO FORM</div>
        </div>
      </div>
      <div class="page-content">
        <div class="property-page-content">
          ${generateInvestmentPropertyHTML(item.prop, item.index)}
        </div>
      </div>
    </div>
  `).join('');
  
  // Generate individual SMSF property pages HTML (one per page)
  const smsfPropertyPagesHTML = smsfPropertyPages.map((item, pageIndex) => `
    <!-- SMSF PROPERTY PAGE ${pageIndex + 1} -->
    <div class="page-auto" data-property-page="true">
      <div class="page-header">
        <div class="header-title-group">
          <div class="header-title">SMSF Property ${item.index}</div>
          <div class="header-subtitle">CLIENT PORTFOLIO FORM</div>
        </div>
      </div>
      <div class="page-content">
        <div class="property-page-content">
          ${generateSmsfPropertyHTML(item.prop, item.index)}
        </div>
      </div>
    </div>
  `).join('');
  
  // Combined property pages HTML
  const allPropertyPagesHTML = investmentPropertyPagesHTML + smsfPropertyPagesHTML;

  // Calculate page numbers for static pages
  // New order: Cover(no number) → Portfolio Summary(1) → Personal Details(2) → Properties → Employment → Assets → Disclaimer
  const propertyPagesCount = investmentPropertyPages.length + smsfPropertyPages.length;
  const summaryPageNumber = 1;
  const page1Number = 2;
  // Property pages start at page 3
  const employmentPageNumber = 3 + propertyPagesCount;
  const assetsPageNumber = 4 + propertyPagesCount;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        /* System font stack — no @import to avoid html2canvas hanging */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 9.5pt; line-height: 1.5; color: ${NPC_COLORS.black}; background: ${NPC_COLORS.white}; }
        
        /* Page Layout */
        .page { width: 794px; height: 1123px; background: ${NPC_COLORS.white}; position: relative; overflow: hidden; }
        .page-auto { width: 794px; min-height: 1123px; height: auto; background: ${NPC_COLORS.white}; position: relative; overflow: visible; }
        .page-content { padding: 30px 40px 80px; padding-top: 94px; }
        /* Keep cohesive blocks together when the auto-tiler picks a safe break */
        .section, .property-card, .summary-box, .kpi-card, .financial-table thead, .data-table thead { page-break-inside: avoid; break-inside: avoid; }
        .financial-table tr, .data-table tr { page-break-inside: avoid; break-inside: avoid; }
        
        /* Cover Page - Image Based */
        .cover-page-image { 
          background-size: cover; 
          background-position: center; 
          background-repeat: no-repeat;
          position: relative;
          transform: rotate(180deg);
        }
        .cover-page-image .cover-overlay {
          transform: rotate(180deg);
        }
        .cover-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }
        .cover-content-positioned {
          position: absolute;
          bottom: 180px;
          left: 0;
          right: 0;
          text-align: center;
        }
        .cover-doc-title-positioned {
          color: ${NPC_COLORS.white};
          font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif;
          font-size: 28pt;
          font-weight: 500;
          margin-bottom: 20px;
        }
        .cover-client-name-positioned {
          color: ${NPC_COLORS.gold};
          font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif;
          font-size: 16pt;
          font-weight: 600;
          letter-spacing: 3px;
          text-transform: uppercase;
          margin-bottom: 40px;
        }
        .cover-date-positioned {
          color: ${NPC_COLORS.white};
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
          font-size: 11pt;
          letter-spacing: 1px;
        }
        
        /* Final Page - Image Based */
        .final-page {
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
        }
        .cover-date { color: ${NPC_COLORS.goldLight}; font-size: 11pt; letter-spacing: 2px; }
        
        /* Page Header */
        .page-header { position: absolute; top: 0; left: 0; right: 0; height: 74px; background: linear-gradient(135deg, ${NPC_COLORS.darkBlue} 0%, ${NPC_COLORS.navy} 100%); display: flex; justify-content: flex-end; align-items: center; padding: 0 40px; }
        .page-header::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, ${NPC_COLORS.gold}, ${NPC_COLORS.goldLight}, ${NPC_COLORS.gold}); }
        .header-title-group { text-align: right; }
        .header-title { color: ${NPC_COLORS.white}; font-size: 13pt; font-weight: 600; letter-spacing: 0.3px; }
        .header-subtitle { color: ${NPC_COLORS.goldLight}; font-size: 8pt; letter-spacing: 1px; }
        
        /* Page Footer */
        .page-footer { position: absolute; bottom: 0; left: 0; right: 0; height: 52px; background: ${NPC_COLORS.lightGray}; border-top: 2px solid ${NPC_COLORS.borderGray}; display: flex; justify-content: space-between; align-items: center; padding: 0 40px; font-size: 8pt; color: #4a5568; }
        .footer-contact { display: flex; gap: 24px; }
        .footer-item { display: flex; align-items: center; gap: 6px; }
        .footer-confidential { font-size: 6pt; color: ${NPC_COLORS.gold}; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; }
        
        /* Section Headers - Enhanced readability */
        .section { margin-bottom: 20px; }
        .section-header { 
          background: linear-gradient(135deg, ${NPC_COLORS.darkBlue} 0%, ${NPC_COLORS.navy} 100%); 
          color: ${NPC_COLORS.white}; 
          padding: 16px 20px; 
          font-size: 10.5pt; 
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border-left: 4px solid ${NPC_COLORS.gold};
          border-radius: 0;
        }
        .section-header-text { display: flex; align-items: center; gap: 10px; }
        .section-header-text::before { content: ''; }
        .section-header.gold { 
          background: linear-gradient(135deg, ${NPC_COLORS.gold} 0%, ${NPC_COLORS.goldDark} 100%); 
          color: ${NPC_COLORS.black}; 
          border-left: 4px solid ${NPC_COLORS.darkBlue};
        }
        .section-header.gold .section-header-text::before { content: ''; }
        
        .subsection-header { 
          background: linear-gradient(90deg, ${NPC_COLORS.goldTint} 0%, ${NPC_COLORS.goldTint} 100%); 
          color: ${NPC_COLORS.darkGray}; 
          padding: 14px 20px; 
          font-size: 9.5pt; 
          font-weight: 600;
          border-left: 3px solid ${NPC_COLORS.gold};
          margin-top: 16px;
          margin-bottom: 12px;
        }
        
        /* Property Page Content - for individual property pages */
        .property-page-content {
          max-width: 680px;
          margin: 0 auto;
        }
        .property-page-content .property-card {
          margin-bottom: 0;
        }
        
        /* Property Cards */
        .property-card {
          border: 1px solid ${NPC_COLORS.borderGray};
          border-radius: 6px;
          margin-bottom: 14px;
          overflow: hidden;
          box-shadow: 0 2px 6px rgba(0,0,0,0.05);
        }
        .property-card .section-header { border-radius: 0; }
        .smsf-card { border: 2px solid ${NPC_COLORS.gold}; }
        
        /* Properties grid for overflow pages */
        .properties-grid {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        
        .property-address-bar {
          background: ${NPC_COLORS.lightGray};
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          border-bottom: 1px solid ${NPC_COLORS.borderGray};
        }
        .property-address-icon { 
          color: ${NPC_COLORS.gold}; 
          font-size: 10pt; 
          line-height: 1; 
        }
        .property-address-text { font-weight: 500; color: ${NPC_COLORS.darkGray}; font-size: 8.5pt; }
        
        /* Property Badges */
        .prop-badge {
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 6.5pt;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .prop-badge-owner { background: ${NPC_COLORS.goldLight}; color: ${NPC_COLORS.goldDark}; }
        .prop-badge-invest { background: #dbeafe; color: #1e40af; }
        .prop-badge-smsf { background: #fae8ff; color: #7e22ce; }
        
        /* Equity Progress Bar */
        .equity-display { padding: 10px 14px; background: ${NPC_COLORS.lightGray}; }
        .equity-bar-container {
          width: 100%;
          height: 18px;
          background: #e5e7eb;
          border-radius: 9px;
          position: relative;
          overflow: hidden;
        }
        .equity-bar {
          height: 100%;
          background: linear-gradient(90deg, ${NPC_COLORS.gold} 0%, ${NPC_COLORS.goldDark} 100%);
          border-radius: 9px;
          transition: width 0.3s ease;
        }
        .equity-label {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 7pt;
          font-weight: 600;
          color: ${NPC_COLORS.darkGray};
        }
        
        /* Cashflow Indicators */
        .cf-indicator { font-size: 11pt; margin-right: 6px; vertical-align: middle; }
        .cf-positive { color: ${NPC_COLORS.success}; }
        .cf-negative { color: ${NPC_COLORS.danger}; }
        .cf-neutral { color: ${NPC_COLORS.warning}; }
        
        .cashflow-row { font-weight: 600; }
        .cf-positive-row { background: ${NPC_COLORS.successLight} !important; }
        .cf-positive-row td { border-color: #86efac !important; }
        .cf-negative-row { background: ${NPC_COLORS.dangerLight} !important; }
        .cf-negative-row td { border-color: #fecaca !important; }
        
        /* Income Values Highlight */
        .income-value { color: ${NPC_COLORS.success}; font-weight: 500; }
        .expense-total { background: #fff7ed !important; }
        .expense-total td { border-top: 1px solid ${NPC_COLORS.warning}; font-weight: 600; }
        
        /* Two Column Layout */
        .two-columns { display: flex; gap: 24px; }
        .column { flex: 1; }
        .column-left { flex: 0.95; }
        .column-right { flex: 1.05; }
        
        /* Data Tables - Enhanced for better readability */
        .data-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; border: 1px solid ${NPC_COLORS.borderGray}; line-height: 1.6; }
        .data-table th { 
          background: linear-gradient(180deg, ${NPC_COLORS.darkGray} 0%, #1a202c 100%); 
          color: ${NPC_COLORS.white};
          border: 1px solid ${NPC_COLORS.mediumGray}; 
          padding: 12px 16px; 
          text-align: left; 
          font-weight: 600;
          font-size: 8pt;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .data-table td { border: 1px solid ${NPC_COLORS.borderGray}; padding: 14px 18px; vertical-align: middle; line-height: 1.5; }
        .data-table .label { 
          background: linear-gradient(90deg, ${NPC_COLORS.lightGray} 0%, #edf2f7 100%); 
          font-weight: 500; 
          width: 48%; 
          color: ${NPC_COLORS.darkGray}; 
          font-size: 9pt;
          letter-spacing: 0.1px;
        }
        .data-table .value { background: ${NPC_COLORS.white}; color: ${NPC_COLORS.black}; font-weight: 500; font-size: 9.5pt; }
        .data-table .currency { text-align: right; font-family: 'Inter', -apple-system, monospace; font-weight: 600; }
        .data-table .percent { text-align: right; }
        
        /* Alternating Rows */
        .data-table.alt-rows tr:nth-child(even) td.label { background: #f0f4f8; }
        .data-table.alt-rows tr:nth-child(even) td.value { background: #f5f7fa; }
        
        /* Compact Tables - still readable */
        .data-table.compact td { padding: 8px 14px; font-size: 8.5pt; line-height: 1.3; }
        
        /* Financial Mini Tables */
        .financial-mini { font-size: 7.5pt; }
        .financial-mini th { 
          background: linear-gradient(180deg, ${NPC_COLORS.navy} 0%, ${NPC_COLORS.darkBlue} 100%); 
          padding: 5px 8px;
          font-size: 6.5pt;
        }
        
        /* Compliance Badges */
        .compliance-badge {
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 7pt;
          font-weight: 600;
        }
        .compliance-badge.compliant { background: ${NPC_COLORS.successLight}; color: ${NPC_COLORS.success}; }
        .compliance-badge.non-compliant { background: ${NPC_COLORS.dangerLight}; color: ${NPC_COLORS.danger}; }
        .compliance-badge.pending { background: ${NPC_COLORS.warningLight}; color: ${NPC_COLORS.warning}; }
        
        .abn-code { 
          font-family: 'Courier New', monospace; 
          background: ${NPC_COLORS.lightGray}; 
          padding: 2px 6px; 
          border-radius: 3px;
          font-size: 8pt;
        }
        
        /* Info Cards - Enhanced readability */
        .info-card {
          border: 1px solid ${NPC_COLORS.borderGray};
          border-radius: 6px;
          overflow: hidden;
          margin-bottom: 12px;
        }
        .info-card-header {
          background: linear-gradient(90deg, ${NPC_COLORS.goldTint} 0%, ${NPC_COLORS.white} 100%);
          padding: 14px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          border-bottom: 1px solid ${NPC_COLORS.borderGray};
          border-left: 4px solid ${NPC_COLORS.gold};
          min-width: 0;
        }
        .employer-icon { 
          font-size: 16pt; 
          line-height: 1;
          flex: 0 0 auto;
        }
        .employer-name {
          font-weight: 600;
          color: ${NPC_COLORS.darkBlue};
          font-size: 10pt;
          flex: 1 1 auto;
          min-width: 0;
          overflow-wrap: anywhere;
          word-break: break-word;
          white-space: normal;
          line-height: 1.25;
        }
        .status-pill {
          flex: 0 0 auto;
          font-size: 6.5pt;
          font-weight: 700;
          letter-spacing: 0.4px;
          padding: 2px 8px;
          border-radius: 999px;
          text-transform: uppercase;
          color: #fff;
          white-space: nowrap;
          align-self: flex-start;
        }
        .status-pill-current { background: #16a34a; }
        .status-pill-previous { background: #94a3b8; }

        .emp-type-badge, .freq-badge {
          display: inline-block;
          background: ${NPC_COLORS.goldLight};
          color: ${NPC_COLORS.goldDark};
          padding: 3px 10px;
          border-radius: 10px;
          font-size: 7.5pt;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          white-space: nowrap;
          max-width: 100%;
          line-height: 1.25;
        }

        .provider-cell {
          white-space: normal;
          overflow-wrap: break-word;
          word-break: normal;
          hyphens: none;
          min-width: 110px;
          line-height: 1.3;
        }
        
        /* Empty State - Compact (neutral; never gold to avoid header-band drift) */
        .empty-state-compact {
          padding: 24px 16px;
          text-align: center;
          background: ${NPC_COLORS.lightGray};
          border-radius: 6px;
          border: 1px dashed ${NPC_COLORS.borderGray};
        }
        .empty-state-compact.primary {
          /* Subtle primary cue — soft tint without bleeding into card header palette */
          border-color: ${NPC_COLORS.borderGray};
          background: ${NPC_COLORS.lightGray};
        }
        .empty-state-icon {
          font-size: 20pt;
          margin-bottom: 8px;
          opacity: 0.7;
        }
        .empty-state-text {
          font-size: 9pt;
          color: ${NPC_COLORS.mediumGray};
          margin: 0;
        }
        
        /* Income Highlight - Better readability */
        .income-highlight {
          background: linear-gradient(135deg, ${NPC_COLORS.gold} 0%, ${NPC_COLORS.goldDark} 100%);
          padding: 10px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          border-radius: 6px;
        }
        .income-highlight-label { color: ${NPC_COLORS.white}; font-size: 8pt; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
        .income-highlight-value { color: ${NPC_COLORS.white}; font-size: 15pt; font-weight: 700; }
        
        /* Assets Summary */
        .assets-summary {
          background: linear-gradient(135deg, ${NPC_COLORS.goldTint} 0%, ${NPC_COLORS.goldTint} 100%);
          border: 2px solid ${NPC_COLORS.gold};
          padding: 14px 18px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 14px;
          border-radius: 6px;
        }
        .assets-summary-label { color: ${NPC_COLORS.darkGray}; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .assets-summary-value { color: ${NPC_COLORS.success}; font-size: 18pt; font-weight: 700; }
        
        .asset-category, .liability-category { margin-bottom: 12px; }
        
        /* Category Headers - Consistent styling with better readability */
        .asset-category-header, .liability-category-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: ${NPC_COLORS.lightGray};
          border-left: 3px solid ${NPC_COLORS.gold};
          margin-bottom: 6px;
          border-radius: 0 4px 4px 0;
        }
        .category-icon {
          font-size: 14pt;
        }
        .category-title {
          font-size: 9pt;
          font-weight: 600;
          color: ${NPC_COLORS.darkGray};
          text-transform: capitalize;
        }
        
        /* Asset Table specific styling */
        .asset-table td.label {
          width: 70%;
        }
        .asset-table td.value {
          width: 30%;
        }
        
        /* Liabilities Summary */
        .liabilities-summary {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 14px;
        }
        .liab-summary-item {
          background: ${NPC_COLORS.lightGray};
          padding: 14px 16px;
          border-radius: 6px;
          border-left: 4px solid ${NPC_COLORS.darkBlue};
        }
        .liab-label { display: block; font-size: 7.5pt; color: ${NPC_COLORS.mediumGray}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
        .liab-value { display: block; font-size: 18pt; font-weight: 700; color: ${NPC_COLORS.darkBlue}; }
        .liab-value.negative { color: ${NPC_COLORS.danger}; }
        
        /* Expenses Summary - Personal expenses like rent */
        .expenses-summary {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 14px;
        }
        .expense-summary-item {
          background: ${NPC_COLORS.lightGray};
          padding: 14px 16px;
          border-radius: 6px;
          border-left: 4px solid ${NPC_COLORS.warning};
        }
        .expense-label { display: block; font-size: 7.5pt; color: ${NPC_COLORS.mediumGray}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
        .expense-value { display: block; font-size: 18pt; font-weight: 700; color: ${NPC_COLORS.darkGray}; }
        .expense-value.negative { color: ${NPC_COLORS.warning}; }
        
        .expense-category { margin-bottom: 12px; }
        .expense-category-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: ${NPC_COLORS.warningLight};
          border-left: 3px solid ${NPC_COLORS.warning};
          margin-bottom: 6px;
          border-radius: 0 4px 4px 0;
        }
        
        /* Empty States */
        .empty-state {
          padding: 20px;
          text-align: center;
          background: ${NPC_COLORS.lightGray};
          border-radius: 6px;
          color: ${NPC_COLORS.mediumGray};
        }
        .empty-icon { font-size: 24pt; display: block; margin-bottom: 8px; opacity: 0.5; }
        .empty-state p { font-size: 8pt; }
        
        /* Summary Box - Gold Accent */
        .summary-box { 
          border: 2px solid ${NPC_COLORS.gold}; 
          background: linear-gradient(135deg, ${NPC_COLORS.goldTint} 0%, ${NPC_COLORS.goldTint} 100%);
          padding: 18px; 
          margin-top: 16px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(201, 162, 39, 0.15);
        }
        .summary-title { 
          font-weight: 700; 
          color: ${NPC_COLORS.darkBlue}; 
          margin-bottom: 14px; 
          font-size: 11pt; 
          display: flex;
          align-items: center;
          gap: 8px;
          padding-bottom: 10px;
          border-bottom: 1px solid ${NPC_COLORS.goldLight};
        }
        .summary-title::before { content: ''; }
        
        /* Financial Table - Better readability */
        .financial-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; border: 1px solid ${NPC_COLORS.borderGray}; border-radius: 4px; overflow: hidden; line-height: 1.5; }
        .financial-table th { 
          background: linear-gradient(180deg, ${NPC_COLORS.darkBlue} 0%, ${NPC_COLORS.navy} 100%); 
          color: ${NPC_COLORS.white}; 
          padding: 14px 16px; 
          text-align: left;
          font-weight: 600;
          font-size: 8pt;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .financial-table td { border: 1px solid ${NPC_COLORS.borderGray}; padding: 12px 14px; font-size: 9.5pt; }
        .financial-table tbody tr:nth-child(odd) { background: ${NPC_COLORS.white}; }
        .financial-table tbody tr:nth-child(even) { background: #f0f4f8; }
        .financial-table .total-row { 
          background: linear-gradient(90deg, ${NPC_COLORS.goldLight} 0%, ${NPC_COLORS.goldTint} 100%) !important; 
          font-weight: 700; 
        }
        .financial-table .total-row td { 
          border-top: 2px solid ${NPC_COLORS.gold}; 
          font-size: 10.5pt;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.2px;
        }
        /* Keep all currency cells tabular so commas render as crisp commas under rasterisation */
        .financial-table td.currency, .financial-table .value.currency, .data-table .value.currency, .kpi-value {
          font-variant-numeric: tabular-nums;
        }
        
        /* KPI Cards - Premium glass-card aesthetic */
        .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-bottom: 24px; }
        .kpi-card {
          position: relative;
          background:
            radial-gradient(120% 90% at 100% 0%, rgba(201,162,39,0.10) 0%, rgba(201,162,39,0) 55%),
            linear-gradient(160deg, #ffffff 0%, #f7f9fc 100%);
          border: 1px solid #e6eaf0;
          border-left: 5px solid ${NPC_COLORS.gold};
          padding: 20px 22px 22px;
          border-radius: 10px;
          box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 6px 18px -8px rgba(15,23,42,0.18), 0 2px 4px rgba(15,23,42,0.05);
          overflow: hidden;
        }
        .kpi-card::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 2px;
          background: linear-gradient(90deg, ${NPC_COLORS.gold}, ${NPC_COLORS.goldLight}, transparent);
          opacity: 0.6;
        }
        .kpi-icon {
          font-size: 24pt;
          margin-bottom: 10px;
          display: block;
          line-height: 1;
          filter: drop-shadow(0 2px 4px rgba(15,23,42,0.10));
        }
        .kpi-label { font-size: 7.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 10px; font-weight: 700; }
        .kpi-value { font-size: 22pt; font-weight: 800; color: ${NPC_COLORS.darkBlue}; letter-spacing: -0.5px; line-height: 1.1; }
        .kpi-value.positive { color: ${NPC_COLORS.success}; }
        .kpi-value.negative { color: ${NPC_COLORS.danger}; }
        .kpi-trend { font-size: 8.5pt; color: ${NPC_COLORS.mediumGray}; margin-top: 8px; }
        .kpi-trend.up { color: ${NPC_COLORS.success}; }
        .kpi-trend.down { color: ${NPC_COLORS.danger}; }
        
        /* Gold Divider */
        .gold-divider {
          height: 2px;
          background: linear-gradient(90deg, transparent 0%, ${NPC_COLORS.gold} 50%, transparent 100%);
          margin: 16px 0;
        }
        
        /* Utility Classes */
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .font-bold { font-weight: 700; }
        .text-green { color: ${NPC_COLORS.success}; }
        .text-red { color: ${NPC_COLORS.danger}; }
        .mt-2 { margin-top: 12px; }
        
        /* Properties Overview Table - Smart column sizing */
        .property-address-cell { 
          max-width: 200px; 
          word-wrap: break-word; 
          font-size: 8pt;
        }
        .compact-col { 
          white-space: nowrap; 
          font-size: 8pt;
          padding: 8px 6px !important;
        }
        .financial-table th:first-child { width: 40%; }
        .financial-table th:not(:first-child) { width: 15%; }
      </style>
    </head>
    <body>
      <!-- COVER PAGE - Using exact template image -->
      <div class="page cover-page-image" style="background-image: url('/templates/npc-formara-cover.jpg'); background-size: cover; background-position: center;">
        <!-- Overlay content positioned on the template -->
        <div class="cover-overlay">
          <div class="cover-content-positioned">
            <div class="cover-doc-title-positioned">Client Portfolio Form</div>
            <div class="cover-client-name-positioned">${clientFullName}</div>
            <div class="cover-date-positioned">${reportDate}</div>
          </div>
        </div>
      </div>
      
      <!-- PAGE 1: Portfolio Summary (immediately after cover) -->
      <div class="page-auto" data-content-page="true">
        <div class="page-header">
          <div class="header-title-group">
            <div class="header-title">Portfolio Summary</div>
            <div class="header-subtitle">CLIENT PORTFOLIO FORM</div>
          </div>
        </div>
        <div class="page-content">
          ${(() => {
            // Compute non-property assets and non-property liabilities for true Net Worth
            const nonPropertyAssetsTotal = (assets || []).reduce((sum, a) => {
              const t = (a.asset_type || '').toLowerCase();
              const isCreditCard = t.includes('credit') || t.includes('card');
              return isCreditCard ? sum : sum + (a.value || 0);
            }, 0);
            const nonPropertyLiabilitiesTotal = (liabilities || []).reduce((sum, l) => sum + (l.current_balance || 0), 0);
            const netWorth = summaryEquity + nonPropertyAssetsTotal - nonPropertyLiabilitiesTotal;
            return `
          <div class="kpi-grid">
            <div class="kpi-card">
              <span class="kpi-icon">🏠</span>
              <div class="kpi-label">TOTAL PORTFOLIO VALUE</div>
              <div class="kpi-value">${formatCurrency(totalValue)}</div>
            </div>
            <div class="kpi-card">
              <span class="kpi-icon">💳</span>
              <div class="kpi-label">TOTAL DEBT</div>
              <div class="kpi-value">${formatCurrency(totalLoans)}</div>
            </div>
            <div class="kpi-card">
              <span class="kpi-icon">📈</span>
              <div class="kpi-label">PORTFOLIO EQUITY</div>
              <div class="kpi-value ${summaryEquity >= 0 ? 'positive' : 'negative'}">${formatCurrency(summaryEquity)}</div>
            </div>
          </div>
          <div class="kpi-grid" style="margin-top:10px;">
            <div class="kpi-card">
              <span class="kpi-icon">💎</span>
              <div class="kpi-label">OTHER ASSETS</div>
              <div class="kpi-value">${formatCurrency(nonPropertyAssetsTotal)}</div>
            </div>
            <div class="kpi-card">
              <span class="kpi-icon">📉</span>
              <div class="kpi-label">OTHER LIABILITIES</div>
              <div class="kpi-value">${formatCurrency(nonPropertyLiabilitiesTotal)}</div>
            </div>
            <div class="kpi-card">
              <span class="kpi-icon">🧮</span>
              <div class="kpi-label">ESTIMATED NET WORTH</div>
              <div class="kpi-value ${netWorth >= 0 ? 'positive' : 'negative'}">${formatCurrency(netWorth)}</div>
            </div>
          </div>`;
          })()}
          
          <div class="summary-box">
            <div class="summary-title">📊 Monthly Cashflow Analysis</div>
            <table class="data-table alt-rows compact">
              <tr style="background: #f0fdf4;">
                <td class="label" colspan="2" style="font-weight:700; color: ${NPC_COLORS.success}; font-size:8pt; text-transform:uppercase; letter-spacing:0.5px; padding:6px 10px;">Income</td>
              </tr>
              <tr><td class="label" style="padding-left:20px;">Employment Income${secondaryEmploymentIncome > 0 ? ' <span style="color:#9ca3af; font-weight:400; font-size:7pt;">(Primary)</span>' : ''}</td><td class="value currency income-value">${formatCurrency(Math.round(primaryEmploymentIncome))}</td></tr>
              ${secondaryEmploymentIncome > 0 ? `<tr><td class="label" style="padding-left:20px;">Employment Income <span style="color:#9ca3af; font-weight:400; font-size:7pt;">(Secondary)</span></td><td class="value currency income-value">${formatCurrency(Math.round(secondaryEmploymentIncome))}</td></tr>` : ''}
              <tr><td class="label" style="padding-left:20px;">Rental Income</td><td class="value currency income-value">${formatCurrency(Math.round(totalRental))}</td></tr>
              ${otherIncomeBreakdown.map((s) => `<tr><td class="label" style="padding-left:20px;">${s.label}</td><td class="value currency income-value">${formatCurrency(Math.round(s.monthly))}</td></tr>`).join('')}
              <tr style="border-top: 1px solid #d1d5db;"><td class="label"><strong>Total Monthly Income</strong></td><td class="value currency income-value"><strong>${formatCurrency(Math.round(displayMonthlyIncome))}</strong></td></tr>
              
              <tr style="background: #fef2f2;">
                <td class="label" colspan="2" style="font-weight:700; color: ${NPC_COLORS.danger}; font-size:8pt; text-transform:uppercase; letter-spacing:0.5px; padding:6px 10px;">Expenditure</td>
              </tr>
              ${homeLoanRepayments > 0 ? `<tr><td class="label" style="padding-left:20px;">Home Loan Repayments</td><td class="value currency">${formatCurrency(Math.round(homeLoanRepayments))}</td></tr>` : ''}
              ${totalPropertyHoldingCosts > 0
                ? `<tr><td class="label" style="padding-left:20px;">Property Holding Costs${propertyExpenditure.investmentHoldingCosts > 0 ? ' <span style="color:#9ca3af; font-weight:400; font-size:7pt;">(incl. investment loan interest)</span>' : ''}</td><td class="value currency">${formatCurrency(Math.round(totalPropertyHoldingCosts))}</td></tr>`
                : ''}
              ${totalLiabilityRepayments > 0
                ? `<tr><td class="label" style="padding-left:20px;">Liability Repayments${hasEstimatedLiabilities ? ' <span style="color:#9ca3af; font-weight:400; font-size:7pt;">(3% min. estimate on cards)</span>' : ''}</td><td class="value currency">${formatCurrency(Math.round(totalLiabilityRepayments))}</td></tr>`
                : (hasAnyLiability
                    ? `<tr><td class="label" style="padding-left:20px; color: #9ca3af; font-style:italic;">Liability Repayments</td><td class="value" style="color:#9ca3af; font-style:italic; font-size:8pt;">Recorded with $0 monthly</td></tr>`
                    : '')}
              ${totalLivingExpenses > 0
                ? `<tr><td class="label" style="padding-left:20px;">Living Expenses</td><td class="value currency">${formatCurrency(Math.round(totalLivingExpenses))}</td></tr>`
                : `<tr><td class="label" style="padding-left:20px; color: #9ca3af; font-style:italic;">Living Expenses</td><td class="value" style="color:#9ca3af; font-style:italic; font-size:8pt;">Not recorded</td></tr>`}
              <tr style="border-top: 1px solid #d1d5db;"><td class="label"><strong>Total Monthly Expenditure</strong></td><td class="value currency"><strong>${formatCurrency(Math.round(displayMonthlyExpenditure))}</strong></td></tr>
              
              <tr class="cashflow-row ${displayNetCashFlow >= 0 ? 'cf-positive-row' : 'cf-negative-row'}">
                <td class="label"><strong>Net Monthly Cash Flow</strong></td>
                <td class="value currency">
                  ${getCashflowIndicator(displayNetCashFlow)}
                  <strong>${formatCurrency(Math.round(displayNetCashFlow))}</strong>
                </td>
              </tr>
            </table>
            ${totalLivingExpenses === 0 ? `<div style="font-size:7pt; color:#9ca3af; margin-top:4px; padding-left:4px; font-style:italic;">⚠ Living expenses not yet recorded — net cash flow reflects property & liability commitments only and will overstate true surplus.</div>` : ''}
          </div>
          
          <div class="section" style="margin-top: 20px;">
            <div class="section-header gold">Properties Overview</div>
            <table class="financial-table">
              <thead>
                <tr>
                  <th>PROPERTY</th>
                  <th class="text-right">VALUE</th>
                  <th class="text-right">LOAN</th>
                  <th class="text-right">RENTAL</th>
                  <th class="text-right">NET CF</th>
                </tr>
              </thead>
              <tbody>
                ${propertiesSummaryRows}
              </tbody>
              <tfoot>
                <tr class="total-row">
                  <td><strong>TOTAL</strong></td>
                  <td class="text-right">${formatCurrency(totalValue)}</td>
                  <td class="text-right">${formatCurrency(totalLoans)}</td>
                  <td class="text-right">${formatCurrency(totalRental)}</td>
                  <td class="text-right ${totalNetCF >= 0 ? 'text-green' : 'text-red'}">${formatCurrency(totalNetCF)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
      
      
      <!-- PAGE 2: Personal Details & Properties -->
      <div class="page-auto" data-content-page="true">
        <div class="page-header">
          <div class="header-title-group">
            <div class="header-title">Personal Details</div>
            <div class="header-subtitle">CLIENT PORTFOLIO FORM</div>
          </div>
        </div>
        <div class="page-content">
          <div class="two-columns" style="align-items: flex-start;">
            <div class="column column-left">
              <div class="section">
                <div class="section-header gold">Primary Contact</div>
                <table class="data-table">
                  <tr><td class="label">First name</td><td class="value">${smartCapitalize(client.primary_first_name) || '-'}</td></tr>
                  <tr><td class="label">Middle name</td><td class="value">${smartCapitalize(client.primary_middle_name) || '-'}</td></tr>
                  <tr><td class="label">Surname</td><td class="value">${smartCapitalize(client.primary_surname) || '-'}</td></tr>
                  <tr><td class="label">Mobile</td><td class="value">${client.primary_mobile || '-'}</td></tr>
                  <tr><td class="label">Email</td><td class="value">${client.primary_email || '-'}</td></tr>
                  <tr><td class="label">Gender</td><td class="value">${enumOrNotRecorded(client.primary_gender)}</td></tr>
                  <tr><td class="label">Date of Birth</td><td class="value">${formatDate(client.primary_dob)}</td></tr>
                </table>
              </div>
              ${hasSecondaryContact ? `
              <div class="section">
                <div class="section-header">Secondary Contact</div>
                <table class="data-table">
                  <tr><td class="label">First name</td><td class="value">${smartCapitalize(client.secondary_first_name) || '-'}</td></tr>
                  <tr><td class="label">Middle name</td><td class="value">${smartCapitalize(client.secondary_middle_name) || '-'}</td></tr>
                  <tr><td class="label">Surname</td><td class="value">${smartCapitalize(client.secondary_surname) || '-'}</td></tr>
                  <tr><td class="label">Mobile</td><td class="value">${client.secondary_mobile || '-'}</td></tr>
                  <tr><td class="label">Email</td><td class="value">${client.secondary_email || '-'}</td></tr>
                  <tr><td class="label">Gender</td><td class="value">${enumOrNotRecorded(client.secondary_gender)}</td></tr>
                  <tr><td class="label">Date of Birth</td><td class="value">${formatDate(client.secondary_dob)}</td></tr>
                </table>
              </div>
              ` : ''}
            </div>
            <div class="column column-right">
              <div class="section">
                <div class="section-header gold">Primary — Address & Status</div>
                <table class="data-table">
                  <tr><td class="label">Current address</td><td class="value">${(() => {
                    const formatted = formatAUAddress(client.current_address, client.current_suburb, client.current_state, client.current_postcode);
                    if (formatted !== '-') return formatted;
                    // Fall back to owner-occupied property address when the clients row is incomplete
                    if (client.living_situation && /mortgage|own/i.test(client.living_situation) && ownerOccupied?.address) {
                      return ownerOccupied.address;
                    }
                    return '-';
                  })()}</td></tr>
                  <tr><td class="label">Country</td><td class="value">${formatCountry(client.country)}</td></tr>
                  <tr><td class="label">Living Situation</td><td class="value">${enumOrNotRecorded(client.living_situation)}</td></tr>
                  <tr><td class="label">Residential status</td><td class="value">${enumOrNotRecorded(client.residential_status)}</td></tr>
                  <tr><td class="label">Marital status</td><td class="value">${enumOrNotRecorded(client.marital_status)}</td></tr>
                  <tr><td class="label">Number of dependents</td><td class="value">${client.dependents_count ?? 0}</td></tr>
                </table>
              </div>
              ${hasSecondaryContact ? `
              <div class="section">
                <div class="section-header">Secondary — Address & Status</div>
                <table class="data-table">
                  <tr><td class="label">Current address</td><td class="value">${(() => {
                    if (client.secondary_same_address_as_primary) {
                      return '<span style="color:#6b7280;font-style:italic;">Same as primary</span>';
                    }
                    const sec = formatAUAddress(client.secondary_current_address, client.secondary_current_suburb, client.secondary_current_state, client.secondary_current_postcode);
                    if (sec !== '-') return escapeHtml(sec);
                    return '<span style="color:#9ca3af;font-style:italic;">Not recorded</span>';
                  })()}</td></tr>
                  <tr><td class="label">Country</td><td class="value">${escapeHtml(formatCountry(client.secondary_country || client.country))}</td></tr>
                  <tr><td class="label">Living Situation</td><td class="value">${escapeHtml(enumOrNotRecorded(client.secondary_living_situation || client.living_situation))}</td></tr>
                  <tr><td class="label">Residential status</td><td class="value">${escapeHtml(enumOrNotRecorded(client.secondary_residential_status))}</td></tr>
                </table>
              </div>
              ` : ''}
              ${hasOwnerOccupied ? `
              <div class="section">
                <div class="section-header">Property (Owner Occupied)</div>
                <table class="data-table">
                  <tr><td class="label">Address</td><td class="value">${ownerOccupied?.address || '-'}</td></tr>
                  <tr><td class="label">Value</td><td class="value currency">${formatCurrency(ownerOccupied?.value)}</td></tr>
                  <tr><td class="label">Loan Remaining ($)</td><td class="value currency">${formatCurrency(ownerOccupied?.loan_remaining)}</td></tr>
                  <tr><td class="label">Interest Rate (%)</td><td class="value percent">${formatPercent(ownerOccupied?.interest_rate)}</td></tr>
                  <tr><td class="label">Ownership (%)</td><td class="value percent">${formatPercent(ownerOccupied?.ownership_percentage)}</td></tr>
                  <tr><td class="label">Lender / Bank</td><td class="value">${textOrNotRecorded(ownerOccupied?.lender_name)}</td></tr>
                  <tr><td class="label">Purchase Price</td><td class="value currency">${currencyOrNotRecorded(ownerOccupied?.purchase_price)}</td></tr>
                  <tr><td class="label">Loan Repayment</td><td class="value currency">${ownerOccupied?.loan_repayment_amount ? `${formatCurrency(ownerOccupied.loan_repayment_amount)} <span style="font-size:7px;color:#999">(${ownerOccupied.loan_repayment_frequency || 'monthly'})</span>` : NOT_RECORDED}</td></tr>
                  <tr><td class="label">Repayment Type</td><td class="value">${enumOrNotRecorded(ownerOccupied?.repayment_type)}</td></tr>
                  <tr><td class="label">Monthly Interest Repayment</td><td class="value currency">${formatCurrency(ownerOccupied?.monthly_interest_repayment)}</td></tr>
                  <tr><td class="label">Net Monthly Cashflow</td><td class="value currency">${formatCurrency(ownerOccupied?.net_monthly_cashflow)}</td></tr>
                </table>
              </div>
              ` : ''}
            </div>
          </div>
        </div>
        
      </div>
      
      ${allPropertyPagesHTML}
      
      <!-- Employment & Income -->
      <div class="page-auto" data-content-page="true">
        <div class="page-header">
          <div class="header-title-group">
            <div class="header-title">Employment & Income</div>
            <div class="header-subtitle">CLIENT PORTFOLIO FORM</div>
          </div>
        </div>
        <div class="page-content">
          <div class="two-columns" style="align-items: flex-start;">
            <div class="column">
              <div class="section" style="margin-bottom: 20px;">
                <div class="section-header gold">Primary Contact - Employment</div>
                ${generateEmploymentTable(primaryEmployment, true)}
              </div>
              <div class="section">
                <div class="section-header">Secondary Contact - Employment</div>
                ${generateEmploymentTable(secondaryEmployment, false)}
              </div>
            </div>
            <div class="column">
              <div class="section" style="margin-bottom: 20px;">
                <div class="section-header gold">Primary Contact - Income</div>
                ${generateIncomeTable(primaryIncome)}
              </div>
              <div class="section">
                <div class="section-header">Secondary Contact - Income</div>
                ${generateIncomeTable(secondaryIncome)}
              </div>
            </div>
          </div>
        </div>
        
      </div>
      
      <!-- Assets, Liabilities & Expenses -->
      <div class="page-auto" data-content-page="true">
        <div class="page-header">
          <div class="header-title-group">
            <div class="header-title">Assets, Liabilities & Expenses</div>
            <div class="header-subtitle">CLIENT PORTFOLIO FORM</div>
          </div>
        </div>
        <div class="page-content">
          <div class="two-columns">
            <div class="column">
              <div class="section">
                <div class="section-header gold">Assets</div>
                ${generateAssetsTable()}
              </div>
            </div>
            <div class="column">
              <div class="section" style="margin-bottom: 20px;">
                <div class="section-header">Liabilities</div>
                ${generateLiabilitiesTable()}
              </div>
              <div class="section">
                <div class="section-header" style="background: linear-gradient(135deg, ${NPC_COLORS.warning} 0%, ${NPC_COLORS.goldDark} 100%); border-left-color: ${NPC_COLORS.darkBlue};">
                  <span class="section-header-text">💸 Personal Expenses</span>
                </div>
                ${generateExpensesTable()}
              </div>
            </div>
          </div>
        </div>
        
      </div>


      
      <!-- FINAL PAGE - Contact & Disclaimer -->
      <div class="page final-page" style="background-color: #141414; display: flex; flex-direction: column; justify-content: flex-start; padding: 60px 40px;">
        <div style="color: ${NPC_COLORS.goldDark}; font-size: 28px; font-weight: bold; text-transform: uppercase; margin-bottom: 4px;">${_companyLine1}</div>
        ${_companyLine2 ? `<div style="color: ${NPC_COLORS.goldDark}; font-size: 16px; font-weight: normal; text-transform: uppercase; margin-bottom: 30px;">${_companyLine2}</div>` : '<div style="margin-bottom: 30px;"></div>'}
        
        <div style="color: ${NPC_COLORS.goldDark}; font-size: 14px; font-weight: bold; margin-bottom: 20px;">CONTACT US</div>
        
        <table style="border-collapse: collapse; margin-bottom: auto;">
          ${_website ? `<tr style="height: 28px;"><td style="color: ${NPC_COLORS.goldDark}; font-size: 9px; font-weight: bold; padding-right: 20px; white-space: nowrap;">WEBSITE:</td><td style="color: ${NPC_COLORS.goldDark}; font-size: 9px;">${_website}</td></tr>` : ''}
          ${_email ? `<tr style="height: 28px;"><td style="color: ${NPC_COLORS.goldDark}; font-size: 9px; font-weight: bold; padding-right: 20px; white-space: nowrap;">EMAIL:</td><td style="color: ${NPC_COLORS.goldDark}; font-size: 9px;">${_email}</td></tr>` : ''}
          ${_phone ? `<tr style="height: 28px;"><td style="color: ${NPC_COLORS.goldDark}; font-size: 9px; font-weight: bold; padding-right: 20px; white-space: nowrap;">PHONE:</td><td style="color: ${NPC_COLORS.goldDark}; font-size: 9px;">${_phone}</td></tr>` : ''}
          ${_address ? `<tr style="height: 28px;"><td style="color: ${NPC_COLORS.goldDark}; font-size: 9px; font-weight: bold; padding-right: 20px; white-space: nowrap;">ADDRESS:</td><td style="color: ${NPC_COLORS.goldDark}; font-size: 9px;">${_address}</td></tr>` : ''}
          ${_abn ? `<tr style="height: 28px;"><td style="color: ${NPC_COLORS.goldDark}; font-size: 9px; font-weight: bold; padding-right: 20px; white-space: nowrap;">ABN:</td><td style="color: ${NPC_COLORS.goldDark}; font-size: 9px;">${_abn}</td></tr>` : ''}
        </table>
        
        ${_disclaimerText ? `<div style="color: #999999; font-size: 8.5px; line-height: 1.4; margin-top: auto; padding-bottom: 20px;">
          ${_disclaimerText}
        </div>` : ''}
      </div>
    </body>
    </html>
  `;
}
