import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getBrandConfig } from '../_shared/brand-config.ts';
import { buildFreeformEnvelope, pdfBytesToBase64, type FreeformRecipient, type FreeformTab } from '../_shared/docusign-freeform.ts';
// pdf-lib removed: we now ship the Gamma PDF as-is with embedded anchor tokens.

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ─── DocuSign JWT Grant Auth ──────────────────────────────
import { SignJWT, importPKCS8 } from 'https://deno.land/x/jose@v5.2.2/index.ts';
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';

// Convert PKCS#1 PEM to PKCS#8 PEM
function convertPkcs1ToPkcs8Pem(pem: string): string {
  if (pem.includes('BEGIN PRIVATE KEY')) {
    return pem; // Already PKCS#8
  }
  
  // Extract base64 from PKCS#1 PEM
  const b64 = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
    .replace(/-----END RSA PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  
  // Decode PKCS#1 DER
  const pkcs1Der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  
  // RSA OID: 1.2.840.113549.1.1.1
  const rsaOid = new Uint8Array([
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01
  ]);
  const nullParam = new Uint8Array([0x05, 0x00]);
  
  // AlgorithmIdentifier SEQUENCE
  const algoIdContent = concatBytes(rsaOid, nullParam);
  const algoId = wrapAsn1(0x30, algoIdContent);
  
  // Version INTEGER 0
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  
  // Wrap PKCS#1 key in OCTET STRING
  const privateKeyOctet = wrapAsn1(0x04, pkcs1Der);
  
  // Outer SEQUENCE
  const pkcs8Content = concatBytes(version, algoId, privateKeyOctet);
  const pkcs8Der = wrapAsn1(0x30, pkcs8Content);
  
  // Convert back to PEM
  const pkcs8B64 = btoa(String.fromCharCode(...pkcs8Der));
  const lines = pkcs8B64.match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

function wrapAsn1(tag: number, content: Uint8Array): Uint8Array {
  const len = content.length;
  let header: Uint8Array;
  if (len < 128) {
    header = new Uint8Array([tag, len]);
  } else if (len < 256) {
    header = new Uint8Array([tag, 0x81, len]);
  } else if (len < 65536) {
    header = new Uint8Array([tag, 0x82, (len >> 8) & 0xff, len & 0xff]);
  } else if (len < 16777216) {
    header = new Uint8Array([tag, 0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  } else {
    header = new Uint8Array([tag, 0x84, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  }
  return concatBytes(header, content);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

async function getDocuSignAccessToken(): Promise<string> {
  const integrationKey = Deno.env.get('DOCUSIGN_INTEGRATION_KEY')?.trim();
  const userId = Deno.env.get('DOCUSIGN_USER_ID')?.trim();
  let rsaPrivateKey = Deno.env.get('DOCUSIGN_RSA_PRIVATE_KEY')?.trim();

  if (!integrationKey || !userId || !rsaPrivateKey) {
    throw new Error('DocuSign JWT credentials not configured. Need DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_RSA_PRIVATE_KEY.');
  }

  // Normalize escaped newlines — secrets often store \n as literal two-char sequences
  rsaPrivateKey = rsaPrivateKey.replace(/\\n/g, '\n');

  console.log('[DocuSign JWT] Key starts with:', rsaPrivateKey.substring(0, 40));
  console.log('[DocuSign JWT] Key contains actual newlines:', rsaPrivateKey.includes('\n'));

  // Convert PKCS#1 to PKCS#8 if needed
  if (rsaPrivateKey.includes('BEGIN RSA PRIVATE KEY')) {
    console.log('[DocuSign JWT] Converting PKCS#1 key to PKCS#8...');
    rsaPrivateKey = convertPkcs1ToPkcs8Pem(rsaPrivateKey);
  }

  // Import the key using jose
  const privateKey = await importPKCS8(rsaPrivateKey, 'RS256');

  // Determine OAuth host: production vs demo. Auto-detect from DOCUSIGN_BASE_URL if not explicitly set.
  const restBase = (Deno.env.get('DOCUSIGN_BASE_URL') || '').toLowerCase();
  const isProduction = restBase.includes('//www.docusign.net') || restBase.includes('//na') || restBase.includes('//eu') || restBase.includes('//au');
  const oauthHost = Deno.env.get('DOCUSIGN_OAUTH_HOST')?.trim()
    || (isProduction ? 'account.docusign.com' : 'account-d.docusign.com');

  console.log('[DocuSign JWT] Using OAuth host:', oauthHost, '(production:', isProduction, ')');

  const now = Math.floor(Date.now() / 1000);

  // Create and sign JWT
  const jwtToken = await new SignJWT({
    iss: integrationKey,
    sub: userId,
    aud: oauthHost,
    scope: 'signature impersonation',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  // Exchange JWT for access token
  console.log('[DocuSign] Exchanging JWT for access token...');
  const tokenResponse = await fetch(`https://${oauthHost}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwtToken}`,
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    console.error('[DocuSign] Token exchange failed:', JSON.stringify(tokenData));
    if (tokenData.error === 'consent_required') {
      const consentUrl = `https://${oauthHost}/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${integrationKey}&redirect_uri=https://www.docusign.com`;
      throw new Error(`DocuSign consent_required. Open this URL in a browser, sign in as the impersonated user, and click "Accept": ${consentUrl}`);
    }
    throw new Error(`DocuSign token exchange failed: ${tokenData.error || tokenData.error_description || 'Unknown error'}`);
  }

  console.log('[DocuSign] Access token obtained successfully, expires in', tokenData.expires_in, 'seconds');
  return tokenData.access_token;
}

function getDocuSignRestBaseUrl(): string {
  const configuredBaseUrl = (Deno.env.get('DOCUSIGN_BASE_URL') || 'https://demo.docusign.net/restapi').trim();
  const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, '');

  if (normalizedBaseUrl.toLowerCase().endsWith('/restapi')) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}/restapi`;
}

// ─── Helper: Fetch PDF from Gamma with content-type validation ────
async function fetchGammaPdfBuffer(
  exportUrl: string | null,
  gammaDocId: string,
  gammaApiKey: string
): Promise<ArrayBuffer | null> {
  const GAMMA_API_URL = 'https://public-api.gamma.app/v1.0';

  // 1. Try the provided export URL first
  if (exportUrl) {
    try {
      console.log('[Gamma PDF] Downloading from exportUrl:', exportUrl);
      const res = await fetch(exportUrl);
      const contentType = res.headers.get('content-type') || '';
      console.log('[Gamma PDF] Response status:', res.status, 'content-type:', contentType);

      if (res.ok) {
        const buf = await res.arrayBuffer();
        const header = new Uint8Array(buf.slice(0, 5));
        const headerStr = String.fromCharCode(...header);
        if (contentType.includes('application/pdf') || headerStr.startsWith('%PDF')) {
          console.log('[Gamma PDF] Valid PDF received, size:', buf.byteLength, 'bytes');
          return buf;
        }
        console.warn('[Gamma PDF] Export URL returned non-PDF content (', contentType, '), header:', headerStr, '— will try explicit export');
      }
    } catch (err: any) {
      console.error('[Gamma PDF] Export URL fetch error:', err.message);
    }
  }

  // 2. Try explicit PDF export via Gamma API
  try {
    console.log('[Gamma PDF] Attempting explicit export for gammaId:', gammaDocId);
    const exportRes = await fetch(`${GAMMA_API_URL}/gammas/${gammaDocId}/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': gammaApiKey,
      },
      body: JSON.stringify({ format: 'pdf' }),
    });

    if (exportRes.ok) {
      const exportData = await exportRes.json();
      console.log('[Gamma PDF] Export response:', JSON.stringify(exportData).substring(0, 500));
      const pdfDownloadUrl = exportData.url || exportData.downloadUrl || exportData.exportUrl || exportData.fileUrl;
      if (pdfDownloadUrl) {
        await new Promise(r => setTimeout(r, 2000));
        const dlRes = await fetch(pdfDownloadUrl);
        if (dlRes.ok) {
          const buf = await dlRes.arrayBuffer();
          const header = new Uint8Array(buf.slice(0, 5));
          if (String.fromCharCode(...header).startsWith('%PDF') || (dlRes.headers.get('content-type') || '').includes('application/pdf')) {
            console.log('[Gamma PDF] Explicit export PDF received, size:', buf.byteLength);
            return buf;
          }
        }
      }
    } else {
      const errText = await exportRes.text();
      console.warn('[Gamma PDF] Export endpoint returned', exportRes.status, ':', errText.substring(0, 300));
    }
  } catch (err: any) {
    console.error('[Gamma PDF] Explicit export error:', err.message);
  }

  // 3. Try re-fetching generation with exportAs query param
  try {
    console.log('[Gamma PDF] Trying generation endpoint with export param for:', gammaDocId);
    const genRes = await fetch(`${GAMMA_API_URL}/generations/${gammaDocId}?exportAs=pdf`, {
      headers: { 'X-API-KEY': gammaApiKey },
    });
    if (genRes.ok) {
      const genData = await genRes.json();
      const pdfUrl2 = genData.exportUrl || genData.pdfUrl || genData.fileUrl;
      if (pdfUrl2 && pdfUrl2 !== exportUrl) {
        console.log('[Gamma PDF] Found alternate PDF URL:', pdfUrl2);
        const dlRes = await fetch(pdfUrl2);
        if (dlRes.ok) {
          const buf = await dlRes.arrayBuffer();
          const header = new Uint8Array(buf.slice(0, 5));
          if (String.fromCharCode(...header).startsWith('%PDF')) {
            console.log('[Gamma PDF] Alternate URL PDF received, size:', buf.byteLength);
            return buf;
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[Gamma PDF] Generation re-fetch error:', err.message);
  }

  console.warn('[Gamma PDF] All PDF fetch attempts failed for gammaDocId:', gammaDocId);
  return null;
}

// ─── Helper: Deferred PDF fetch (re-polls generation + downloads PDF) ────
async function attemptDeferredPdfFetch(
  supabase: any,
  agreement: any,
  gammaApiKey: string,
): Promise<string | null> {
  const GAMMA_API_URL = 'https://public-api.gamma.app/v1.0';
  const generationId = agreement.gamma_document_id;

  try {
    // Step 1: Check if the generation has completed
    console.log('[deferred] Checking generation status for:', generationId);
    const pollRes = await fetch(`${GAMMA_API_URL}/generations/${generationId}`, {
      headers: { 'X-API-KEY': gammaApiKey },
    });

    if (!pollRes.ok) {
      console.warn('[deferred] Generation poll failed:', pollRes.status);
      return null;
    }

    const gammaData = await pollRes.json();
    console.log('[deferred] Generation status:', gammaData.status, 'keys:', Object.keys(gammaData).join(','));

    if (gammaData.status === 'pending' || gammaData.status === 'processing') {
      // Still not ready — do a short additional poll (up to 30s)
      console.log('[deferred] Generation still pending, doing short poll (10 attempts)...');
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const retryRes = await fetch(`${GAMMA_API_URL}/generations/${generationId}`, {
          headers: { 'X-API-KEY': gammaApiKey },
        });
        if (retryRes.ok) {
          const retryData = await retryRes.json();
          console.log(`[deferred] Short poll ${i + 1}/10: status=${retryData.status}`);
          if (retryData.status === 'completed') {
            Object.assign(gammaData, retryData);
            break;
          } else if (retryData.status === 'failed' || retryData.status === 'error') {
            console.error('[deferred] Generation failed:', JSON.stringify(retryData));
            return null;
          }
        }
      }
    }

    if (gammaData.status !== 'completed') {
      console.warn('[deferred] Generation not yet completed:', gammaData.status);
      return null;
    }

    // Step 2: Generation completed — extract URLs and fetch PDF
    const rawPdfUrl = gammaData.exportUrl || gammaData.pdfUrl || gammaData.fileUrl;
    const gammaDocId = gammaData.gammaId || generationId;
    const gammaUrl = gammaData.gammaUrl || gammaData.url;

    const pdfBuffer = await fetchGammaPdfBuffer(rawPdfUrl, gammaDocId, gammaApiKey);
    if (!pdfBuffer) {
      console.warn('[deferred] Could not obtain valid PDF');
      return null;
    }

    // Step 3: Upload to storage
    const storagePath = `agreements/${agreement.id}/agreement.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('agency-agreements')
      .upload(storagePath, new Uint8Array(pdfBuffer), {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error('[deferred] PDF upload error:', uploadErr.message);
      return null;
    }

    // Step 4: Update agreement record
    await supabase.from('agency_agreements').update({
      pdf_storage_path: storagePath,
      gamma_document_id: gammaDocId,
      gamma_document_url: gammaUrl || agreement.gamma_document_url,
      status: agreement.status === 'pending_pdf' ? 'generated' : agreement.status,
    }).eq('id', agreement.id);

    console.log('[deferred] PDF successfully backfilled to:', storagePath);

    // Step 5: Return signed URL
    const { data: signedData } = await supabase.storage
      .from('agency-agreements')
      .createSignedUrl(storagePath, 3600);

    return signedData?.signedUrl || null;
  } catch (err: any) {
    console.error('[deferred] Error:', err.message);
    return null;
  }
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
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    
    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) {
      return createUnauthorizedResponse(authResult.error, corsHeaders);
    }

    // Agreements is a Scale-or-add-on capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, authResult, 'agreements');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    const { action } = body;

    // ─── LIST AGREEMENTS ────────────────────────────────────
    if (action === 'list') {
      const query = supabase
        .from('agency_agreements')
        .select('*')
        .order('created_at', { ascending: false });

      if (body.client_id) {
        query.eq('client_id', body.client_id);
      }

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify({ agreements: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── GENERATE AGREEMENT (create record + store PDF metadata) ──
    if (action === 'generate') {
      const {
        client_id, buyer_names, buyer_address, buyer_phone,
        buyer_email, agreement_date, secondary_buyer_name, secondary_buyer_email,
        deal_id, notes, initial_commitment_fee, template_id,
      } = body;

      if (!client_id || !buyer_names || !buyer_email) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: client_id, buyer_names, buyer_email' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Look up template from DB if template_id provided
      let resolvedGammaTemplateId: string | null = null;
      let placeholderMappings: any[] | null = null;
      
      if (template_id) {
        const { data: tmpl, error: tmplErr } = await supabase
          .from('gamma_agreement_templates')
          .select('gamma_template_id, placeholder_mappings')
          .eq('id', template_id)
          .single();
        if (!tmplErr && tmpl) {
          resolvedGammaTemplateId = tmpl.gamma_template_id;
          placeholderMappings = tmpl.placeholder_mappings as any[];
          console.log('[generate] Using DB template:', template_id, 'gamma_id:', resolvedGammaTemplateId);
        }
      }

      // Fallback to default template from DB
      if (!resolvedGammaTemplateId) {
        const { data: defaultTmpl } = await supabase
          .from('gamma_agreement_templates')
          .select('id, gamma_template_id, placeholder_mappings')
          .eq('is_default', true)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        if (defaultTmpl) {
          resolvedGammaTemplateId = defaultTmpl.gamma_template_id;
          placeholderMappings = defaultTmpl.placeholder_mappings as any[];
          console.log('[generate] Using default DB template:', defaultTmpl.id);
        }
      }

      // Final fallback to env var
      if (!resolvedGammaTemplateId) {
        resolvedGammaTemplateId = Deno.env.get('GAMMA_TEMPLATE_ID') || null;
        console.log('[generate] Falling back to env GAMMA_TEMPLATE_ID:', resolvedGammaTemplateId);
      }

      const { data: agreement, error } = await supabase
        .from('agency_agreements')
        .insert({
          client_id,
          deal_id: deal_id || null,
          status: 'generating',
          buyer_names,
          buyer_address: buyer_address || null,
          buyer_phone: buyer_phone || null,
          buyer_email,
          agreement_date: agreement_date || new Date().toISOString().split('T')[0],
          secondary_buyer_name: secondary_buyer_name || null,
          secondary_buyer_email: secondary_buyer_email || null,
          notes: notes || null,
          initial_commitment_fee: initial_commitment_fee ? parseFloat(initial_commitment_fee) : null,
          created_by: authResult.username || authResult.userId,
          template_id: template_id || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Trigger Gamma generation — run the ENTIRE Gamma call chain in the
      // background so this request returns immediately and the frontend
      // (60s fetch timeout) does not abort while Gamma is still working.
      // The frontend polls agency_agreements.pdf_storage_path for readiness.
      const gammaApiKey = Deno.env.get('GAMMA_API_KEY');
      const gammaTemplateId = resolvedGammaTemplateId;

      console.log('[generate] GAMMA_API_KEY present:', !!gammaApiKey, 'GAMMA_TEMPLATE_ID:', gammaTemplateId);

      if (gammaApiKey && gammaTemplateId) {
        // Mark as pending immediately so the UI shows the right state.
        await supabase.from('agency_agreements')
          .update({ status: 'pending_pdf' })
          .eq('id', agreement.id);

        const GAMMA_API_URL = 'https://public-api.gamma.app/v1.0';

        // Build prompt from placeholder mappings if available
        const fieldValues: Record<string, string> = {
          buyer_names,
          buyer_address: buyer_address || 'N/A',
          buyer_phone: buyer_phone || 'N/A',
          buyer_email,
          initial_commitment_fee: initial_commitment_fee || '$1,500.00 + GST',
          secondary_buyer_name: secondary_buyer_name || '',
          agreement_date: agreement_date || new Date().toISOString().split('T')[0],
          notes: notes || '',
        };

        let promptLines: string[];
        if (placeholderMappings && placeholderMappings.length > 0) {
          promptLines = placeholderMappings
            .filter((m: any) => m.placeholder && m.field)
            .map((m: any) => `${m.placeholder} → ${fieldValues[m.field] || m.defaultValue || 'N/A'}`);
        } else {
          promptLines = [
            `[Buyer's Name] → ${buyer_names}`,
            `[Address] → ${buyer_address || 'N/A'}`,
            `[Phone Number] → ${buyer_phone || 'N/A'}`,
            `[Email] → ${buyer_email}`,
            `[Initial Commitment Fee] → ${initial_commitment_fee || '$1,500.00 + GST'}`,
          ];
        }

        const prompt = `Replace the placeholders in this agreement template with the following details. Do NOT change any other content, formatting, structure, or wording — only replace the bracketed placeholders exactly:\n\n${promptLines.join('\n')}\n\nKeep everything else exactly as-is.`;

        const backgroundTask = (async () => {
          try {
            console.log('[Gamma:bg] POST /generations/from-template with gammaId:', gammaTemplateId);
            const createRes = await fetch(`${GAMMA_API_URL}/generations/from-template`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': gammaApiKey,
              },
              body: JSON.stringify({
                gammaId: gammaTemplateId,
                prompt,
                exportAs: 'pdf',
              }),
            });

            const createText = await createRes.text();
            console.log('[Gamma:bg] Create response status:', createRes.status, 'body:', createText.substring(0, 500));

            let createData: any;
            try { createData = JSON.parse(createText); } catch { createData = {}; }

            if (!createRes.ok) {
              console.error('[Gamma:bg] Create failed - status:', createRes.status);
              await supabase.from('agency_agreements')
                .update({ status: 'generated' })
                .eq('id', agreement.id);
              return;
            }

            const generationId = createData.generationId || createData.id;
            console.log('[Gamma:bg] Generation started, generationId:', generationId);

            await supabase.from('agency_agreements').update({
              gamma_document_id: generationId,
            }).eq('id', agreement.id);

            let gammaResult: any = null;
            for (let i = 0; i < 50; i++) {
              await new Promise(r => setTimeout(r, 3000));
              const pollRes = await fetch(`${GAMMA_API_URL}/generations/${generationId}`, {
                headers: { 'X-API-KEY': gammaApiKey },
              });
              const pollText = await pollRes.text();
              let pollData: any;
              try { pollData = JSON.parse(pollText); } catch { pollData = {}; }
              console.log(`[Gamma:bg] Poll ${i + 1}/50: status=${pollData.status}`);

              if (pollData.status === 'completed') {
                gammaResult = pollData;
                break;
              } else if (pollData.status === 'failed' || pollData.status === 'error') {
                console.error('[Gamma:bg] Generation failed:', JSON.stringify(pollData));
                return;
              }
            }

            if (!gammaResult) {
              console.warn('[Gamma:bg] Polling timed out — generationId stored for deferred retry:', generationId);
              return;
            }

            const gammaUrl = gammaResult.gammaUrl || gammaResult.url;
            const pdfUrl = gammaResult.exportUrl || gammaResult.pdfUrl || gammaResult.fileUrl;
            const gammaDocId = gammaResult.gammaId || generationId;

            const updateData: Record<string, any> = {
              status: 'generated',
              gamma_document_id: gammaDocId,
              gamma_document_url: gammaUrl,
            };

            const pdfBuffer = await fetchGammaPdfBuffer(pdfUrl, gammaDocId, gammaApiKey!);
            if (pdfBuffer) {
              const storagePath = `agreements/${agreement.id}/agreement.pdf`;
              const { error: uploadErr } = await supabase.storage
                .from('agency-agreements')
                .upload(storagePath, new Uint8Array(pdfBuffer), {
                  contentType: 'application/pdf',
                  upsert: true,
                });
              if (!uploadErr) {
                updateData.pdf_storage_path = storagePath;
                console.log('[Gamma:bg] PDF stored at:', storagePath);
              } else {
                console.error('[Gamma:bg] PDF upload error:', uploadErr.message);
              }
            } else {
              console.warn('[Gamma:bg] Could not obtain a valid PDF for this agreement');
            }

            await supabase.from('agency_agreements').update(updateData).eq('id', agreement.id);
            console.log('[Gamma:bg] Agreement record updated');
          } catch (bgErr: any) {
            console.error('[Gamma:bg] Background task error:', bgErr.message, bgErr.stack);
            await supabase.from('agency_agreements')
              .update({ status: 'generated' })
              .eq('id', agreement.id);
          }
        })();

        // @ts-ignore - EdgeRuntime is available in Supabase Edge Runtime
        if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
          // @ts-ignore
          EdgeRuntime.waitUntil(backgroundTask);
        } else {
          backgroundTask;
        }
      } else {
        console.warn('[generate] Gamma not configured, skipping. API key present:', !!gammaApiKey, 'Template ID present:', !!gammaTemplateId);
        await supabase.from('agency_agreements').update({ status: 'generated' }).eq('id', agreement.id);
      }



      // Re-fetch the updated agreement
      const { data: updatedAgreement } = await supabase
        .from('agency_agreements')
        .select('*')
        .eq('id', agreement.id)
        .single();

      return new Response(
        JSON.stringify({ success: true, agreement_id: agreement.id, agreement: updatedAgreement || agreement }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── PREVIEW AGREEMENT (return HTML or PDF URL) ──────────────────
    if (action === 'preview') {
      const { agreement_id } = body;
      if (!agreement_id) {
        return new Response(
          JSON.stringify({ error: 'Missing agreement_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: agreement, error: fetchErr } = await supabase
        .from('agency_agreements')
        .select('*')
        .eq('id', agreement_id)
        .single();

      if (fetchErr || !agreement) {
        return new Response(
          JSON.stringify({ error: 'Agreement not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // If PDF exists in storage, return a signed URL
      let pdfSignedUrl: string | null = null;
      if (agreement.pdf_storage_path) {
        const { data: signedData } = await supabase.storage
          .from('agency-agreements')
          .createSignedUrl(agreement.pdf_storage_path, 3600); // 1 hour
        if (signedData?.signedUrl) {
          pdfSignedUrl = signedData.signedUrl;
        }
      } else if (agreement.gamma_document_id) {
        // PDF not stored but Gamma doc/generation ID exists - try to fetch and store it now
        console.log('[preview] PDF not stored, attempting deferred fetch for:', agreement.gamma_document_id);
        const gammaApiKey = Deno.env.get('GAMMA_API_KEY');
        if (gammaApiKey) {
          pdfSignedUrl = await attemptDeferredPdfFetch(supabase, agreement, gammaApiKey);
        }
      }

      // If Gamma URL exists, include it
      const gammaUrl = agreement.gamma_document_url || null;

      const html = await generateAgreementHtml(agreement);
      return new Response(
        JSON.stringify({ success: true, html, agreement, pdf_url: pdfSignedUrl, gamma_url: gammaUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── RETRY PDF (deferred fetch for timed-out generations) ─────
    if (action === 'retry_pdf') {
      const { agreement_id } = body;
      if (!agreement_id) {
        return new Response(
          JSON.stringify({ error: 'Missing agreement_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: agreement, error: fetchErr } = await supabase
        .from('agency_agreements')
        .select('*')
        .eq('id', agreement_id)
        .single();

      if (fetchErr || !agreement) {
        return new Response(
          JSON.stringify({ error: 'Agreement not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (agreement.pdf_storage_path) {
        // Already has PDF
        const { data: signedData } = await supabase.storage
          .from('agency-agreements')
          .createSignedUrl(agreement.pdf_storage_path, 3600);
        return new Response(
          JSON.stringify({ success: true, pdf_url: signedData?.signedUrl || null, status: 'already_exists' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!agreement.gamma_document_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'No Gamma generation ID found for this agreement' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const gammaApiKey = Deno.env.get('GAMMA_API_KEY');
      if (!gammaApiKey) {
        return new Response(
          JSON.stringify({ success: false, error: 'Gamma API key not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const pdfSignedUrl = await attemptDeferredPdfFetch(supabase, agreement, gammaApiKey);
      return new Response(
        JSON.stringify({
          success: !!pdfSignedUrl,
          pdf_url: pdfSignedUrl,
          status: pdfSignedUrl ? 'pdf_retrieved' : 'still_pending',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── SAVE SIGNING LAYOUT (visual tagger persistence) ──────
    if (action === 'save_signing_layout') {
      const { agreement_id, signing_recipients, signing_layout } = body;
      if (!agreement_id) {
        return new Response(JSON.stringify({ error: 'Missing agreement_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { error } = await supabase
        .from('agency_agreements')
        .update({
          signing_recipients: Array.isArray(signing_recipients) ? signing_recipients : [],
          signing_layout: Array.isArray(signing_layout) ? signing_layout : [],
          signing_prepared_at: new Date().toISOString(),
        })
        .eq('id', agreement_id);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── SEND VIA DOCUSIGN — FREEFORM (visual tagger) ─────────
    if (action === 'send_freeform') {
      const { agreement_id, signing_recipients, signing_layout, email_subject, email_blurb } = body;
      if (!agreement_id) {
        return new Response(JSON.stringify({ error: 'Missing agreement_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const recipients: FreeformRecipient[] = Array.isArray(signing_recipients) ? signing_recipients : [];
      const tabs: FreeformTab[] = Array.isArray(signing_layout) ? signing_layout : [];
      if (recipients.length === 0) {
        return new Response(JSON.stringify({ error: 'At least one recipient is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (tabs.length === 0) {
        return new Response(JSON.stringify({ error: 'At least one signature field must be placed' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      for (const r of recipients) {
        if (!r.email || !r.name) {
          return new Response(JSON.stringify({ error: `Recipient missing name or email: ${JSON.stringify(r)}` }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      const { data: agreement, error: fetchErr } = await supabase
        .from('agency_agreements')
        .select('*')
        .eq('id', agreement_id)
        .single();
      if (fetchErr || !agreement) {
        return new Response(JSON.stringify({ error: 'Agreement not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!agreement.pdf_storage_path) {
        return new Response(JSON.stringify({
          error: 'Agreement PDF is not ready yet. Please wait for generation to complete and try again.',
          code: 'PDF_NOT_READY',
        }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const docusignAccountId = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
      if (!docusignAccountId) {
        return new Response(JSON.stringify({
          error: 'DocuSign not configured. Add DOCUSIGN_ACCOUNT_ID secret.',
          requires_setup: true,
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      let docusignAccessToken: string;
      try {
        docusignAccessToken = await getDocuSignAccessToken();
      } catch (tokenErr: any) {
        return new Response(JSON.stringify({ error: `DocuSign auth failed: ${tokenErr.message}` }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: pdfBlob, error: dlErr } = await supabase.storage
        .from('agency-agreements')
        .download(agreement.pdf_storage_path);
      if (dlErr || !pdfBlob) {
        return new Response(JSON.stringify({ error: `Failed to load PDF: ${dlErr?.message || 'not found'}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
      const brandCfg = await getBrandConfig();

      const envelopeDefinition = buildFreeformEnvelope({
        pdfBase64: pdfBytesToBase64(pdfBytes),
        documentName: "Buyer's Agent Agreement.pdf",
        recipients,
        tabs,
        emailSubject: email_subject || `Buyer's Agent Agreement — ${agreement.buyer_names}`,
        emailBlurb: email_blurb || `Please review and sign the attached Buyer's Agent Agreement.\n\nKind regards,\n${brandCfg.companyName || 'Property Consulting'}`,
      });

      const docusignBaseUrl = getDocuSignRestBaseUrl();
      const envelopeUrl = `${docusignBaseUrl}/v2.1/accounts/${docusignAccountId}/envelopes`;
      const dsResponse = await fetch(envelopeUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${docusignAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(envelopeDefinition),
      });
      const dsText = await dsResponse.text();
      let dsData: any;
      try { dsData = JSON.parse(dsText); } catch {
        return new Response(JSON.stringify({ error: `DocuSign returned non-JSON (status ${dsResponse.status})`, raw: dsText.substring(0, 500) }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!dsResponse.ok) {
        console.error('[DocuSign freeform] envelope failed:', dsText.substring(0, 1000));
        return new Response(JSON.stringify({ error: `DocuSign error: ${dsData.message || dsData.errorCode || 'Unknown'}`, details: dsData }), {
          status: dsResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await supabase.from('agency_agreements').update({
        status: 'sent',
        docusign_envelope_id: dsData.envelopeId,
        docusign_status: dsData.status,
        docusign_sent_at: new Date().toISOString(),
        sent_via: 'docusign',
        signing_recipients: recipients,
        signing_layout: tabs,
        signing_prepared_at: new Date().toISOString(),
      }).eq('id', agreement_id);

      return new Response(JSON.stringify({ success: true, envelope_id: dsData.envelopeId, status: dsData.status }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── SEND VIA DOCUSIGN (LEGACY anchor mode) ────────────
    if (action === 'send_docusign') {
      const { agreement_id } = body;
      if (!agreement_id) {
        return new Response(
          JSON.stringify({ error: 'Missing agreement_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch agreement
      const { data: agreement, error: fetchErr } = await supabase
        .from('agency_agreements')
        .select('*')
        .eq('id', agreement_id)
        .single();

      if (fetchErr || !agreement) {
        return new Response(
          JSON.stringify({ error: 'Agreement not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // DocuSign API credentials - auto-generate token via JWT
      const docusignAccountId = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
      const docusignBaseUrl = getDocuSignRestBaseUrl();

      if (!docusignAccountId) {
        return new Response(
          JSON.stringify({
            error: 'DocuSign credentials not configured. Please add DOCUSIGN_ACCOUNT_ID secret.',
            requires_setup: true,
          }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let docusignAccessToken: string;
      try {
        docusignAccessToken = await getDocuSignAccessToken();
      } catch (tokenErr: any) {
        console.error('[DocuSign] Token generation failed:', tokenErr.message);
        return new Response(
          JSON.stringify({ error: `DocuSign auth failed: ${tokenErr.message}` }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Resolve brand info for agent signer + signature page footer
      const brandCfg = await getBrandConfig();
      const agentSignerName = Deno.env.get('DOCUSIGN_AGENT_NAME') || brandCfg.companyName || 'Authorised Representative';
      const agentSignerEmail = Deno.env.get('DOCUSIGN_AGENT_EMAIL') || brandCfg.contactEmail;
      const hasSecondary = !!(agreement.secondary_buyer_name && agreement.secondary_buyer_name.trim());
      const secondaryEmailRaw = (agreement as any).secondary_buyer_email as string | undefined;
      const secondaryEmail = (secondaryEmailRaw && secondaryEmailRaw.trim()) || agreement.buyer_email;

      // Anchor tokens embedded directly inside the Gamma template (white text,
      // tiny font — invisible to humans, readable by DocuSign's text scanner).
      // The template author pastes these tokens into the signature block of the
      // Gamma doc. We then send the raw Gamma PDF to DocuSign untouched — no
      // appended execution page — so what the buyer sees on mobile is exactly
      // the branded Gamma layout.
      const ANCHOR = {
        buyerSig: '\\sig_buyer_1\\',
        buyerDate: '\\date_buyer_1\\',
        buyerName: '\\name_buyer_1\\',
        secSig: '\\sig_buyer_2\\',
        secDate: '\\date_buyer_2\\',
        secName: '\\name_buyer_2\\',
        agentSig: '\\sig_agent\\',
        agentDate: '\\date_agent\\',
        agentName: '\\name_agent\\',
      };

      // Resolve the Gamma PDF. If it's not yet in storage, attempt a deferred
      // fetch. We REQUIRE the Gamma PDF — no execution-page fallback anymore.
      let pdfBytes: Uint8Array | null = null;
      let resolvedAgreement = agreement;

      if (!resolvedAgreement.pdf_storage_path && resolvedAgreement.gamma_document_id) {
        const gammaApiKey = Deno.env.get('GAMMA_API_KEY');
        if (gammaApiKey) {
          console.log('[DocuSign] No pdf_storage_path yet — attempting deferred Gamma fetch for:', resolvedAgreement.gamma_document_id);
          const deferredUrl = await attemptDeferredPdfFetch(supabase, resolvedAgreement, gammaApiKey);
          if (deferredUrl) {
            const { data: refreshed } = await supabase
              .from('agency_agreements')
              .select('*')
              .eq('id', agreement_id)
              .single();
            if (refreshed?.pdf_storage_path) {
              resolvedAgreement = refreshed;
              console.log('[DocuSign] Deferred fetch succeeded — using PDF at:', refreshed.pdf_storage_path);
            }
          }
        }
      }

      if (!resolvedAgreement.pdf_storage_path) {
        return new Response(
          JSON.stringify({
            error: 'Gamma agreement document is not ready yet. Please wait for generation to complete and try again.',
            code: 'PDF_NOT_READY',
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[DocuSign] Downloading Gamma PDF from storage:', resolvedAgreement.pdf_storage_path);
      const { data: pdfBlob, error: dlErr } = await supabase.storage
        .from('agency-agreements')
        .download(resolvedAgreement.pdf_storage_path);
      if (dlErr || !pdfBlob) {
        console.error('[DocuSign] Failed to download stored PDF:', dlErr?.message);
        return new Response(
          JSON.stringify({ error: `Failed to load Gamma PDF from storage: ${dlErr?.message || 'not found'}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
      console.log('[DocuSign] Loaded Gamma PDF, size:', pdfBytes.byteLength, 'bytes');

      // Send the Gamma PDF as-is — DocuSign will anchor onto the embedded tokens.
      const finalPdfBytes = pdfBytes;
      let bin = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < finalPdfBytes.length; i += chunkSize) {
        bin += String.fromCharCode(...finalPdfBytes.subarray(i, i + chunkSize));
      }
      const base64Doc = btoa(bin);
      const docName = "Buyer's Agent Agreement.pdf";
      const docExt = 'pdf';
      console.log('[DocuSign] Final PDF size:', finalPdfBytes.length, 'bytes (raw Gamma, no execution page)');

      // Build signer tabs against the anchor tokens embedded in the Gamma
      // template. Tokens should be placed (white, ~6pt) where you want the
      // signature/date/name to appear. The signature graphic is centered on the
      // anchor (offset up so it sits ABOVE the token's baseline). Date/name
      // sit on the token's baseline. anchorIgnoreIfNotPresent=true so that an
      // absent token (e.g. secondary buyer in a single-buyer template) is a
      // no-op rather than an envelope failure.
      const buildTabs = (sig: string, date: string, name: string) => ({
        signHereTabs: [{
          anchorString: sig,
          anchorUnits: 'pixels',
          anchorXOffset: '0',
          anchorYOffset: '-30',
          anchorIgnoreIfNotPresent: 'true',
          anchorCaseSensitive: 'true',
          anchorMatchWholeWord: 'false',
          scaleValue: '0.7',
        }],
        dateSignedTabs: [{
          anchorString: date,
          anchorUnits: 'pixels',
          anchorXOffset: '0',
          anchorYOffset: '-2',
          anchorIgnoreIfNotPresent: 'true',
          anchorCaseSensitive: 'true',
          anchorMatchWholeWord: 'false',
          font: 'Helvetica',
          fontSize: 'Size10',
        }],
        fullNameTabs: [{
          anchorString: name,
          anchorUnits: 'pixels',
          anchorXOffset: '0',
          anchorYOffset: '-2',
          anchorIgnoreIfNotPresent: 'true',
          anchorCaseSensitive: 'true',
          anchorMatchWholeWord: 'false',
          font: 'Helvetica',
          fontSize: 'Size10',
        }],
      });
      const buyerTabs = buildTabs(ANCHOR.buyerSig, ANCHOR.buyerDate, ANCHOR.buyerName);
      const secondaryTabs = buildTabs(ANCHOR.secSig, ANCHOR.secDate, ANCHOR.secName);
      const agentTabs = buildTabs(ANCHOR.agentSig, ANCHOR.agentDate, ANCHOR.agentName);

      const signers: any[] = [
        {
          email: agreement.buyer_email,
          name: agreement.buyer_names,
          recipientId: '1',
          routingOrder: '1',
          tabs: buyerTabs,
        },
      ];
      if (hasSecondary) {
        signers.push({
          email: secondaryEmail,
          name: agreement.secondary_buyer_name,
          recipientId: '2',
          routingOrder: '2',
          tabs: secondaryTabs,
        });
      }
      if (agentSignerEmail) {
        signers.push({
          email: agentSignerEmail,
          name: agentSignerName,
          recipientId: String(signers.length + 1),
          routingOrder: String(signers.length + 1),
          tabs: agentTabs,
        });
      } else {
        console.warn('[DocuSign] No agent signer email configured; skipping agent recipient.');
      }

      const envelopeDefinition = {
        emailSubject: `Buyer's Agent Agreement — ${agreement.buyer_names}`,
        emailBlurb: `Dear ${agreement.buyer_names},\n\nPlease review and sign the attached Buyer's Agent Agreement.\n\nKind regards,\n${brandCfg.companyName || 'Property Consulting'}`,
        documents: [
          {
            documentBase64: base64Doc,
            name: docName,
            fileExtension: docExt,
            documentId: '1',
          },
        ],
        recipients: { signers },
        status: 'sent',
      };


      try {
        const envelopeUrl = `${docusignBaseUrl}/v2.1/accounts/${docusignAccountId}/envelopes`;
        console.log('[DocuSign] Sending envelope to:', envelopeUrl);
        
        const dsResponse = await fetch(envelopeUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${docusignAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(envelopeDefinition),
        });

        const responseText = await dsResponse.text();
        console.log('[DocuSign] Response status:', dsResponse.status, 'Content-Type:', dsResponse.headers.get('content-type'));
        
        // Check if response is JSON before parsing
        let dsData: any;
        try {
          dsData = JSON.parse(responseText);
        } catch {
          console.error('[DocuSign] Non-JSON response:', responseText.substring(0, 500));
          return new Response(
            JSON.stringify({
              error: `DocuSign returned a non-JSON response (status ${dsResponse.status}). This usually means the DOCUSIGN_BASE_URL is incorrect. Current URL: ${docusignBaseUrl}. For demo accounts use: https://demo.docusign.net/restapi`,
              hint: 'Check your DOCUSIGN_BASE_URL secret value',
            }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!dsResponse.ok) {
          console.error('[DocuSign] Envelope creation failed:', JSON.stringify(dsData));
          return new Response(
            JSON.stringify({
              error: `DocuSign error: ${dsData.message || dsData.errorCode || 'Unknown error'}`,
              details: dsData,
            }),
            { status: dsResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Update agreement with DocuSign info
        const { error: updateErr } = await supabase
          .from('agency_agreements')
          .update({
            status: 'sent',
            docusign_envelope_id: dsData.envelopeId,
            docusign_status: dsData.status,
            docusign_sent_at: new Date().toISOString(),
            sent_via: 'docusign',
          })
          .eq('id', agreement_id);

        if (updateErr) {
          console.error('[DocuSign] Failed to update agreement:', updateErr);
        }

        return new Response(
          JSON.stringify({
            success: true,
            envelope_id: dsData.envelopeId,
            status: dsData.status,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (dsError: any) {
        console.error('[DocuSign] API error:', dsError);
        return new Response(
          JSON.stringify(internalError(dsError, 'manage-agency-agreements')),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ─── CHECK DOCUSIGN STATUS ─────────────────────────────
    if (action === 'check_status') {
      const { agreement_id } = body;

      const { data: agreement, error: fetchErr } = await supabase
        .from('agency_agreements')
        .select('*')
        .eq('id', agreement_id)
        .single();

      if (fetchErr || !agreement || !agreement.docusign_envelope_id) {
        return new Response(
          JSON.stringify({ error: 'Agreement or envelope not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const docusignAccountId = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
      const docusignBaseUrl = getDocuSignRestBaseUrl();

      if (!docusignAccountId) {
        return new Response(
          JSON.stringify({ error: 'DocuSign not configured' }),
          { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let docusignAccessToken: string;
      try {
        docusignAccessToken = await getDocuSignAccessToken();
      } catch (tokenErr: any) {
        return new Response(
          JSON.stringify({ error: `DocuSign auth failed: ${tokenErr.message}` }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const dsResponse = await fetch(
        `${docusignBaseUrl}/v2.1/accounts/${docusignAccountId}/envelopes/${agreement.docusign_envelope_id}`,
        {
          headers: { Authorization: `Bearer ${docusignAccessToken}` },
        }
      );

      const dsData = await dsResponse.json();
      if (!dsResponse.ok) {
        return new Response(
          JSON.stringify({ error: `DocuSign: ${dsData.message || 'Unknown'}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Map DocuSign status to our status
      let newStatus = agreement.status;
      const updates: Record<string, any> = {
        docusign_status: dsData.status,
      };

      if (dsData.status === 'completed') {
        newStatus = 'signed';
        updates.docusign_signed_at = dsData.completedDateTime || new Date().toISOString();
      } else if (dsData.status === 'delivered') {
        newStatus = 'delivered';
      } else if (dsData.status === 'sent') {
        newStatus = 'sent';
      } else if (dsData.status === 'declined') {
        newStatus = 'declined';
      } else if (dsData.status === 'voided') {
        newStatus = 'voided';
        updates.docusign_voided_at = dsData.voidedDateTime || new Date().toISOString();
      }

      updates.status = newStatus;

      await supabase
        .from('agency_agreements')
        .update(updates)
        .eq('id', agreement_id);

      return new Response(
        JSON.stringify({ success: true, status: newStatus, docusign_status: dsData.status }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── ENVELOPE DETAILS (status + recipients + audit events) ─
    if (action === 'envelope_details') {
      const { agreement_id } = body;
      const { data: agreement, error: fetchErr } = await supabase
        .from('agency_agreements').select('*').eq('id', agreement_id).single();
      if (fetchErr || !agreement?.docusign_envelope_id) {
        return new Response(JSON.stringify({ error: 'Envelope not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const acct = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
      const base = getDocuSignRestBaseUrl();
      if (!acct) return new Response(JSON.stringify({ error: 'DocuSign not configured' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      let token: string;
      try { token = await getDocuSignAccessToken(); }
      catch (e: any) { return new Response(JSON.stringify({ error: `DocuSign auth failed: ${e.message}` }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

      const auth = { Authorization: `Bearer ${token}` };
      const envId = agreement.docusign_envelope_id;
      const [envRes, recRes, evtRes] = await Promise.all([
        fetch(`${base}/v2.1/accounts/${acct}/envelopes/${envId}`, { headers: auth }),
        fetch(`${base}/v2.1/accounts/${acct}/envelopes/${envId}/recipients`, { headers: auth }),
        fetch(`${base}/v2.1/accounts/${acct}/envelopes/${envId}/audit_events`, { headers: auth }),
      ]);
      const envelope = await envRes.json();
      const recipients = recRes.ok ? await recRes.json() : null;
      const auditRaw = evtRes.ok ? await evtRes.json() : null;
      if (!envRes.ok) {
        return new Response(JSON.stringify({ error: `DocuSign: ${envelope?.message || 'Unknown'}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Persist refreshed status
      let newStatus = agreement.status;
      const updates: Record<string, any> = { docusign_status: envelope.status };
      if (envelope.status === 'completed') { newStatus = 'signed'; updates.docusign_signed_at = envelope.completedDateTime || new Date().toISOString(); }
      else if (envelope.status === 'delivered') newStatus = 'delivered';
      else if (envelope.status === 'sent') newStatus = 'sent';
      else if (envelope.status === 'declined') newStatus = 'declined';
      else if (envelope.status === 'voided') { newStatus = 'voided'; updates.docusign_voided_at = envelope.voidedDateTime || new Date().toISOString(); }
      updates.status = newStatus;
      await supabase.from('agency_agreements').update(updates).eq('id', agreement_id);

      // Flatten audit events
      const events = (auditRaw?.auditEvents || []).map((ev: any) => {
        const fields: Record<string, string> = {};
        (ev.eventFields || []).forEach((f: any) => { fields[f.name] = f.value; });
        return {
          action: fields.Action || fields.action || 'event',
          description: fields.Description || fields.description || '',
          user: fields.UserName || fields.userName || '',
          email: fields.UserEmail || fields.userEmail || '',
          timestamp: fields.LogTime || fields.logTime || '',
        };
      }).filter((e: any) => e.timestamp);

      const signers = (recipients?.signers || []).map((s: any) => ({
        name: s.name, email: s.email, status: s.status, routingOrder: s.routingOrder,
        sentAt: s.sentDateTime, deliveredAt: s.deliveredDateTime, signedAt: s.signedDateTime, declinedReason: s.declinedReason,
      }));

      return new Response(JSON.stringify({
        success: true,
        envelope: {
          envelopeId: envelope.envelopeId, status: envelope.status, emailSubject: envelope.emailSubject,
          sentDateTime: envelope.sentDateTime, statusChangedDateTime: envelope.statusChangedDateTime,
          completedDateTime: envelope.completedDateTime, voidedDateTime: envelope.voidedDateTime, voidedReason: envelope.voidedReason,
        },
        signers, events, mapped_status: newStatus,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ─── DOWNLOAD SIGNED PDF ───────────────────────────────
    if (action === 'download_signed') {
      const { agreement_id } = body;
      const { data: agreement, error: fErr } = await supabase
        .from('agency_agreements').select('id, docusign_envelope_id, buyer_names').eq('id', agreement_id).single();
      if (fErr || !agreement?.docusign_envelope_id) {
        return new Response(JSON.stringify({ error: 'Envelope not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const acct = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
      const base = getDocuSignRestBaseUrl();
      if (!acct) return new Response(JSON.stringify({ error: 'DocuSign not configured' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      let token: string;
      try { token = await getDocuSignAccessToken(); }
      catch (e: any) { return new Response(JSON.stringify({ error: `DocuSign auth: ${e.message}` }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      const url = `${base}/v2.1/accounts/${acct}/envelopes/${agreement.docusign_envelope_id}/documents/combined`;
      const dsRes = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } });
      if (!dsRes.ok) {
        const txt = await dsRes.text();
        return new Response(JSON.stringify({ error: `DocuSign: ${txt.substring(0, 300)}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const bytes = new Uint8Array(await dsRes.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      const filename = `${(agreement.buyer_names || 'Agreement').replace(/[^a-z0-9]+/gi, '_')}_signed.pdf`;
      return new Response(JSON.stringify({ success: true, pdf_base64: b64, filename }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ─── VOID AGREEMENT ────────────────────────────────────
    if (action === 'void') {
      const { agreement_id, void_reason } = body;

      const { data: agreement } = await supabase
        .from('agency_agreements')
        .select('docusign_envelope_id')
        .eq('id', agreement_id)
        .single();

      // Void in DocuSign if applicable
      if (agreement?.docusign_envelope_id) {
        const docusignAccountId = Deno.env.get('DOCUSIGN_ACCOUNT_ID');
        const docusignBaseUrl = getDocuSignRestBaseUrl();

        if (docusignAccountId) {
          try {
            const docusignAccessToken = await getDocuSignAccessToken();
            await fetch(
              `${docusignBaseUrl}/v2.1/accounts/${docusignAccountId}/envelopes/${agreement.docusign_envelope_id}`,
              {
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${docusignAccessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  status: 'voided',
                  voidedReason: void_reason || 'Voided by agent',
                }),
              }
            );
          } catch (tokenErr: any) {
            console.error('[DocuSign] Void token error:', tokenErr.message);
          }
        }
      }

      await supabase
        .from('agency_agreements')
        .update({
          status: 'voided',
          docusign_status: 'voided',
          docusign_voided_at: new Date().toISOString(),
          notes: void_reason ? `Voided: ${void_reason}` : 'Voided',
        })
        .eq('id', agreement_id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[manage-agency-agreements] Error:', error);
    return new Response(
      JSON.stringify(internalError(error, 'manage-agency-agreements')),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Generate the agreement HTML document for DocuSign
 * This mirrors the PDF template structure with pre-filled values
 */
async function generateAgreementHtml(agreement: any): Promise<string> {
  const date = agreement.agreement_date
    ? new Date(agreement.agreement_date).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  // Resolve dynamic brand identity. Falls back to safe defaults when
  // global_report_settings is empty so legal copy never breaks.
  const brand = await getBrandConfig();
  const legalEntity = brand.companyName || 'Property Consulting';
  const legalAddress = brand.contactAddress || '[Address]';
  const legalEmail = brand.contactEmail || 'admin@example.com';
  const legalAbn = brand.abn || '';
  const footerLine = legalAbn ? `${legalEntity} | ABN: ${legalAbn}` : legalEntity;

  return `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Georgia', serif; margin: 40px; color: #1a1a1a; line-height: 1.6; font-size: 11pt; }
  h1 { text-align: center; font-size: 18pt; margin-bottom: 30px; color: #0a2e4a; }
  h2 { font-size: 13pt; margin-top: 24px; color: #0a2e4a; }
  .header-block { margin-bottom: 30px; }
  .party { margin-bottom: 15px; }
  .party-label { font-weight: bold; }
  table.fees { width: 100%; border-collapse: collapse; margin: 15px 0; }
  table.fees th, table.fees td { border: 1px solid #ccc; padding: 8px 12px; text-align: left; }
  table.fees th { background: #f0f4f8; }
  .signature-block { margin-top: 40px; display: flex; gap: 80px; }
  .sig-col { flex: 1; }
  .sig-line { border-bottom: 1px solid #333; height: 40px; margin: 5px 0; }
  .footer { text-align: center; font-size: 9pt; color: #666; margin-top: 40px; border-top: 1px solid #ccc; padding-top: 10px; }
  ol { padding-left: 20px; }
  ol li { margin-bottom: 8px; }
  ul { padding-left: 20px; }
  ul li { margin-bottom: 6px; }
</style>
</head>
<body>

<h1>PROPERTY CONSULTANT & BUYER'S AGENT AGREEMENT</h1>

<div class="header-block">
  <p>THIS AGREEMENT is made on <strong>${date}</strong> by and between:</p>
  
  <div class="party">
    <p class="party-label">1. ${agreement.buyer_names}</p>
    <p>${agreement.buyer_address || '[Address]'}</p>
    <p>${agreement.buyer_phone || '[Phone Number]'}</p>
    <p>${agreement.buyer_email || '[Email]'}</p>
    <p>(Hereinafter referred to as "the Buyer")</p>
  </div>
  
  <div class="party">
    <p class="party-label">2. ${legalEntity}</p>
    <p>${legalAddress.replace(/\n/g, '<br>')}</p>
    <p>${legalEmail}</p>
    <p>(Hereinafter referred to as "the Agent")</p>
  </div>
  
  <p>The parties agree as follows:</p>
</div>

<h2>1. ENGAGEMENT OF AGENT</h2>
<p>The Buyer engages the Agent to act as their exclusive representative for the purpose of identifying and acquiring real property in accordance with the terms of this Agreement.</p>

<h2>2. TERM OF AGREEMENT</h2>
<p>This Agreement will be effective from the date of execution and will continue until the earlier of:</p>
<ul>
  <li>a) Ninety (90) days from the date of execution of this Agreement, during which the Agent will source and present suitable property opportunities to the Buyer; or</li>
  <li>b) The completion of the purchase of a property by the Buyer.</li>
</ul>

<h2>3. AGENT'S RESPONSIBILITIES</h2>
<p>The Agent agrees to:</p>
<ol>
  <li><strong>Locate & Present</strong> — To locate and present to the Buyer properties that match the Buyer's criteria.</li>
  <li><strong>Advise & Evaluate</strong> — Provide information and advice to the Buyer about the market, potential properties, and assist in evaluating those properties.</li>
  <li><strong>Coordinate Viewings</strong> — Coordinate property viewings and inspections if necessary.</li>
  <li><strong>Negotiate Terms</strong> — Negotiate the terms and conditions of any offers, including price, with the Seller or their agent on the Buyer's behalf.</li>
  <li><strong>Prepare Documents</strong> — Assist the Buyer in the preparation and execution of purchase-related documents.</li>
  <li><strong>Timely Updates</strong> — Provide timely updates and communications to the Buyer throughout the property acquisition process.</li>
</ol>

<h2>4. BUYER'S RESPONSIBILITIES</h2>
<p>The Buyer agrees to:</p>
<ul>
  <li>Provide the Agent with accurate and up-to-date information about their preferences, financial situation, and criteria for purchasing the property.</li>
  <li>Respond promptly to the Agent's communications and take reasonable steps to facilitate the transaction.</li>
  <li>Advise the Agent immediately if the Buyer becomes aware of any issues that could affect the potential property acquisition.</li>
</ul>

<h2>5. AGENT'S FEES AND COMMISSION</h2>
<p>The Buyer agrees to pay the Agent the below commission of the purchase price of any property acquired as a result of the Agent's services.</p>

<table class="fees">
  <tr><th>Initial Commitment Fee (ICF):</th><td>${agreement.initial_commitment_fee ? `$${Number(agreement.initial_commitment_fee).toLocaleString('en-AU', { minimumFractionDigits: 2 })} + GST` : '$1,500.00 + GST'} (Non-Refundable, deducted from Final Payment from Property Purchase)</td></tr>
</table>

<table class="fees">
  <tr><th>Property Purchase Price</th><th>Percentage Agent Fee + GST</th></tr>
  <tr><td>Below $650,000</td><td>1.3%</td></tr>
  <tr><td>$650,000 - $1,000,000</td><td>1.2%</td></tr>
  <tr><td>$1,000,000 - $2,000,000</td><td>1.1%</td></tr>
  <tr><td>Above $2,000,000</td><td>1.0%</td></tr>
</table>

<p><em>Disclosure: If applicable, should the Buyer opt to proceed with a purchase of a property where the above-mentioned commission can be requested from a developer/builder, the Buyer will then only be charged the ICF.</em></p>
<p>The commission is payable upon completion of the purchase transaction (settlement date).</p>

<h2>6. BUYER'S AGENT DUTY OF CARE AND DISCLOSURE</h2>
<p>The Agent shall act in the best interests of the Buyer at all times. The Agent shall disclose any potential conflicts of interest, including but not limited to any relationships with property sellers, developers, or other agents, and shall provide the Buyer with all relevant information to make an informed decision.</p>
<p>The Buyer acknowledges that while the Agent will use reasonable efforts to find suitable properties, the Agent does not guarantee the availability or suitability of any specific property.</p>

<h2>7. TERMINATION OF AGREEMENT</h2>
<p>This Agreement may be terminated by either party in writing with 14 Days' notice. Upon termination, the Buyer will:</p>
<ul>
  <li>Pay any outstanding commission due to the Agent for services rendered up to the termination date, should it be applicable.</li>
  <li>Reimburse the Agent for any reasonable expenses incurred during the course of performing their obligations under this Agreement.</li>
</ul>

<h2>8. DISPUTE RESOLUTION</h2>
<p>In the event of any dispute arising from this Agreement, the parties agree to first attempt to resolve the dispute through negotiation. If the dispute cannot be resolved through negotiation, the parties agree to submit the matter to mediation or arbitration before pursuing legal action.</p>

<h2>9. PRIVACY AND CONFIDENTIALITY</h2>
<p>The Agent agrees to maintain the confidentiality of the Buyer's personal and financial information. The Agent will not disclose such information to any third party unless required by law or unless the Buyer provides written consent.</p>

<h2>10. ENTIRE AGREEMENT</h2>
<p>This Agreement constitutes the entire understanding between the parties and supersedes all prior discussions, understandings, or agreements related to the subject matter hereof. Any amendments to this Agreement must be made in writing and signed by both parties.</p>

<p>The parties hereto have executed this Agreement as of the day and year first written above.</p>

<div style="margin-top: 40px;">
  <table style="width: 100%; border: none;">
    <tr>
      <td style="width: 48%; border: none; vertical-align: top;">
        <p><strong>Buyer's Name:</strong> ${agreement.buyer_names}</p>
        <p><strong>Buyer's Signature:</strong></p>
        <div>___BUYER_SIGNATURE___</div>
        <p><strong>Date:</strong> ___BUYER_DATE___</p>
      </td>
      <td style="width: 4%; border: none;"></td>
      <td style="width: 48%; border: none; vertical-align: top;">
        ${
          agreement.secondary_buyer_name
            ? `<p><strong>Buyer's Name:</strong> ${agreement.secondary_buyer_name}</p>
               <p><strong>Buyer's Signature:</strong></p>
               <div>___SECONDARY_SIGNATURE___</div>
               <p><strong>Date:</strong> ___BUYER_DATE___</p>`
            : ''
        }
      </td>
    </tr>
  </table>
</div>

<div style="margin-top: 40px;">
  <p><strong>Agent's Name:</strong> ___________________________</p>
  <p><strong>Agent Signature:</strong> ___________________________</p>
  <p><strong>Date:</strong> ___________________________</p>
</div>

<h2 style="page-break-before: always;">Terms and Conditions</h2>

<h3>1.1</h3>
<p>The client appoints ${legalEntity} as their exclusive agent to perform services in respect to a property which meets the specifications provided the client, in accordance with the terms of this Agreement.</p>

<h3>1.2</h3>
<p>The Parties will be deemed to have accepted the terms of this agreement upon the Client's execution of this Agreement (Including Electronic Execution) or upon ${legalEntity} receipt of any commission from the Client.</p>

<h3>1.3</h3>
<p>The term of this Agreement will be from the date the client accepts the terms of this agreement, after which this agreement will remain enforceable until it is terminated by either party giving (14) days' notice in writing.</p>

<h3>1.4 The Client Agrees to:</h3>
<p>1.4.1 Notify ${legalEntity} in writing of any amendments to the personal details or property specifications.</p>
<p>1.4.2 Always Cooperate with ${legalEntity}.</p>
<p>1.4.3 Obtain Independent legal, financial, investment, tax and other advice pursuant to the Purchase.</p>
<p>1.4.4 Not purchase any property which was presented by ${legalEntity} to the client during the term.</p>
<p>1.4.5 Not appoint another agent to act on its behalf during the time of the term.</p>

<h3>1.5</h3>
<p>The Client warrants that they have authority to enter into this agreement.</p>

<h3>1.6</h3>
<p>The Client warrants they are not subject to any earlier or concurrent agency agreement which would conflict with its obligations.</p>

<h3>1.7</h3>
<p>The Client agrees to pay the commission/sign up fee to ${legalEntity} as specified.</p>

<h3>1.8</h3>
<p>The Client agrees to pay ${legalEntity} the applicable Commission upon the earlier of: entering a contract, purchasing or procuring that another person purchases, or becoming the legal or equitable beneficial owner of a property.</p>

<h3>1.9</h3>
<p>The Commission will also be payable where any of the matters in clause 1.8 arise at anytime within 12 months after termination.</p>

<h3>1.10</h3>
<p>The Client indemnifies ${legalEntity} for all expenses, costs, and disbursements incurred in recovering any outstanding fees.</p>

<h3>1.11</h3>
<p>The Client acknowledges that any data information or advice provided by ${legalEntity} is of general purpose only and does not constitute financial or investment advice.</p>

<h3>1.12</h3>
<p>The Client acknowledges that the market data provided is solely for the benefit of the client and may only be relied upon for the purposes of this Agreement.</p>

<h3>1.13</h3>
<p>The Client acknowledges that they are responsible for their purchasing decision and that ${legalEntity} makes no guarantee or warranties.</p>

<h3>1.14</h3>
<p>${legalEntity} may recommend third parties to the client. The client acknowledges that all third parties are independent of ${legalEntity}.</p>

<h3>1.15</h3>
<p>Under no circumstances will ${legalEntity} be liable for any indirect, incidental, special, consequential, aggravated, exemplary and/or punitive damages.</p>

<h3>1.16</h3>
<p>The Client will indemnify and hold ${legalEntity} harmless from any liabilities, actions, suits, proceedings, claims, demands, costs, loss, damage, and expenses of any nature.</p>

<h3>1.17</h3>
<p>Each of the terms set out in this agreement is severable and independent.</p>

<h3>1.18</h3>
<p>This agreement will be governed by and interpreted in accordance with laws pertaining to all associated states within Australia.</p>

<h3>1.19</h3>
<p>The Client acknowledges that this agreement constitutes the whole agreement and supersedes all communications, negotiations, arrangements and agreements prior to the date of this agreement.</p>

<div class="footer">
  ${footerLine}
</div>

</body>
</html>`;
}
