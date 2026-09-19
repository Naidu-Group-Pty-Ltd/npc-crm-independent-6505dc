import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * What a partner sees if a public link page fails to render.
 *
 * The link pages are reached from an email by somebody with no account, no
 * session and no support channel here — they are not a user of this platform
 * and never will be. The application's own fallback says "Something went
 * wrong" and offers a reload, which is written for a signed-in operator who
 * can raise a ticket. To the recipient of a compliance agreement it is
 * indistinguishable from a link that has expired or been mistyped, and the
 * only sensible reading of it — "this link is broken" — is the one thing they
 * cannot act on, because the sender never hears about it.
 *
 * So this fallback names the ONE action that actually resolves it: ask the
 * organisation that sent the link to send it again. Nothing is lost by doing
 * so — a replacement link stands the previous one down and carries the same
 * agreement — and if the fault is ours rather than theirs, the re-send is
 * what surfaces it in the Command Centre, where somebody can see it.
 *
 * It is deliberately plain: no brand lookup, no data, no hooks. A fallback
 * that can itself throw is not a fallback.
 */
export function PublicLinkErrorFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-3 py-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-warning" aria-hidden />
          <h1 className="text-base font-semibold text-foreground">
            This page could not be displayed
          </h1>
          <p className="mx-auto max-w-prose text-sm text-muted-foreground">
            Nothing has been recorded and nothing has been lost. Please ask the organisation that
            sent you this link to issue a new one — a replacement carries the same document and
            stands the previous link down.
          </p>
          <div className="pt-1">
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
