import { lazy, Suspense, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, FileText, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";

const InvestmentReportGenerator = lazy(() =>
  import("@/components/reports/InvestmentReportGenerator").then((m) => ({
    default: m.InvestmentReportGenerator,
  })),
);

const ComponentLoader = () => (
  <Card className="ci-card-premium">
    <CardContent className="p-6">
      Loading investment reporting workspace…
    </CardContent>
  </Card>
);

export default function Reports() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (
      searchParams.get("tab") !== "quant" &&
      searchParams.get("tab") !== "quantitative"
    )
      return;
    const params = new URLSearchParams(searchParams);
    params.delete("tab");
    navigate(`/quantitative-reports${params.toString() ? `?${params}` : ""}`, {
      replace: true,
    });
  }, [navigate, searchParams]);

  if (
    searchParams.get("tab") === "quant" ||
    searchParams.get("tab") === "quantitative"
  )
    return null;

  return (
    <div className="ci-foundation ci-page-shell reports-page-premium space-y-6">
      <Card className="ci-suite-header overflow-hidden reports-top-command">
        <CardContent className="relative z-10 p-5 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-4">
              <span className="ci-header-icon reports-header-icon">
                <TrendingUp className="h-6 w-6" />
              </span>
              <div>
                <p className="ci-tab-eyebrow">NPC reporting command centre</p>
                <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                  Reports
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
                  Generate property investment reports and analysis.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="h-11 rounded-2xl">
              <a
                href="/generated-reports?tab=investment"
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileText className="h-4 w-4" />
                Recent Reports
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
      <ErrorBoundary
        fallback={
          <Card className="ci-card-premium">
            <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
              <AlertTriangle className="h-5 w-5" />
              <p className="text-sm font-medium">
                Investment Report Generator encountered an error. Please refresh
                the page.
              </p>
            </CardContent>
          </Card>
        }
      >
        <Suspense fallback={<ComponentLoader />}>
          <InvestmentReportGenerator />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
