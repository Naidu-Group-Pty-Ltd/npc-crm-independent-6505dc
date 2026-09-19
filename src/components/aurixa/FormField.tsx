import * as React from 'react';
import { AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

/**
 * FormField — Phase 5 primitive.
 *
 * Wraps a control (Input, Select, Textarea, Combobox…) with:
 *   - semantic label + optional required indicator
 *   - inline helper text (muted foreground)
 *   - inline error text (destructive) that replaces helper text on error
 *   - `aria-describedby` wiring for both helper and error nodes
 *   - `aria-invalid` propagated to the underlying control via render prop
 *
 * Consumers pass a render function so the primitive stays agnostic to the
 * specific control library (Radix, native, shadcn wrappers).
 *
 *   <FormField id="email" label="Work email" required
 *     helper="We only use this for report delivery."
 *     error={errors.email}>
 *     {({ id, describedBy, invalid }) => (
 *       <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} />
 *     )}
 *   </FormField>
 */

export interface FormFieldRenderArgs {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

export interface FormFieldProps {
  id: string;
  label: React.ReactNode;
  /** Visible required marker + `aria-required` intent (leave validation to the control). */
  required?: boolean;
  /** Muted helper text — replaced by `error` when present. */
  helper?: React.ReactNode;
  /** Destructive error text. When set the field renders `aria-invalid`. */
  error?: React.ReactNode;
  /** Optional trailing hint (e.g. "0/280") rendered to the right of the label. */
  hint?: React.ReactNode;
  /** Marks the field visibly optional. Ignored when `required` is true. */
  optional?: boolean;
  className?: string;
  children: (args: FormFieldRenderArgs) => React.ReactNode;
}

export function FormField({
  id,
  label,
  required,
  helper,
  error,
  hint,
  optional,
  className,
  children,
}: FormFieldProps) {
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helperId].filter(Boolean).join(' ') || undefined;
  const invalid = !!error;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-destructive">
              *
            </span>
          )}
          {!required && optional && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">Optional</span>
          )}
        </Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>

      {children({ id, describedBy, invalid })}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-xs text-destructive"
        >
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : helper ? (
        <p id={helperId} className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
          <span>{helper}</span>
        </p>
      ) : null}
    </div>
  );
}

export default FormField;
