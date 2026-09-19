# NPC Services — brand guide

The design system for **Naidu Property Consulting Services** (trading as
**NPC Services**), an Australian property advisory and buyers-agency practice, and
for the platform it runs on. Director: **Rugesh Naidu** — Property Consultant &
Buyers Agent, `npcservices.com.au`.

Everything here is derived from the product's own code and brand assets. Where the
source is silent, this guide says so rather than inventing an answer.

Synced from the **NPC Services Design System** project on
[claude.ai/design](https://claude.ai/design) (reachable with the **DesignSync**
tool), which holds the full system: 27 guideline specimen cards, four UI kits, and
the component library.

---

## 1 · Precedence

This skill is a *local working copy* of the brand. It is not the runtime source of
truth for colour.

| If these disagree | The winner is |
| --- | --- |
| `src/styles/tokens.css` vs the design-system project | **the repo** — and the project needs re-syncing |
| this skill's `tokens/` vs `src/styles/tokens.css` | **the repo**, for anything the repo defines |
| this skill's type scale / spacing scale | **this skill** — the repo does not define these yet |

The repo currently has **no `--text-*` / `--leading-*` / `--tracking-*` scale and no
`--space-*` scale**; spacing is still Tailwind's default. Those parts of
`tokens/typography.css` and `tokens/spacing.css` are the published specification,
not a mirror.

---

## 2 · Voice

**Precise, unhurried, quietly authoritative.** This is a firm that moves other
people's money. Copy never oversells and never jokes. It states the position, names
the next action, and stops.

- **Sentence case** for everything the reader sees. Two exceptions: the letterspaced
  UPPERCASE eyebrow (a CSS transform over sentence-cased source — `Deal command
  centre` → `DEAL COMMAND CENTRE`), and Australian legal/industry proper nouns
  (AUSTRAC, AML/CTF, RBA, Pre-Approval, Under Contract, PEXA).
- **Person.** *You* for the reader, *we* for NPC. Internal staff surfaces get
  imperatives and nouns instead ("Generate report", "Files requiring action").
  Never "I".
- **Australian English, always.** Organis*e*, authoris*e*, centr*e*, modell*ing*,
  analys*e*, licence (noun). Currency is `en-AU` AUD with no decimals — `$842,000`.
  Dates are `d MMM yyyy` (`14 Aug 2026`); relative for recency.
- **Numbers carry their unit and their comparison.** `$11,480/mo`,
  `+6.1% vs last quarter`, `2d to clause`. A bare number with no unit or baseline
  is a bug.
- **Every empty state names the thing and the owner.** Never "No data".
- **Eyebrows are two or three words.**
- **No emoji. Ever.** No exclamation marks either, except inside a genuine
  congratulation. The brand is a gold monogram on obsidian; emoji breaks it
  instantly.

---

## 3 · Colour

Two full themes over one token contract, in `src/styles/tokens.css`.

**Light** ("Luxury Property Advisory Light") is the default and is uniformly
**warm** — warm ivory page, porcelain cards, champagne wells, soft beige hairlines.
There is no cool grey anywhere. **Dark** is near-black obsidian with gold emphasis,
and is closer to the printed brand than light mode is.

Emphasis is split deliberately: light mode leads with **amethyst**
(`--primary: 262 66% 46%`) and keeps gold as `--brand`; dark mode makes the **gold**
(`43 74% 49%`) primary.

Colours are stored as **bare HSL triplets** so they compose with alpha —
`hsl(var(--primary) / 0.12)`. Partial alpha is used constantly: hairlines at 72–86%,
tint fills at 10–15%, hover washes at 30–38%.

### Category A / B / C

| Category | What | Tenant may retune? |
| --- | --- | --- |
| **A — brand** | `--primary`, `--accent`, `--brand` + the `--brand-50…950` ramp, rings, charts | **Yes** |
| **B — semantic** | `--success`, `--warning`, `--destructive`, `--info` | **Never** |
| **C — neutral** | surfaces, borders | At most a contrast-clamped tint |

Note that `--warning` *is* the gold, so a warning chip and a premium chip can look
alike — separate them by icon and copy, not colour.

---

## 4 · Type

**UI type is a system sans stack**, and that is intentional: the White-Label admin
swaps `--font-sans` / `--font-heading` per tenant
(`src/branding/brand-fonts.ts`), so **no component may declare its own
font-family**.

The product ships exactly **two webfonts** — **Cinzel Bold** and **Playfair Display
Medium** (`public/fonts/`) — used only on report covers, certificates and pull
quotes. They are currently wired into nothing; the report layer is what will use
them.

**The typographic signature is the wide uppercase eyebrow over a tight-tracked
title**: 0.18em (section labels, sidebar groups, KPI titles) or 0.34em (hero
eyebrows) above a heading tracked at −0.02em to −0.045em. KPI values are 28px/600
with tabular numerals; units trail small and muted. Nothing lighter than 400 or
heavier than 700.

---

## 5 · Spacing, radius, layout

4px base. 12px gaps in cozy grids, 16px in comfy. 24px panel padding on desktop,
16px on mobile. 24–32px between page sections.

**Nothing has square corners.** Cards 12px, buttons 13.6px (`--radius-button`,
deliberately softer than shadcn's 8px), glass and section frames 20–24px, the page
frame 32px, chips and avatars fully round.

Desktop is a fixed 288px sidebar plus a fluid main column capped at 1600px under a
72px sticky top bar. **44px is the hard hit-target floor.**

---

## 6 · Surfaces, shadow, motion

Every shell paints a composited background: an ivory→porcelain wash, a 12%-alpha
amethyst glow from the left, and a **36px hairline grid** masked to fade by 72%
depth. It is why NPC screens never read as flat white admin panels.

Light-mode shadows are **warm brown** — `rgba(80, 60, 20, α)`, low opacity, long
spread. A cool grey shadow instantly reads as a different product.

**Gradients are rationed.** Three legitimate uses: the amethyst button/active-tab
gradient, the gold rail on premium hero units, and the **aurora** (gold → amethyst →
sky, blurred) which exclusively means *Aurixa / AI*. At most one aurora per screen,
never as decoration on a data view.

Motion is 120/200/320ms on `cubic-bezier(0.22, 1, 0.36, 1)`. Nothing bounces or
springs. Everything collapses under `prefers-reduced-motion`.

---

## 7 · Iconography

**One set: [Lucide](https://lucide.dev)** (`lucide-react`), 2px stroke, rounded
caps. 16px in buttons/table cells/sidebar rows, 18–20px in KPI icon chips, 22–24px
in empty states. Muted by default, amethyst when active, semantic colour only when
the state is semantic.

**No icon font. No sprite sheet. No emoji as icons. No second icon set.**

Third-party data-source logos (`src/assets/brands/`, 44 files — PropTrack, Cotality,
Landchecker, Nearmap, Domain, Pricefinder, RBA, ABS, Equifax, Basiq, FrankieOne,
ComplyAdvantage, GoHighLevel, SQM Research) render at **native colour on a porcelain
tile** — never tinted, never inverted.

---

## 8 · Imagery

Client-facing imagery is **desaturated architectural photography** — high-rise
skylines and façades pushed toward monochrome, laid on obsidian with gold type over
the top. Warm, dusk-lit, never bright daylight. **No people, no stock handshakes.**

**Body copy never sits directly on a photo** — it sits on the obsidian panel beside
it.

Report cover art lives at `public/templates/npc-*-cover.jpg`.

---

## 9 · The logo

The mark is a **woven, gold-gradient N**. It lives on **obsidian or ivory, never a
mid tone**. Full-name lockups use wide-tracked uppercase sans in gold.

See [`assets/README.md`](./assets/README.md) — and read it before putting any
existing repo asset on a client-facing document, because most of them are not what
their filenames suggest.

---

## 10 · Known gaps

- **No body webfont.** The product genuinely ships a system stack plus a per-tenant
  picker. If NPC has a real brand typeface for the UI, it is not in the repo.
- **No clean wordmark asset.** See `assets/README.md`.
- **The repo has no spacing or type scale tokens.** Documented here, not implemented.
