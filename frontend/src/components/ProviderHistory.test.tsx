import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api";
import type { PageResponse, ProviderEvent } from "../types";
import { ProviderHistory } from "./ProviderHistory";

vi.mock("../api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api")>();
  return { ...original, api: { ...original.api, listProviderHistory: vi.fn() } };
});

const newest: ProviderEvent = {
  id: "synthetic-provider-event-2", event_type: "provider.updated", finding_version: 3,
  occurred_at: "2026-11-16T02:30:00Z",
  changes: {
    provider_status: { before: "ACTIVE", after: "ARCHIVED" },
    is_public: { before: true, after: false },
    priority: { before: "high", after: "medium" },
  },
};
const oldest: ProviderEvent = {
  id: "synthetic-provider-event-1", event_type: "provider.imported", finding_version: 1,
  occurred_at: "2026-11-15T02:30:00Z",
  changes: { provider_status: { before: null, after: "ACTIVE" } },
};
const empty: PageResponse<ProviderEvent> = { items: [], page: 1, page_size: 25, total: 0, pages: 1 };
const listHistory = vi.mocked(api.listProviderHistory);

beforeEach(() => {
  listHistory.mockReset();
  listHistory.mockResolvedValue(empty);
});

describe("provider history", () => {
  it("shows before/after values and pages through older events", async () => {
    listHistory.mockResolvedValueOnce({ items: [newest], page: 1, page_size: 25, total: 26, pages: 2 })
      .mockResolvedValueOnce({ items: [oldest], page: 2, page_size: 25, total: 26, pages: 2 });
    render(<ProviderHistory findingId="synthetic-finding" onReloadFinding={vi.fn()} />);
    await screen.findByText("Provider fields refreshed");
    const section = screen.getByRole("region", { name: "Provider history" });
    expect(within(section).getByText("Provider status").parentElement).toHaveTextContent("Active → Archived");
    expect(within(section).getByText("Public access reported").parentElement).toHaveTextContent("Yes → No");
    expect(within(section).getByText("Triage priority").parentElement).toHaveTextContent("High → Medium");
    expect(within(section).getByText("Finding version 3")).toBeInTheDocument();
    expect(within(section).getByText(/Nov 16.*UTC/)).toHaveAttribute("dateTime", newest.occurred_at);
    expect(within(section).getByRole("button", { name: "Newer provider events" })).toBeDisabled();
    fireEvent.click(within(section).getByRole("button", { name: "Older provider events" }));
    await screen.findByText("Finding imported");
    expect(listHistory).toHaveBeenLastCalledWith("synthetic-finding", 2);
    expect(within(section).getByText("Provider status").parentElement).toHaveTextContent("Not recorded → Active");
    expect(within(section).getByRole("button", { name: "Older provider events" })).toBeDisabled();
    expect(within(section).getByText("Page 2 of 2")).toBeInTheDocument();
    expect(within(section).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows an honest empty state for findings without recorded history", async () => {
    render(<ProviderHistory findingId="synthetic-finding" onReloadFinding={vi.fn()} />);
    expect(await screen.findByText("No provider changes have been recorded for this finding."))
      .toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Provider history pages" })).not.toBeInTheDocument();
  });

  it("retries a failed read without exposing raw errors", async () => {
    listHistory.mockRejectedValueOnce(new Error("synthetic-sensitive-driver-details"));
    render(<ProviderHistory findingId="synthetic-finding" onReloadFinding={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry provider history" }));
    await screen.findByText("No provider changes have been recorded for this finding.");
    expect(listHistory).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/synthetic-sensitive/)).not.toBeInTheDocument();
  });

  it("reloads finding details to recover from an expired session", async () => {
    listHistory.mockRejectedValueOnce(new ApiError(401, { title: "Session expired" }));
    const reload = vi.fn();
    render(<ProviderHistory findingId="synthetic-finding" onReloadFinding={reload} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reload finding details" }));
    expect(reload).toHaveBeenCalledOnce();
    expect(listHistory).toHaveBeenCalledOnce();
  });

  it("renders provider values as plain text", async () => {
    const value = '<img data-provider-xss src=x onerror="alert(1)">';
    listHistory.mockResolvedValueOnce({ ...empty, total: 1, items: [{
      ...newest, changes: { resource_type: { before: null, after: value } },
    }] });
    const { container } = render(<ProviderHistory findingId="synthetic-finding" onReloadFinding={vi.fn()} />);
    expect(await screen.findByText(new RegExp("data-provider-xss"))).toBeInTheDocument();
    expect(container.querySelector("[data-provider-xss]")).toBeNull();
  });
});
