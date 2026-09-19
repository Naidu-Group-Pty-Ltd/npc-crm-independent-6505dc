import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Database, CheckCircle2, AlertCircle } from "lucide-react";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { useToast } from "@/hooks/use-toast";
import { settingsPrimaryButtonClass } from "@/components/settings/settingsUi";

export function ComparisonScoreMigration() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    totalProcessed?: number;
    migrated?: number;
    skipped?: number;
    errors?: string[];
  } | null>(null);
  const { toast } = useToast();

  const runMigration = async () => {
    setIsRunning(true);
    setResult(null);

    try {
      const { data, error } = await invokeSecureFunction(
        "migrate-comparison-scores",
        {},
      );

      if (error) {
        throw error;
      }

      setResult(data);

      if (data.success && data.migrated > 0) {
        toast({
          title: "Migration Complete",
          description: `Successfully migrated ${data.migrated} comparison(s) to new score format.`,
        });
      } else if (data.migrated === 0) {
        toast({
          title: "No Migration Needed",
          description:
            "All comparisons are already using the correct score format.",
        });
      }
    } catch (err) {
      console.error("Migration error:", err);
      toast({
        title: "Migration Failed",
        description:
          err instanceof Error ? err.message : "Failed to run migration",
        variant: "destructive",
      });
      setResult({
        success: false,
        errors: [err instanceof Error ? err.message : "Unknown error"],
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl border-warning/25 bg-[linear-gradient(145deg,hsl(var(--card)),hsl(var(--warning)/0.08))] shadow-[0_18px_44px_hsl(var(--foreground)/0.07)] ring-1 ring-warning/10 dark:border-warning/20 dark:bg-background/80 dark:shadow-black/30">
      <CardHeader className="space-y-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
          <Database className="h-5 w-5 shrink-0 text-warning" />
          Comparison Score Migration
        </CardTitle>
        <CardDescription className="max-w-3xl break-words leading-6">
          Migrate legacy comparison scores from 0-10 scale to 0-100 scale
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <Alert className="min-w-0 overflow-hidden rounded-2xl border-warning/35 bg-warning/10 text-foreground">
          <AlertCircle className="h-4 w-4 text-warning" />
          <AlertDescription className="break-words leading-6">
            This migration will normalize all comparison scores that appear to
            be on a 0-10 scale (scores less than 15) by multiplying them by 10.
            This is a one-time operation.
          </AlertDescription>
        </Alert>

        <Button
          onClick={runMigration}
          disabled={isRunning}
          className={settingsPrimaryButtonClass}
        >
          {isRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running Migration...
            </>
          ) : (
            <>
              <Database className="mr-2 h-4 w-4" />
              Run Migration
            </>
          )}
        </Button>

        {result && (
          <Alert
            variant={result.success ? "default" : "destructive"}
            className="min-w-0 overflow-hidden rounded-2xl"
          >
            {result.success ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertDescription className="break-words">
              {result.success ? (
                <div className="min-w-0 space-y-2">
                  <p className="font-medium">Migration Results:</p>
                  <ul className="list-inside list-disc space-y-1 text-sm">
                    <li>Total Processed: {result.totalProcessed}</li>
                    <li>Migrated: {result.migrated}</li>
                    <li>Skipped (already correct): {result.skipped}</li>
                  </ul>
                  {result.errors && result.errors.length > 0 && (
                    <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
                      <p className="font-medium text-destructive">Errors:</p>
                      <ul className="list-inside list-disc space-y-1 text-sm">
                        {result.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="font-medium">Migration Failed</p>
                  {result.errors && result.errors.length > 0 && (
                    <ul className="mt-1 list-inside list-disc space-y-1 text-sm">
                      {result.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
