import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { amlPortalApi, type AmlPortalOverview } from '@/lib/aml/amlPortalApi';

/**
 * Dashboard entry point into the AML/CTF compliance check.
 *
 * Activating a client in the Command Centre posts them a portal notification,
 * but a notification is easy to miss and impossible to find again once read.
 * This callout is the persistent link: it appears on the dashboard for as long
 * as there is an open case, and states what is outstanding.
 *
 * Portal-safe by construction — it renders only the fields the client-portal
 * contract already exposes (reference, presentation status, progress counts).
 * No risk rating, screening outcome or internal case state is fetched here.
 */
export function AmlComplianceCallout() {
  const [data, setData] = useState<AmlPortalOverview | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    amlPortalApi.overview()
      .then(res => { if (alive) setData(res); })
      // Silent: the dashboard must still render if AML is unavailable.
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const caseObj = data?.case ?? null;
  if (!loaded || !caseObj) return null;

  const consentOutstanding = data?.consent ? !data.consent.satisfied : false;
  const progress = data?.requirement_progress;
  const sections = data?.sections ?? [];
  const sectionsDone = sections.filter(
    s => ['submitted', 'accepted', 'complete'].includes(s.status)).length;

  const complete = caseObj.status === 'complete';
  const awaitingUs = caseObj.status === 'submitted' || caseObj.status === 'under_review';

  const headline = complete
    ? 'Identity and compliance check complete'
    : awaitingUs
      ? 'Your compliance check is with our team'
      : consentOutstanding
        ? 'Start your identity and compliance check'
        : 'Finish your identity and compliance check';

  const detail = complete
    ? 'Nothing further is needed from you right now.'
    : awaitingUs
      ? 'We are reviewing what you sent. We will contact you if anything else is needed.'
      : consentOutstanding
        ? 'We are required by law to verify your identity before we can act for you. Start by reviewing the collection notice and consents.'
        : 'A few items are still outstanding. Your answers are saved as you go.';

  const pct = sections.length > 0
    ? Math.round(((sectionsDone + (consentOutstanding ? 0 : 1)) / (sections.length + 1)) * 100)
    : 0;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="py-5 flex flex-wrap items-center gap-4">
        <div className="rounded-xl bg-background/80 p-2.5 shadow-sm">
          {complete
            ? <CheckCircle2 className="h-5 w-5 text-primary" />
            : <ShieldCheck className="h-5 w-5 text-primary" />}
        </div>

        <div className="min-w-[240px] flex-1">
          <div className="text-sm font-semibold text-foreground">{headline}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
          {!complete && !awaitingUs && sections.length > 0 && (
            <div className="mt-2 max-w-sm">
              <Progress value={pct} className="h-1.5" />
              <div className="mt-1 text-[11px] text-muted-foreground">
                {sectionsDone} of {sections.length} sections complete
                {progress && progress.total > 0 &&
                  ` · ${progress.completed} of ${progress.total} documents provided`}
              </div>
            </div>
          )}
        </div>

        <Button asChild size="sm" variant={complete || awaitingUs ? 'outline' : 'default'}>
          <Link to="/client/aml">
            {complete || awaitingUs ? 'View' : consentOutstanding ? 'Get started' : 'Continue'}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
