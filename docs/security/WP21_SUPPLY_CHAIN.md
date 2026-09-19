# WP-21 — Detection was never the gap

Phase 7 of the 20-item app-security programme. Checklist items **18**
(outdated dependencies) and **20** (file uploads).

## Item 18

This repo already had good detection: `dependency-audit.mjs` blocking unaccepted
high/critical advisories, a CycloneDX SBOM per run, and osv-scanner in
`codex-security-scan.yml`. What it did not have was anything that opened an
upgrade PR. Every remediation depended on somebody noticing.

The evidence was sitting in the allowlist. `xlsx@^0.18.5` carried two advisories
whose accepted-reason said out loud that the real fix was to drop the
dependency — and it stayed for months, because nothing ever raised it again.

### `xlsx` — resolved, without the 21-file migration

The allowlist's premise was that SheetJS stopped publishing to npm after 0.18,
so the advisories have **no upgrade path**. That is true of the *registry*: npm's
`latest` for `xlsx` is still 0.18.5. It is not true of SheetJS, which publishes
patched releases on its own CDN, and that is the vendor's documented
distribution channel.

```
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

0.20.3 fixes both — GHSA-4r6h-8v6p-xvw6 (prototype pollution, fixed 0.19.3) and
GHSA-5pgg-2g8v-p4x9 (ReDoS, fixed 0.20.2). No code changed: 21 files and ~100
call sites keep the same synchronous API.

This matters more than a version number, because **both advisories were
reachable**. `xlsx` is not only used to generate spreadsheets here — `XLSX.read`
parses files a user uploads, through `ExcelDropzone`, `ClientFormaraUpload`,
`MigrationSourceUploader` and the CI intake pack. Attacker-controlled input into
a parser with a known prototype-pollution defect is exactly the reachable case.

Migrating to `exceljs` remains the cleaner long-term answer — it is already a
dependency — but it is 21 files across client-data import, GHL export and the
sanctions parser, and `exceljs` is async where `xlsx` is sync, so every call site
changes shape. That is its own project with its own round-trip tests. Taking the
patched release now closes the advisories today and leaves that decision on its
own merits rather than under advisory pressure.

**Trade-off, stated plainly.** A CDN tarball has no npm registry provenance, and
`npm ci` now needs `cdn.sheetjs.com` reachable. The lockfile pins the URL and an
integrity hash, so the bytes are still verified; but if that host is blocked in
your CI, the install fails. Weighed against staying on a version the registry
has stopped patching, with reachable defects in an upload parser, the trade is
worth making — but it is a real change to the build's failure modes.

Verified here: 333 tests across `src/lib/client-fact-find`,
`src/lib/ciAssessment` and the add-client import suite pass on 0.20.3, and
`npm run build` is clean.

### The rest of the audit

`nanoid` (transitive, via `docx`) had a non-breaking fix and took it.

`image-size` and `pptxgenjs` are now accepted with reasons and a review date.
The advisories are infinite loops in the ICNS/JXL/HEIF parsers, reached only
through `pptxgenjs`, whose single call site is
`src/lib/reportTemplate/pptxExporter.ts`. That runs **in the browser**, on a
PowerPoint export the user started, over images from their own template — the
worst case is that user hanging their own tab, not a server-side denial of
service. The only fix is a `pptxgenjs` major bump, which is its own change; the
same argument the repo already accepted for the vite advisories.

**The gate needed a fix to express that.** `pptxgenjs` has no advisory of its
own — `npm audit` flags it purely as the path to `image-size`, and represents
that as a `via` entry which is a bare package *name* rather than an advisory
object. There was no id to allowlist, and the only way to accept it was
`id: "pptxgenjs"`, which the allowlist's own policy forbids: *"Accepting a
package accepts everything published against it in future, including an advisory
nobody has read yet."*

So `dependency-audit.mjs` now resolves that case properly: a package flagged
**only** through other packages is accepted exactly when all of those are. The
judgement stays attached to the advisory somebody actually read, and a new
advisory against `pptxgenjs` itself would arrive as an advisory object and block,
as it should.

With that, **`node scripts/security/dependency-audit.mjs` passes** — it was
failing on `main` before this work, on 5 unaccepted high advisories.

### Dependabot

`.github/dependabot.yml`, grouped deliberately. Ungrouped npm updates on a tree
this size open dozens of PRs a week, and a review queue nobody can keep up with
is the same outcome as no PRs at all — it just looks busier.

- **Security updates travel alone and first.** That is the point of the file.
- Version updates batch into one weekly minor/patch PR.
- Majors are ignored for the build toolchain and the render path (`vite`,
  `typescript`, `react`, `@supabase/supabase-js`, `jspdf`, `pptxgenjs`). Renderer
  output is byte-compared by the golden-render guard; a Dependabot PR cannot make
  that call, so it should not raise it. The audit gate keeps saying so instead.
- `xlsx` is ignored entirely: it is a URL dependency Dependabot cannot resolve,
  and a helpful rewrite back to the registry would silently reintroduce both
  advisories.
- GitHub Actions get their own monthly group. A pinned action is a supply-chain
  dependency like any other, and there are ten workflows' worth.

## Item 20 — already closed, and the audit note was stale

The programme carried `investment-reports` as a still-public bucket needing
render-time signing. Read live, it is **`public: false`** —
`20260723120000_security_stor005_privatize_investment_reports.sql` closed it
after the STOR-004 comment that said it was excluded. The comment outlived the
exclusion, which is how it kept being reported as open.

Confirmed live for the whole set:

| Bucket | `public` | |
|---|---|---|
| `investment-reports` | false | closed by STOR-005 |
| `client-files`, `email-attachments` | false | STOR-004 |
| `partner-agreements` | false | 25 MB, `application/pdf` only |
| `qa_exports` | false | 100 MB, typed |
| `branding-assets`, `lead-magnets` | **true** | intentional; anonymous `list()` closed by RLS-W4 — no anon SELECT policy on `storage.objects` for either |

Upload hardening itself was already done and gated: `_shared/storageAuthz.ts` is
fail-closed with an empty legacy-bucket allowlist, uploads are backend-mediated
(55 `.upload(` sites in edge functions against 1 in `src/`), and
`check-storage-upload-hardening.mjs` runs in CI.

The one gap worth naming: `branding-assets` and `lead-magnets` have no
`file_size_limit` or `allowed_mime_types`, where `partner-agreements` and
`qa_exports` do. They are staff-written and public-read, so the risk is a large
or unexpected object being served from a CDN URL rather than a data leak — but
the two typed buckets show what the convention should be.

## Verification

```
node scripts/security/dependency-audit.mjs   # passes (was failing on main)
node --test scripts/security/dependency-audit.test.mjs   # 4 passed
npx vitest run src/lib/client-fact-find src/lib/ciAssessment src/components/clients/add-client
                                             # 333 passed on xlsx 0.20.3
npm run build                                # clean
```

`npm audit`: 11 total, 3 high (all accepted with reasons), 0 critical —
from 13 total / 5 high.
