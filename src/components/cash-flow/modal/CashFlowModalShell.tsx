import { ReactNode } from 'react';
import { DialogContent } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

interface CashFlowModalShellProps {
  header: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function CashFlowModalShell({ header, children, footer }: CashFlowModalShellProps) {
  return (
    <DialogContent className="h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] md:h-[95vh] md:max-w-[95vw] flex flex-col gap-0 p-0 overflow-hidden [&>button]:right-4 [&>button]:top-4 [&>button]:z-30 [&>button]:min-h-11 [&>button]:min-w-11 [&>button]:rounded-full [&>button]:border [&>button]:border-border/80 [&>button]:bg-background/90 [&>button]:text-foreground [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:backdrop-blur [&>button:hover]:bg-accent [&>button:hover]:text-accent-foreground [&>button:focus-visible]:ring-2 [&>button:focus-visible]:ring-ring [&>button:focus-visible]:ring-offset-2 [&>button:focus-visible]:ring-offset-background md:[&>button]:right-6 md:[&>button]:top-6">
      <div className="sticky top-0 z-20 bg-background/95 px-4 pt-4 pb-3 pr-16 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85 md:px-6 md:pt-6 md:pb-4 md:pr-20">
        {header}
      </div>
      <Separator />
      <div className="flex-1 overflow-auto px-4 md:px-6 py-4">
        {children}
      </div>
      {footer && (
        <>
          <Separator />
          {footer}
        </>
      )}
    </DialogContent>
  );
}
