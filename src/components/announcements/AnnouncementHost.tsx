import { AlertCircle, AlertTriangle, ArrowUpRight, CheckCircle2, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import type {
  AnnouncementSeverity,
  PlatformAnnouncement,
} from "@/lib/announcements/state";

/**
 * Platform announcements from Mission Control, drawn in the dashboard's own
 * banner strip beside the gate, plan-change and feedback banners — plus at
 * most one modal popup at a time.
 *
 * Two rules from this codebase carry the rendering. **Severity is an icon
 * AND a tint, never a tint alone** — `--primary` and `--warning` are both
 * gold in dark mode, and five tones that carry no information is a defect
 * this platform has already shipped once. And **nothing here can block the
 * page**: a modal is always dismissible (enforced server-side, in the
 * parser, and by the close affordances here), because an uncloseable modal
 * is a lock screen and locking is the payment gate's job.
 */
const SEVERITY: Record<
  AnnouncementSeverity,
  { icon: typeof Info; frame: string; chip: string }
> = {
  info: {
    icon: Info,
    frame: "border-primary/40 bg-primary/10",
    chip: "border-primary/40 bg-primary/15 text-primary",
  },
  success: {
    icon: CheckCircle2,
    frame: "border-success/40 bg-success/10",
    chip: "border-success/40 bg-success/15 text-success",
  },
  warning: {
    icon: AlertTriangle,
    frame: "border-warning/40 bg-warning/10",
    chip: "border-warning/40 bg-warning/15 text-warning",
  },
  critical: {
    icon: AlertCircle,
    frame: "border-destructive/40 bg-destructive/10",
    chip: "border-destructive/40 bg-destructive/15 text-destructive",
  },
};

function AnnouncementBanner({
  announcement,
  onDismiss,
}: {
  announcement: PlatformAnnouncement;
  onDismiss: () => void;
}) {
  const look = SEVERITY[announcement.severity];
  const Icon = look.icon;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative mx-auto w-full max-w-[1600px] min-w-0 overflow-hidden rounded-2xl border px-4 py-3.5 sm:px-5",
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        "text-foreground backdrop-blur-sm",
        "shadow-[0_12px_32px_hsl(var(--foreground)/0.06)]",
        look.frame,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
            look.chip,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{announcement.title}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
            {announcement.body}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
        {announcement.linkUrl && (
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href={announcement.linkUrl} target="_blank" rel="noopener noreferrer">
              {announcement.linkLabel ?? announcement.linkUrl}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        {announcement.dismissible && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={onDismiss}
            aria-label={`Dismiss "${announcement.title}"`}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function AnnouncementHost() {
  const { visible, dismiss } = useAnnouncements();

  return (
    <>
      {visible.banners.map((a) => (
        <AnnouncementBanner
          key={`${a.id}:r${a.revision}`}
          announcement={a}
          onDismiss={() => dismiss(a)}
        />
      ))}

      {visible.modal && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && visible.modal) dismiss(visible.modal);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-3">
                {(() => {
                  const look = SEVERITY[visible.modal.severity];
                  const Icon = look.icon;
                  return (
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                        look.chip,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                  );
                })()}
                <DialogTitle>{visible.modal.title}</DialogTitle>
              </div>
              <DialogDescription className="whitespace-pre-line pt-2 text-left">
                {visible.modal.body}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              {visible.modal.linkUrl && (
                <Button asChild variant="outline" className="gap-1.5">
                  <a
                    href={visible.modal.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {visible.modal.linkLabel ?? visible.modal.linkUrl}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
              <Button onClick={() => visible.modal && dismiss(visible.modal)}>
                Got it
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
