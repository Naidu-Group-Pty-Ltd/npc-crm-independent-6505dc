# Template library design

The Command Center library is **40 Word documents generated from code**
(`build_library.py` → `builders/` → `components.py` → `theme.py`). Nothing in
`public/templates/command-center/` is edited by hand; change the generator and
rebuild.

```bash
python3 scripts/aurixa-templates/build_library.py --sample   # masters + previews
python3 scripts/aurixa-templates/verify_library.py           # structural gate
python3 scripts/aurixa-templates/review_layout.py --sample   # composition gate
python3 scripts/aurixa-templates/check_covers.py --sample    # cover gate
```

## Connecting Claude Design

Claude Design syncs an **HTML/CSS component library** with a
[claude.ai/design](https://claude.ai/design) project. This library is Word
documents produced by `python-docx` — there is no HTML in the pipeline — so the
two cannot be synced directly. `design-tokens.json` is the bridge.

**Status: not connected.** `DesignSync` needs design-system authorization, which
`/design-login` grants from an interactive terminal. It cannot be granted from a
non-interactive session such as Claude Code on the web. To connect it:

1. Authorize, by either
   - running `/design-login` in an interactive Claude Code terminal, or
   - using Claude Design's **Send to Claude Code Web**, which seeds the design
     project into the workspace.
2. Export the design system's colours and type sizes into the shape of
   `design-tokens.json` (start from `--export` below, then overwrite values).
3. Rebuild. All 40 templates re-cut against the new values.

Until then the library builds from the values in `theme.py`, and
`design-tokens.json` is a faithful export of them.

## Design tokens

```bash
python3 scripts/aurixa-templates/design_tokens.py --export  # current values → JSON
python3 scripts/aurixa-templates/design_tokens.py --check   # validate the file
```

Only **colour** and **type size** are overridable. Spacing, margins, cover
architecture and table structure stay in `theme.py`, because those are what
break a layout when someone who is not looking at the output changes them — the
same reason `BrandConfig` has never accepted them from a partner.

An unknown or malformed token raises. A typo'd token name that quietly did
nothing would be discovered in a client-facing PDF.

Semantic colours (`success` / `warning` / `alert`) *are* overridable, but
changing them changes what a status means to a reader. The exported file says so
in `_semanticWarning`.

## Pagination

Two defects were structural rather than per-template and are corrected once over
the finished body, in `components.normalise_layout()`:

- **Blank pages.** `page_break()` writes a paragraph carrying a break run. When
  the preceding content ended at a page boundary that paragraph landed at the
  top of a fresh page and broke again, emitting a page containing nothing but
  the running header and footer. Breaks now become `pageBreakBefore` on the
  following block, which Word suppresses at the top of a page.
- **Orphaned headings.** `section_opener` sets `keepNext`, but every builder
  follows it with `gap()` — a spacer with no `keepNext` — so Word kept the
  heading with the spacer and then broke, stranding the heading above its
  content. The chain is now extended through the spacers.

Only components that genuinely own a page boundary keep a hard break: the
cover, the contents, an appendix opener, the disclaimer and the back cover.
Those call `hard_page_break()`, which tags itself with an invisible bookmark so
the two kinds stay distinguishable; the marker is stripped during
normalisation and never reaches the shipped file. Every other `page_break()` in
the builders was a manual pagination hint tuned to content that has since
changed, and each one ended a page early — those are dropped so sections flow.

`keep_table_together()` marks a **figure** as atomic: a bar chart with three
bars on one page and two on the next reads as two broken charts. A **data
table** is a list and is deliberately left free to flow, with its header row
repeating.

## Measuring composition

`review_layout.py` renders every template through LibreOffice, rasterises the
pages and reports how far down the type area the last mark sits. The aggregate
`short pages` count is the regression metric: a change that raises it has made
the library emptier, whatever it did to any one page.

| | before | after |
| --- | --- | --- |
| mean fill | 64.3% | 79.8% |
| median fill | 69.1% | 97.9% |
| pages ending above 80% | 63% | 32% |
| fully blank pages | several | none |

**LibreOffice is a proxy for Word, not a substitute.** It is close enough to
catch voids, orphaned headings and overflow, which is what the harness is for.
One known divergence: an oversized atomic card (a `info_card` with many fields)
that does not fit in the remaining space is moved to the next page by
LibreOffice *without* pulling its `keepNext` heading along, so a heading can
still appear stranded in a LibreOffice render. Word honours the chain. Check
anything cover-critical in Word before shipping.

`check_covers.py` gates the cover separately, because it is the first thing a
recipient sees. Each cover variant reports the vertical space it consumes so
`cover()` can anchor the issue-control block to the foot of the page; those
figures are deliberately stated slightly high, since an over-estimate leaves a
little residual space while an under-estimate spills the cover onto page two.
