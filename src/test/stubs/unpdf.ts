/**
 * Test-time stand-in for `https://esm.sh/unpdf@0.12.1`.
 *
 * `extract.ts` reads a PDF's text layer through unpdf, and it imports it
 * DYNAMICALLY inside the PDF branch precisely so that a spreadsheet import
 * never depends on it. Vite resolves a literal dynamic specifier at transform
 * time regardless, so a test that imports `extract.ts` for its HTML or CSV
 * branch dies on a package this repo does not install for the browser.
 *
 * It reads the text a FIXTURE declares rather than parsing a PDF: a page's
 * prose is written into the fixture as `%%PAGETEXT: …` lines, one per page, and
 * returned here in page order. That is enough to exercise the one thing the
 * text layer is used for — deciding which page names which property — without
 * shipping a PDF text engine into the browser test run.
 *
 * It also does what the real library does and takes ownership of the array it
 * is handed, so the test run reproduces the detachment that once emptied the
 * bytes the photographs are read out of.
 */
const PAGE_TEXT = /%%PAGETEXT:([^\n]*)/g;

interface StubDocument { pages: string[] }

export function getDocumentProxy(bytes: Uint8Array): Promise<StubDocument> {
  const text = new TextDecoder('latin1').decode(bytes);
  const pages = [...text.matchAll(PAGE_TEXT)].map((match) => match[1].trim());
  if (!pages.length) {
    throw new Error('unpdf stub: this fixture declares no %%PAGETEXT: lines.');
  }
  return Promise.resolve({ pages });
}

export function extractText(
  document: StubDocument,
  options: { mergePages?: boolean } = {},
): Promise<{ totalPages: number; text: string | string[] }> {
  return Promise.resolve({
    totalPages: document.pages.length,
    text: options.mergePages ? document.pages.join('\n') : document.pages,
  });
}
