import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { buildResimacRates, RESIMAC_LENDER } from './resimacRates.ts';
import { isSafeCdrUrl } from './cdrUrlSafety.ts';
import { internalError } from '../_shared/errorResponse.ts';

// ============================================
// MANUAL (non-CDR) lender registry
// Resimac, Pepper, Liberty, etc. don't expose CDR APIs — rates are
// hardcoded from the broker rate cards and refreshed manually.
// ============================================
const MANUAL_LENDERS: Record<string, { name: string; logo?: string; build: () => any[] }> = {
  resimac: { name: RESIMAC_LENDER.name, logo: RESIMAC_LENDER.logo, build: buildResimacRates },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
};

// ============================================
// CDR DATA HOLDER ENDPOINTS
// Each bank has specific API version requirements
// ============================================
// Authoritative CDR PublicBaseUri values (sourced from the public AU Open Banking
// registry, cross-checked against each data-holder's published developer docs).
// productVersion "4" — /banking/products has been on v4 since Oct 2024; older
// versions now return 406 on most holders. Product detail is now v6 for most
// holders; calling detail with v4 returns 406 and produces 0 cached rates.
const CDR_LENDERS: Record<string, { name: string; baseUrl: string; logo?: string; productVersion: string; detailVersion: string }> = {
  macquarie: {
    name: "Macquarie Bank",
    baseUrl: "https://api.macquariebank.io/cds-au/v1",
    logo: "https://www.macquarie.com/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  boq: {
    name: "Bank of Queensland",
    baseUrl: "https://api.cds.boq.com.au/cds-au/v1",
    logo: "https://www.boq.com.au/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  amp: {
    name: "AMP",
    baseUrl: "https://api.cdr-api.amp.com.au/cds-au/v1",
    logo: "https://www.amp.com.au/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  bendigo: {
    name: "Bendigo Bank",
    baseUrl: "https://api.cdr.bendigobank.com.au/cds-au/v1",
    logo: "https://www.bendigobank.com.au/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  bankwest: {
    name: "Bankwest",
    baseUrl: "https://open-api.bankwest.com.au/bwpublic/cds-au/v1",
    logo: "https://www.bankwest.com.au/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  westpac: {
    name: "Westpac",
    baseUrl: "https://digital-api.westpac.com.au/cds-au/v1",
    logo: "https://www.westpac.com.au/etc/designs/westpac/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  banksa: {
    name: "BankSA",
    baseUrl: "https://digital-api.banksa.com.au/cds-au/v1",
    logo: "https://www.banksa.com.au/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  stgeorge: {
    name: "St.George",
    baseUrl: "https://digital-api.stgeorge.com.au/cds-au/v1",
    logo: "https://www.stgeorge.com.au/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  cba: {
    name: "Commonwealth Bank",
    baseUrl: "https://api.commbank.com.au/public/cds-au/v1",
    logo: "https://www.commbank.com.au/etc/designs/default/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  nab: {
    name: "NAB",
    baseUrl: "https://openbank.api.nab.com.au/cds-au/v1",
    logo: "https://www.nab.com.au/etc/designs/nab/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  anz: {
    name: "ANZ",
    baseUrl: "https://api.anz/cds-au/v1",
    logo: "https://www.anz.com.au/etc/designs/commons/images/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  ing: {
    name: "ING",
    baseUrl: "https://id.ob.ing.com.au/cds-au/v1",
    logo: "https://www.ing.com.au/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  suncorp: {
    name: "Suncorp",
    baseUrl: "https://id-ob.suncorpbank.com.au/cds-au/v1",
    logo: "https://www.suncorp.com.au/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  hsbc: {
    name: "HSBC Australia",
    baseUrl: "https://public.ob.hsbc.com.au/cds-au/v1",
    logo: "https://www.hsbc.com.au/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  },
  ubank: {
    name: "UBank",
    baseUrl: "https://public.cdr-api.86400.com.au/cds-au/v1",
    logo: "https://www.ubank.com.au/favicon.ico",
    productVersion: "4",
    detailVersion: "6"
  }
};

// Historical/alternate hosts retained as secondary fallback only.
const BASE_URL_FALLBACKS: Record<string, string[]> = {
  boq: ["https://secure.api.boq.com.au/cds-au/v1"],
  amp: ["https://pub.cdr-sme.amp.com.au/api/cds-au/v1"],
  anz: ["https://api.anz.com/cds-au/v1"],
  hsbc: ["https://ob.hsbc.com.au/cds-au/v1"],
  ubank: ["https://ob.ubank.com.au/cds-au/v1", "https://openbank.api.nab.com.au/cds-au/v1"],
  ing: ["https://openbanking.api.ing.com.au/cds-au/v1"],
};

const REGISTER_BRAND_MATCHES: Record<string, string[]> = {
  macquarie: ['macquarie bank'], boq: ['bank of queensland'], amp: ['amp - my amp', 'amp bank go'],
  bendigo: ['bendigo bank'], bankwest: ['bankwest'], westpac: ['westpac'], banksa: ['banksa'],
  stgeorge: ['st.george'], cba: ['commonwealth bank'], nab: ['nab'], anz: ['anz'], ing: ['ing bank'],
  suncorp: ['suncorp bank'], hsbc: ['hsbc'], ubank: ['ubank'],
};

let registerBrandsCache: any[] | null = null;
let registerBrandsCacheAt = 0;

async function fetchRegisterBaseUrls(lenderId: string): Promise<string[]> {
  try {
    if (!registerBrandsCache || Date.now() - registerBrandsCacheAt > 60 * 60 * 1000) {
      const response = await fetch('https://api.cdr.gov.au/cdr-register/v1/banking/data-holders/brands/summary', {
        headers: { 'x-v': '2', 'x-min-v': '1', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; NPCFinancePortal/1.0)' },
      });
      if (!response.ok) return [];
      const payload = await response.json();
      registerBrandsCache = (payload?.data || []) as any[];
      registerBrandsCacheAt = Date.now();
    }
    const matches = REGISTER_BRAND_MATCHES[lenderId] || [];
    return registerBrandsCache
      .filter((b) => matches.some((m) => String(b.brandName || '').toLowerCase().includes(m)))
      .map((b) => String(b.publicBaseUri || '').replace(/\/$/, ''))
      .filter(Boolean)
      .map((base) => base.endsWith('/cds-au/v1') ? base : `${base}/cds-au/v1`)
      .filter((base) => isSafeCdrUrl(base, false));
  } catch (e) {
    console.warn(`[CDR] Register lookup failed for ${lenderId}:`, e);
    return [];
  }
}


// Manual redirect-following fetch.
// Many CDR data holders return 301/308 from their published baseUrl to a new
// host. Deno's default fetch DOES follow redirects, but some holders return
// a 301 with no Location, or to a host that strips required headers — we do
// it manually so we (a) preserve x-v/x-min-v across hops and (b) capture the
// final URL + Location header for diagnostics.
async function fetchCdr(
  url: string,
  headers: Record<string, string>,
  maxRedirects = 5
): Promise<{ response: Response | null; finalUrl: string; redirectChain: string[]; lastStatus: number; error?: string }> {
  const chain: string[] = [];
  let currentUrl = url;
  for (let i = 0; i <= maxRedirects; i++) {
    chain.push(currentUrl);
    if (!isSafeCdrUrl(currentUrl)) {
      return { response: null, finalUrl: currentUrl, redirectChain: chain, lastStatus: 0, error: 'Unsafe CDR URL rejected' };
    }
    try {
      const requestHeaders = {
        'User-Agent': 'Mozilla/5.0 (compatible; NPCFinancePortal/1.0; +https://npcservices.com.au)',
        ...headers,
      };
      let res = await fetch(currentUrl, { headers: requestHeaders, redirect: 'manual' });
      for (let attempt = 1; attempt <= 2 && [429, 500, 502, 503, 504].includes(res.status); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        res = await fetch(currentUrl, { headers: requestHeaders, redirect: 'manual' });
      }
      // Manual redirect: status 0 in some runtimes, or 301/302/303/307/308
      if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
        const loc = res.headers.get('location');
        if (!loc) {
          return { response: res, finalUrl: currentUrl, redirectChain: chain, lastStatus: res.status, error: `${res.status} with no Location header` };
        }
        // Resolve relative redirects
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }
      return { response: res, finalUrl: currentUrl, redirectChain: chain, lastStatus: res.status };
    } catch (e: any) {
      return { response: null, finalUrl: currentUrl, redirectChain: chain, lastStatus: 0, error: e?.message || String(e) };
    }
  }
  return { response: null, finalUrl: currentUrl, redirectChain: chain, lastStatus: 0, error: `Too many redirects (>${maxRedirects})` };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface LendingRate {
  lenderId: string;
  lenderName: string;
  productId: string;
  productName: string;
  rate: number;
  comparisonRate: number | null;
  rateType: 'FIXED' | 'VARIABLE';
  loanPurpose: 'OWNER_OCCUPIED' | 'INVESTMENT';
  repaymentType: 'PRINCIPAL_AND_INTEREST' | 'INTEREST_ONLY';
  lvrMin: number | null;
  lvrMax: number | null;
  minLoanAmount: number | null;
  maxLoanAmount: number | null;
  features: string[];
  lastUpdated: string;
}

interface CacheEntry {
  lenderId: string;
  rates: LendingRate[];
  fetchedAt: string;
  expiresAt: string;
}

async function fetchProductDetail(
  lenderId: string,
  baseUrl: string,
  product: any,
  detailVersion: string
): Promise<LendingRate[]> {
  const rates: LendingRate[] = [];

  try {
    const versionsToTry = Array.from(new Set([detailVersion, '6', '5', '4', '3', '2', '1']));
    let detailData: any = null;

    for (const version of versionsToTry) {
      const { response, lastStatus, finalUrl, error } = await fetchCdr(
        `${baseUrl}/banking/products/${encodeURIComponent(product.productId)}`,
        { 'x-v': version, 'x-min-v': '1', 'Accept': 'application/json' }
      );

      if (!response) {
        console.warn(`[CDR] ${lenderId} detail ${product.productId} transport error: ${error}`);
        break;
      }

      if (response.ok) {
        detailData = await response.json();
        console.log(`[CDR] ${lenderId} detail ${product.productId} v${version}: ${(detailData?.data?.lendingRates || []).length} rates`);
        break;
      }
      if (response.status === 406) continue; // try lower version
      console.warn(`[CDR] ${lenderId} detail ${product.productId} -> ${lastStatus} (final ${finalUrl})`);
      break;
    }

    if (!detailData) return rates;
    const productDetail = detailData?.data;
    if (!productDetail?.lendingRates?.length) return rates;

    for (const lendingRate of productDetail.lendingRates) {
      const rateValue = parseFloat(lendingRate.rate) * 100;
      if (rateValue > 0.1 && rateValue < 20) {
        const tier = Array.isArray(lendingRate.tiers) ? lendingRate.tiers[0] : null;
        const tierMin = tier?.unitOfMeasure === 'PERCENT' && tier.minimumValue != null ? parseFloat(tier.minimumValue) * 100 : null;
        const tierMax = tier?.unitOfMeasure === 'PERCENT' && tier.maximumValue != null ? parseFloat(tier.maximumValue) * 100 : null;
        const constraints = Array.isArray(productDetail.constraints) ? productDetail.constraints : [];
        const minLoanConstraint = constraints.find((c: any) => c.constraintType === 'MIN_LIMIT');
        const maxLoanConstraint = constraints.find((c: any) => c.constraintType === 'MAX_LIMIT');
        rates.push({
          lenderId,
          lenderName: CDR_LENDERS[lenderId]?.name || lenderId,
          productId: product.productId,
          productName: product.name || product.productId,
          rate: rateValue,
          comparisonRate: lendingRate.comparisonRate ? parseFloat(lendingRate.comparisonRate) * 100 : null,
          rateType: lendingRate.lendingRateType?.includes('FIXED') ? 'FIXED' : 'VARIABLE',
          loanPurpose: lendingRate.loanPurpose === 'INVESTMENT' ? 'INVESTMENT' : 'OWNER_OCCUPIED',
          repaymentType: lendingRate.repaymentType === 'INTEREST_ONLY' ? 'INTEREST_ONLY' : 'PRINCIPAL_AND_INTEREST',
          lvrMin: Number.isFinite(tierMin) ? tierMin : null,
          lvrMax: Number.isFinite(tierMax) ? tierMax : null,
          minLoanAmount: minLoanConstraint?.minimumValue ? parseFloat(minLoanConstraint.minimumValue) : null,
          maxLoanAmount: maxLoanConstraint?.maximumValue ? parseFloat(maxLoanConstraint.maximumValue) : null,
          features: productDetail.features?.map((f: any) => f.featureType) || [],
          lastUpdated: new Date().toISOString(),
        });
      }
    }
  } catch (e) {
    console.warn(`[CDR] ${lenderId} detail ${product.productId} exception:`, e);
  }

  return rates;
}

// Attempt a single base URL. Returns {products, status, finalUrl, error}.
async function tryFetchProductsAtBase(
  lenderId: string,
  baseUrl: string,
  productVersion: string
): Promise<{ products: any[]; status: number; finalUrl: string; error?: string }> {
  const versionsToTry = Array.from(new Set([productVersion, '4', '3', '2', '1']));
  let lastStatus = 0;
  let lastFinalUrl = baseUrl;
  let lastError: string | undefined;

  for (const version of versionsToTry) {
    const url = `${baseUrl}/banking/products?product-category=RESIDENTIAL_MORTGAGES&page-size=100`;
    const { response, lastStatus: s, finalUrl, error, redirectChain } = await fetchCdr(url, {
      'x-v': version,
      'x-min-v': '1',
      'Accept': 'application/json',
    });

    lastStatus = s;
    lastFinalUrl = finalUrl;
    lastError = error;

    if (!response) {
      console.warn(`[CDR] ${lenderId} ${baseUrl} v${version} transport: ${error} (chain=${redirectChain.join(' -> ')})`);
      break; // network error — fallback baseUrl will try next
    }

    if (response.ok) {
      const data = await response.json();
      const products = (data?.data?.products || []).filter((p: any) => p?.productCategory === 'RESIDENTIAL_MORTGAGES');
      console.log(`[CDR] ${lenderId} ${baseUrl} v${version}: ${products.length} mortgage products (final ${finalUrl})`);
      return { products, status: response.status, finalUrl };
    }

    if (response.status === 406) {
      console.log(`[CDR] ${lenderId} v${version} 406, trying lower version`);
      continue;
    }

    // 3xx with no Location, 4xx, 5xx etc.
    console.warn(`[CDR] ${lenderId} ${baseUrl} v${version} -> ${response.status} (final ${finalUrl}) ${error ?? ''}`);
    break;
  }

  return { products: [], status: lastStatus, finalUrl: lastFinalUrl, error: lastError };
}

async function fetchLenderProducts(
  lenderId: string,
  config: { baseUrl: string; productVersion: string; detailVersion: string }
): Promise<{ rates: LendingRate[]; usedBaseUrl: string; error?: string; status: number }> {
  const { baseUrl, productVersion, detailVersion } = config;

  // Build URL attempt list: configured primary, live ACCC register URI, then known fallbacks (deduped)
  const registerBaseUrls = await fetchRegisterBaseUrls(lenderId);
  const candidates = [baseUrl, ...registerBaseUrls, ...(BASE_URL_FALLBACKS[lenderId] || [])]
    .filter((v, i, a) => a.indexOf(v) === i);

  let products: any[] = [];
  let usedBaseUrl = baseUrl;
  let lastStatus = 0;
  let lastError: string | undefined;

  for (const candidate of candidates) {
    console.log(`[CDR] ${lenderId} trying baseUrl: ${candidate}`);
    const r = await tryFetchProductsAtBase(lenderId, candidate, productVersion);
    lastStatus = r.status;
    lastError = r.error;
    if (r.products.length > 0) {
      products = r.products;
      usedBaseUrl = candidate;
      break;
    }
  }

  if (products.length === 0) {
    return { rates: [], usedBaseUrl, status: lastStatus, error: lastError || `No products (last status ${lastStatus})` };
  }

  // Top 15 for performance
  const productsToFetch = products.slice(0, 15);
  const rateArrays = await mapWithConcurrency(
    productsToFetch,
    4,
    (p: any) => fetchProductDetail(lenderId, usedBaseUrl, p, detailVersion)
  );
  const allRates: LendingRate[] = [];
  for (const arr of rateArrays) allRates.push(...arr);

  console.log(`[CDR] ${lenderId} collected ${allRates.length} rates from ${usedBaseUrl}`);
  return { rates: allRates, usedBaseUrl, status: lastStatus };
}

async function getCachedRates(supabase: any, lenderId: string): Promise<CacheEntry | null> {
  const { data, error } = await supabase
    .from('bank_lending_rates_cache')
    .select('*')
    .eq('lender_id', lenderId)
    .single();

  if (error || !data) return null;

  // Check if cache is still valid (24 hours)
  const expiresAt = new Date(data.expires_at);
  if (expiresAt < new Date()) return null;

  return {
    lenderId: data.lender_id,
    rates: data.rates as LendingRate[],
    fetchedAt: data.fetched_at,
    expiresAt: data.expires_at,
  };
}

async function setCachedRates(supabase: any, lenderId: string, rates: LendingRate[]): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  console.log(`[CDR] Caching ${rates.length} rates for ${lenderId}`);

  const { error } = await supabase
    .from('bank_lending_rates_cache')
    .upsert({
      lender_id: lenderId,
      lender_name: CDR_LENDERS[lenderId]?.name || MANUAL_LENDERS[lenderId]?.name || lenderId,
      rates,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: 'lender_id' });

  if (error) {
    console.error(`[CDR] Failed to cache rates for ${lenderId}:`, error);
    return false;
  }
  
  console.log(`[CDR] Successfully cached rates for ${lenderId}`);
  return true;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // SECURITY: Verify authentication
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[cdr-lending-rates-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[cdr-lending-rates-service] Authenticated user: ${userId}`);

    // Support both GET query params and POST body
    const url = new URL(req.url);
    let action = url.searchParams.get('action') || 'list';
    let lenderId = url.searchParams.get('lender');
    let loanPurpose = url.searchParams.get('purpose') as 'OWNER_OCCUPIED' | 'INVESTMENT' | null;
    let repaymentType = url.searchParams.get('repayment') as 'PRINCIPAL_AND_INTEREST' | 'INTEREST_ONLY' | null;
    let lvr = url.searchParams.get('lvr') ? parseFloat(url.searchParams.get('lvr')!) : null;
    let forceRefresh = url.searchParams.get('refresh') === 'true';

    // Parse POST body if present (body already parsed for auth, reuse it)
    if (req.method === 'POST' && body && typeof body === 'object') {
      if (body.action) action = body.action;
      if (body.lender) lenderId = body.lender;
      if (body.purpose) loanPurpose = body.purpose;
      if (body.repayment) repaymentType = body.repayment;
      if (body.lvr !== undefined) lvr = parseFloat(body.lvr);
      if (body.refresh) forceRefresh = body.refresh === true || body.refresh === 'true';
    }

    console.log(`[CDR] Action: ${action}, Lender: ${lenderId}, Purpose: ${loanPurpose}, LVR: ${lvr}`);

    // Action: List available lenders (CDR + manual non-bank cards)
    if (action === 'lenders') {
      const cdrLenders = Object.entries(CDR_LENDERS).map(([id, info]) => ({
        id, name: info.name, logo: info.logo,
      }));
      const manualLenders = Object.entries(MANUAL_LENDERS).map(([id, info]) => ({
        id, name: info.name, logo: info.logo,
      }));
      const lenders = [...cdrLenders, ...manualLenders].sort((a, b) => a.name.localeCompare(b.name));

      return new Response(
        JSON.stringify({ success: true, data: lenders }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: Get rates for specific lender
    if (action === 'rates' && lenderId) {
      // Manual lender path (Resimac etc.) — bypass CDR fetch, build from static rate card
      if (MANUAL_LENDERS[lenderId]) {
        const manual = MANUAL_LENDERS[lenderId];
        const rates: LendingRate[] = manual.build();
        // Refresh cache so best-rates picks them up
        await setCachedRates(supabase, lenderId, rates).catch((e) => console.warn(`[manual] cache fail ${lenderId}`, e));

        let filteredRates = rates;
        if (loanPurpose) filteredRates = filteredRates.filter(r => r.loanPurpose === loanPurpose);
        if (repaymentType) filteredRates = filteredRates.filter(r => r.repaymentType === repaymentType);
        if (lvr !== null) {
          filteredRates = filteredRates.filter(r =>
            (r.lvrMin === null || lvr >= r.lvrMin) && (r.lvrMax === null || lvr <= r.lvrMax)
          );
        }
        filteredRates.sort((a, b) => a.rate - b.rate);

        return new Response(
          JSON.stringify({
            success: true,
            data: filteredRates,
            lender: { id: lenderId, name: manual.name },
            cached: false,
            totalRates: rates.length,
            source: 'manual',
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const lenderConfig = CDR_LENDERS[lenderId];
      if (!lenderConfig) {
        return new Response(
          JSON.stringify({ success: false, error: "Unknown lender" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check cache first
      let rates: LendingRate[] = [];
      let fromCache = false;
      
      if (!forceRefresh) {
        const cached = await getCachedRates(supabase, lenderId);
        if (cached && cached.rates.length > 0) {
          console.log(`[CDR] Using cached rates for ${lenderId} (${cached.rates.length} rates)`);
          rates = cached.rates;
          fromCache = true;
        }
      }

      // Fetch fresh if no cache
      if (rates.length === 0) {
        console.log(`[CDR] Fetching fresh rates for ${lenderId}`);
        const result = await fetchLenderProducts(lenderId, {
          baseUrl: lenderConfig.baseUrl,
          productVersion: lenderConfig.productVersion,
          detailVersion: lenderConfig.detailVersion,
        });
        rates = result.rates;
        if (rates.length > 0) {
          await setCachedRates(supabase, lenderId, rates);
        } else {
          console.warn(`[CDR] No rates found for ${lenderId}: ${result.error || 'unknown'}`);
        }
      }

      // Apply filters
      let filteredRates = rates;
      if (loanPurpose) {
        filteredRates = filteredRates.filter(r => r.loanPurpose === loanPurpose);
      }
      if (repaymentType) {
        filteredRates = filteredRates.filter(r => r.repaymentType === repaymentType);
      }
      if (lvr !== null) {
        filteredRates = filteredRates.filter(r => 
          (!r.lvrMin || lvr >= r.lvrMin) && (!r.lvrMax || lvr <= r.lvrMax)
        );
      }

      // Sort by rate
      filteredRates.sort((a, b) => a.rate - b.rate);

      return new Response(
        JSON.stringify({ 
          success: true, 
          data: filteredRates,
          lender: { id: lenderId, name: lenderConfig.name },
          cached: fromCache,
          totalRates: rates.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: Probe one lender without writing cache — useful for diagnostics.
    if (action === 'probe' && lenderId) {
      const lenderConfig = CDR_LENDERS[lenderId];
      if (!lenderConfig) {
        return new Response(
          JSON.stringify({ success: false, error: "Unknown lender" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const result = await fetchLenderProducts(lenderId, lenderConfig);
      return new Response(
        JSON.stringify({
          success: result.rates.length > 0,
          lenderId,
          lenderName: lenderConfig.name,
          rateCount: result.rates.length,
          usedBaseUrl: result.usedBaseUrl,
          httpStatus: result.status,
          error: result.error || null,
          sample: result.rates.slice(0, 5),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: Get best rates across all lenders (CDR + manual)
    if (action === 'best-rates') {
      const allRates: LendingRate[] = [];

      // CDR cached rates
      for (const [id] of Object.entries(CDR_LENDERS)) {
        const cached = await getCachedRates(supabase, id);
        if (cached && cached.rates.length > 0) {
          allRates.push(...cached.rates);
        }
      }

      // Manual rate cards (Resimac etc.) — always available, no API dependency
      for (const [id, manual] of Object.entries(MANUAL_LENDERS)) {
        try {
          allRates.push(...manual.build());
        } catch (e) {
          console.warn(`[manual] build failed for ${id}:`, e);
        }
      }

      console.log(`[CDR] Found ${allRates.length} total rates across all lenders`);

      // Apply filters
      let filteredRates = allRates;
      if (loanPurpose) {
        filteredRates = filteredRates.filter(r => r.loanPurpose === loanPurpose);
      }
      if (repaymentType) {
        filteredRates = filteredRates.filter(r => r.repaymentType === repaymentType);
      }
      if (lvr !== null) {
        filteredRates = filteredRates.filter(r =>
          (!r.lvrMin || lvr >= r.lvrMin) && (!r.lvrMax || lvr <= r.lvrMax)
        );
      }

      // Sort by rate and get top 10
      filteredRates.sort((a, b) => a.rate - b.rate);
      const topRates = filteredRates.slice(0, 10);

      return new Response(
        JSON.stringify({
          success: true,
          data: topRates,
          totalLenders: Object.keys(CDR_LENDERS).length + Object.keys(MANUAL_LENDERS).length,
          totalCachedRates: allRates.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: Refresh all lender caches (CDR + manual) — PARALLEL with per-lender timeout
    if (action === 'refresh-all') {
      const totalCount = Object.keys(CDR_LENDERS).length + Object.keys(MANUAL_LENDERS).length;
      console.log(`[CDR] Starting PARALLEL refresh-all for ${totalCount} lenders`);

      // Fifteen CDR lenders at concurrency five require up to three waves. Keep
      // those waves within the function's 120-second request timeout.
      const PER_LENDER_TIMEOUT_MS = 25_000;
      const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((_, rej) =>
            setTimeout(() => rej(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
          ),
        ]);

      // CDR fetches are network-heavy; cap concurrency to avoid data-holder throttling
      const cdrResults = await mapWithConcurrency(Object.entries(CDR_LENDERS), 5, async ([id, config]) => {
        try {
          const result = await withTimeout(
            fetchLenderProducts(id, {
              baseUrl: config.baseUrl,
              productVersion: config.productVersion,
              detailVersion: config.detailVersion,
            }),
            PER_LENDER_TIMEOUT_MS,
            id
          );
          const rates = result.rates;
          let cached = false;
          if (rates.length > 0) {
            cached = await setCachedRates(supabase, id, rates);
          }
          console.log(`[CDR] Refresh ${id}: ${rates.length} rates via ${result.usedBaseUrl}, cached: ${cached}`);
          return {
            lenderId: id,
            lenderName: config.name,
            success: rates.length > 0,
            rateCount: rates.length,
            cached,
            usedBaseUrl: result.usedBaseUrl,
            httpStatus: result.status,
            error: rates.length === 0 ? (result.error || `No products (status ${result.status})`) : undefined,
          };
        } catch (error: any) {
          const msg = error?.message || String(error);
          console.error(`[CDR] Failed to refresh ${id}:`, msg);
          return { lenderId: id, lenderName: config.name, success: false, rateCount: 0, cached: false, error: msg };
        }
      });

      // Manual lenders are synchronous-ish (no network) but keep them concurrent for symmetry
      const manualPromises = Object.entries(MANUAL_LENDERS).map(async ([id, manual]) => {
        try {
          const rates = manual.build();
          const cached = rates.length > 0 ? await setCachedRates(supabase, id, rates) : false;
          console.log(`[manual] Refresh ${id}: ${rates.length} rates, cached: ${cached}`);
          return { lenderId: id, lenderName: manual.name, success: rates.length > 0, rateCount: rates.length, cached };
        } catch (error: any) {
          const msg = error?.message || String(error);
          console.error(`[manual] Failed to refresh ${id}:`, msg);
          return { lenderId: id, lenderName: manual.name, success: false, rateCount: 0, cached: false, error: msg };
        }
      });

      const manualResults = await Promise.all(manualPromises);
      const results = [...cdrResults, ...manualResults];

      const successCount = results.filter(r => r.success && r.rateCount > 0).length;
      const totalRates = results.reduce((sum, r) => sum + r.rateCount, 0);

      console.log(`[CDR] Refresh complete: ${successCount}/${results.length} lenders, ${totalRates} total rates`);

      return new Response(
        JSON.stringify({
          success: true,
          data: results,
          summary: {
            totalLenders: results.length,
            successfulLenders: successCount,
            totalRates,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default: List all cached rates summary
    const { data: cachedData } = await supabase
      .from('bank_lending_rates_cache')
      .select('lender_id, lender_name, fetched_at, expires_at, rates')
      .order('lender_name');

    const summary = (cachedData || []).map((entry: any) => ({
      lenderId: entry.lender_id,
      lenderName: entry.lender_name,
      rateCount: entry.rates?.length || 0,
      fetchedAt: entry.fetched_at,
      expiresAt: entry.expires_at,
      lowestRate: entry.rates?.length > 0 
        ? Math.min(...entry.rates.map((r: LendingRate) => r.rate))
        : null,
    }));

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: summary,
        availableLenders: Object.keys(CDR_LENDERS).length,
        cachedLenders: summary.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[CDR] Error:", error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'cdr-lending-rates-service'), success: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
