import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ShieldCheck } from "lucide-react";
import { Table, TableBody } from "@/components/ui/table";
import {
  AmlEmptyState,
  AmlErrorState,
  AmlGateBadge,
  AmlLoadingState,
  AmlMetricCard,
  AmlPageHeader,
  AmlPageSection,
  AmlRefreshButton,
  AmlRiskBadge,
  AmlStageBadge,
  AmlTableEmptyRow,
  AmlTableLoadingRow,
} from "../primitives";

describe("AmlPageHeader", () => {
  it("renders an h2 by default so the shell keeps the only h1", () => {
    render(
      <AmlPageHeader title="Case register" description="All cases." icon={ShieldCheck}
        actions={<button>Refresh</button>} />,
    );
    const heading = screen.getByRole("heading", { name: "Case register" });
    expect(heading.tagName).toBe("H2");
    expect(screen.getByText("All cases.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("supports h1 for pages that render outside the AML shell", () => {
    render(<AmlPageHeader title="Integration Health" headingLevel="h1" />);
    expect(screen.getByRole("heading", { name: "Integration Health" }).tagName).toBe("H1");
  });
});

describe("AmlMetricCard", () => {
  it("distinguishes loading, a real zero and unavailable", () => {
    const { rerender } = render(
      <MemoryRouter><AmlMetricCard title="Open alerts" state="loading" /></MemoryRouter>,
    );
    expect(screen.getByText("Loading Open alerts")).toBeInTheDocument();

    rerender(
      <MemoryRouter><AmlMetricCard title="Open alerts" state="ready" value={0} hint="hint" /></MemoryRouter>,
    );
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();

    rerender(
      <MemoryRouter><AmlMetricCard title="Open alerts" state="unavailable" /></MemoryRouter>,
    );
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("deep-links with an accessible name when `to` is set", () => {
    render(
      <MemoryRouter>
        <AmlMetricCard title="Reviews due" state="ready" value={3} to="/admin/aml/monitoring" />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /Reviews due: 3/ });
    expect(link).toHaveAttribute("href", "/admin/aml/monitoring");
  });
});

describe("states", () => {
  it("loading state is announced via role=status", () => {
    render(<AmlLoadingState label="Loading cases…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading cases…");
  });

  it("empty state carries a next action", () => {
    render(<AmlEmptyState title="No cases" body="Activate a client to begin." action={<button>Activate</button>} />);
    expect(screen.getByText("No cases")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
  });

  it("error state offers a retry", () => {
    const onRetry = vi.fn();
    render(<AmlErrorState message="The request failed." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("table loading and empty rows are distinct", () => {
    render(
      <Table>
        <TableBody>
          <AmlTableLoadingRow colSpan={3} label="Loading alerts…" />
          <AmlTableEmptyRow colSpan={3}>No open alerts.</AmlTableEmptyRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading alerts…");
    expect(screen.getByText("No open alerts.")).toBeInTheDocument();
  });
});

describe("case badges — status is text, never colour alone", () => {
  it("renders stage, risk and gate labels as text", () => {
    render(
      <div>
        <AmlStageBadge stage="decision_pending" />
        <AmlRiskBadge risk="prohibited" />
        <AmlRiskBadge risk={null} />
        <AmlGateBadge gate="approved_with_controls" />
        <AmlGateBadge gate="locked" prefix />
      </div>,
    );
    expect(screen.getByText("Decision pending")).toBeInTheDocument();
    expect(screen.getByText("PROHIBITED")).toBeInTheDocument();
    expect(screen.getByText("Unrated")).toBeInTheDocument();
    expect(screen.getByText("Approved with controls")).toBeInTheDocument();
    expect(screen.getByText("Service gate: Locked")).toBeInTheDocument();
  });
});

describe("AmlPageSection / AmlRefreshButton", () => {
  it("section exposes a labelled region", () => {
    render(<AmlPageSection title="Customer pipeline"><p>content</p></AmlPageSection>);
    expect(screen.getByRole("region", { name: "Customer pipeline" })).toBeInTheDocument();
  });

  it("refresh button is always labelled and disabled while loading", () => {
    const onClick = vi.fn();
    const { rerender } = render(<AmlRefreshButton onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<AmlRefreshButton onClick={onClick} loading />);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
  });
});
