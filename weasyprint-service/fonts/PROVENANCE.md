# Render fonts — provenance

These are the faces no Debian release packages, so they travel with the service
and are `COPY`-ed into the image. Everything else the report uses comes from
`apt` — see the Dockerfile.

All three families are **SIL Open Font License 1.1**. The licence requires the
text to travel with the font, which is why each `*-OFL.txt` ships beside its
TTFs and is copied into the image alongside them.

The SHA-256 column is **checked**, not claimed: `reportTypography.spec.ts` reads
this table, hashes the files beside it, and fails if any row is wrong, missing
or extra. A font binary swapped without a line in this file fails CI.

| File | Family | Weight | SHA-256 | Source |
|---|---|---|---|---|
| `Cinzel-Regular.ttf` | Cinzel | 400 | `6e67a440d19a22e7a14631e7fb8efb71cdf43fde8adf040b7935ac2b38519ab0` | `public/fonts/Cinzel_Playfair_Display.zip` |
| `Cinzel-SemiBold.ttf` | Cinzel | 600 | `a215fd5c61da3cbb0d06c33b5d4d8cf7b343fab2805b3b53ef2a6be43cd092be` | `public/fonts/Cinzel_Playfair_Display.zip` |
| `IBMPlexMono-Bold.ttf` | IBM Plex Mono | 700 | `ac27abd6450a64dd94467580a02fe6235156d5b92f2926ebbc8e7489df64e0be` | `github.com/google/fonts` → `ofl/ibmplexmono` |
| `IBMPlexMono-Medium.ttf` | IBM Plex Mono | 500 | `a9b4c49bb299e05b5f6c481e7fb5e78943d2793249a0c8874ab574a2d1ea6755` | `github.com/google/fonts` → `ofl/ibmplexmono` |
| `IBMPlexMono-Regular.ttf` | IBM Plex Mono | 400 | `6a3412f058c7d8dfd9170c41e85ade48e5156ecb89356110ca57a0a27734af46` | `github.com/google/fonts` → `ofl/ibmplexmono` |
| `PlayfairDisplay-Bold.ttf` | Playfair Display | 700 | `4f3b87b5aa297eed5e5a48dbd9941356ca0313d4725b02c29a298cb042b7b31b` | `public/fonts/Cinzel_Playfair_Display.zip` |
| `PlayfairDisplay-Italic.ttf` | Playfair Display | 400 italic | `40a6afa92220254c2c426ccef129d3615dd19e4c591fbfa997e5f28ebba8302c` | `public/fonts/Cinzel_Playfair_Display.zip` |
| `PlayfairDisplay-Regular.ttf` | Playfair Display | 400 | `861f838d481d28cbbd4793e45dc02f01d04c81e06ed98ab2779ca152ace9f27b` | `public/fonts/Cinzel_Playfair_Display.zip` |
| `PlayfairDisplay-SemiBold.ttf` | Playfair Display | 600 | `0f8ae66ea018739838dac8fc0a70f9dd6fe8806bf4f63bb35b3c643480221d31` | `public/fonts/Cinzel_Playfair_Display.zip` |

Cinzel and Playfair Display were extracted from the archive already committed at
`public/fonts/Cinzel_Playfair_Display.zip` — a Google Fonts download, unpacked
rather than re-fetched. IBM Plex Mono came from the Google Fonts repository, the
same origin as that archive, because Debian does not package it.

To add a weight, take it from that archive rather than the network. It carries
the full family at every static weight, upright and italic, in the same build as
what already ships:

```bash
unzip -j -o public/fonts/Cinzel_Playfair_Display.zip \
  "Cinzel/static/Cinzel-Medium.ttf" -d weasyprint-service/fonts/
sha256sum weasyprint-service/fonts/Cinzel-Medium.ttf   # then add the row above
```

Prefer it to `fonts.gstatic.com`, which serves *subsetted* statics — the Cinzel
it hands out has 368 glyphs against the archive's 547, so a client name with an
accent would come back as a missing glyph.

## Why these weights and no others

A weight the stylesheet asks for and the image does not have is not a missing
font — it is a **substituted** one. Fontconfig answers with the nearest weight
it has, the PDF renders, and nothing reports it.

That is not hypothetical here. Cinzel shipped **Bold alone**, so the cover title
and the closing wordmark were both set Bold — and a comment in
`typography.pure.ts` recorded the face as "confined to the two places set large
and short" *because* of it. Cinzel is an inscriptional roman cut after
Trajan-column capitals, which are light; Bold reads as blunt at 34pt and blooms
on the obsidian ground a cover is set on. The Regular and SemiBold that fix it
were sitting unused in the same committed archive the Bold came from, the whole
time. A typographic decision had been made by an omission.

The cover is now Regular and the wordmark SemiBold, and Bold is gone because
nothing asks for it.

The set above is exactly what the report requests, derived from the real
stylesheet *and* the chart drawings by `reportTypography.spec.ts`. That test
fails both ways: on a requested weight with no file, and on a file nothing
requests. Add a weight to the CSS or a chart and the test tells you which file
to add here.

## Checking whether a font is packaged, correctly

`fonts-ibm-plex` was in this Dockerfile's `apt-get install` list and the image
could not be built because of it. It survived a check against
`packages.debian.org/bookworm/fonts-ibm-plex`, which returns a page — because
`fonts-ibm-plex` is a Debian **source** package name. There is no binary package
of that name in any release.

The website is not the index. Check the index:

```bash
curl -sS -o Packages.gz \
  http://deb.debian.org/debian/dists/bookworm/main/binary-amd64/Packages.gz
zcat Packages.gz | grep '^Package: fonts-ibm-plex$'   # no output = not installable
```

Every package the Dockerfile names has been verified this way against both
bookworm and trixie. CI does the real check anyway — the `render-container` job
builds the image, and that is what caught this one.
