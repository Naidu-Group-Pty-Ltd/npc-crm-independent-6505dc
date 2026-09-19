import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  Loader2,
  MessageSquareQuote,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchFeedbackPrompt, type FeedbackPrompt } from '@/lib/missionControl';

/**
 * A shortcut to the feedback form.
 *
 * In normal use nobody comes here: the workspace is prompted by
 * FeedbackPromptBanner inside its first 30 days and once a quarter after that,
 * and the banner carries the link. This page also provides the plain feedback
 * form URL when no campaign is currently due.
 *
 * The distinction it makes visible is the one that matters. An ATTRIBUTED link
 * carries a handoff minted server-to-server, so the form knows the workspace
 * and the person, can grant the 100 credits, and scales its questions to the
 * plan. A PLAIN link carries nothing and the form will say so rather than
 * pretend.
 *
 */

const FEEDBACK_URL = 'https://aurixasystems.com.au/feedback';

export default function Feedback() {
  const [prompt, setPrompt] = useState<FeedbackPrompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchFeedbackPrompt()
      .then((p) => !cancelled && setPrompt(p))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const attributed = prompt?.feedbackUrl ?? null;
  const target = attributed ?? FEEDBACK_URL;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(target);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the URL is on screen to select by hand */
    }
  };

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-8">
      <div className="flex items-center gap-3">
        <MessageSquareQuote className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Feedback</h1>
          <p className="text-muted-foreground">
            Opens the Aurixa Systems feedback form in a new tab.
          </p>
        </div>
        <Badge variant="outline" className="ml-auto">
          Feedback
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open the form</CardTitle>
          <CardDescription>
            In normal use this is reached from the prompt that appears at the top of the dashboard
            — inside your first 30 days, then once a quarter. An attributed, reward-eligible link
            is available here only while a campaign is due.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {loading ? (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking for a link…
            </span>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="lg" className="gap-2">
                  <a href={target} target="_blank" rel="noopener noreferrer">
                    Open feedback form
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </Button>
                <Button variant="outline" size="lg" onClick={() => void copy()} className="gap-2">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              </div>

              {/* Which link you actually got, and what it will do. Without this
                  a tester sees "open this from your workspace" on the form and
                  reasonably concludes something is broken. */}
              {attributed ? (
                <div className="rounded-md border border-primary/40 bg-primary/[0.07] p-4">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Zap className="h-4 w-4 text-primary" />
                    Attributed link — the full flow
                  </p>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Carries a single-use handoff, so the form knows this workspace and you, scales
                    its questions to your plan, and grants{' '}
                    <span className="font-medium text-foreground">
                      {prompt?.rewardTokens?.toLocaleString('en-AU') ?? 100} credits
                    </span>{' '}
                    on submit
                    {prompt?.rewardAvailable === false &&
                      ' — though someone here has already claimed this round, so this submission earns nothing'}
                    .
                  </p>
                </div>
              ) : (
                <div className="rounded-md border border-destructive/40 bg-destructive/[0.07] p-4">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    Plain link — no feedback campaign is due
                  </p>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Mission Control did not return a campaign link. The form can still be opened,
                    but the plain link carries no workspace attribution and cannot grant campaign
                    credits.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Destination
                </p>
                <code className="block break-all rounded-md border bg-muted/50 px-3 py-2 text-xs">
                  {target}
                </code>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What to check</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              The questions match this workspace&rsquo;s plan — core areas for everyone, plus the
              modules the tier includes.
            </li>
            <li>Submitting returns the reward state with the credits and their expiry date.</li>
            <li>
              The balance in the header goes up by 100, and the response appears in Mission Control
              under <span className="text-foreground">Billing → Catalog → Product feedback</span>.
            </li>
            <li>
              Submitting again as a different user records the response but grants nothing — the
              reward is one per workspace per campaign.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
