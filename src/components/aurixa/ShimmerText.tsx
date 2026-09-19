import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * ShimmerText — Phase 6 primitive.
 *
 * Aurixa shimmer treatment for streaming/thinking states. Delegates to the
 * `.aurixa-shimmer-text` class shipped in `src/styles/primitives.css`, which
 * already handles reduced-motion fallback.
 *
 * Prefer this over generic loading dots for AI surfaces (per chat-ui rule
 * "prefer shimmer text such as 'Thinking...' over generic loading dots").
 */

export interface ShimmerTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  as?: 'span' | 'p' | 'div';
}

export const ShimmerText = React.forwardRef<HTMLSpanElement, ShimmerTextProps>(
  ({ className, children, as = 'span', ...props }, ref) => {
    const Comp = as as React.ElementType;
    return (
      <Comp
        ref={ref as never}
        className={cn('aurixa-shimmer-text font-medium', className)}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);

ShimmerText.displayName = 'ShimmerText';

export default ShimmerText;
