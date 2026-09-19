/**
 * A dismissible in-progress notice.
 *
 * `sonner` deliberately refuses to draw its close button on a loading toast
 * (`closeButton && !toast.jsx && toastType !== 'loading'`), so the long-running
 * report generation notice had no way to be closed however the `Toaster` was
 * configured. This renders the same thing as a custom toast — spinner, title,
 * description — with our own close control.
 *
 * Two rules:
 *  - Closing hides the notice only. The work continues, and the floating
 *    progress panel remains the place to stop a run.
 *  - A closed notice stays closed: the generators update the same toast id once
 *    per section, and re-adding it after a click would make the button useless.
 */
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

const dismissedIds = new Set<string>();

let counter = 0;

export function createProgressToastId(prefix = "progress"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function progressToastDismissed(id: string): boolean {
  return dismissedIds.has(id);
}

/** Show or update a progress notice. No-op once the user has closed it. */
export function showProgressToast(
  id: string,
  title: string,
  description?: string,
): void {
  if (dismissedIds.has(id)) return;

  toast.custom(
    () => (
      <div className="flex w-full items-start gap-3">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-5 text-foreground">{title}</p>
          {description ? (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close this notice"
          onClick={() => dismissProgressToast(id)}
          className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    ),
    { id, duration: Infinity },
  );
}

/** Close the notice by hand. The underlying work is untouched. */
export function dismissProgressToast(id: string): void {
  dismissedIds.add(id);
  toast.dismiss(id);
}

/**
 * Replace the notice with its outcome. A settled notice is a new toast, so it
 * carries the standard close button and auto-dismiss, and a notice the user
 * closed earlier does not suppress the result.
 */
export function settleProgressToast(
  id: string,
  kind: "success" | "error" | "info",
  title: string,
  description?: string,
): void {
  dismissedIds.delete(id);
  toast.dismiss(id);
  toast[kind](title, description ? { description } : undefined);
}
