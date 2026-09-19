import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { amlPortalApi } from '@/lib/aml/amlPortalApi';
import type { PassportView } from '@/lib/aml/passport';

/**
 * The bridge between the AML journey and the Compliance Passport: a quiet
 * card on the Identity & Compliance page showing the Passport the journey is
 * building. Renders NOTHING while `aml_passport_client_view` is off or no
 * case exists — the page stays exactly as it was before the Passport.
 *
 * Every figure comes from the server projection; this card derives nothing.
 */
export function PassportPromoCard() {
  const [view, setView] = useState<PassportView | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Promise.resolve() first: if the API surface lacks getPassport (older
    // deploys, partial test mocks) the sync throw becomes a handled
    // rejection and the card simply does not render.
    Promise.resolve()
      .then(() => amlPortalApi.getPassport())
      .then(({ passport }) => { if (!cancelled && passport) setView(passport); })
      .catch(() => { /* flag off or unavailable — render nothing */ });
    return () => { cancelled = true; };
  }, []);

  if (!view) return null;

  const stampCount = view.stamps.length;
  const issued = view.header.state.code === 'issued_current';

  return (
    <Card className="border-primary/20">
      <CardContent className="flex flex-wrap items-center gap-4 py-4">
        <ShieldCheck className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Your Compliance Passport</span>
            <Badge variant="outline">{view.header.state.label}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {issued
              ? `Issued by ${view.header.issuer_org}. ${stampCount} milestone stamp${stampCount === 1 ? '' : 's'} recorded.`
              : stampCount > 0
                ? `Each step you complete adds to your Passport — ${stampCount} stamp${stampCount === 1 ? '' : 's'} earned so far.`
                : 'Completing the steps below builds your Passport.'}
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/client/aml/passport">
            <BookOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {issued ? 'View your Passport' : 'Preview your Passport'}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
