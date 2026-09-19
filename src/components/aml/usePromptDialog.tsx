import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Phase 12 — commercial replacement for `window.prompt`.
 *
 * Browser prompts cannot be styled, cannot carry a label/description pair a
 * screen reader can associate, cannot show inline validation, and are blocked
 * outright in some embedded contexts. Compliance actions that require a
 * reason or a dated deadline need all three, so they use this dialog instead.
 *
 * Usage mirrors `window.prompt` so call sites stay simple:
 *
 *   const { prompt, dialog } = usePromptDialog();
 *   const values = await prompt({ title: "…", fields: [{ name: "reason", … }] });
 *   if (!values) return;            // cancelled
 *   … values.reason …
 *   return (<>{dialog}…</>);
 */
export interface PromptField {
  name: string;
  label: string;
  type?: "text" | "date" | "textarea" | "email";
  required?: boolean;
  /** Mirrors the server-side rule so the user sees it before submitting. */
  minLength?: number;
  placeholder?: string;
  helpText?: string;
  /**
   * The value the field OPENS with.
   *
   * Placeholder text is not a value: it cannot be selected, cannot be
   * copied, and is not submitted. A dialog that "pre-fills" an address by
   * placeholder alone forces the operator to retype something the platform
   * already knows, and a dialog that shows a one-time credential that way
   * shows an empty box — which is exactly how a Passport link came to be
   * displayed at the one moment it existed and could not be copied.
   */
  value?: string;
}

export interface PromptConfig {
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Use for irreversible or escalating actions. */
  destructive?: boolean;
  fields: PromptField[];
}

type PromptValues = Record<string, string>;

function validate(field: PromptField, raw: string): string | null {
  const value = (raw ?? "").trim();
  if (field.required && !value) return "This is required.";
  if (!value) return null;
  if (field.minLength && value.length < field.minLength) {
    return `Enter at least ${field.minLength} characters (${value.length} so far).`;
  }
  if (field.type === "date" && Number.isNaN(new Date(value).getTime())) {
    return "Enter a valid date.";
  }
  return null;
}

export function usePromptDialog() {
  const [config, setConfig] = useState<PromptConfig | null>(null);
  const [resolver, setResolver] = useState<{ fn: (v: PromptValues | null) => void } | null>(null);
  const [values, setValues] = useState<PromptValues>({});
  const [showErrors, setShowErrors] = useState(false);

  const prompt = useCallback((next: PromptConfig) => {
    setConfig(next);
    setValues(Object.fromEntries(next.fields.map((f) => [f.name, f.value ?? ""])));
    setShowErrors(false);
    return new Promise<PromptValues | null>((resolve) => {
      setResolver({ fn: resolve });
    });
  }, []);

  const close = useCallback((result: PromptValues | null) => {
    resolver?.fn(result ?? null);
    setResolver(null);
    setConfig(null);
    setValues({});
    setShowErrors(false);
  }, [resolver]);

  const errors = useMemo(() => {
    if (!config) return {} as Record<string, string | null>;
    return Object.fromEntries(
      config.fields.map((f) => [f.name, validate(f, values[f.name] ?? "")]),
    ) as Record<string, string | null>;
  }, [config, values]);

  const isValid = Object.values(errors).every((e) => !e);

  const submit = () => {
    if (!isValid) {
      // Keep the button enabled and move focus to the first problem rather
      // than leaving the user with a dead control.
      setShowErrors(true);
      const firstBad = config?.fields.find((f) => errors[f.name]);
      if (firstBad) {
        requestAnimationFrame(() => {
          document.getElementById(`prompt-${firstBad.name}`)?.focus();
        });
      }
      return;
    }
    const trimmed = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, (v ?? "").trim()]),
    );
    close(trimmed);
  };

  const dialog: ReactNode = (
    <Dialog open={Boolean(config)} onOpenChange={(open) => { if (!open) close(null); }}>
      <DialogContent className="max-w-lg">
        {config && (
          <>
            <DialogHeader>
              <DialogTitle>{config.title}</DialogTitle>
              {config.description && <DialogDescription>{config.description}</DialogDescription>}
            </DialogHeader>
            <div className="space-y-4">
              {config.fields.map((f) => {
                const id = `prompt-${f.name}`;
                const error = showErrors ? errors[f.name] : null;
                const describedBy = [
                  f.helpText ? `${id}-help` : null,
                  error ? `${id}-error` : null,
                ].filter(Boolean).join(" ") || undefined;
                return (
                  <div key={f.name} className="space-y-1.5">
                    <Label htmlFor={id}>
                      {f.label}
                      {f.required && <span aria-hidden className="ml-1 text-destructive">*</span>}
                      {f.required && <span className="sr-only"> (required)</span>}
                    </Label>
                    {f.type === "textarea" ? (
                      <Textarea
                        id={id} rows={3} value={values[f.name] ?? ""}
                        placeholder={f.placeholder}
                        aria-describedby={describedBy}
                        aria-invalid={error ? true : undefined}
                        onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      />
                    ) : (
                      <Input
                        id={id} type={f.type ?? "text"} value={values[f.name] ?? ""}
                        placeholder={f.placeholder}
                        aria-describedby={describedBy}
                        aria-invalid={error ? true : undefined}
                        onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      />
                    )}
                    {f.helpText && (
                      <p id={`${id}-help`} className="text-xs text-muted-foreground">{f.helpText}</p>
                    )}
                    {error && (
                      <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>
                    )}
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(null)}>Cancel</Button>
              <Button
                variant={config.destructive ? "destructive" : "default"}
                onClick={submit}
              >
                {config.confirmLabel ?? "Confirm"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  return { prompt, dialog };
}
