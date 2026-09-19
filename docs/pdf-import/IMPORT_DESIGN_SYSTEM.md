# The design system an import brings with it

## What an import shipped

Measured by running a Docling document through the real production path
(`mapDoclingToPagePlan` → `applyTemplateImportPlan` → `parseTemplate`):

```
tokens                       { colors: {}, fonts: {}, spacing: {} }
overlays with a colour token          0 of 5
overlays with a font token            0 of 5
```

Empty tokens, and every overlay carrying a literal `#251F18` and a literal font
stack. An imported template was not a design — it was a photograph made of
absolutely-positioned boxes. Change the brand colour and nothing moved. There was
no way to restyle an import at all, and any token-driven block added to an
imported page used defaults with no relationship to the document.

The palette was never the hard part. `tokenDerivation.pure` already reads it
correctly — on the same document it returns:

```
primary #251F18   bg #FFFFFF   text #251F18   muted #7A7A7A
heading "Inter, Arial, sans-serif"   body Helvetica
```

It just ran only on the **CDIR → template** direction, which the Docling import
never takes, and nothing would have referenced the result if it had.

## What changed

| | before | after |
|---|---|---|
| tokens on an imported template | `{}` | palette + typefaces read off the source |
| text overlays bound to a colour token | **0 of 5** | **5 of 5** |
| text overlays bound to a font token | **0 of 5** | **5 of 5** |
| page raster at 300 DPI | — | **byte-identical** |
| change one token → the page changes | **no** | **yes** |

Both halves verified through WeasyPrint: the bound render is SHA-256-identical
to the literal one at 300 DPI, and setting `tokens.colors.primary` to a different
value produces a different page with an **identical text layer** — a style
change, not a content change.

## The rule that makes it safe

**Bind only where the token's value is EXACTLY what the overlay measured.**

That single constraint gives two properties at once:

- today's render is byte-identical, because every binding resolves back to the
  literal it replaced;
- changing a token afterwards restyles exactly the elements that shared that
  value in the source, and nothing else.

A binding that "improved" a colour by snapping it to a nearby token would change
a client's document during an import that claims to reproduce it. There is no
tolerance parameter, and adding one would break the guarantee.

## Rules that keep biting

**Roles disambiguate; they never cause a binding.** `primary` and `text` are both
`#251F18` on this document. Stage 2's roles decide which NAME a heading and a
paragraph use — but a title whose colour matches nothing stays a literal, role or
no role.

**A near miss is a different colour.** `#251F18` and `#251F19` do not bind.
`#ABC` and `#AABBCC` do, because they are the same colour written differently.
`#AABBCC80` and `#AABBCC` do **not**: binding a translucent value to an opaque
token makes the element opaque.

**A font stack is compared whole.** `Inter` and `"Segoe UI", Inter` are different
declarations even though they overlap — substituting one for the other changes
which typeface renders whenever the first resolves.

**The base template wins every conflict.** Importing into an existing template
must not restyle the pages already in it, so derived tokens only fill names the
base does not have, and binding happens against the **merged** map. That is what
keeps pixel identity in both cases: a derived `text #251F18` against a base that
already defines `text #000000` simply does not match, so the literal stays.

**Anything that MEASURES a template must resolve the references first.** This is
the second-order break the change caused and had to repair: CDIR copies an
overlay's colour verbatim, and `token:primary` in a CDIR layer is not a colour.
Left alone, `cdirToReportTemplate` derived a palette of `heading:
"token:heading"` and the colour derivation fell back to defaults.
`reportTemplateToCdir` now resolves through `resolveTokenLiteral`, and the
round-trip derives the same palette the import does — which is itself a useful
check that the two agree.

**The editor's caret needs the same resolution as the render.** The canvas text
editor set `fontFamily` from the raw overlay value; a `token:heading` there would
put the caret in a font that does not exist while the iframe beneath it rendered
the resolved one. That is precisely the editor/export divergence R3 exists to
prevent.

## What is not bound

- **Vector `paths[]` fills.** A vector overlay's own `fill`/`stroke` bind, but
  each path carries its own fill and the renderer does not resolve tokens inside
  path data. So a page's backdrop vector keeps a literal, and changing `bg` does
  not repaint it. Stated rather than left as a silent gap.
- **Font size.** There is no numeric token path: `fontSize` resolves through
  `resolveBindableNumber`, which does not consult tokens. A type scale would need
  renderer support first.
- **Table and chart internals.** Their palettes live inside their own props and
  are a separate contract.
- **Existing templates.** Nothing is rewritten retroactively. An import gains its
  design system at import time; a template that predates this keeps its literals
  and renders exactly as it does today.
