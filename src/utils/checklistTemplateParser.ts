/**
 * Multi-format parser for checklist templates.
 * Supports: JSON, Markdown, HTML, Plain Text, and extracted text from PDFs/Word/Excel.
 * Flexible parsing: accepts checkboxes, bullets, numbered lists, and plain text paragraphs.
 */
import { normalizeDocumentText } from '@/lib/documentText/textHygiene';

export interface ParsedTemplateSection {
  title: string;
  icon: string;
  items: { label: string; is_pre_checked: boolean }[];
}

export interface ParsedTemplate {
  name: string;
  description?: string;
  icon: string;
  sections: ParsedTemplateSection[];
}

// ── Icon mapping for common section keywords ──
const SECTION_ICON_MAP: Record<string, string> = {
  daily: '🔹', start: '▶️', before: '▶️', after: '▶️', call: '📞',
  'no show': '🚫', agreement: '✍️', financial: '💼', consultation: '💼',
  strategy: '💼', assessment: '📊', smsf: '🏦', property: '🏠',
  research: '🏠', shortlist: '🏠', operations: '🔹', review: '📊',
  invoic: '✍️', booking: '💼', handling: '🚫', default: '▶️',
  marketing: '📣', finance: '💰', accounting: '🧾', legal: '⚖️',
  depreciation: '📉', management: '🏠', 'day to day': '🔹',
};

function inferSectionIcon(title: string): string {
  const lower = title.toLowerCase();
  for (const [keyword, icon] of Object.entries(SECTION_ICON_MAP)) {
    if (lower.includes(keyword)) return icon;
  }
  return '▶️';
}

// ── JSON Parser ──
function parseJSON(text: string): ParsedTemplate {
  const parsed = JSON.parse(text);
  if (!parsed.name) throw new Error('JSON template must have a "name" field');
  return {
    name: parsed.name,
    description: parsed.description || undefined,
    icon: parsed.icon || '📋',
    sections: (parsed.sections || []).map((sec: any) => ({
      title: sec.title || 'Untitled Section',
      icon: sec.icon || inferSectionIcon(sec.title || ''),
      items: (sec.items || []).map((item: any) =>
        typeof item === 'string'
          ? { label: item, is_pre_checked: false }
          : { label: item.label || item.text || String(item), is_pre_checked: !!item.is_pre_checked }
      ),
    })),
  };
}

// ── Markdown / Plain-Text Parser ──
// Flexible: detects sections from headings, bold lines, numbered headers.
// Items from checkboxes, bullets, numbered items, and even plain text lines.
function parseMarkdown(text: string): ParsedTemplate {
  const lines = text.split('\n');
  let templateName = '';
  let templateDesc = '';
  const sections: ParsedTemplateSection[] = [];
  let currentSection: ParsedTemplateSection | null = null;

  // Regex patterns
  const h1 = /^#\s+(.+)/;
  const h2 = /^##\s+(.+)/;
  const h3 = /^###\s+(.+)/;
  const checkboxChecked = /^[-*]?\s*\[x\]\s*(.+)/i;
  const checkboxUnchecked = /^[-*]?\s*\[\s?\]\s*(.+)/i;
  // Word/PDF documents render checkboxes as glyphs, not `[ ]` — the previous
  // parser fell through to the plain-text branch and lost the checked state.
  const glyphChecked = /^[-*]?\s*[☑☒✅✔✓]\s*(.+)/;
  const glyphUnchecked = /^[-*]?\s*[☐□⬜❏]\s*(.+)/;
  const bulletItem = /^[-*•·▪▸►→‣⁃]\s+(?!\[)(.+)/;
  // Numbered list item (e.g., "1. Do something" or "1) Do something")
  const numberedItem = /^\d+[.)]\s+(.+)/;
  // Bold section-like lines (e.g., **Section Title** or __Section Title__)
  const boldLine = /^\*\*(.+?)\*\*\s*$/;
  const boldLineAlt = /^__(.+?)__\s*$/;
  // Uppercase section headers (e.g., "DAILY TASKS:" or "SECTION ONE")
  const uppercaseHeader = /^([A-Z][A-Z\s&/,()-]{2,}[A-Z]):?\s*$/;
  // Colon-terminated header (e.g., "Morning Tasks:" or "Step 1:")
  const colonHeader = /^([A-Za-z][\w\s&/,()-]{2,}):\s*$/;

  const stripEmoji = (s: string) => s.replace(/^[\p{Emoji}\p{Emoji_Presentation}\s]+/u, '').trim();

  // Page furniture from PDF/Word extraction: never a checklist item.
  const pageFurniture = /^(?:-{2,}\s*page\s+\d+\s*-{2,}|page\s+\d+(?:\s+of\s+\d+)?|\d+\s*\|\s*page)$/i;
  // A markdown table separator row (`| --- | --- |`) carries no content.
  const tableSeparator = /^\|?[\s:|-]*\|[\s:|-]*$/;

  const addItem = (section: ParsedTemplateSection, label: string, checked: boolean) => {
    const cleaned = label.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (cleaned.length <= 2) return;
    // Extraction repeats headers/footers on every page; a checklist never has
    // the same item twice in the same section.
    if (section.items.some((item) => item.label.toLowerCase() === cleaned.toLowerCase())) return;
    section.items.push({ label: cleaned, is_pre_checked: checked });
  };

  // A markdown table's header row is the one immediately above the `| --- |`
  // separator; without this, "Task | Status" was imported as a checklist item.
  let lastTableRow: { section: ParsedTemplateSection; index: number } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      lastTableRow = null;
      continue;
    }
    if (pageFurniture.test(line)) continue;
    if (line.startsWith('|') && tableSeparator.test(line)) {
      if (lastTableRow && lastTableRow.section.items.length > lastTableRow.index) {
        lastTableRow.section.items.splice(lastTableRow.index, 1);
      }
      lastTableRow = null;
      continue;
    }
    const wasTableRow = line.startsWith('|') && line.endsWith('|');
    if (!wasTableRow) lastTableRow = null;

    // H1 → first one is template name, subsequent ones are section headers
    const h1Match = line.match(h1);
    if (h1Match) {
      const title = stripEmoji(h1Match[1]).replace(/\*\*/g, '');
      if (!templateName) {
        templateName = title;
      } else {
        // Subsequent H1s become sections
        currentSection = { title, icon: inferSectionIcon(title), items: [] };
        sections.push(currentSection);
      }
      continue;
    }

    // H2 → section
    const h2Match = line.match(h2);
    if (h2Match) {
      const title = stripEmoji(h2Match[1]).replace(/\*\*/g, '');
      if (title.toLowerCase().includes('operational checklist') || title.toLowerCase().includes('notion version')) {
        if (!templateDesc) templateDesc = title;
        continue;
      }
      currentSection = { title, icon: inferSectionIcon(title), items: [] };
      sections.push(currentSection);
      continue;
    }

    // H3 → sub-section
    const h3Match = line.match(h3);
    if (h3Match) {
      const title = stripEmoji(h3Match[1]).replace(/\*\*/g, '');
      currentSection = { title, icon: inferSectionIcon(title), items: [] };
      sections.push(currentSection);
      continue;
    }

    // Bold standalone line as a section header
    const boldMatch = line.match(boldLine) || line.match(boldLineAlt);
    if (boldMatch && !checkboxChecked.test(line) && !checkboxUnchecked.test(line)) {
      const title = stripEmoji(boldMatch[1]);
      if (title.length > 3 && title.length < 100) {
        currentSection = { title, icon: inferSectionIcon(title), items: [] };
        sections.push(currentSection);
        continue;
      }
    }

    // UPPERCASE HEADER
    const upperMatch = line.match(uppercaseHeader);
    if (upperMatch) {
      const title = upperMatch[1].trim();
      if (title.length > 3 && title.length < 100) {
        currentSection = { title: title.charAt(0) + title.slice(1).toLowerCase(), icon: inferSectionIcon(title), items: [] };
        sections.push(currentSection);
        continue;
      }
    }

    // Colon-terminated header (only if no current section or short enough to be a header)
    const colonMatch = line.match(colonHeader);
    if (colonMatch && line.length < 80) {
      const title = colonMatch[1].trim();
      if (title.length > 3 && title.length < 80 && !title.includes('.')) {
        currentSection = { title, icon: inferSectionIcon(title), items: [] };
        sections.push(currentSection);
        continue;
      }
    }

    // Checkbox, in either markdown (`- [x]`) or glyph (`☑`) form. Items are
    // accepted even without a section — an unsectioned checklist previously
    // produced "Could not find any checklist items".
    const checkedMatch = line.match(checkboxChecked) || line.match(glyphChecked);
    const uncheckedMatch = checkedMatch ? null : (line.match(checkboxUnchecked) || line.match(glyphUnchecked));
    if (checkedMatch || uncheckedMatch) {
      if (!currentSection) {
        currentSection = { title: 'Checklist Items', icon: '▶️', items: [] };
        sections.push(currentSection);
      }
      addItem(currentSection, (checkedMatch ?? uncheckedMatch)![1], Boolean(checkedMatch));
      continue;
    }

    // Plain bullet
    const bulletMatch = line.match(bulletItem);
    if (bulletMatch && currentSection) {
      addItem(currentSection, bulletMatch[1], false);
      continue;
    }

    // Numbered list item
    const numberedMatch = line.match(numberedItem);
    if (numberedMatch) {
      if (!currentSection) {
        currentSection = { title: 'Checklist Items', icon: '▶️', items: [] };
        sections.push(currentSection);
      }
      addItem(currentSection, numberedMatch[1], false);
      continue;
    }

    // Markdown table row → first cell is the task, a checkbox-ish second cell
    // carries its state. Word/PDF checklists are very often tables.
    if (line.startsWith('|') && line.endsWith('|') && line.split('|').length > 2) {
      const cells = line.slice(1, -1).split('|').map((cell) => cell.trim());
      const label = cells[0] ?? '';
      if (label && label.length > 2) {
        if (!currentSection) {
          currentSection = { title: 'Checklist Items', icon: '▶️', items: [] };
          sections.push(currentSection);
        }
        const status = (cells[1] ?? '').toLowerCase();
        const checked = /^(?:x|y|yes|done|complete[d]?|true|✓|✔|☑|☒)$/.test(status);
        const before = currentSection.items.length;
        addItem(currentSection, label, checked);
        lastTableRow = currentSection.items.length > before
          ? { section: currentSection, index: before }
          : null;
      }
      continue;
    }

    // Plain text line → treat as an item if it looks substantive
    // (not a section header — we already checked those above)
    if (currentSection && line.length > 5 && line.length < 500) {
      // Skip lines that look like descriptions/metadata
      if (!line.startsWith('http') && !line.startsWith('<!--') && !line.startsWith('//')) {
        addItem(currentSection, line, false);
      }
      continue;
    }
  }

  // Filter out sections with no items
  let meaningful = sections.filter(s => s.items.length > 0);

  // If no sections were created but we have content, try a fallback approach:
  // split into sentences/paragraphs and create items from them
  if (meaningful.length === 0) {
    const fallbackItems = extractItemsFromPlainText(text);
    if (fallbackItems.length > 0) {
      meaningful = [{ title: 'Checklist Items', icon: '▶️', items: fallbackItems }];
    }
  }

  // Try to derive a better name
  if (!templateName) {
    const emptySections = sections.filter(s => s.items.length === 0);
    if (emptySections.length > 0) {
      templateName = emptySections[0].title;
    }
  }

  if (meaningful.length === 0) {
    throw new Error('Could not find any checklist items. Please provide content with bullet points, numbered lists, or structured text.');
  }

  return {
    name: templateName || 'Imported Checklist',
    description: templateDesc || undefined,
    icon: '📋',
    sections: meaningful,
  };
}

/**
 * Fallback: extract items from unstructured plain text.
 * Splits on sentence boundaries or newlines and creates items from each.
 */
function extractItemsFromPlainText(text: string): { label: string; is_pre_checked: boolean }[] {
  const items: { label: string; is_pre_checked: boolean }[] = [];

  // First try splitting by newlines
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);

  if (lines.length >= 3) {
    // Multiple lines — each line becomes an item
    for (const line of lines) {
      // Skip very short lines or lines that look like titles
      if (line.length > 3 && line.length < 500) {
        const checked = /^[-*•·▪▸►→‣⁃]?\s*(?:\[x\]|[☑☒✅✔✓])/i.test(line);
        const cleaned = line
          .replace(/^[-*•·▪▸►→‣⁃]\s*/, '') // strip bullet chars
          .replace(/^(?:\[[ x]\]|[☑☒✅✔✓☐□⬜❏])\s*/i, '') // strip checkbox markers
          .replace(/^\d+[.)]\s*/, '') // strip numbering
          .replace(/\*\*/g, '') // strip bold
          .trim();
        if (cleaned.length > 3) {
          items.push({ label: cleaned, is_pre_checked: checked });
        }
      }
    }
  } else {
    // Single block of text — split on sentence boundaries
    const sentences = text
      .replace(/\n/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 5 && s.length < 500);

    for (const sentence of sentences) {
      items.push({ label: sentence, is_pre_checked: false });
    }
  }

  return items;
}

// ── HTML Parser ──
function parseHTML(html: string): ParsedTemplate {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  let templateName = '';
  const sections: ParsedTemplateSection[] = [];
  let currentSection: ParsedTemplateSection | null = null;

  const h1El = doc.querySelector('h1');
  if (h1El) templateName = h1El.textContent?.trim() || '';

  const ensureSection = (): ParsedTemplateSection => {
    if (!currentSection) {
      currentSection = { title: 'Checklist Items', icon: '▶️', items: [] };
      sections.push(currentSection);
    }
    return currentSection as ParsedTemplateSection;
  };

  const pushItem = (label: string, checked: boolean) => {
    const cleaned = label.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    const section = ensureSection();
    if (section.items.some((item) => item.label.toLowerCase() === cleaned.toLowerCase())) return;
    section.items.push({ label: cleaned, is_pre_checked: checked });
  };

  // Walk the whole tree rather than only `body`'s direct children: real
  // exported HTML wraps its content in `<div>`/`<main>`/`<article>`, and the
  // previous direct-children-only loop found nothing at all in those documents.
  const walk = (parent: Element) => {
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase();

      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        const title = el.textContent?.trim() || '';
        if (tag === 'h1' && !templateName) {
          templateName = title;
          continue;
        }
        if (title) {
          currentSection = { title, icon: inferSectionIcon(title), items: [] };
          sections.push(currentSection);
        }
        continue;
      }

      if (['ul', 'ol'].includes(tag)) {
        // `:scope > li` so a nested list's items are not counted twice.
        for (const li of Array.from(el.querySelectorAll(':scope > li'))) {
          const checkbox = li.querySelector('input[type="checkbox"]');
          const isChecked = checkbox
            ? (checkbox as HTMLInputElement).checked || checkbox.hasAttribute('checked')
            : /^\s*[☑☒✅✔✓]/.test(li.textContent || '');
          // A nested list contributes its own items, not its parent's text.
          const nested = li.querySelector(':scope > ul, :scope > ol');
          const own = Array.from(li.childNodes)
            .filter((node) => node !== nested)
            .map((node) => node.textContent || '')
            .join('');
          pushItem(own.replace(/^\s*[☑☒✅✔✓☐□⬜❏]\s*/, ''), isChecked);
          if (nested) walk(li);
        }
        continue;
      }

      if (tag === 'table') {
        for (const row of Array.from(el.querySelectorAll('tr'))) {
          const cells = Array.from(row.querySelectorAll('td'));
          if (!cells.length) continue;
          const label = cells[0]?.textContent?.trim() || '';
          const status = (cells[1]?.textContent || '').trim().toLowerCase();
          const checked =
            !!cells[0]?.querySelector('input[type="checkbox"]:checked') ||
            /^(?:x|y|yes|done|complete[d]?|true|✓|✔|☑|☒)$/.test(status);
          pushItem(label, checked);
        }
        continue;
      }

      if (['p', 'span', 'label'].includes(tag) && /^\s*[☑☒✅✔✓☐□⬜❏]/.test(el.textContent || '')) {
        const text = el.textContent || '';
        pushItem(text.replace(/^\s*[☑☒✅✔✓☐□⬜❏]\s*/, ''), /^\s*[☑☒✅✔✓]/.test(text));
        continue;
      }

      if (el.children.length) walk(el);
    }
  };

  walk(doc.body);

  const meaningful = sections.filter(s => s.items.length > 0);
  
  if (meaningful.length === 0) {
    const bodyText = doc.body.textContent || '';
    return parseMarkdown(bodyText);
  }

  return {
    name: templateName || 'Imported Checklist',
    icon: '📋',
    sections: meaningful,
  };
}

// ── Main detect-and-parse function ──
export function parseTemplateContent(content: string, format?: 'json' | 'markdown' | 'html' | 'text'): ParsedTemplate {
  // Normalise first: PDF/Word extraction delivers ligatures, non-breaking
  // spaces and soft hyphens that otherwise defeat every pattern below.
  const trimmed = normalizeDocumentText(content).trim();

  if (!format) {
    // Detect HTML structurally rather than by a handful of literal prefixes:
    // real exported HTML often starts with `<body>` or a wrapper `<div>` and
    // contains no `<ul` or `<h1` at all, and was previously parsed as markdown
    // — which turned every tag into a checklist item.
    const looksLikeHtml =
      /^<!doctype\s+html/i.test(trimmed) ||
      /^<html[\s>]/i.test(trimmed) ||
      (trimmed.startsWith('<') &&
        /<\/(?:html|body|div|main|section|article|table|ul|ol|h[1-6]|p|li)>/i.test(trimmed)) ||
      /<(?:ul|ol|table)\b[^>]*>[\s\S]*<\/(?:ul|ol|table)>/i.test(trimmed);

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      format = 'json';
    } else if (looksLikeHtml) {
      format = 'html';
    } else {
      format = 'markdown';
    }
  }

  switch (format) {
    case 'json':
      return parseJSON(trimmed);
    case 'html':
      return parseHTML(trimmed);
    case 'markdown':
    case 'text':
    default:
      return parseMarkdown(trimmed);
  }
}

// ── File reader helpers ──
export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function detectFormatFromFile(file: File): 'json' | 'markdown' | 'html' | 'text' | 'pdf' | 'docx' | 'xlsx' {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = file.type;
  
  if (ext === 'json' || mime === 'application/json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'html' || ext === 'htm' || mime === 'text/html') return 'html';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (ext === 'xlsx' || ext === 'xls' || mime.includes('spreadsheet') || mime.includes('excel')) return 'xlsx';
  return 'text';
}
