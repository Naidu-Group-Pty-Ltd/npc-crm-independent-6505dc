import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Standard refresh action for AML pages. Always labelled (the audit found
 * four icon-only refresh buttons with no accessible name), always disabled
 * while the reload is in flight, and announces the in-flight state.
 */
export interface AmlRefreshButtonProps {
  onClick: () => void;
  loading?: boolean;
  /** Accessible name; defaults to "Refresh". */
  label?: string;
  className?: string;
}

export function AmlRefreshButton({
  onClick,
  loading = false,
  label = "Refresh",
  className,
}: AmlRefreshButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={loading}
      aria-label={label}
      className={className}
    >
      {loading ? (
        <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}
