import type { InputHTMLAttributes } from 'react';
import { useFormContext, useFormState } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { advField, advLabel } from './advancedTheme';

function errorAt(errors: unknown, path: string): string | undefined {
  let value: any = errors;
  for (const key of path.split('.')) value = value?.[key];
  return typeof value?.message === 'string' ? value.message : undefined;
}
export function FormField({ name, label, required, ...props }: { name: string; label: string; required?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const { register, control } = useFormContext();
  const { errors } = useFormState({ control, name, exact: true });
  const error = errorAt(errors, name); const id = `advanced-${name.replace(/\./g, '-')}`;
  return <div className="min-w-0 space-y-1.5">
    <Label className={advLabel} htmlFor={id}>{label}{required ? <><span className="ml-1 text-destructive" aria-hidden="true">*</span><span className="sr-only"> (required)</span></> : ''}</Label>
    <Input className={advField} id={id} aria-required={required} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} {...register(name, props.type === 'number' ? { setValueAs: value => value === '' ? 0 : Number(value) } : undefined)} {...props} />
    {error && <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">{error}</p>}
  </div>;
}
