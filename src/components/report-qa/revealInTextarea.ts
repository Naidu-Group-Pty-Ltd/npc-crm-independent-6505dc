/** The computed properties that decide where a textarea wraps its text. */
const WRAPPING = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
  'textTransform', 'wordSpacing', 'textIndent', 'tabSize', 'wordBreak',
] as const;

/**
 * Select a stretch of a textarea and scroll it into view, near the top.
 *
 * Where a character sits depends on how the textarea wraps its lines, so it is
 * measured on a hidden copy that wraps the same way — counting newlines would
 * put a heading several screens off on an answer of long paragraphs.
 */
export function revealInTextarea(textarea: HTMLTextAreaElement, start: number, end: number): void {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const property of WRAPPING) {
    mirror.style.setProperty(
      property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
      style.getPropertyValue(property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
    );
  }
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.textContent = textarea.value.slice(0, start);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  document.body.removeChild(mirror);

  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(start, end);
  textarea.scrollTop = Math.max(0, top - 24);
}
