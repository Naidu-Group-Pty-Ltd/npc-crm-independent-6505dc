import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, MessageSquareQuote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchFeedbackPrompt, type FeedbackPrompt } from "@/lib/missionControl";

/**
 * "Tell us how it's going — worth 100 credits."
 *
 * Shown when Mission Control says this workspace is due: once inside its first
 * 30 days, then once a quarter. The cadence deliberately lives there rather
 * than here, so a clone created next year inherits it without the rule being
 * copied into a front end that deploys separately.
 *
 * The link is minted server-side and carries an attributed handoff, which is
 * how a form on a marketing domain knows which workspace and which person is
 * answering without anyone logging in twice. Built here it would be a bare URL
 * and every response would arrive anonymous.
 *
 * Dismissing is local and lasts the session. Deliberately NOT an
 * acknowledgement: the prompt is retired by actually answering, and a
 * server-side dismissal would let one person permanently silence a request the
 * whole workspace is eligible for.
 */
const DISMISS_KEY = "aurixa.feedback-prompt.dismissed";

export function FeedbackPromptBanner() {
  const [prompt, setPrompt] = useState<FeedbackPrompt | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchFeedbackPrompt().then((p) => {
      if (cancelled || !p) return;
      // Per campaign, so a new quarter asks again even in the same session.
      try {
        if (sessionStorage.getItem(DISMISS_KEY) === p.campaignKey) return;
      } catch {
        /* private mode — show it */
      }
      setPrompt(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      if (prompt?.campaignKey) sessionStorage.setItem(DISMISS_KEY, prompt.campaignKey);
    } catch {
      /* nothing to do */
    }
  }, [prompt]);

  if (!prompt || dismissed || !prompt.feedbackUrl) return null;

  const first = prompt.reason === "onboarding";

  return (
    <div
      role="status"
      className={cn(
        "relative mx-auto w-full max-w-[1600px] min-w-0 overflow-hidden rounded-2xl border px-4 py-3.5 sm:px-5",
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        "border-primary/35 bg-primary/[0.07] text-foreground backdrop-blur-sm",
      )}
    >
      <div className="flex min-w-0 items-start gap-3 sm:items-center">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/15 text-primary">
          <MessageSquareQuote className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">
            {first ? "How are the first few weeks going?" : "How has Aurixa been this quarter?"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {prompt.rewardAvailable ? (
              <>
                A few minutes of feedback, and your workspace gets{" "}
                <span className="font-medium text-foreground">
                  {prompt.rewardTokens.toLocaleString('en-AU')} credits
                </span>
                . The questions cover only the modules you actually use.
              </>
            ) : (
              // Honest rather than tempting: a colleague already claimed this
              // round's credits, and promising them again would be a lie the
              // form itself would have to walk back.
              <>
                A colleague has already claimed this round&rsquo;s credits, but we&rsquo;d still
                like to hear from you — every response gets read.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
        <Button asChild size="sm" className="gap-1.5">
          {/* Opened in a new tab: the form lives on the marketing site, and
              sending someone away mid-task loses whatever they were doing. */}
          <a href={prompt.feedbackUrl} target="_blank" rel="noopener noreferrer">
            Share feedback
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={dismiss}
          aria-label="Dismiss feedback request"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
