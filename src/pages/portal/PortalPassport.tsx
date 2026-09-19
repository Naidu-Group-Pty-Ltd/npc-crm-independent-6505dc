import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { amlPortalApi } from '@/lib/aml/amlPortalApi';
import { buildBooklet, type PassportView } from '@/lib/aml/passport';
import { PassportBook } from '@/components/aml/passport/design/PassportBook';
import {
  formatPassportCurrency,
  formatPassportDate,
  formatPassportDateTime,
} from '@/components/aml/passport/format';
import { classifyPassportLoadFailure } from '@/components/aml/passport/loadState';

/**
 * The client's Compliance Passport — the premium booklet expression of the
 * SAME server projection the working views consume.
 *
 * Everything on these pages arrived from `get_passport` (the dedicated
 * client-sanitised projection): this component adds no data, derives no
 * state and holds no milestone flags of its own. The booklet is a deliberate
 * single-look print world (navy cover, cream paper) painted entirely from
 * the scoped passport tokens — a passport's paper stays paper in dark mode.
 *
 * While `aml_passport_client_view` is off the server answers 404
 * `passport_disabled` and this page shows only a quiet return path — the
 * portal behaves as though the page does not exist.
 */

type LoadState =
  | { kind: 'loading' }
  | { kind: 'disabled' }
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; view: PassportView };

type BookletPage = { id: string; title: string; kicker: string };

export default function PortalPassport() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [pageIdx, setPageIdx] = useState(0);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const { passport } = await amlPortalApi.getPassport();
      setState(passport ? { kind: 'ready', view: passport } : { kind: 'none' });
    } catch (e: unknown) {
      const failure = classifyPassportLoadFailure(e);
      setState(failure.kind === 'disabled' ? { kind: 'disabled' } : { kind: 'error', message: failure.message });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const view = state.kind === 'ready' ? state.view : null;

  const pages = useMemo(() => (view ? buildBooklet(view) : []), [view]);

  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPageIdx((i) => Math.min(i + 1, pages.length - 1));
      if (e.key === 'ArrowLeft') setPageIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, pages.length]);

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Opening your Compliance Passport…
      </div>
    );
  }

  if (state.kind === 'disabled' || state.kind === 'none') {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Card>
          <CardContent className="space-y-3 py-6 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {state.kind === 'none'
                ? 'Your Compliance Passport will appear here once your adviser opens your identity and compliance case.'
                : 'Your Compliance Passport is not available yet.'}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/client/aml"><ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Back to Identity &amp; Compliance</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Alert variant="destructive">
          <AlertTitle>Your Passport could not be opened</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Please try again shortly.</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const v = view!;

  return (
    <div className="passport-scope mx-auto max-w-3xl space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/client/aml"><ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Identity &amp; Compliance</Link>
        </Button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{v.header.credential ?? 'In progress'}</span>
          <Badge variant="outline">{v.header.state.label}</Badge>
        </div>
      </div>

      {/* ── the bound document ─────────────────────────────────────────
          The SAME viewer the Command Centre uses. The client and the officer
          must be looking at one artefact; the audience difference is already
          handled by the projection, so nothing here re-decides it. */}
      <PassportBook pages={pages} className="passport-scope rounded-xl" />
    </div>
  );
}

/* ── pages ─────────────────────────────────────────────────────────────── */













