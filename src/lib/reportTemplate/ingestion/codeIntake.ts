/**
 * Code upload intake helpers for the template builder.
 *
 * These are deliberately pure so the modal can detect and explain what was
 * uploaded before it starts the expensive render → CDIR → editable-template
 * pipeline. Folder uploads arrive from the browser as a flat FileList with
 * webkitRelativePath values; this module turns that into a concise manifest and
 * extension/type breakdown.
 */

export type CodeFileCategory =
  | 'renderable'
  | 'style'
  | 'script'
  | 'framework'
  | 'asset'
  | 'data'
  | 'config'
  | 'document'
  | 'archive'
  | 'other';

export interface CodeFileTypeInfo {
  extension: string;
  label: string;
  category: CodeFileCategory;
  renderRole: 'entry' | 'style' | 'component' | 'asset' | 'support' | 'archive' | 'unknown';
  ingestible: boolean;
}

export interface CodeIntakeFileLike {
  name: string;
  size?: number;
  type?: string;
  webkitRelativePath?: string;
}

export interface CodeTypeBreakdownItem {
  extension: string;
  label: string;
  category: CodeFileCategory;
  count: number;
  bytes: number;
}

export interface CodeIntakeSummary {
  mode: 'file' | 'folder';
  fileCount: number;
  totalBytes: number;
  rootName: string | null;
  entryCandidates: string[];
  breakdown: CodeTypeBreakdownItem[];
  primary: CodeFileTypeInfo;
}

const INFO_BY_EXT: Record<string, Omit<CodeFileTypeInfo, 'extension'>> = {
  html: { label: 'HTML document', category: 'renderable', renderRole: 'entry', ingestible: true },
  htm: { label: 'HTML document', category: 'renderable', renderRole: 'entry', ingestible: true },
  css: { label: 'CSS stylesheet', category: 'style', renderRole: 'style', ingestible: true },
  scss: { label: 'Sass stylesheet', category: 'style', renderRole: 'style', ingestible: true },
  sass: { label: 'Sass stylesheet', category: 'style', renderRole: 'style', ingestible: true },
  less: { label: 'Less stylesheet', category: 'style', renderRole: 'style', ingestible: true },
  js: { label: 'JavaScript source', category: 'script', renderRole: 'component', ingestible: true },
  mjs: { label: 'JavaScript module', category: 'script', renderRole: 'component', ingestible: true },
  cjs: { label: 'CommonJS source', category: 'script', renderRole: 'component', ingestible: true },
  jsx: { label: 'React JSX component', category: 'framework', renderRole: 'component', ingestible: true },
  ts: { label: 'TypeScript source', category: 'script', renderRole: 'component', ingestible: true },
  tsx: { label: 'React TSX component', category: 'framework', renderRole: 'component', ingestible: true },
  vue: { label: 'Vue component', category: 'framework', renderRole: 'component', ingestible: true },
  svelte: { label: 'Svelte component', category: 'framework', renderRole: 'component', ingestible: true },
  astro: { label: 'Astro component', category: 'framework', renderRole: 'component', ingestible: true },
  json: { label: 'JSON data/config', category: 'data', renderRole: 'support', ingestible: true },
  yaml: { label: 'YAML config', category: 'config', renderRole: 'support', ingestible: true },
  yml: { label: 'YAML config', category: 'config', renderRole: 'support', ingestible: true },
  md: { label: 'Markdown document', category: 'document', renderRole: 'entry', ingestible: true },
  markdown: { label: 'Markdown document', category: 'document', renderRole: 'entry', ingestible: true },
  svg: { label: 'SVG vector image', category: 'asset', renderRole: 'asset', ingestible: true },
  png: { label: 'PNG image', category: 'asset', renderRole: 'asset', ingestible: true },
  jpg: { label: 'JPEG image', category: 'asset', renderRole: 'asset', ingestible: true },
  jpeg: { label: 'JPEG image', category: 'asset', renderRole: 'asset', ingestible: true },
  webp: { label: 'WebP image', category: 'asset', renderRole: 'asset', ingestible: true },
  gif: { label: 'GIF image', category: 'asset', renderRole: 'asset', ingestible: true },
  avif: { label: 'AVIF image', category: 'asset', renderRole: 'asset', ingestible: true },
  woff: { label: 'Web font', category: 'asset', renderRole: 'asset', ingestible: true },
  woff2: { label: 'Web font', category: 'asset', renderRole: 'asset', ingestible: true },
  ttf: { label: 'TrueType font', category: 'asset', renderRole: 'asset', ingestible: true },
  otf: { label: 'OpenType font', category: 'asset', renderRole: 'asset', ingestible: true },
  zip: { label: 'ZIP project archive', category: 'archive', renderRole: 'archive', ingestible: true },
};

const EXT_FROM_MIME: Record<string, string> = {
  'text/html': 'html',
  'text/css': 'css',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'application/json': 'json',
  'image/svg+xml': 'svg',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
};

export function extensionForName(name = '', mime = ''): string {
  const clean = name.split(/[?#]/)[0].toLowerCase();
  const base = clean.split('/').pop() || clean;
  if (base.includes('.')) return base.slice(base.lastIndexOf('.') + 1) || 'no-ext';
  return EXT_FROM_MIME[mime.toLowerCase()] ?? 'no-ext';
}

export function codeFileTypeInfo(name = '', mime = ''): CodeFileTypeInfo {
  const extension = extensionForName(name, mime);
  const found = INFO_BY_EXT[extension];
  if (found) return { extension, ...found };
  if (/^image\//i.test(mime)) return { extension, label: 'Image asset', category: 'asset', renderRole: 'asset', ingestible: true };
  if (/^font\//i.test(mime)) return { extension, label: 'Font asset', category: 'asset', renderRole: 'asset', ingestible: true };
  if (/^text\//i.test(mime)) return { extension, label: 'Text/source file', category: 'document', renderRole: 'support', ingestible: true };
  return { extension, label: extension === 'no-ext' ? 'File without extension' : `${extension.toUpperCase()} file`, category: 'other', renderRole: 'unknown', ingestible: false };
}

export function formatBytes(bytes = 0): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / (1024 ** idx);
  // A whole number reads as "2 MB", not "2.0 MB" — the decimal is there to
  // distinguish 1.5 from 1, and carries nothing when there is no fraction.
  const rounded = Number(value.toFixed(1));
  return `${value >= 10 || idx === 0 || Number.isInteger(rounded) ? Math.round(value) : rounded} ${units[idx]}`;
}

function displayPath(file: CodeIntakeFileLike): string {
  return file.webkitRelativePath || file.name;
}

function rootFrom(files: CodeIntakeFileLike[]): string | null {
  const roots = new Set(files.map((f) => f.webkitRelativePath?.split('/')[0]).filter(Boolean));
  return roots.size === 1 ? Array.from(roots)[0]! : null;
}

export function summarizeCodeIntake(files: CodeIntakeFileLike[]): CodeIntakeSummary {
  const list = files.filter(Boolean);
  const hasFolderPath = list.some((f) => Boolean(f.webkitRelativePath));
  const breakdownByExt = new Map<string, CodeTypeBreakdownItem>();
  let totalBytes = 0;
  for (const file of list) {
    const info = codeFileTypeInfo(file.name, file.type);
    totalBytes += Number(file.size || 0);
    const item = breakdownByExt.get(info.extension) ?? { extension: info.extension, label: info.label, category: info.category, count: 0, bytes: 0 };
    item.count += 1;
    item.bytes += Number(file.size || 0);
    breakdownByExt.set(info.extension, item);
  }

  const entryCandidates = list
    .map(displayPath)
    .filter((p) => /(^|\/)(index|app|main|page)\.(html?|jsx?|tsx?|vue|svelte|astro|md)$/i.test(p))
    .slice(0, 6);
  const breakdown = Array.from(breakdownByExt.values())
    .sort((a, b) => b.count - a.count || b.bytes - a.bytes || a.extension.localeCompare(b.extension));
  const primary = list.length === 1
    ? codeFileTypeInfo(list[0].name, list[0].type)
    : (breakdown.find((b) => ['renderable', 'framework', 'style'].includes(b.category))
      ? codeFileTypeInfo(`x.${breakdown.find((b) => ['renderable', 'framework', 'style'].includes(b.category))!.extension}`)
      : codeFileTypeInfo(`x.${breakdown[0]?.extension ?? ''}`));

  return {
    mode: hasFolderPath || list.length > 1 ? 'folder' : 'file',
    fileCount: list.length,
    totalBytes,
    rootName: rootFrom(list),
    entryCandidates,
    breakdown,
    primary,
  };
}
