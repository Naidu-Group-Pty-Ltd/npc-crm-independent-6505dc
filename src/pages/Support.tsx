import { useMemo } from 'react';
import { ArrowUpRight, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useWorkspaceEntitlements } from '@/hooks/useWorkspaceEntitlements';

/**
 * A shortcut to the Aurixa Systems Support Portal.
 *
 * Tickets are not handled in this app: they are raised on the portal and
 * triaged by Aurixa Mission Control. The link carries the workspace and user
 * identity as query parameters so the portal can attach the ticket to the
 * right tenant without the reporter re-typing anything — and the "Ticket
 * context" card shows exactly what will be sent, so nothing travels that the
 * user has not seen.
 */

const SUPPORT_PORTAL_URL =
  ((import.meta.env.VITE_SUPPORT_PORTAL_URL as string | undefined) ?? 'https://www.aurixasystems.com.au/support')
    .trim()
    .replace(/\/+$/, '') || 'https://www.aurixasystems.com.au/support';

export default function Support() {
  const { workspaceId } = useWorkspaceEntitlements();
  const { user } = useAuth();

  const target = useMemo(() => {
    const params = new URLSearchParams();
    const entries: Array<[string, string]> = [
      ['workspace_id', workspaceId],
      ['user_id', user?.id ?? ''],
      ['user_name', user?.username ?? ''],
      ['source', 'npc-dashboard'],
      // The exact deployment the user came from, so portal deep links (e.g.
      // knowledge-base answers pointing at /user-guide#section-…) return to
      // this workspace's own dashboard rather than a hardcoded default.
      ['dashboard_url', window.location.origin],
    ];
    for (const [key, value] of entries) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `${SUPPORT_PORTAL_URL}?${query}` : SUPPORT_PORTAL_URL;
  }, [workspaceId, user?.id, user?.username]);

  return (
    <div className="container mx-auto max-w-3xl space-y-6 py-8">
      <div className="flex items-center gap-3">
        <LifeBuoy className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Support</h1>
          <p className="text-muted-foreground">
            Tickets are raised on the Aurixa Systems Support Portal and triaged by Aurixa Mission
            Control.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Raise a support ticket</CardTitle>
          <CardDescription>
            The portal opens in a new tab with this workspace and your user identity already
            attached, so the ticket lands against the right tenant without re-typing anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Button asChild size="lg" className="gap-2">
            <a href={target} target="_blank" rel="noopener noreferrer">
              Open the support portal
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </Button>

          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Destination
            </p>
            <code className="block break-all rounded-md border bg-muted/50 px-3 py-2 text-xs">
              {target}
            </code>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What happens next</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              Your ticket is classified <span className="text-foreground">P0&ndash;P3</span> by
              Aurixa Mission Control based on the nature of the issue and its breakage vector.
            </li>
            <li>
              P2 and below flow through automated remediation where it is safe to do so; fixes
              deploy automatically.
            </li>
            <li>
              P0/P1 and sensitive changes are validated by an engineer; you&rsquo;re contacted at
              the email you provide.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ticket context</CardTitle>
          <CardDescription>What the portal link attaches to your ticket.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-muted-foreground">Workspace ID</dt>
              <dd className="font-mono text-xs">{workspaceId || '—'}</dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-muted-foreground">User</dt>
              <dd className="font-mono text-xs">
                {user ? `${user.username} (${user.id})` : '—'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
