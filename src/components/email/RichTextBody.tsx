import React from 'react';

interface RichTextBodyProps {
  content: string;
  className?: string;
}

/**
 * Strip stray markdown markers that leak through from the HTML→text conversion
 * (e.g. unbalanced **bold** spans broken by line wraps, decorative underscore
 * separator lines, trailing single _ after a word like "Disclaimer:_"), so they
 * don't render as literal asterisks/underscores in the dashboard.
 */
function cleanPlainTextArtifacts(input: string): string {
  if (!input) return '';
  let text = input.replace(/\r\n/g, '\n');

  // Drop decorative separator lines made of just _ or - or = (3+).
  text = text
    .split('\n')
    .map((line) => (/^\s*[_\-=]{1,}\s*$/.test(line) && line.trim().length <= 80 ? '' : line))
    .join('\n');

  // Per-line: if a line has an odd number of `**`, remove the unmatched one
  // (prefer removing a leading marker; otherwise drop the last one).
  text = text
    .split('\n')
    .map((line) => {
      const count = (line.match(/\*\*/g) || []).length;
      if (count % 2 === 0) return line;
      if (line.startsWith('**')) return line.replace(/^\*\*/, '');
      return line.replace(/\*\*(?=[^*]*$)/, '');
    })
    .join('\n');

  // Trailing single underscore glued to a word ("Disclaimer:_") with no opener.
  text = text.replace(/([^\s_])_(?=\s|$)/g, '$1');
  // Leading single underscore glued to a word.
  text = text.replace(/(^|\s)_(?=[^\s_])/g, '$1');

  // Collapse 3+ blank lines.
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

// Patterns for detecting various types of content
const linkPatterns = {
  url: /(https?:\/\/[^\s<>"{}|\\^`[\]]+|www\.[^\s<>"{}|\\^`[\]]+)/gi,
  email: /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
  phone: /(\+?[\d\s-]{10,}|\(\d{2,4}\)\s*[\d\s-]{6,}|\d{4}\s*\d{3}\s*\d{3})/g,
};

// Text formatting patterns (bold, italic, underline)
const formatPatterns = [
  // Bold: **text**, __text__, or *text* (single asterisk for bold in some email clients)
  { pattern: /\*\*(.+?)\*\*/g, tag: 'strong' },
  { pattern: /__(.+?)__/g, tag: 'strong' },
  // Italic: _text_ or /text/
  { pattern: /(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, tag: 'em' },
  // HTML-style tags that might come from rich text emails
  { pattern: /<b>(.+?)<\/b>/gi, tag: 'strong' },
  { pattern: /<strong>(.+?)<\/strong>/gi, tag: 'strong' },
  { pattern: /<i>(.+?)<\/i>/gi, tag: 'em' },
  { pattern: /<em>(.+?)<\/em>/gi, tag: 'em' },
  { pattern: /<u>(.+?)<\/u>/gi, tag: 'u' },
];

// Apply text formatting (bold, italic, underline)
function applyTextFormatting(text: string): React.ReactNode[] {
  if (!text) return [];
  
  // Find all format matches with their positions
  interface FormatMatch {
    start: number;
    end: number;
    content: string;
    tag: string;
    fullMatch: string;
  }
  
  const matches: FormatMatch[] = [];
  
  for (const { pattern, tag } of formatPatterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        tag,
        fullMatch: match[0],
      });
    }
  }
  
  // Sort by start position
  matches.sort((a, b) => a.start - b.start);
  
  // Remove overlapping matches (keep first)
  const filteredMatches: FormatMatch[] = [];
  for (const match of matches) {
    const overlaps = filteredMatches.some(
      m => (match.start >= m.start && match.start < m.end) ||
           (match.end > m.start && match.end <= m.end)
    );
    if (!overlaps) {
      filteredMatches.push(match);
    }
  }
  
  if (filteredMatches.length === 0) {
    return [text];
  }
  
  // Build result with formatted segments
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  
  for (let i = 0; i < filteredMatches.length; i++) {
    const match = filteredMatches[i];
    
    // Add text before this match
    if (match.start > lastIndex) {
      result.push(text.slice(lastIndex, match.start));
    }
    
    // Add formatted element
    const FormattedElement = match.tag as keyof JSX.IntrinsicElements;
    result.push(
      <FormattedElement key={`fmt-${i}`} className={match.tag === 'strong' ? 'font-semibold' : match.tag === 'u' ? 'underline' : 'italic'}>
        {match.content}
      </FormattedElement>
    );
    
    lastIndex = match.end;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }
  
  return result;
}

// Parse text for links (URLs, emails, phones)
function parseLinks(text: string): Array<{ type: 'text' | 'url' | 'email' | 'phone'; value: string; index: number }> {
  if (!text) return [];
  
  const segments: Array<{ type: 'text' | 'url' | 'email' | 'phone'; value: string; index: number }> = [];
  
  // Find all URLs
  let match;
  const urlRegex = new RegExp(linkPatterns.url.source, linkPatterns.url.flags);
  while ((match = urlRegex.exec(text)) !== null) {
    segments.push({ type: 'url', value: match[0], index: match.index });
  }
  
  // Find all emails
  const emailRegex = new RegExp(linkPatterns.email.source, linkPatterns.email.flags);
  while ((match = emailRegex.exec(text)) !== null) {
    const overlaps = segments.some(s => 
      (match!.index >= s.index && match!.index < s.index + s.value.length) ||
      (s.index >= match!.index && s.index < match!.index + match![0].length)
    );
    if (!overlaps) {
      segments.push({ type: 'email', value: match[0], index: match.index });
    }
  }
  
  // Find all phone numbers
  const phoneRegex = new RegExp(linkPatterns.phone.source, linkPatterns.phone.flags);
  while ((match = phoneRegex.exec(text)) !== null) {
    const cleanedPhone = match[0].replace(/[\s-]/g, '');
    if (cleanedPhone.replace(/\D/g, '').length >= 8) {
      const overlaps = segments.some(s => 
        (match!.index >= s.index && match!.index < s.index + s.value.length) ||
        (s.index >= match!.index && s.index < match!.index + match![0].length)
      );
      if (!overlaps) {
        segments.push({ type: 'phone', value: match[0], index: match.index });
      }
    }
  }
  
  return segments.sort((a, b) => a.index - b.index);
}

// Render text with links and formatting
function RichTextSpan({ text }: { text: string }) {
  const linkSegments = parseLinks(text);
  
  if (linkSegments.length === 0) {
    // No links, just apply text formatting
    return <>{applyTextFormatting(text)}</>;
  }
  
  // Build result with links
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  
  for (let i = 0; i < linkSegments.length; i++) {
    const segment = linkSegments[i];
    
    // Add formatted text before this link
    if (segment.index > lastIndex) {
      const textBefore = text.slice(lastIndex, segment.index);
      result.push(<React.Fragment key={`text-${i}`}>{applyTextFormatting(textBefore)}</React.Fragment>);
    }
    
    // Add link element
    switch (segment.type) {
      case 'url':
        const href = segment.value.startsWith('http') ? segment.value : `https://${segment.value}`;
        result.push(
          <a key={`link-${i}`} href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
            {segment.value}
          </a>
        );
        break;
      case 'email':
        result.push(
          <a key={`link-${i}`} href={`mailto:${segment.value}`} className="text-primary hover:underline">
            {segment.value}
          </a>
        );
        break;
      case 'phone':
        result.push(
          <a key={`link-${i}`} href={`tel:${segment.value.replace(/\D/g, '')}`} className="text-primary hover:underline">
            {segment.value}
          </a>
        );
        break;
    }
    
    lastIndex = segment.index + segment.value.length;
  }
  
  // Add remaining formatted text
  if (lastIndex < text.length) {
    result.push(<React.Fragment key="text-end">{applyTextFormatting(text.slice(lastIndex))}</React.Fragment>);
  }
  
  return <>{result}</>;
}

// Comprehensive thread separator patterns for various email clients
const threadSeparatorPatterns = [
  // Outlook patterns
  /^-{3,}\s*Original Message\s*-{3,}/i,
  /^_{3,}\s*$/,
  /^From:\s+.+\s*$/i,
  /^Sent:\s+.+\s*$/i,
  
  // Gmail patterns
  /^On\s+.+\s+wrote:\s*$/i,
  /^On\s+.+\s+at\s+.+,?\s+.+\s+wrote:\s*$/i,
  
  // Forwarded message patterns
  /^-{3,}\s*Forwarded message\s*-{3,}/i,
  /^Begin forwarded message/i,
  /^-{3,}\s*Forwarded by\s+.+\s*-{3,}/i,
  
  // Mobile client patterns
  /^On\s+\w{3},?\s+\w{3}\s+\d+,?\s+\d{4}/i,
  /^Sent from my (iPhone|iPad|Galaxy|Android|Mobile)/i,
  
  // Quote markers
  /^>\s*On\s+.+\s+wrote:/i,
  /^>+\s*From:/i,
  
  // Generic reply headers
  /^Reply to:/i,
  /^In reply to:/i,
];

// Detect if a block of lines looks like quoted/forwarded content
function isQuotedBlock(lines: string[], startIndex: number): boolean {
  // Check if multiple consecutive lines start with > (quote marker)
  let quotedCount = 0;
  for (let i = startIndex; i < Math.min(startIndex + 5, lines.length); i++) {
    if (lines[i].trim().startsWith('>')) {
      quotedCount++;
    }
  }
  return quotedCount >= 2;
}

// Detect email header block (From, To, Subject, Date pattern)
function isEmailHeaderBlock(lines: string[], startIndex: number): { isHeader: boolean; endIndex: number } {
  const headerPatterns = [
    /^From:\s*.+/i,
    /^To:\s*.+/i,
    /^Cc:\s*.+/i,
    /^Subject:\s*.+/i,
    /^Date:\s*.+/i,
    /^Sent:\s*.+/i,
  ];
  
  let matchCount = 0;
  let lastMatchIndex = startIndex;
  
  for (let i = startIndex; i < Math.min(startIndex + 8, lines.length); i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    
    const isHeader = headerPatterns.some(p => p.test(line));
    if (isHeader) {
      matchCount++;
      lastMatchIndex = i;
    } else if (matchCount > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
      // Non-header line that's not a continuation - stop checking
      break;
    }
  }
  
  // Need at least 2 header-like lines to consider it a header block
  return { isHeader: matchCount >= 2, endIndex: lastMatchIndex };
}

// Parse email body to separate current message from thread history
function parseEmailThread(body: string): { currentMessage: string; threadHistory: string | null } {
  if (!body) return { currentMessage: '', threadHistory: null };
  
  const lines = body.split('\n');
  let splitIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
    
    // Check for explicit thread separators
    for (const pattern of threadSeparatorPatterns) {
      if (pattern.test(line)) {
        // For "From:" pattern, require it to be after some content and followed by more header-like lines
        if (/^From:\s*.+/i.test(line)) {
          if (i < 3) continue; // Too early to be a thread separator
          const { isHeader } = isEmailHeaderBlock(lines, i);
          if (!isHeader) continue;
        }
        
        // For "Sent from my..." patterns, it's a signature, not thread separator
        if (/^Sent from my/i.test(line)) {
          continue; // Skip - this is a signature
        }
        
        splitIndex = i;
        break;
      }
    }
    
    if (splitIndex !== -1) break;
    
    // Check for quoted content block
    if (isQuotedBlock(lines, i)) {
      splitIndex = i;
      break;
    }
    
    // Check for email header block starting mid-email
    if (i > 3 && /^From:\s*.+/i.test(line)) {
      const { isHeader } = isEmailHeaderBlock(lines, i);
      if (isHeader) {
        splitIndex = i;
        break;
      }
    }
    
    // "On ... wrote:" pattern (most common)
    if (/^On\s+.+\s+wrote:\s*$/i.test(line)) {
      splitIndex = i;
      break;
    }
    
    // Two-line Gmail pattern: "On Mon, Jan 1, 2024 at 10:00 AM" followed by "Name <email> wrote:"
    if (/^On\s+\w{3},?\s+\w{3}\s+\d+/i.test(line) && /wrote:\s*$/i.test(nextLine)) {
      splitIndex = i;
      break;
    }
  }
  
  if (splitIndex === -1) {
    return { currentMessage: body, threadHistory: null };
  }
  
  return {
    currentMessage: lines.slice(0, splitIndex).join('\n').trim(),
    threadHistory: lines.slice(splitIndex).join('\n').trim()
  };
}

// Signature detection patterns
const signatureStartPatterns = [
  /^-{2,}\s*$/,                                    // -- (common signature delimiter)
  /^_{2,}\s*$/,                                    // __ underscores
  /^Regards,?\s*$/i,
  /^Kind\s+regards,?\s*$/i,
  /^Best\s+regards,?\s*$/i,
  /^Best,?\s*$/i,
  /^Thanks,?\s*$/i,
  /^Thank\s+you,?\s*$/i,
  /^Cheers,?\s*$/i,
  /^Sincerely,?\s*$/i,
  /^Warm\s+regards,?\s*$/i,
  /^Many\s+thanks,?\s*$/i,
  /^With\s+thanks,?\s*$/i,
  /^Yours\s+(sincerely|faithfully|truly),?\s*$/i,
  /^All\s+the\s+best,?\s*$/i,
  /^Take\s+care,?\s*$/i,
  /^Sent\s+from\s+my\s+(iPhone|iPad|Galaxy|Android|Mobile|Samsung|Pixel)/i,
  /^Get\s+Outlook\s+for\s+(iOS|Android)/i,
];

// Content that typically appears IN signatures
const signatureContentPatterns = [
  /^(M|T|P|F|E|W):\s*.+/i,                        // M: mobile, T: tel, P: phone, E: email, W: website
  /^(Mobile|Phone|Tel|Fax|Email|Web|Website):\s*.+/i,
  /^(ABN|ACN|AFSL):\s*[\d\s]+/i,                  // Business numbers
  /^\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}$/,          // Phone number only line
  /^www\..+$/i,                                    // Website
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, // Email only line
  /^\|.*\|.*\|/,                                   // Pipe-separated info
  /^Level\s+\d+,?\s+\d+/i,                        // Address: Level X, XXX
  /^\d+\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Boulevard|Blvd)/i, // Street address
  /^(PO|P\.O\.)\s*Box\s+\d+/i,                    // PO Box
  /^[A-Z]{2,3}\s+\d{4}$/,                         // State postcode (NSW 2000)
  /^LinkedIn|Twitter|Facebook|Instagram/i,        // Social media
];

// Detect if remaining lines look like a signature
function looksLikeSignature(lines: string[], startIndex: number): boolean {
  const remainingLines = lines.slice(startIndex).filter(l => l.trim() !== '');
  
  // Signature shouldn't be too long (typically 2-12 lines)
  if (remainingLines.length > 15) return false;
  if (remainingLines.length === 0) return false;
  
  // Count how many lines match signature content patterns
  let signatureContentMatches = 0;
  for (const line of remainingLines) {
    const trimmed = line.trim();
    if (signatureContentPatterns.some(p => p.test(trimmed))) {
      signatureContentMatches++;
    }
  }
  
  // If more than 30% of lines look like signature content, it's likely a signature
  return signatureContentMatches / remainingLines.length >= 0.3;
}

// Parse message to separate body from signature
function parseSignature(message: string): { body: string; signature: string | null } {
  if (!message) return { body: '', signature: null };
  
  const lines = message.split('\n');
  let signatureStart = -1;
  
  // Scan from the end backwards (signatures are at the end)
  // But also check from start for sign-off patterns
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
    const line = lines[i].trim();
    
    // Skip empty lines at the end
    if (line === '' && signatureStart === -1) continue;
    
    // Check for explicit signature delimiter
    if (/^-{2,}\s*$/.test(line) || /^_{2,}\s*$/.test(line)) {
      signatureStart = i;
      break;
    }
  }
  
  // If no explicit delimiter, look for sign-off patterns
  if (signatureStart === -1) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check for sign-off patterns
      const isSignOff = signatureStartPatterns.some(p => p.test(line));
      
      if (isSignOff) {
        // Verify the rest looks like a signature
        if (looksLikeSignature(lines, i) || lines.length - i <= 8) {
          signatureStart = i;
          break;
        }
      }
      
      // Check for "Sent from my..." which is always signature
      if (/^Sent\s+from\s+my/i.test(line) || /^Get\s+Outlook\s+for/i.test(line)) {
        signatureStart = i;
        break;
      }
    }
  }
  
  if (signatureStart === -1) {
    return { body: message, signature: null };
  }
  
  const bodyContent = lines.slice(0, signatureStart).join('\n').trim();
  const signatureContent = lines.slice(signatureStart).join('\n').trim();
  
  // Only treat as signature if body still has content
  if (!bodyContent) {
    return { body: message, signature: null };
  }
  
  return {
    body: bodyContent,
    signature: signatureContent
  };
}

// Smart paragraph detection - groups related lines together
function smartParagraph(text: string): string[][] {
  if (!text) return [];
  
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n');
  
  const paragraphs: string[][] = [];
  let currentParagraph: string[] = [];
  let prevLineEmpty = false;
  let prevLineWasBullet = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const isEmpty = trimmed === '';
    const isBullet = /^([-*•>▪◦]|\d+[.):]|\(\d+\)|[a-zA-Z][.):])\s+/.test(trimmed);
    const isGreeting = /^(hi|hello|hey|dear|good\s+(morning|afternoon|evening))/i.test(trimmed);
    const isSignOff = /^(regards|thanks|thank\s+you|best|cheers|sincerely|kind\s+regards)/i.test(trimmed);
    const isShortLine = trimmed.length < 60 && !trimmed.endsWith(',');
    
    if (isEmpty) {
      // Empty line - end current paragraph if it has content
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph);
        currentParagraph = [];
      }
      prevLineEmpty = true;
      prevLineWasBullet = false;
      continue;
    }
    
    // Start new paragraph conditions
    const shouldStartNew = 
      (prevLineEmpty && currentParagraph.length > 0) ||
      (isGreeting && currentParagraph.length > 0) ||
      (isSignOff && currentParagraph.length > 0) ||
      (isBullet && !prevLineWasBullet && currentParagraph.length > 0) ||
      (!isBullet && prevLineWasBullet && currentParagraph.length > 0);
    
    if (shouldStartNew) {
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph);
      }
      currentParagraph = [line];
    } else {
      currentParagraph.push(line);
    }
    
    prevLineEmpty = false;
    prevLineWasBullet = isBullet;
  }
  
  // Don't forget the last paragraph
  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph);
  }
  
  return paragraphs;
}

// Detect if a line is a bullet/list item
function parseBulletLine(line: string): { isBullet: boolean; indent: number; marker: string; content: string } {
  const trimmed = line.trimStart();
  const indent = line.length - trimmed.length;
  
  // Bullet patterns
  const bulletMatch = trimmed.match(/^([-*•>▪◦])\s+(.*)$/);
  if (bulletMatch) {
    return { isBullet: true, indent, marker: bulletMatch[1], content: bulletMatch[2] };
  }
  
  // Numbered list patterns
  const numberedMatch = trimmed.match(/^(\d+[.):]|\(\d+\)|[a-zA-Z][.):])\s+(.*)$/);
  if (numberedMatch) {
    return { isBullet: true, indent, marker: numberedMatch[1], content: numberedMatch[2] };
  }
  
  return { isBullet: false, indent: 0, marker: '', content: line };
}

// Group lines by type (list vs paragraph)
function groupLinesByType(lines: string[]): Array<{ type: 'paragraph' | 'list'; lines: string[] }> {
  const groups: Array<{ type: 'paragraph' | 'list'; lines: string[] }> = [];
  let currentGroup: { type: 'paragraph' | 'list'; lines: string[] } | null = null;
  
  for (const line of lines) {
    if (line.trim() === '') continue;
    
    const { isBullet } = parseBulletLine(line);
    const lineType = isBullet ? 'list' : 'paragraph';
    
    if (!currentGroup || currentGroup.type !== lineType) {
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { type: lineType, lines: [line] };
    } else {
      currentGroup.lines.push(line);
    }
  }
  
  if (currentGroup) groups.push(currentGroup);
  return groups;
}

// Render a list item
function ListItem({ line, isSmall = false }: { line: string; isSmall?: boolean }) {
  const { marker, content, indent } = parseBulletLine(line);
  const textSize = isSmall ? 'text-xs' : 'text-sm';
  
  return (
    <li 
      className={`${textSize} text-foreground leading-relaxed flex gap-2`}
      style={{ marginLeft: `${Math.min(indent * 4, 32)}px` }}
    >
      <span className="text-muted-foreground flex-shrink-0 min-w-[1.25rem]">{marker}</span>
      <span className="flex-1"><RichTextSpan text={content} /></span>
    </li>
  );
}

// Main formatted content renderer
function FormattedContent({ content, isSmall = false }: { content: string; isSmall?: boolean }) {
  const paragraphs = smartParagraph(content);
  const textSize = isSmall ? 'text-xs' : 'text-sm';
  
  return (
    <div className="space-y-3.5">
      {paragraphs.map((paragraphLines, pIndex) => {
        const groups = groupLinesByType(paragraphLines);

        return (
          <div key={pIndex} className="space-y-2">
            {groups.map((group, gIndex) => {
              if (group.type === 'list') {
                return (
                  <ul key={gIndex} className="space-y-1.5 my-2">
                    {group.lines.map((line, lIndex) => (
                      <ListItem key={lIndex} line={line} isSmall={isSmall} />
                    ))}
                  </ul>
                );
              }

              // Horizontal rule shorthand
              if (group.lines.length === 1 && /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(group.lines[0])) {
                return <hr key={gIndex} className="my-3 border-border/60" />;
              }

              const isQuoted = group.lines.every((l) => /^\s*>/.test(l));
              const quotedClean = isQuoted
                ? group.lines.map((l) => l.replace(/^\s*>+\s?/, ''))
                : group.lines;

              const Wrapper: React.ElementType = isQuoted ? 'blockquote' : 'p';
              const wrapperClass = isQuoted
                ? `${textSize} text-muted-foreground leading-relaxed whitespace-pre-wrap border-l-2 border-border/60 pl-3 italic`
                : `${textSize} text-foreground leading-relaxed whitespace-pre-wrap`;

              return (
                <Wrapper key={gIndex} className={wrapperClass}>
                  {quotedClean.map((line, lIndex) => (
                    <React.Fragment key={lIndex}>
                      <RichTextSpan text={line} />
                      {lIndex < quotedClean.length - 1 && <br />}
                    </React.Fragment>
                  ))}
                </Wrapper>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function RichTextBody({ content, className = '' }: RichTextBodyProps) {
  const cleaned = cleanPlainTextArtifacts(content);
  const { currentMessage, threadHistory } = parseEmailThread(cleaned);
  const { body, signature } = parseSignature(currentMessage);

  return (
    <div className={className}>
      <FormattedContent content={body} />

      {signature && (
        <details className="mt-6 rounded-2xl border border-border/60 bg-muted/20 p-3">
          <summary className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="font-medium">Show signature</span>
          </summary>
          <div className="mt-3 border-l-2 border-primary/25 pl-3 text-muted-foreground">
            <FormattedContent content={signature} isSmall />
          </div>
        </details>
      )}

      {threadHistory && (
        <details className="mt-6 rounded-2xl border border-border/60 bg-muted/20 p-3">
          <summary className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            <span className="font-medium">Show previous messages in thread</span>
          </summary>
          <div className="mt-4 border-l-2 border-primary/25 pl-4 text-muted-foreground">
            <FormattedContent content={threadHistory} isSmall />
          </div>
        </details>
      )}
    </div>
  );
}
