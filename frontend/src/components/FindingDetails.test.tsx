import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { demoFindings } from "../demoData";
import { formatDate } from "../presentation";
import type { Finding, FindingProvider } from "../types";
import { FindingDetails } from "./FindingDetails";

const syntheticProvider: FindingProvider = {
  status: "ARCHIVED",
  is_public: false,
  created_at: "2026-10-30T08:00:00Z",
  updated_at: "2026-10-31T09:00:00Z",
  analyzed_at: "2026-10-31T09:05:00Z",
};

function showDetails(overrides: Partial<Finding> = {}) {
  const onChangeStatus = vi.fn().mockResolvedValue(true);
  const finding: Finding = {
    ...demoFindings[0],
    source: "aws-access-analyzer",
    source_event_id: "0".repeat(64),
    status: "resolved",
    severity: "medium",
    provider: syntheticProvider,
    ...overrides,
  };
  render(<FindingDetails
    finding={finding}
    notes={[]}
    history={[]}
    loading={false}
    busy={false}
    error={null}
    canUpdate={true}
    onClose={vi.fn()}
    onRetry={vi.fn()}
    onChangeStatus={onChangeStatus}
    onAddNote={vi.fn().mockResolvedValue(true)}
  />);
  return { finding, onChangeStatus };
}

describe("provider context in finding details", () => {
  it("keeps provider status distinct from the analyst decision", () => {
    showDetails();
    const context = screen.getByRole("region", { name: "Provider context" });
    expect(screen.getByText("Analyst status: Resolved")).toBeInTheDocument();
    expect(within(context).getByText("Provider status").parentElement).toHaveTextContent("Archived");
    expect(within(context).getByText("Public access reported").parentElement).toHaveTextContent("No");
    expect(screen.getByText("Provider reference")).toBeInTheDocument();
    expect(within(context).queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["ACTIVE", "ARCHIVED", "RESOLVED"] as const)(
    "shows the %s provider state with explicit public access", (status) => {
      showDetails({ severity: "high", provider: { ...syntheticProvider, status, is_public: true } });
      const context = screen.getByRole("region", { name: "Provider context" });
      expect(within(context).getByText("Provider status").parentElement).toHaveTextContent(
        status.charAt(0) + status.slice(1).toLowerCase(),
      );
      expect(within(context).getByText("Public access reported").parentElement).toHaveTextContent("Yes");
    },
  );

  it("shows each provider timestamp in UTC with its original machine-readable value", () => {
    showDetails();
    const context = screen.getByRole("region", { name: "Provider context" });
    for (const value of [syntheticProvider.created_at, syntheticProvider.updated_at, syntheticProvider.analyzed_at]) {
      expect(within(context).getByText(formatDate(value))).toHaveAttribute("dateTime", value);
    }
  });

  it("leaves findings without provider data unclassified", () => {
    showDetails({ provider: null });
    expect(screen.queryByRole("region", { name: "Provider context" })).not.toBeInTheDocument();
    expect(screen.queryByText("Public access reported")).not.toBeInTheDocument();
    expect(screen.getByText("Source event")).toBeInTheDocument();
  });

  it("explains the local Access Analyzer priority rule", () => {
    showDetails();
    expect(screen.getByText("Medium priority")).toBeInTheDocument();
    expect(screen.getByText(/Access Analyzer triage rule: High for reported public access/))
      .toBeInTheDocument();
  });

  it("does not apply the Access Analyzer rule to other sources", () => {
    showDetails({ source: "config", provider: null });
    expect(screen.queryByText(/Access Analyzer triage rule/)).not.toBeInTheDocument();
  });

  it("sends only an analyst transition when the analyst saves status", async () => {
    const { finding, onChangeStatus } = showDetails();
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    expect(onChangeStatus).toHaveBeenCalledWith("investigating", null);
    expect(finding.provider).toEqual(syntheticProvider);
    expect(await screen.findByText("Archived")).toBeInTheDocument();
  });
});
