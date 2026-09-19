import * as React from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A money field that groups its digits while you type.
 *
 * ## Why this exists
 *
 * Every money field in the product was `<Input type="number" />`, which cannot
 * show a thousands separator: the HTML number input's value must parse as a
 * number, so `1,500,000` is not a value it can hold. An adviser typing a
 * property value therefore read `1500000` and had to count the zeros — asked
 * for in the 19 Sep 2026 clone audit, on the property form and then "global
 * across the dashboard for every field that we need to input a numerical
 * value".
 *
 * ## What it is and is not for
 *
 * MONEY. A grouped bedroom count, a grouped interest rate and a grouped year
 * are all wrong, so this is not a replacement for every numeric input — it is
 * the one to reach for where the figure is an amount.
 *
 * ## The rules
 *
 * **It reports a number, never a string.** `onValueChange` is handed
 * `number | null`, so a caller keeps whatever storage it already had and no
 * formatting can leak into a payload. `null` means the box is empty, which is
 * not the same as zero — a distinction this codebase pays for repeatedly
 * elsewhere.
 *
 * **The caret stays where the typist put it.** Re-formatting on every
 * keystroke moves the text under the cursor, so the caret is restored by
 * counting the DIGITS before it rather than the characters: inserting a
 * separator two places to the left must not push the cursor.
 *
 * **What is being typed wins over what it will look like.** A trailing `.`
 * and trailing zeros after it (`1,500.` , `12.50`) are preserved verbatim
 * while the field has focus, because re-writing them mid-entry makes a decimal
 * impossible to type.
 */

const GROUPER = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });

/** Digits before `caret` in `text` — the position that survives re-formatting. */
function digitsBefore(text: string, caret: number): number {
  let seen = 0;
  for (let i = 0; i < caret && i < text.length; i += 1) {
    if (/[0-9]/.test(text[i])) seen += 1;
  }
  return seen;
}

/** The offset in `text` just after its `count`-th digit. */
function offsetAfterDigits(text: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (/[0-9]/.test(text[i])) {
      seen += 1;
      if (seen === count) return i + 1;
    }
  }
  return text.length;
}

/**
 * `1500000.5` → `1,500,000.5`. The fraction is left exactly as typed; only the
 * integer part is grouped.
 */
export function groupDigits(raw: string): string {
  const negative = raw.trim().startsWith('-');
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  const whole = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
  // Everything after the FIRST dot, with any further dots dropped.
  const fraction = firstDot === -1 ? null : cleaned.slice(firstDot + 1).replace(/\./g, '');
  const groupedWhole = whole ? GROUPER.format(Number(whole)) : '';
  const body = fraction === null ? groupedWhole : `${groupedWhole || '0'}.${fraction}`;
  if (!body) return negative ? '-' : '';
  return negative ? `-${body}` : body;
}

/** The number a formatted string stands for, or null when it stands for none. */
export function parseGrouped(text: string): number | null {
  const cleaned = text.replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface CurrencyInputProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Input>, 'value' | 'onChange' | 'type'> {
  /** The amount, or null/undefined for an empty field. */
  value: number | null | undefined;
  /** Called with the amount the field now holds. `null` means empty. */
  onValueChange: (value: number | null) => void;
  /** Allow a negative amount (an adjustment, a credit). Off by default. */
  allowNegative?: boolean;
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onValueChange, allowNegative = false, className, onBlur, onFocus, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const [focused, setFocused] = React.useState(false);
    // What the typist has actually got in the box, while they are in it.
    const [draft, setDraft] = React.useState<string | null>(null);
    const caretRef = React.useRef<number | null>(null);

    const fromProp = value === null || value === undefined || Number.isNaN(value)
      ? ''
      : groupDigits(String(value));
    const shown = focused && draft !== null ? draft : fromProp;

    React.useLayoutEffect(() => {
      const el = inputRef.current;
      if (!el || caretRef.current === null) return;
      const target = offsetAfterDigits(el.value, caretRef.current);
      el.setSelectionRange(target, target);
      caretRef.current = null;
    });

    const setRefs = (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    };

    return (
      <Input
        {...props}
        ref={setRefs}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn('tabular-nums', className)}
        value={shown}
        onFocus={(event) => {
          setFocused(true);
          setDraft(event.currentTarget.value);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          setDraft(null);
          onBlur?.(event);
        }}
        onChange={(event) => {
          const el = event.currentTarget;
          const beforeCaret = digitsBefore(el.value, el.selectionStart ?? el.value.length);
          const stripped = allowNegative ? el.value : el.value.replace(/-/g, '');
          const formatted = groupDigits(stripped);
          caretRef.current = beforeCaret;
          setDraft(formatted);
          onValueChange(parseGrouped(formatted));
        }}
      />
    );
  },
);
CurrencyInput.displayName = 'CurrencyInput';
