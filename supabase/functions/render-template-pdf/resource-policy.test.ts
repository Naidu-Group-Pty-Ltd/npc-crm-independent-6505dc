import { assertEquals, assertThrows } from 'jsr:@std/assert';
import { assertSafeRenderResources } from '../_shared/renderResourcePolicy.pure.ts';

const projectUrl = 'https://project.supabase.co';

Deno.test('render resource policy permits embedded and project storage assets', () => {
  assertSafeRenderResources('<img src="data:image/png;base64,AA==">', projectUrl);
  assertSafeRenderResources('<img src="https://project.supabase.co/storage/v1/object/sign/private/a.png?token=x&amp;y=1">', projectUrl);
  assertEquals(true, true);
});

Deno.test('render resource policy blocks metadata, private, and arbitrary public hosts', () => {
  for (const src of [
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/image.png',
    'https://attacker.example/image.png',
    '//attacker.example/image.png',
    'file:///etc/passwd',
    'https://project.supabase.co/rest/v1/private_table',
  ]) {
    assertThrows(() => assertSafeRenderResources(`<img src="${src}">`, projectUrl));
  }
});

/**
 * The regression this file exists to catch from now on.
 *
 * Every inline SVG the report system emits opens with the SVG namespace, and
 * rejecting it rejected the whole document — the Borrowing Capacity Snapshot
 * never rendered once, and any template with a QR code failed the same way.
 */
Deno.test('render resource policy permits XML namespace declarations', () => {
  assertSafeRenderResources('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', projectUrl);
  assertSafeRenderResources(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"></svg>`,
    projectUrl,
  );
  assertSafeRenderResources("<svg xmlns='http://www.w3.org/2000/svg'></svg>", projectUrl);
  assertEquals(true, true);
});

/** Exempting the declaration must not exempt the element that carries it. */
Deno.test('render resource policy still blocks resources beside a namespace declaration', () => {
  assertThrows(() => assertSafeRenderResources(
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://attacker.example/a.png"/></svg>',
    projectUrl,
  ));
  assertThrows(() => assertSafeRenderResources(
    '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="http://169.254.169.254/latest/meta-data/"/></svg>',
    projectUrl,
  ));
  // An attribute that merely starts with the same letters is not a declaration.
  assertThrows(() => assertSafeRenderResources(
    '<img data-xmlns="https://attacker.example/a.png">',
    projectUrl,
  ));
});

/**
 * The other half of the same regression.
 *
 * The base64 alphabet contains `/`, so any inlined image big enough eventually
 * contains `//` — read as a scheme-relative URL, and the document was rejected.
 * Inlining brand assets is what `assets.pure.ts` requires, so this made the
 * required shape the unrenderable one.
 */
Deno.test('render resource policy ignores base64 data URI payloads', () => {
  assertSafeRenderResources('<img src="data:image/png;base64,AAAA//n1DaHZA6vzhqh0YG==">', projectUrl);
  assertSafeRenderResources('<div style="background:url(data:image/png;base64,QQ//BB=)"></div>', projectUrl);
  assertEquals(true, true);
});

Deno.test('render resource policy still reads non-base64 data URIs and what follows one', () => {
  // Percent-encoded text can name a host; only the opaque base64 form is skipped.
  assertThrows(() => assertSafeRenderResources(
    `<img src="data:image/svg+xml,%3Csvg%3E%3Cimage href='http://169.254.169.254/x'/%3E%3C/svg%3E">`,
    projectUrl,
  ));
  assertThrows(() => assertSafeRenderResources(
    '<img src="data:image/png;base64,QQ//BB="><img src="https://attacker.example/a.png">',
    projectUrl,
  ));
});

Deno.test('render resource policy blocks entity-obfuscated network URLs', () => {
  assertThrows(() => assertSafeRenderResources(
    '<img src="&#x68;ttp&colon;&sol;&sol;169.254.169.254/latest/meta-data/">',
    projectUrl,
  ));
});

/**
 * The boundary judges where the renderer FETCHES, not where it draws.
 *
 * This scanned the whole document as one string, so a report was refused for
 * its prose: 808 of 1,182 investment reports carry a URL in their content, and
 * every one of them failed here — invisibly, because the caller fell back to
 * its legacy generator and a document still arrived. WeasyPrint has no script
 * engine and resolves a URL only from an attribute or a stylesheet; a URL in a
 * text node is drawn as characters.
 */
Deno.test('render resource policy permits a URL in the document text', () => {
  assertSafeRenderResources(
    '<p>Council planning data is published at https://www.planning.nsw.gov.au/ and was checked.</p>',
    projectUrl,
  );
  assertSafeRenderResources('<td>Source: https://www.abs.gov.au/statistics</td>', projectUrl);
  assertSafeRenderResources('<p>Contact admin@npcservices.com.au or http://npcservices.com.au</p>', projectUrl);
  assertEquals(true, true);
});

/** A hyperlink is a link annotation in the PDF, not a request. */
Deno.test('render resource policy permits an anchor href', () => {
  assertSafeRenderResources('<a href="https://npcservices.com.au/disclosure">Disclosure</a>', projectUrl);
  assertEquals(true, true);
});

/** Exempting the anchor's href must not exempt the anchor. */
Deno.test('render resource policy still blocks a fetch beside an anchor href', () => {
  assertThrows(() => assertSafeRenderResources(
    '<a href="https://ok.example/x" style="background:url(https://attacker.example/a.png)">x</a>',
    projectUrl,
  ));
  assertThrows(() => assertSafeRenderResources(
    '<a href="https://ok.example/x" data-src="https://attacker.example/a.png">x</a>',
    projectUrl,
  ));
});

/** Stylesheet bodies are CSS, and CSS fetches. */
Deno.test('render resource policy blocks stylesheet and inline-style fetches', () => {
  assertThrows(() => assertSafeRenderResources(
    '<style>@import url("https://fonts.googleapis.com/css2?family=Lato");</style>',
    projectUrl,
  ));
  assertThrows(() => assertSafeRenderResources(
    '<style>.x{background:url(https://cdn.example.com/bg.png)}</style>',
    projectUrl,
  ));
  assertThrows(() => assertSafeRenderResources(
    '<div style="background:url(https://cdn.example.com/bg.png)"></div>',
    projectUrl,
  ));
});
