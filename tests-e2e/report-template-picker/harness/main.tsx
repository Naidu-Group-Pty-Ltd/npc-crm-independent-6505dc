/**
 * Mounts the REAL `ReportTemplatePicker` so Playwright can see and measure it.
 *
 * The complaint this answers was visual — a template was chosen from sixty
 * radio rows of NAMES — and jsdom has no layout and no iframes, so a DOM test
 * can pass while the gallery renders as a wall of blank tiles. The dialog is
 * built and rendered in Chromium here, over sixteen real catalogue rows with
 * their production `preview_schema`, and the assertions are on bounding boxes
 * and painted iframes.
 *
 * `?selected=house` stores a selection first, to show the followed-choice
 * state: the Private Banking tray open, Chancery checked and badged Current.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReportTemplatePicker } from "@/components/reports/ReportTemplatePicker";
import "@/index.css";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <ReportTemplatePicker
        reportType="investment_compass"
        formatLabel="Investment report"
        open
        onOpenChange={() => {}}
      />
    </QueryClientProvider>
  </StrictMode>,
);
