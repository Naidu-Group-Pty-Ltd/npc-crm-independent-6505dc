# Brand assets

Assets live in the repo, not in this skill — one copy, no drift. This file says
which file is which, because **several of them are not what their filenames
suggest**.

## The marks

| File | What it actually is | Safe on a client document? |
| --- | --- | --- |
| `public/images/npc-logo-monogram.png` | **The mark.** Woven gold-gradient N, 559×447 RGBA, transparent background. | **Yes — use this one.** |
| `public/images/npc-signature-logo.png` | An **email-signature banner**, 1200×400. Contains Rugesh Naidu's name, title, **mobile number and email address burned into the pixels**, plus a skyline. | **No.** |
| `public/icons/icon-512.png` | The same signature banner, letterboxed into a 512×512 square. It is the PWA icon. | **No.** |
| `public/icons/icon-192.png`, `apple-touch-icon.png`, `icon-maskable-512.png` | Same banner at other sizes. | **No.** |
| `public/images/npc-og-logo.jpg` | 640×640 social card. | Social only. |
| `public/images/og-image.png` | 1024×1024, and it is actually a JPEG despite the extension. | Social only. |
| `public/favicon.ico` | 73×74 PNG despite the extension. | Favicon only. |

> **Read this twice before shipping a report cover.** Putting
> `npc-signature-logo.png` or any `icon-*.png` on a generated document prints the
> director's personal mobile number on every client PDF. Only
> `npc-logo-monogram.png` is a clean mark.

### Placement

The mark sits on **obsidian or ivory, never a mid tone**. Do not auto-invert it —
it is a gold gradient, and inverting produces a muddy blue. If a ground needs a
reversed mark, that is a separate asset the designer must supply.

`--logo-height-*` in `tokens/surfaces.css` sizes it on screen. Print sizing lives in
[`../reports/REPORT_RULES.md`](../reports/REPORT_RULES.md).

## Fonts

| File | Face |
| --- | --- |
| `public/fonts/Cinzel-Bold.ttf` | Cinzel Bold — engraved Roman capitals. Report covers and certificates only. |
| `public/fonts/PlayfairDisplay-Medium.ttf` | Playfair Display Medium — display serif for headings and pull quotes. |

Both are OFL-licensed and redistributable, including inside a container image.

`public/fonts/` also contains `Cinzel.zip`, `PlayfairDisplay.zip` and
`Cinzel_Playfair_Display.zip` — **3.8 MB of source archives served to every browser
for nothing.** They are unreferenced and should be deleted.

Neither TTF is wired into any CSS today. For PDF rendering they must be installed
in the WeasyPrint container; the browser never loads them.

## Report cover art

`public/templates/npc-cashflow-cover.jpg`, `npc-formara-cover.jpg`,
`npc-qa-cover.jpg`, `npc-portfolio-cover-new.jpg`, plus `npc_template.pdf` (a
pre-branded PDF that `PixelPerfectPDFGenerator` stamps text onto).

Desaturated architectural photography on obsidian. Note that
`render-investment-report-pdf/index.ts` currently fetches one of these from a
**hardcoded `lovable.app` URL** rather than from the repo or storage — that is a
defect, tracked for the report-design work.

## Tenant assets

White-label tenants upload their own marks to the public Supabase Storage bucket
`branding-assets`, path `${slot}/${timestamp}.${ext}`, resolved by
`src/branding/brand-assets.ts:getBrandAssetSrc`. Slots today are
`auth | sidebar | sidebar-icon | favicon` — there is **no report slot yet**.
