import { FileText } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function SkeletonLine({ className }: { className: string }) {
  return <Skeleton className={className} />;
}

export function InvestmentReportLoadingState() {
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-muted/20">
      <div className="border-b bg-background/95 px-3 py-3 shadow-sm sm:px-4">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="h-9 w-20 rounded-md" />
            <div className="hidden h-7 w-px bg-border sm:block" />
            <div className="min-w-0 space-y-2">
              <SkeletonLine className="h-4 w-36" />
              <SkeletonLine className="h-3 w-56 max-w-[50vw]" />
            </div>
          </div>
          <div className="hidden items-center justify-center gap-2 xl:flex">
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-9 w-44 rounded-lg" />
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Skeleton className="h-9 w-10 rounded-md sm:w-28" />
            <Skeleton className="hidden h-9 w-32 rounded-md md:block" />
            <Skeleton className="h-9 w-10 rounded-md sm:w-20" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto overflow-x-hidden">
        <div className="mx-auto w-full max-w-7xl space-y-6 p-4 pb-24 lg:p-6">
          <Card className="overflow-hidden border-primary/10 bg-card shadow-sm">
            <CardContent className="p-0">
              <div className="border-b bg-background/40 p-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Skeleton className="h-6 w-32 rounded-full" />
                      <Skeleton className="h-6 w-20 rounded-full" />
                      <Skeleton className="h-6 w-24 rounded-full" />
                    </div>
                    <div className="space-y-3">
                      <Skeleton className="h-9 w-full max-w-2xl" />
                      <Skeleton className="h-4 w-full max-w-xl" />
                    </div>
                  </div>
                  <div className="rounded-2xl border bg-background/70 p-4 shadow-sm xl:min-w-[300px]">
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-16 w-16 rounded-2xl" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-3/4" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 p-6 sm:grid-cols-2 xl:grid-cols-5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="rounded-xl border bg-background/70 p-4">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-3 h-6 w-20" />
                    <Skeleton className="mt-2 h-3 w-28" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card className="overflow-hidden border-primary/10 bg-card shadow-sm">
              <CardHeader className="border-b bg-card/95">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <Skeleton className="h-5 w-36" />
                </div>
              </CardHeader>
              <CardContent className="mx-auto max-w-[960px] space-y-6 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
                <Skeleton className="h-8 w-3/4" />
                <div className="space-y-3">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <Skeleton key={index} className={`h-4 ${index % 3 === 0 ? 'w-11/12' : index % 3 === 1 ? 'w-full' : 'w-4/5'}`} />
                  ))}
                </div>
                <Skeleton className="h-40 w-full rounded-xl" />
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className={`h-4 ${index % 2 === 0 ? 'w-full' : 'w-5/6'}`} />
                  ))}
                </div>
              </CardContent>
            </Card>

            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <Card className="overflow-hidden border-primary/10 bg-card/95 shadow-sm">
                <CardHeader className="border-b bg-gradient-to-br from-background via-background to-primary/5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </CardHeader>
                <CardContent className="space-y-4 p-4">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="rounded-lg border bg-background/70 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-5 w-9 rounded-full" />
                      </div>
                    </div>
                  ))}
                  <Skeleton className="h-9 w-full rounded-md" />
                  <Skeleton className="h-9 w-full rounded-md" />
                </CardContent>
              </Card>
              <Card className="border-border/80 bg-card shadow-sm">
                <CardContent className="space-y-3 p-4">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3 w-full" />
                </CardContent>
              </Card>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
