# Import from URL

Paste a share/view link and reconstruct it into an editable template — no manual download.

> Status: **v1 implemented** · Last updated: 2026‑06‑10

## Flow
1. **Client normalises** the link with the pure, unit‑tested `src/lib/reportTemplate/importUrl.ts`
   (`normalizeImportUrl`) → a directly‑fetchable URL + expected kind + provider.
2. **`import-from-url` edge function** does the cross‑origin fetch the browser can't, behind
   `verifyAuth` + **SSRF guards** (private/reserved hosts blocked on every redirect hop) + 30 MB / 20 s
   limits, and returns the bytes as base64 (or guidance).
3. The client turns the bytes into a `File` and drops it into the existing import flow
   (`extractPdfToTemplate` for PDFs, the OCR‑grounded path for images).

## Provider support
| Provider | Handling |
|---|---|
| **Google Drive** | `…/file/d/{id}/view` → `uc?export=download&id={id}` |
| **Google Docs / Slides / Sheets** | `…/export?format=pdf` (Slides `…/export/pdf`) |
| **Dropbox** | content host + `dl=1` |
| **OneDrive / SharePoint** | `?download=1` (best‑effort; link must be "anyone with the link") |
| **Generic `.pdf` / image URL** | fetched directly |
| **Figma** | exported via the Figma REST API when `FIGMA_TOKEN` is set; else guidance to export PDF |
| **Canva / Gamma** | no public file URL → guidance to export PDF and paste that link |

## Security
- All fetching is **server‑side**; `isLikelyPrivateHost` (mirrored in the edge function) blocks
  localhost, RFC‑1918, link‑local/`169.254.169.254`, CGNAT, multicast and IPv6 ULA/link‑local.
- Redirects are followed **manually** so every hop is re‑validated (defeats public→internal redirects).
- Only `http(s)`; size + timeout capped.

## Not yet
- **Headless render of interactive app pages** (Figma without a token, Canva, Gamma "code‑built"
  designs). True fidelity for those needs a browser‑render microservice (same pattern as the WeasyPrint
  service) → screenshot → the R5 OCR‑grounded reconstruct path. Until then we guide the user to export PDF.
- DNS‑rebinding is mitigated at the hostname level only (no IP pinning in the edge runtime).
