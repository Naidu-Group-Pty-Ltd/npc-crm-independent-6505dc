import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Camera, ExternalLink, RefreshCw } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { readStreetView, writeStreetView } from '@/lib/streetViewCache';

interface StreetViewPanelProps {
  lat: number;
  lng: number;
  label?: string;
  className?: string;
  /**
   * `card` (default) is the standalone block: its own heading, the capture date
   * beside it, and a full-width link out to Google Maps.
   *
   * `inline` is the same imagery with the chrome stripped down to overlays, for
   * callers that already provide a heading — the map popup shows Street View
   * and the property photo in one framed slot with a toggle between them, and a
   * second heading plus a second full-width button there is what made the card
   * taller than the map itself.
   */
  variant?: 'card' | 'inline';
  /** Frame height. Only meaningful for `inline`. */
  frameClassName?: string;
  /**
   * Told every time the panel's state settles. Exists for the gallery's
   * automatic cascade: a hero that swapped its drawn cover for this panel needs
   * to know when the panorama genuinely rendered — and when it did not, so it
   * can put the cover back rather than leave an apology where imagery was
   * promised.
   */
  onStatus?: (status: StreetViewStatus) => void;
  /**
   * Names the imagery as Street View on the frame itself. Where the panel is
   * one slide among labelled slides that is redundant; where it stands alone in
   * a photo grid a passer-by must not mistake a street frontage from years ago
   * for the agency's photography.
   */
  showBadge?: boolean;
}

/**
 * Why these are separate states rather than one "unavailable":
 *
 * The panel used to render every failure as "Google has no panorama coverage
 * for this location", which is a claim about Google. When the backend was
 * answering 429 for every request — the shared rate limiter it depends on had
 * never been migrated — the panel dutifully told everyone that Google had no
 * imagery for every address in the country. A wrong explanation is worse than
 * no explanation: it sends people looking in the wrong place.
 */
export type StreetViewStatus =
  | 'loading'
  /** Imagery returned. */
  | 'available'
  /** Google genuinely has no panorama here. The only state that may say so. */
  | 'no_coverage'
  /** No API key configured for this workspace — an administrator fixes this. */
  | 'not_configured'
  /** Rate limited or the provider circuit is open. Retrying later works. */
  | 'busy'
  /** Anything else. */
  | 'error';

type Status = StreetViewStatus;

interface StreetViewState {
  status: Status;
  imageDataUrl?: string;
  panoramaDate?: string | null;
}

function classify(error: unknown, data: Record<string, unknown> | null | undefined): Status {
  const code = String((data as { error?: unknown })?.error ?? '').toLowerCase();
  if (code === 'street_view_not_configured') return 'not_configured';
  if (code === 'rate_limited' || code === 'temporarily_unavailable' || code === 'daily_quota_exceeded') {
    return 'busy';
  }
  if (code === 'invalid_location') return 'error';
  return error ? 'error' : 'error';
}

const MESSAGES: Record<Exclude<Status, 'loading' | 'available'>, { title: string; detail: string }> = {
  no_coverage: {
    title: 'No Street View here',
    detail: 'Google has no panorama coverage for this location.',
  },
  not_configured: {
    title: 'Street View not configured',
    detail: 'No Google Maps key is set for this workspace. An administrator can add one in Settings.',
  },
  busy: {
    title: 'Street View is busy',
    detail: 'Too many requests right now, or the provider is briefly unavailable. Try again shortly.',
  },
  error: {
    title: "Street View didn't load",
    detail: 'Something went wrong fetching the imagery. This is not a coverage problem.',
  },
};

export function StreetViewPanel({
  lat,
  lng,
  label,
  className,
  variant = 'card',
  frameClassName,
  onStatus,
  showBadge = false,
}: StreetViewPanelProps) {
  const [state, setState] = useState<StreetViewState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => {
    onStatusRef.current?.(state.status);
  }, [state.status]);

  useEffect(() => {
    let cancelled = false;

    // Answered this session already — for this location, from any panel. The
    // imagery now loads automatically wherever a photo-less listing renders,
    // so without this every remount (a view switch, a filter change, a "Load
    // more") would spend two more metered Google calls per card.
    const cached = readStreetView(lat, lng);
    if (cached) {
      setState(
        cached.kind === 'image'
          ? { status: 'available', imageDataUrl: cached.dataUrl, panoramaDate: cached.date }
          : { status: 'no_coverage' },
      );
      return;
    }

    setState({ status: 'loading' });

    (async () => {
      const { data, error } = await invokeSecureFunction<{
        success?: boolean;
        available?: boolean;
        status?: string;
        error?: string;
        imageDataUrl?: string;
        panoramaDate?: string | null;
      }>('street-view', { lat, lng });
      if (cancelled) return;

      if (error || !data?.success) {
        setState({ status: classify(error, data) });
        return;
      }
      if (!data.available) {
        // `success: true, available: false` with ZERO_RESULTS is the one case
        // where blaming Google is accurate. Anything else here is an upstream
        // fault (an image fetch that failed, a quota answer) and should not be
        // reported to the user as missing coverage.
        if (data.status === 'ZERO_RESULTS') writeStreetView(lat, lng, { kind: 'none' });
        setState({ status: data.status === 'ZERO_RESULTS' ? 'no_coverage' : 'error' });
        return;
      }
      if (data.imageDataUrl) {
        writeStreetView(lat, lng, {
          kind: 'image',
          dataUrl: data.imageDataUrl,
          date: data.panoramaDate ?? null,
        });
      }
      setState({
        status: 'available',
        imageDataUrl: data.imageDataUrl,
        panoramaDate: data.panoramaDate ?? null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [lat, lng, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const mapsUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
  const failed = state.status !== 'loading' && state.status !== 'available';
  const message = failed ? MESSAGES[state.status as keyof typeof MESSAGES] : null;
  // Retrying a genuine coverage gap or a missing key just repeats the answer.
  const canRetry = state.status === 'busy' || state.status === 'error';

  const frame = frameClassName ?? 'h-32';

  if (variant === 'inline') {
    return (
      <div
        className={`relative overflow-hidden rounded-lg border border-border/60 bg-muted/30 ${frame} ${className ?? ''}`}
      >
        {state.status === 'loading' && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            <span className="sr-only">Loading Street View imagery</span>
          </div>
        )}

        {state.status === 'available' && state.imageDataUrl && (
          <img
            src={state.imageDataUrl}
            alt={label ? `Street View of ${label}` : 'Street View of the property location'}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}

        {message && (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
            <p className="text-[11px] font-medium text-foreground">{message.title}</p>
            <p className="text-[10px] leading-4 text-muted-foreground">{message.detail}</p>
            {canRetry && (
              <Button
                variant="outline"
                size="sm"
                className="mt-0.5 h-6 gap-1 px-2 text-[10px]"
                onClick={retry}
              >
                <RefreshCw className="h-3 w-3" />
                Try again
              </Button>
            )}
          </div>
        )}

        {/* Chrome as overlays so it costs no vertical space. */}
        {state.status === 'available' && (showBadge || state.panoramaDate) ? (
          <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-background/85 px-1.5 py-0.5 text-[10px] text-muted-foreground backdrop-blur">
            {showBadge
              ? `Street view${state.panoramaDate ? ` · ${state.panoramaDate}` : ''}`
              : state.panoramaDate}
          </span>
        ) : null}
        {state.status === 'available' ? (
          <button
            type="button"
            onClick={() => window.open(mapsUrl, '_blank', 'noopener,noreferrer')}
            aria-label="Open this location in Google Maps"
            title="Open in Google Maps"
            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded bg-background/85 text-muted-foreground backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Camera className="h-3.5 w-3.5 text-primary" />
          Street View
        </span>
        {state.status === 'available' && state.panoramaDate ? (
          <span className="text-[10px] text-muted-foreground">{state.panoramaDate}</span>
        ) : null}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-border/60 bg-muted/30">
        {state.status === 'loading' && (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            <span className="sr-only">Loading Street View imagery</span>
          </div>
        )}

        {state.status === 'available' && state.imageDataUrl && (
          <img
            src={state.imageDataUrl}
            alt={label ? `Street View of ${label}` : 'Street View of the property location'}
            className="h-32 w-full object-cover"
            loading="lazy"
          />
        )}

        {message && (
          <div className="flex h-32 flex-col items-center justify-center gap-1.5 px-3 text-center">
            <p className="text-xs font-medium text-foreground">{message.title}</p>
            <p className="text-[11px] leading-4 text-muted-foreground">{message.detail}</p>
            {canRetry && (
              <Button
                variant="outline"
                size="sm"
                className="mt-1 h-6 gap-1 px-2 text-[10px]"
                onClick={retry}
              >
                <RefreshCw className="h-3 w-3" />
                Try again
              </Button>
            )}
          </div>
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="mt-1 h-7 w-full gap-1.5 text-[11px]"
        onClick={() => window.open(mapsUrl, '_blank', 'noopener,noreferrer')}
      >
        <ExternalLink className="h-3 w-3" />
        Open in Google Maps
      </Button>
    </div>
  );
}

export default StreetViewPanel;
