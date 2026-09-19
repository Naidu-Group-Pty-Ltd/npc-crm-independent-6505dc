---
name: npc-services-design
description: The NPC Services (Naidu Property Consulting Services) brand and design system — colours, type, spacing, logo marks, voice, and the rules for generated PDF reports. Use when building or restyling any NPC surface, and whenever a generated report, PDF, cover page or client-facing document is involved.
user-invocable: true
---

# NPC Services Design System

Read [`README.md`](./README.md) first — it is the brand guide. For anything that
renders to paper or PDF, read [`reports/REPORT_RULES.md`](./reports/REPORT_RULES.md)
as well; print has its own contrast, colour and typography rules that differ from
screen.

## Where the authority lives

| Concern | Authoritative source |
| --- | --- |
| Colour tokens (runtime) | `src/styles/tokens.css` — **not** this skill |
| Type scale, spacing, radii, surfaces, motion | `tokens/` in this skill |
| Webfonts | `public/fonts/Cinzel-Bold.ttf`, `PlayfairDisplay-Medium.ttf` |
| Logo marks | `public/images/` — see [`assets/README.md`](./assets/README.md) |
| Report / PDF rules | [`reports/REPORT_RULES.md`](./reports/REPORT_RULES.md) |
| Published brand system | the **NPC Services Design System** project on claude.ai/design, reached with the **DesignSync** tool |

`tokens/colors.css` is **deliberately absent**. Colours already live in
`src/styles/tokens.css`; a second copy here would be a third source of truth and
would drift. Read the repo file.

## The three rules that matter most

1. **Never hardcode a colour or a font-family.** Everything comes from a token.
   The White-Label admin retunes brand tokens per tenant at runtime, so a
   hardcoded value silently breaks every tenant but one.
2. **Category A cascades, Category B does not.** Brand colours follow the tenant.
   `--success` / `--warning` / `--destructive` / `--info` are fixed by design and
   must never be brand-derived — in the app or in a PDF.
3. **The signature is the wide uppercase eyebrow over a tight-tracked title.**
   `--tracking-eyebrow` (0.18em) or `--tracking-widest` (0.34em) above a heading
   at −0.02em to −0.045em. It is how every NPC surface announces itself.

## If invoked without other guidance

Ask what is being built or designed, then act as an expert designer for this
brand — production code or HTML mockups, depending on the need. Do not invent
colours, faces or marks: everything you need is listed above, and if something
genuinely is not there, say so rather than approximating it.
