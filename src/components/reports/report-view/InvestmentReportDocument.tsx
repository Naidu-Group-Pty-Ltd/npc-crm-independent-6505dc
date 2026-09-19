import { Download, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import type { InvestmentReport } from './types';

import { InvestmentReportMarkdown } from './InvestmentReportMarkdown';

interface Props {
  report: InvestmentReport;
  includeSources: boolean;
  onDownload: () => void;
}

export function InvestmentReportDocument({ report, includeSources, onDownload }: Props) {
  return (
    <Card className="overflow-hidden border-primary/10 bg-card shadow-sm">
      <CardHeader className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Analysis Report</CardTitle>
            <p className="mt-1 truncate text-xs text-muted-foreground">Client-facing document view for {report.property_address}</p>
          </div>
          <Button variant="ghost" size="sm" className="hidden shrink-0 sm:inline-flex" onClick={onDownload}>
            <Download className="h-3.5 w-3.5 mr-1" />
            Raw text
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="mx-auto max-w-[960px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          <div className="prose prose-slate max-w-none dark:prose-invert prose-headings:scroll-mt-28 prose-a:text-primary">
            <ErrorBoundary fallback={<div className="rounded-xl border border-border bg-muted/40 p-5"><div className="text-sm font-medium text-foreground">Report content couldn't be displayed.</div><div className="mt-1 text-sm text-muted-foreground">You can still download the raw report text.</div><div className="mt-3"><Button variant="outline" size="sm" onClick={onDownload}><Download className="h-3 w-3 mr-1" />Download raw text</Button></div></div>}>
              <InvestmentReportMarkdown
                content={report.report_content}
                sourcesContent={report.sources_content}
                includeSources={includeSources}
              />
            </ErrorBoundary>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
