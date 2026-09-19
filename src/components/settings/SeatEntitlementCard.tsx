/**
 * Plan & Seats card — Mission Control seat entitlement summary + active seat
 * list. Superadmin-only; hides itself for everyone else.
 */
import { useEffect, useState, useCallback } from 'react';
import { AURIXA_PRICING_URL, openMissionControlWithAttribution } from '@/lib/missionControl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Users, ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { formatDistanceToNow } from 'date-fns';

interface SeatRow {
  id: string;
  external_user_id: string;
  email: string | null;
  display_name?: string | null;
  status: string;
  created_at: string;
}

interface Entitlement {
  plan: { slug: string; name: string; seat_limit: number; device_limit_per_seat: number | null };
  seats_used: number;
  seats_remaining: number;
}

interface Payload {
  entitlement: Entitlement;
  seats: SeatRow[];
  total: number;
}

export function SeatEntitlementCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    const { data: resp, error } = await invokeSecureFunction<Payload>(
      'mission-control-seats',
      { include_list: true, status: 'active', limit: 50 },
    );
    if (error) {
      if (/forbidden|unauth/i.test(error.message)) {
        setForbidden(true);
      } else {
        setLoadError(error.message);
        setData(null);
      }
    } else if (resp?.entitlement) {
      setData(resp);
      setLoadError(null);
    } else {
      setLoadError('Mission Control returned an empty response');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (forbidden) return null;

  const limit = data?.entitlement.plan.seat_limit ?? 0;
  const used = data?.entitlement.seats_used ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const atLimit = limit > 0 && used >= limit;
  const approaching = limit > 0 && pct >= 80 && !atLimit;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Plan & Seats
            </CardTitle>
            <CardDescription>
              Seat entitlement managed by Aurixa Mission Control.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <>
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{loadError}</span>
              <Button size="sm" variant="outline" onClick={load}>Retry</Button>
            </AlertDescription>
          </Alert>
        ) : data ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm text-muted-foreground">Current plan</div>
                <div className="text-lg font-semibold flex items-center gap-2">
                  {data.entitlement.plan.name}
                  <Badge variant="outline" className="text-xs">
                    {data.entitlement.plan.slug}
                  </Badge>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void openMissionControlWithAttribution('seat_plan', AURIXA_PRICING_URL)}>
                Manage plan
                <ExternalLink className="h-3 w-3 ml-2" />
              </Button>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Seats used</span>
                <span className="font-mono">
                  {used} / {limit || '∞'}
                  {limit > 0 && (
                    <span className="text-muted-foreground ml-2">
                      ({data.entitlement.seats_remaining} remaining)
                    </span>
                  )}
                </span>
              </div>
              <Progress value={pct} />
            </div>

            {atLimit && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Seat limit reached — new invites will be blocked until you upgrade your plan.
                </AlertDescription>
              </Alert>
            )}
            {approaching && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  You're at {pct}% of your seat allowance. Consider upgrading before you hit the limit.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <div className="text-sm font-medium">
                Active seats ({data.total || data.seats.length})
              </div>
              {data.seats.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active seats yet.</p>
              ) : (
                <div className="rounded-md border divide-y">
                  {data.seats.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {s.display_name || s.email || s.external_user_id}
                        </div>
                        {s.email && s.display_name && (
                          <div className="text-xs text-muted-foreground truncate">{s.email}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant={s.status === 'active' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {s.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
