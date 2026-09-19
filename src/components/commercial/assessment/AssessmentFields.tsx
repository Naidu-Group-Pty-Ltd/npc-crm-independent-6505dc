/**
 * Form primitives for the assessment workspace.
 *
 * Every control here wires its label, help text and error to the input with
 * real `id` / `aria-describedby` / `aria-invalid` attributes, so a screen
 * reader announces the same thing a sighted user reads and an error is never
 * conveyed by colour alone.
 */

import { useId, useMemo, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** A titled group of fields. Two columns on desktop, one on small screens. */
export function FieldGroup({
  title, description, children, columns = 2,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  return (
    <section className="ci-field-group">
      <header className="ci-field-group-header">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div
        className={cn(
          'ci-field-grid',
          columns === 1 && 'sm:grid-cols-1',
          columns === 2 && 'sm:grid-cols-2',
          columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        )}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Advanced fields, collapsed by default. Progressive disclosure is the whole
 * reason an ordinary user can get through a step that a specialist needs
 * forty fields for.
 */
export function AdvancedSection({
  title, children, defaultOpen = false, count,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  count?: number;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="ci-advanced">
      <CollapsibleTrigger className="ci-advanced-trigger group">
        <span className="flex items-center gap-2">
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
          {title}
        </span>
        {count != null ? (
          <span className="text-xs font-normal text-muted-foreground">{count} field{count === 1 ? '' : 's'}</span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="ci-advanced-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Span the full width of a `FieldGroup` grid. */
export function FullWidth({ children }: { children: ReactNode }) {
  return <div className="sm:col-span-2 lg:col-span-3">{children}</div>;
}

// ---------------------------------------------------------------------------
// Field shell
// ---------------------------------------------------------------------------

interface FieldShellProps {
  label: string;
  help?: string;
  error?: string;
  required?: boolean;
  /** Where the value came from, when it was imported rather than typed. */
  provenance?: string;
  /**
   * Dot path into the payload, e.g. `loan.residualBalloonAmount`. Rendered as a
   * DOM attribute so the error summary can scroll straight to this field and
   * flash it, rather than dropping the user at the top of a long step and
   * leaving them to hunt for what is wrong.
   */
  fieldPath?: string;
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

function FieldShell({ label, help, error, required, provenance, fieldPath, children }: FieldShellProps) {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="ci-field" data-ci-field={fieldPath} data-ci-invalid={error ? 'true' : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={inputId} className="ci-field-label">
          {label}
          {required ? <span className="text-destructive" aria-hidden="true"> *</span> : null}
          {required ? <span className="sr-only"> (required)</span> : null}
        </Label>
        {provenance ? <span className="ci-provenance-tag">{provenance}</span> : null}
      </div>
      {children({ inputId, describedBy, invalid: Boolean(error) })}
      {help ? (
        <p id={helpId} className="ci-field-help">
          <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{help}</span>
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="ci-field-error" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export interface BaseFieldProps {
  label: string;
  help?: string;
  error?: string;
  required?: boolean;
  provenance?: string;
  disabled?: boolean;
  /** Dot path into the payload; makes the field a scroll-and-highlight target. */
  fieldPath?: string;
}

export function TextField({
  value, onChange, placeholder, onBlur, ...shell
}: BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onBlur?: () => void;
}) {
  return (
    <FieldShell {...shell}>
      {({ inputId, describedBy, invalid }) => (
        <Input
          id={inputId}
          value={value}
          disabled={shell.disabled}
          placeholder={placeholder}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FieldShell>
  );
}


/**
 * Money input. Held as a string so a half-typed "1200" never round-trips
 * through a number and loses the user's cursor, and parsed on the way out.
 */
export function MoneyField({
  value, onChange, ...shell
}: BaseFieldProps & {
  value: number;
  onChange: (value: number) => void;
}) {
  const display = useMemo(() => (value === 0 ? '' : String(value)), [value]);
  return (
    <FieldShell {...shell}>
      {({ inputId, describedBy, invalid }) => (
        <div className="ci-money-input">
          <span className="ci-money-prefix" aria-hidden="true">$</span>
          <Input
            id={inputId}
            type="text"
            inputMode="decimal"
            value={display}
            disabled={shell.disabled}
            placeholder="0"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              const raw = event.target.value.replace(/[^0-9.-]/g, '');
              const parsed = Number(raw);
              onChange(raw === '' || Number.isNaN(parsed) ? 0 : parsed);
            }}
          />
        </div>
      )}
    </FieldShell>
  );
}

export function PercentField({
  value, onChange, max = 100, ...shell
}: BaseFieldProps & {
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  const display = useMemo(() => (value === 0 ? '' : String(value)), [value]);
  return (
    <FieldShell {...shell}>
      {({ inputId, describedBy, invalid }) => (
        <div className="ci-money-input">
          <Input
            id={inputId}
            type="text"
            inputMode="decimal"
            value={display}
            disabled={shell.disabled}
            placeholder="0"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              const raw = event.target.value.replace(/[^0-9.-]/g, '');
              const parsed = Number(raw);
              onChange(raw === '' || Number.isNaN(parsed) ? 0 : Math.min(max, parsed));
            }}
          />
          <span className="ci-money-suffix" aria-hidden="true">%</span>
        </div>
      )}
    </FieldShell>
  );
}

export function NumberField({
  value, onChange, ...shell
}: BaseFieldProps & {
  value: number;
  onChange: (value: number) => void;
}) {
  const display = useMemo(() => (value === 0 ? '' : String(value)), [value]);
  return (
    <FieldShell {...shell}>
      {({ inputId, describedBy, invalid }) => (
        <Input
          id={inputId}
          type="text"
          inputMode="numeric"
          value={display}
          disabled={shell.disabled}
          placeholder="0"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            const raw = event.target.value.replace(/[^0-9.-]/g, '');
            const parsed = Number(raw);
            onChange(raw === '' || Number.isNaN(parsed) ? 0 : parsed);
          }}
        />
      )}
    </FieldShell>
  );
}

export function DateField({
  value, onChange, ...shell
}: BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FieldShell {...shell}>
      {({ inputId, describedBy, invalid }) => (
        <Input
          id={inputId}
          type="date"
          value={value}
          disabled={shell.disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FieldShell>
  );
}

export function SelectField<T extends string>({
  value, onChange, options, placeholder, ...shell
}: BaseFieldProps & {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; description?: string }>;
  placeholder?: string;
}) {
  return (
    <FieldShell {...shell}>
      {({ inputId, describedBy, invalid }) => (
        <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={shell.disabled}>
          <SelectTrigger
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-required={shell.required || undefined}
          >
            <SelectValue placeholder={placeholder ?? 'Select…'} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  value, onChange, rows = 3, placeholder, ...shell
}: BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <FieldShell {...shell}>
      {({ inputId, describedBy, invalid }) => (
        <Textarea
          id={inputId}
          value={value}
          rows={rows}
          placeholder={placeholder}
          disabled={shell.disabled}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FieldShell>
  );
}

export function SwitchField({
  value, onChange, label, help, disabled, fieldPath,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  help?: string;
  disabled?: boolean;
  /** See `FieldShellProps.fieldPath` — the scroll-and-highlight target. */
  fieldPath?: string;
}) {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  return (
    <div className="ci-switch-field" data-ci-field={fieldPath}>
      <Switch
        id={inputId}
        checked={value}
        disabled={disabled}
        aria-describedby={help ? helpId : undefined}
        onCheckedChange={onChange}
      />
      <div className="min-w-0">
        <Label htmlFor={inputId} className="ci-field-label cursor-pointer">{label}</Label>
        {help ? <p id={helpId} className="mt-0.5 text-xs leading-5 text-muted-foreground">{help}</p> : null}
      </div>
    </div>
  );
}

/**
 * Tri-state control for questions where "we do not know yet" is a real and
 * meaningful answer — collapsing it to false would silently assert something.
 */
export function TriStateField({
  value, onChange, label, help, fieldPath,
}: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  label: string;
  help?: string;
  /** See `FieldShellProps.fieldPath` — the scroll-and-highlight target. */
  fieldPath?: string;
}) {
  const options = [
    { key: 'yes', label: 'Yes', value: true },
    { key: 'no', label: 'No', value: false },
    { key: 'unknown', label: 'Not yet known', value: null },
  ] as const;
  const groupId = useId();

  return (
    <div className="ci-field" role="radiogroup" aria-labelledby={`${groupId}-label`} data-ci-field={fieldPath}>
      <span id={`${groupId}-label`} className="ci-field-label">{label}</span>
      <div className="ci-tristate">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={cn('ci-tristate-option', value === option.value && 'ci-tristate-option-active')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {help ? <p className="ci-field-help"><Info className="h-3 w-3 shrink-0" aria-hidden="true" /><span>{help}</span></p> : null}
    </div>
  );
}

/** Read-only derived value, shown alongside the inputs that produced it. */
export function DerivedValue({
  label, value, tone = 'neutral', note,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  note?: string;
}) {
  return (
    <div className={cn('ci-derived', `ci-derived-${tone}`)}>
      <dt className="ci-derived-label">{label}</dt>
      <dd className="ci-derived-value">{value}</dd>
      {note ? <p className="ci-derived-note">{note}</p> : null}
    </div>
  );
}
