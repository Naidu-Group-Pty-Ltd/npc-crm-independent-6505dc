/**
 * Shared document-text toolkit.
 *
 * One place for everything that turns document bytes into text a human or an
 * LLM can read: PDF.js layout reconstruction, Word (.docx) structural
 * extraction, and the normalisation / truncation / chunking / value-coercion
 * primitives shared with the Edge Function parsers.
 */
export * from './textHygiene';
export * from './llmValues';
export * from './pdfTextLayout';
export * from './docxText';
