import { useMemo, useState } from 'react';
import RichTextBody from './RichTextBody';
import SanitizedEmailHtml from './SanitizedEmailHtml';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface EmailBodyViewProps {
  content: string;
  /** Original sanitized-on-render HTML from Outlook. Preferred when present so tables, links, and formatting cascade through. */
  html?: string | null;
  className?: string;
  /** Soft character threshold above which the body is collapsed by default. */
  collapseThreshold?: number;
  /** Hard cap to avoid catastrophic renders. */
  hardCap?: number;
}

/**
 * Safe wrapper around the email body renderer.
 *
 * - When the original Outlook HTML is available, render it through
 *   SanitizedEmailHtml (DOMPurify + incremental chunked rendering) so
 *   tables, clickable links and rich formatting survive intact.
 * - Otherwise fall back to RichTextBody for legacy plain-text bodies.
 * - Either path collapses by default once the content exceeds the
 *   threshold, with an explicit "Show full email" toggle.
 */
export default function EmailBodyView({
  content,
  html,
  className = 'prose prose-sm max-w-none dark:prose-invert',
  collapseThreshold = 8000,
  hardCap = 80000,
}: EmailBodyViewProps) {
  const safeHtml = html?.trim() ? html : '';
  const safeContent = content || '';
  const length = (safeHtml || safeContent).length;
  const isLong = length > collapseThreshold;
  const isHuge = length > hardCap;
  const [expanded, setExpanded] = useState(!isLong);

  // Collapsed slice for the text fallback path.
  const collapsedText = useMemo(() => {
    if (!isLong || safeHtml) return safeContent;
    const window = safeContent.slice(0, collapseThreshold);
    const lastBreak = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '));
    return window.slice(0, lastBreak > collapseThreshold * 0.6 ? lastBreak : collapseThreshold);
  }, [safeContent, collapseThreshold, isLong, safeHtml]);

  // Collapsed slice for the HTML path — cut at the nearest tag boundary.
  const collapsedHtml = useMemo(() => {
    if (!isLong || !safeHtml) return safeHtml;
    const window = safeHtml.slice(0, collapseThreshold);
    const lastCut = Math.max(
      window.lastIndexOf('</p>'),
      window.lastIndexOf('</div>'),
      window.lastIndexOf('</tr>'),
      window.lastIndexOf('<br'),
    );
    return lastCut > collapseThreshold * 0.5
      ? window.slice(0, lastCut + (window[lastCut + 4] === '>' ? 5 : 0))
      : window;
  }, [safeHtml, collapseThreshold, isLong]);

  const hiddenChars = length - (expanded ? length : collapseThreshold);

  return (
    <div>
      {safeHtml ? (
        <SanitizedEmailHtml
          html={expanded ? safeHtml : collapsedHtml}
          className={className}
        />
      ) : (
        <RichTextBody content={expanded ? safeContent : collapsedText} className={className} />
      )}

      {isLong && (
        <div className="mt-4 flex flex-col items-start gap-2 border-t border-border/50 pt-3">
          {!expanded && (
            <p className="text-xs text-muted-foreground">
              {Math.max(0, hiddenChars).toLocaleString('en-AU')} more characters hidden
              {isHuge ? ' (large email — expand to load the rest)' : ''}.
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Collapse email
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Show full email
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
