import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { App } from "./App";
import { demoFindings, demoHistoryByFinding, demoNotesByFinding } from "./demoData";
import type {
  AuditEvent,
  Finding,
  FindingAnalytics,
  FindingNote,
  FindingProvider,
  FindingRegionAnalytics,
  FindingStatus,
  FindingSummary,
  SessionUser,
} from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      getSession: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getSummary: vi.fn(),
      getSources: vi.fn(),
      getAnalytics: vi.fn(),
      getRegionAnalytics: vi.fn(),
      listFindings: vi.fn(),
      getFinding: vi.fn(),
      listNotes: vi.fn(),
      listHistory: vi.fn(),
      listProviderHistory: vi.fn(),
      changeStatus: vi.fn(),
      addNote: vi.fn(),
    },
  };
});

const mockedApi = vi.mocked(api);
const analyst: SessionUser = { id: "user-analyst", username: "analyst.demo", role: "analyst" };
let serverFindings: Finding[];
let serverNotes: Record<string, FindingNote[]>;
let serverHistory: Record<string, AuditEvent[]>;

function syntheticProvider(status: FindingProvider["status"]): FindingProvider {
  return {
    status, is_public: status === "ACTIVE", created_at: "2026-11-01T08:00:00Z",
    updated_at: "2026-11-02T08:00:00Z", analyzed_at: "2026-11-02T09:00:00Z",
  };
}

function summarize(findings: Finding[]): FindingSummary {
  const summary: FindingSummary = {
    total: findings.length,
    by_status: { new: 0, investigating: 0, resolved: 0, dismissed: 0 },
    by_severity: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
  };
  for (const finding of findings) {
    summary.by_status[finding.status] += 1;
    summary.by_severity[finding.severity] += 1;
  }
  return summary;
}

beforeEach(() => {
  mockedApi.listProviderHistory.mockResolvedValue({ items: [], page: 1, page_size: 25, total: 0, pages: 1 });
  vi.clearAllMocks();
  serverFindings = demoFindings.map((finding) => ({ ...finding }));
  serverNotes = Object.fromEntries(
    Object.entries(demoNotesByFinding).map(([findingId, notes]) => [findingId, [...notes]]),
  );
  serverHistory = Object.fromEntries(
    Object.entries(demoHistoryByFinding).map(([findingId, events]) => [findingId, [...events]]),
  );

  mockedApi.getSession.mockResolvedValue(analyst);
  mockedApi.login.mockResolvedValue(analyst);
  mockedApi.logout.mockResolvedValue(undefined);
  mockedApi.getSummary.mockImplementation(async () => summarize(serverFindings));
  mockedApi.getSources.mockImplementation(async () => [...new Set(serverFindings.map((finding) => finding.source))].sort());
  mockedApi.getAnalytics.mockImplementation(async (filters) => {
    const matching = serverFindings.filter(
      (finding) =>
        (!filters.status || finding.status === filters.status) &&
        (!filters.severity || finding.severity === filters.severity) &&
        (!filters.source || finding.source === filters.source) &&
        (!filters.provider_status || (filters.provider_status === "none" ? finding.provider === null : finding.provider?.status === filters.provider_status)) &&
        (!filters.location_scope || finding.resource_location.scope === filters.location_scope) &&
        (!filters.resource_region || finding.resource_location.region === filters.resource_region),
    );
    const today = new Date();
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 29);
    const dayCounts = new Map<string, number>();
    for (let offset = 0; offset < 30; offset += 1) {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + offset);
      dayCounts.set(day.toISOString().slice(0, 10), 0);
    }
    const resourceCounts = new Map<string, number>();
    for (const finding of matching) {
      if (finding.observed_at < start.toISOString() || finding.observed_at >= new Date(end.getTime() + 86_400_000).toISOString()) {
        continue;
      }
      const day = finding.observed_at.slice(0, 10);
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
      const type = typeof finding.metadata.resource_type === "string" ? finding.metadata.resource_type : "Unknown";
      resourceCounts.set(type, (resourceCounts.get(type) ?? 0) + 1);
    }
    const result: FindingAnalytics = {
      window: {
        days: 30,
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        timezone: "UTC",
      },
      total: [...dayCounts.values()].reduce((sum, count) => sum + count, 0),
      by_resource_type: [...resourceCounts].map(([resource_type, count]) => ({ resource_type, count })),
      by_observed_day: [...dayCounts].map(([day, count]) => ({ day, count })),
    };
    return result;
  });
  mockedApi.getRegionAnalytics.mockImplementation(async (filters) => {
    const matching = serverFindings.filter(
      (finding) =>
        (!filters.status || finding.status === filters.status) &&
        (!filters.severity || finding.severity === filters.severity) &&
        (!filters.source || finding.source === filters.source) &&
        (!filters.provider_status || (filters.provider_status === "none" ? finding.provider === null : finding.provider?.status === filters.provider_status)) &&
        (!filters.location_scope || finding.resource_location.scope === filters.location_scope) &&
        (!filters.resource_region || finding.resource_location.region === filters.resource_region),
    );
    const today = new Date();
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 29);
    const regionalCounts = new Map<string, number>();
    const by_scope = { region: 0, global: 0, unknown: 0 };
    for (const finding of matching) {
      if (finding.observed_at < start.toISOString() || finding.observed_at >= new Date(end.getTime() + 86_400_000).toISOString()) {
        continue;
      }
      by_scope[finding.resource_location.scope] += 1;
      if (finding.resource_location.scope === "region") {
        const region = finding.resource_location.region;
        regionalCounts.set(region, (regionalCounts.get(region) ?? 0) + 1);
      }
    }
    const result: FindingRegionAnalytics = {
      window: {
        days: 30,
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        timezone: "UTC",
      },
      total: by_scope.region + by_scope.global + by_scope.unknown,
      by_region: [...regionalCounts].map(([region, count]) => ({ region, count })),
      by_scope,
    };
    return result;
  });
  mockedApi.listFindings.mockImplementation(async (filters) => {
    const matching = serverFindings.filter(
      (finding) =>
        (!filters.status || finding.status === filters.status) &&
        (!filters.severity || finding.severity === filters.severity) &&
        (!filters.source || finding.source === filters.source) &&
        (!filters.provider_status || (filters.provider_status === "none" ? finding.provider === null : finding.provider?.status === filters.provider_status)) &&
        (!filters.location_scope || finding.resource_location.scope === filters.location_scope) &&
        (!filters.resource_region || finding.resource_location.region === filters.resource_region),
    );
    const start = (filters.page - 1) * filters.page_size;
    return {
      items: matching.slice(start, start + filters.page_size),
      page: filters.page,
      page_size: filters.page_size,
      total: matching.length,
      pages: Math.ceil(matching.length / filters.page_size),
    };
  });
  mockedApi.getFinding.mockImplementation(async (findingId) => {
    const finding = serverFindings.find((item) => item.id === findingId);
    if (!finding) throw new Error("Finding not found");
    return { ...finding };
  });
  mockedApi.listNotes.mockImplementation(async (findingId, page = 1) => {
    const items = serverNotes[findingId] ?? [];
    return { items: items.slice((page - 1) * 25, page * 25), page, page_size: 25, total: items.length, pages: Math.max(1, Math.ceil(items.length / 25)) };
  });
  mockedApi.listHistory.mockImplementation(async (findingId, page = 1) => {
    const items = serverHistory[findingId] ?? [];
    return { items: items.slice((page - 1) * 25, page * 25), page, page_size: 25, total: items.length, pages: Math.max(1, Math.ceil(items.length / 25)) };
  });
  mockedApi.changeStatus.mockImplementation(
    async (findingId, status: FindingStatus, expectedVersion, resolutionReason) => {
      const current = serverFindings.find((item) => item.id === findingId);
      if (!current || current.version !== expectedVersion) {
        throw new ApiError(409, { title: "Conflict", detail: "Refresh the finding and retry." });
      }
      const updated: Finding = {
        ...current,
        status,
        version: current.version + 1,
        resolution_reason: resolutionReason,
        updated_at: "2026-10-30T10:00:00Z",
      };
      serverFindings = serverFindings.map((item) => (item.id === findingId ? updated : item));
      const event: AuditEvent = {
        id: `audit-${updated.version}`,
        actor: analyst.username,
        event_type: "finding.status_changed",
        occurred_at: updated.updated_at,
        details: { from_status: current.status, to_status: status, version: updated.version },
        request_id: null,
      };
      serverHistory[findingId] = [...(serverHistory[findingId] ?? []), event];
      return updated;
    },
  );
  mockedApi.addNote.mockImplementation(async (findingId, body) => {
    const note: FindingNote = {
      id: `note-${(serverNotes[findingId] ?? []).length + 1}`,
      author: analyst.username,
      body,
      created_at: "2026-10-30T10:05:00Z",
    };
    serverNotes[findingId] = [...(serverNotes[findingId] ?? []), note];
    const event: AuditEvent = {
      id: `note-audit-${note.id}`,
      actor: analyst.username,
      event_type: "finding.note_added",
      occurred_at: note.created_at,
      details: { note_id: note.id },
      request_id: null,
    };
    serverHistory[findingId] = [...(serverHistory[findingId] ?? []), event];
    return note;
  });
});

describe("API-connected findings workbench", () => {
  it("offers later-page and older sources from page one and preserves the inventory across filters", async () => {
    serverFindings = Array.from({ length: 30 }, (_, index) => ({
      ...demoFindings[0], id: `synthetic-source-${index}`, title: `Synthetic source queue ${index}`,
      source: index === 29 ? "synthetic-older" : "synthetic-recent", provider: null,
      observed_at: new Date(Date.now() - (index === 29 ? 40 : 0) * 86_400_000).toISOString(),
    }));
    render(<App />);
    const source = await screen.findByRole("combobox", { name: "Source" });
    await screen.findByRole("button", { name: "View Synthetic source queue 0" });
    expect(screen.queryByRole("button", { name: "View Synthetic source queue 29" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "synthetic-older" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByRole("button", { name: "View Synthetic source queue 29" });
    fireEvent.change(source, { target: { value: "synthetic-older" } });
    await screen.findByLabelText("1 matching findings");
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25, source: "synthetic-older" });
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith({ source: "synthetic-older" });
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith({ source: "synthetic-older" });
    expect(screen.getByRole("option", { name: "synthetic-recent" })).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    await within(screen.getByRole("region", { name: "Findings by AWS Region" })).findByText("No findings match these filters in this period.");
    fireEvent.change(screen.getByRole("combobox", { name: "Provider status" }), { target: { value: "none" } });
    await waitFor(() => expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25, source: "synthetic-older", provider_status: "none" }));
    expect(mockedApi.getSources).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByLabelText("30 matching findings");
    expect(source).toHaveValue("");
    expect(screen.getByRole("option", { name: "synthetic-older" })).toBeInTheDocument();
    expect(mockedApi.getSources).toHaveBeenCalledTimes(1);
  });

  it("treats a source named all as an exact source filter", async () => {
    serverFindings[0].source = "all";
    render(<App />);
    await screen.findByRole("option", { name: "all" });
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), { target: { value: "all" } });
    await screen.findByLabelText("1 matching findings");
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25, source: "all" });
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith({ source: "all" });
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith({ source: "all" });
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), { target: { value: "" } });
    await screen.findByLabelText(`${serverFindings.length} matching findings`);
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25 });
  });

  it("recovers the source list independently while retaining filters and an open review draft", async () => {
    render(<App />);
    const finding = serverFindings[0];
    await screen.findByRole("option", { name: finding.source });
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), { target: { value: finding.source } });
    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    const field = await screen.findByRole("textbox", { name: "Add an investigation note" });
    fireEvent.change(field, { target: { value: "Synthetic draft retained during source refresh." } });
    await waitFor(() => expect(screen.getByRole("region", { name: "Findings table" })).toHaveAttribute("aria-busy", "false"));
    const reads = { queue: mockedApi.listFindings.mock.calls.length, charts: mockedApi.getAnalytics.mock.calls.length,
      map: mockedApi.getRegionAnalytics.mock.calls.length, detail: mockedApi.getFinding.mock.calls.length };
    mockedApi.getSources.mockRejectedValueOnce(new ApiError(503, { detail: "Synthetic source inventory failure." }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh sources" }));
    await screen.findByText(/Source list unavailable: Synthetic source inventory failure/);
    expect(screen.getByRole("combobox", { name: "Source" })).toHaveValue(finding.source);
    expect(screen.getByRole("button", { name: `View ${finding.title}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry sources" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh sources" })).toBeEnabled());
    expect(field).toHaveValue("Synthetic draft retained during source refresh.");
    expect(screen.getByRole("combobox", { name: "Source" })).toHaveValue(finding.source);
    expect(mockedApi.listFindings).toHaveBeenCalledTimes(reads.queue);
    expect(mockedApi.getAnalytics).toHaveBeenCalledTimes(reads.charts);
    expect(mockedApi.getRegionAnalytics).toHaveBeenCalledTimes(reads.map);
    expect(mockedApi.getFinding).toHaveBeenCalledTimes(reads.detail);
    expect(mockedApi.addNote).not.toHaveBeenCalled();
    expect(mockedApi.changeStatus).not.toHaveBeenCalled();
  });

  it("returns to sign-in when the source inventory reports an expired session", async () => {
    mockedApi.getSources.mockRejectedValueOnce(new ApiError(401, { detail: "Synthetic source session expiry." }));
    render(<App />);
    await screen.findByRole("heading", { name: "Sign in to your workspace" });
    expect(screen.getByText("Your session has expired. Sign in again to continue.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Source" })).not.toBeInTheDocument();
  });

  it("refreshes an open review and its filtered dashboard while retaining drafts", async () => {
    const now = new Date().toISOString();
    serverFindings = serverFindings.map((finding) => ({ ...finding, observed_at: now }));
    const finding = serverFindings[1];
    finding.source = "aws-access-analyzer";
    finding.provider = syntheticProvider("ACTIVE");
    finding.resource_location = { scope: "region", region: "ap-southeast-1" };
    render(<App />);
    await screen.findByRole("button", { name: `View ${finding.title}` });
    fireEvent.change(screen.getByRole("combobox", { name: "Provider status" }), { target: { value: "ACTIVE" } });
    await screen.findByLabelText("1 matching findings");
    fireEvent.click(await screen.findByRole("button", { name: "Filter findings in ap-southeast-1 (1)" }));
    await waitFor(() => expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25, provider_status: "ACTIVE", location_scope: "region", resource_region: "ap-southeast-1" }));
    fireEvent.click(screen.getByRole("button", { name: `View ${finding.title}` }));
    await screen.findByText("No provider changes have been recorded for this finding.");
    const reason = "Synthetic resolution draft kept while refreshing.";
    const note = "Synthetic unsaved note kept while refreshing.";
    fireEvent.change(screen.getByRole("textbox", { name: "Resolution reason" }), { target: { value: reason } });
    fireEvent.change(screen.getByRole("textbox", { name: "Add an investigation note" }), { target: { value: note } });
    const refreshed: Finding = { ...finding, version: finding.version + 1, severity: "medium", provider: { ...finding.provider, status: "ARCHIVED", is_public: false } };
    serverFindings[1] = refreshed;
    serverFindings[2].source = "synthetic-added-source";
    serverNotes[finding.id] = [...(serverNotes[finding.id] ?? []), {
      id: "synthetic-colleague-note", author: "synthetic-colleague", body: "Synthetic collaborator note after refresh.", created_at: now,
    }];
    serverHistory[finding.id] = [...(serverHistory[finding.id] ?? []), {
      id: "synthetic-colleague-event", actor: "synthetic-colleague", event_type: "finding.note_added",
      occurred_at: now, details: { note_id: "synthetic-colleague-note" }, request_id: null,
    }];
    mockedApi.listProviderHistory.mockResolvedValue({ page: 1, page_size: 25, total: 1, pages: 1, items: [{
      id: "synthetic-refresh-event", event_type: "provider.updated", finding_version: refreshed.version,
      occurred_at: now, changes: { provider_status: { before: "ACTIVE", after: "ARCHIVED" } },
    }] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh finding" }));
    await within(screen.getByRole("region", { name: "Provider context" })).findByText("Archived");
    await screen.findByText("Synthetic collaborator note after refresh.");
    await screen.findByText("Provider fields refreshed");
    await screen.findByLabelText("0 matching findings");
    await screen.findByRole("option", { name: "synthetic-added-source" });
    expect(mockedApi.getSources).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("textbox", { name: "Resolution reason" })).toHaveValue(reason);
    expect(screen.getByRole("textbox", { name: "Add an investigation note" })).toHaveValue(note);
    expect(screen.getByText("Analyst status: Investigating")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Provider status" })).toHaveValue("ACTIVE");
    expect(screen.getByRole("combobox", { name: "Resource location" })).toHaveValue("region");
    expect(screen.getByRole("textbox", { name: "AWS Region code" })).toHaveValue("ap-southeast-1");
    const filters = { provider_status: "ACTIVE", location_scope: "region", resource_region: "ap-southeast-1" };
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25, ...filters });
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith(filters);
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith(filters);
    expect(mockedApi.getFinding).toHaveBeenCalledTimes(2);
    expect(mockedApi.listNotes).toHaveBeenCalledTimes(2);
    expect(mockedApi.listHistory).toHaveBeenCalledTimes(2);
    expect(mockedApi.listProviderHistory).toHaveBeenCalledTimes(2);
    expect(mockedApi.changeStatus).not.toHaveBeenCalled();
    expect(mockedApi.addNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await screen.findByText("Analyst status: Resolved");
    expect(mockedApi.changeStatus).toHaveBeenCalledWith(finding.id, "resolved", refreshed.version, reason);
    expect(screen.getByRole("textbox", { name: "Add an investigation note" })).toHaveValue(note);
    await waitFor(() => expect(screen.getByRole("region", { name: "Findings table" })).toHaveAttribute("aria-busy", "false"));
  });

  it("keeps newer text and blocks saves during a delayed refresh", async () => {
    const finding = serverFindings[1];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    const field = await screen.findByRole("textbox", { name: "Add an investigation note" });
    fireEvent.change(field, { target: { value: "Synthetic note before refresh." } });
    fireEvent.change(screen.getByRole("textbox", { name: "Resolution reason" }), { target: { value: "Synthetic resolution before refresh." } });
    let finishReload: (value: Finding) => void = () => {};
    mockedApi.getFinding.mockImplementationOnce(() => new Promise((resolve) => { finishReload = resolve; }));
    const refresh = screen.getByRole("button", { name: "Refresh finding" });
    fireEvent.click(refresh);
    await waitFor(() => expect(mockedApi.getFinding).toHaveBeenCalledTimes(2));
    expect(refresh).toBeDisabled();
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save status" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
    fireEvent.click(refresh);
    expect(mockedApi.getFinding).toHaveBeenCalledTimes(2);
    fireEvent.change(field, { target: { value: "Synthetic newer draft typed during refresh." } });
    await act(async () => { finishReload({ ...finding, version: finding.version + 1 }); });
    await waitFor(() => expect(refresh).toBeEnabled());
    expect(field).toHaveValue("Synthetic newer draft typed during refresh.");
    expect(screen.getByRole("textbox", { name: "Resolution reason" })).toHaveValue("Synthetic resolution before refresh.");
    expect(mockedApi.changeStatus).not.toHaveBeenCalled();
    expect(mockedApi.addNote).not.toHaveBeenCalled();
  });

  it("retains drafts and requires recovery after a manual refresh fails", async () => {
    const finding = serverFindings[1];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    const field = await screen.findByRole("textbox", { name: "Add an investigation note" });
    fireEvent.change(field, { target: { value: "Synthetic retained note after refresh failure." } });
    fireEvent.change(screen.getByRole("textbox", { name: "Resolution reason" }), { target: { value: "Synthetic retained resolution." } });
    mockedApi.getFinding.mockRejectedValueOnce(new ApiError(503, { detail: "Synthetic manual refresh failure." }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh finding" }));
    await screen.findByText("Synthetic manual refresh failure.");
    expect(screen.getByRole("button", { name: "Save status" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
    expect(field).toHaveValue("Synthetic retained note after refresh failure.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh finding" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save status" })).toBeEnabled());
    expect(screen.queryByText("Synthetic manual refresh failure.")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Resolution reason" })).toHaveValue("Synthetic retained resolution.");
    expect(field).toHaveValue("Synthetic retained note after refresh failure.");
    expect(mockedApi.changeStatus).not.toHaveBeenCalled();
    expect(mockedApi.addNote).not.toHaveBeenCalled();
  });

  it("lets a viewer refresh without showing write controls", async () => {
    mockedApi.getSession.mockResolvedValue({ ...analyst, role: "viewer" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${serverFindings[0].title}` }));
    await screen.findByText("Viewer access is read-only.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh finding" }));
    await waitFor(() => expect(mockedApi.getFinding).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh finding" })).toBeEnabled());
    expect(mockedApi.listNotes).toHaveBeenCalledTimes(2);
    expect(mockedApi.listHistory).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Save status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();
  });

  it("returns to sign-in when a manual detail refresh reports an expired session", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${serverFindings[0].title}` }));
    const field = await screen.findByRole("textbox", { name: "Add an investigation note" });
    fireEvent.change(field, { target: { value: "Synthetic draft discarded on session expiry." } });
    mockedApi.getFinding.mockRejectedValueOnce(new ApiError(401, { detail: "Synthetic expired session." }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh finding" }));
    await screen.findByRole("heading", { name: "Sign in to your workspace" });
    expect(screen.queryByRole("dialog", { name: "Investigation" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Synthetic draft discarded on session expiry.")).not.toBeInTheDocument();
    expect(mockedApi.changeStatus).not.toHaveBeenCalled();
    expect(mockedApi.addNote).not.toHaveBeenCalled();
  });

  it.each(["success", "expired"] as const)("ignores a previous review's delayed refresh %s", async (outcome) => {
    const first = serverFindings[0];
    const next = serverFindings[1];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${first.title}` }));
    await screen.findByRole("heading", { name: first.title });
    let finishReload: () => void = () => {};
    mockedApi.getFinding.mockImplementationOnce(() => new Promise((resolve, reject) => {
      finishReload = () => outcome === "success"
        ? resolve({ ...first, title: "Synthetic stale refresh response." })
        : reject(new ApiError(401, { detail: "Synthetic stale session response." }));
    }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh finding" }));
    await waitFor(() => expect(mockedApi.getFinding).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: `View ${next.title}` }));
    await screen.findByRole("heading", { name: next.title });
    const field = screen.getByRole("textbox", { name: "Add an investigation note" });
    fireEvent.change(field, { target: { value: "Synthetic next review draft." } });
    await act(async () => { finishReload(); });
    expect(screen.getByRole("heading", { name: next.title })).toBeInTheDocument();
    expect(field).toHaveValue("Synthetic next review draft.");
    expect(screen.queryByText("Synthetic stale refresh response.")).not.toBeInTheDocument();
    expect(mockedApi.getFinding).toHaveBeenCalledTimes(3);
  });

  it("waits for an in-flight note save before allowing manual refresh", async () => {
    const save = mockedApi.addNote.getMockImplementation()!;
    let finishSave: () => Promise<void> = async () => {};
    mockedApi.addNote.mockImplementationOnce((...args) => new Promise((resolve) => {
      finishSave = async () => { resolve(await save(...args)); };
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${serverFindings[0].title}` }));
    const field = await screen.findByRole("textbox", { name: "Add an investigation note" });
    fireEvent.change(field, { target: { value: "Synthetic note saved before the manual refresh." } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    const refresh = screen.getByRole("button", { name: "Refresh finding" });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(mockedApi.getFinding).toHaveBeenCalledTimes(1);
    await act(async () => { await finishSave(); });
    await screen.findByText("Synthetic note saved before the manual refresh.", { selector: ".note-card p" });
    await waitFor(() => expect(refresh).toBeEnabled());
    fireEvent.click(refresh);
    await waitFor(() => expect(mockedApi.getFinding).toHaveBeenCalledTimes(3));
    expect(mockedApi.addNote).toHaveBeenCalledTimes(1);
  });

  it("returns the queue to page one while retaining a review opened from page two", async () => {
    serverFindings = Array.from({ length: 30 }, (_, index) => ({
      ...demoFindings[0], id: `synthetic-refresh-${index}`, title: `Synthetic refresh queue ${index}`,
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(await screen.findByRole("button", { name: "View Synthetic refresh queue 25" }));
    const field = await screen.findByRole("textbox", { name: "Add an investigation note" });
    fireEvent.change(field, { target: { value: "Synthetic draft from the later page." } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh finding" }));
    await screen.findByText("Page 1 of 2");
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh finding" })).toBeEnabled());
    expect(screen.getByRole("heading", { name: "Synthetic refresh queue 25" })).toBeInTheDocument();
    expect(field).toHaveValue("Synthetic draft from the later page.");
    expect(mockedApi.changeStatus).not.toHaveBeenCalled();
    expect(mockedApi.addNote).not.toHaveBeenCalled();
  });

  it("reloads failed provider history even when the finding version has not changed", async () => {
    const finding = serverFindings[0];
    finding.provider = syntheticProvider("ACTIVE");
    mockedApi.listProviderHistory.mockRejectedValueOnce(new ApiError(503, { detail: "Synthetic history read failure." }));
    mockedApi.addNote.mockRejectedValueOnce(new ApiError(503, { detail: "Synthetic note save failure." }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    await screen.findByRole("button", { name: "Retry provider history" });
    const field = screen.getByRole("textbox", { name: "Add an investigation note" });
    fireEvent.change(field, { target: { value: "Synthetic draft kept during a full details reload." } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reload details" }));
    await screen.findByText("No provider changes have been recorded for this finding.");
    expect(mockedApi.listProviderHistory).toHaveBeenCalledTimes(2);
    expect(mockedApi.getFinding).toHaveBeenCalledTimes(2);
    expect(field).toHaveValue("Synthetic draft kept during a full details reload.");
    expect(serverFindings[0].version).toBe(finding.version);
    expect(mockedApi.addNote).toHaveBeenCalledTimes(1);
  });

  it("combines provider status with the other filters across the queue, charts, and map", async () => {
    const observedAt = new Date().toISOString();
    serverFindings = serverFindings.map((finding, index) => ({
      ...finding, observed_at: observedAt,
      ...(index < 3 ? { provider: syntheticProvider((["ACTIVE", "ARCHIVED", "RESOLVED"] as const)[index]), source: "aws-access-analyzer" } : {}),
      ...(index === 1 ? { status: "new" as const, severity: "medium" as const } : {}),
    }));
    render(<App />);
    await screen.findByRole("button", { name: `View ${serverFindings[0].title}` });
    fireEvent.change(screen.getByRole("combobox", { name: "Provider status" }), { target: { value: "ARCHIVED" } });
    expect(screen.getByRole("option", { name: "Provider: Archived", selected: true })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: `View ${serverFindings[0].title}` })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: `View ${serverFindings[1].title}` })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Analyst status" }), { target: { value: "new" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Triage priority" }), { target: { value: "medium" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), { target: { value: "aws-access-analyzer" } });
    const expected = { status: "new", severity: "medium", source: "aws-access-analyzer", provider_status: "ARCHIVED" };
    await waitFor(() => expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ ...expected, page: 1, page_size: 25 }));
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith(expected);
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith(expected);
    const map = screen.getByRole("region", { name: "Findings by AWS Region" });
    await waitFor(() => expect(within(map).getByText("matching findings").parentElement).toHaveTextContent(/1\s*matching findings/));
    const timeChart = screen.getByRole("heading", { name: "Findings over time" }).closest("article")!;
    expect(within(timeChart).getByText("1", { selector: "strong" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByRole("button", { name: `View ${serverFindings[0].title}` });
    expect(screen.getByRole("combobox", { name: "Provider status" })).toHaveValue("all");
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25 });
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith({});
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith({});
  });

  it("combines map selections with existing filters and clears the exact Region on scope changes", async () => {
    serverFindings = serverFindings.map((finding, index) => ({
      ...finding, observed_at: new Date().toISOString(), source: "aws-access-analyzer",
      status: "new", severity: "medium", provider: syntheticProvider(index === 2 ? "ARCHIVED" : "ACTIVE"),
      resource_location: index < 3
        ? { scope: "region", region: index === 1 ? "us-west-2" : "ap-southeast-1" }
        : index === 3 ? { scope: "global", region: null } : { scope: "unknown", region: null },
    }));
    render(<App />);
    await screen.findByRole("button", { name: `View ${serverFindings[0].title}` });
    fireEvent.change(screen.getByRole("combobox", { name: "Provider status" }), { target: { value: "ACTIVE" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Analyst status" }), { target: { value: "new" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Triage priority" }), { target: { value: "medium" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), { target: { value: "aws-access-analyzer" } });
    fireEvent.click(await screen.findByRole("button", { name: "Filter findings in ap-southeast-1 (1)" }));
    await screen.findByLabelText("1 matching findings");
    const retained = { status: "new", severity: "medium", source: "aws-access-analyzer", provider_status: "ACTIVE" };
    const filters = { ...retained, location_scope: "region", resource_region: "ap-southeast-1" };
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ ...filters, page: 1, page_size: 25 });
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith(filters);
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith(filters);
    expect(screen.getByRole("textbox", { name: "AWS Region code" })).toHaveValue("ap-southeast-1");
    expect(screen.getByRole("button", { name: `View ${serverFindings[0].title}` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `View ${serverFindings[1].title}` })).not.toBeInTheDocument();
    const timeChart = screen.getByRole("heading", { name: "Findings over time" }).closest("article")!;
    expect(within(timeChart).getByText("1", { selector: "strong" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Resource location" }), { target: { value: "all" } });
    fireEvent.click(await screen.findByRole("button", { name: "Filter global resources (1)" }));
    await screen.findByRole("button", { name: `View ${serverFindings[3].title}` });
    expect(screen.queryByRole("textbox", { name: "AWS Region code" })).not.toBeInTheDocument();
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ ...retained, location_scope: "global", page: 1, page_size: 25 });
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith({ ...retained, location_scope: "global" });
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith({ ...retained, location_scope: "global" });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByRole("button", { name: `View ${serverFindings[0].title}` });
    expect(screen.getByRole("combobox", { name: "Resource location" })).toHaveValue("all");
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25 });
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith({});
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith({});
  });

  it("reaches unplotted and older-only Regions without treating map windows as queue limits", async () => {
    serverFindings = serverFindings.slice(0, 2).map((finding, index) => ({
      ...finding, observed_at: new Date(Date.now() - index * 40 * 86_400_000).toISOString(),
      resource_location: { scope: "region", region: index === 0 ? "xx-future-1" : "xx-older-1" },
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Filter findings in xx-future-1 (1)" }));
    await screen.findByLabelText("1 matching findings");
    expect(screen.getByText("List only")).toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: "AWS Region code" });
    const reads = mockedApi.listFindings.mock.calls.length;
    fireEvent.change(field, { target: { value: "  XX-OLDER-1  " } });
    expect(mockedApi.listFindings).toHaveBeenCalledTimes(reads);
    fireEvent.click(screen.getByRole("button", { name: "Apply Region" }));
    await screen.findByRole("button", { name: `View ${serverFindings[1].title}` });
    expect(screen.getByRole("textbox", { name: "AWS Region code" })).toHaveValue("xx-older-1");
    const filters = { location_scope: "region", resource_region: "xx-older-1" };
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ ...filters, page: 1, page_size: 25 });
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith(filters);
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith(filters);
    await within(screen.getByRole("region", { name: "Findings by AWS Region" })).findByText("No findings match these filters in this period.");
    const timeChart = screen.getByRole("heading", { name: "Findings over time" }).closest("article")!;
    expect(within(timeChart).getByText("0", { selector: "strong" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "AWS Region code" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Region" }));
    await screen.findByLabelText("2 matching findings");
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ location_scope: "region", page: 1, page_size: 25 });
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith({ location_scope: "region" });
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith({ location_scope: "region" });
  });

  it("resets queue pagination on map selection and clears an empty location cohort", async () => {
    serverFindings = Array.from({ length: 30 }, (_, index) => ({
      ...demoFindings[0], id: `synthetic-location-${index}`, title: `Synthetic location queue ${index}`,
      observed_at: new Date().toISOString(), resource_location: index === 0
        ? { scope: "region", region: "ap-southeast-1" } : { scope: "unknown", region: null },
    }));
    render(<App />);
    await screen.findByRole("button", { name: "Filter findings in ap-southeast-1 (1)" });
    const chartReads = mockedApi.getAnalytics.mock.calls.length;
    const mapReads = mockedApi.getRegionAnalytics.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByRole("button", { name: "View Synthetic location queue 25" });
    expect(mockedApi.getAnalytics).toHaveBeenCalledTimes(chartReads);
    expect(mockedApi.getRegionAnalytics).toHaveBeenCalledTimes(mapReads);
    fireEvent.click(screen.getByRole("button", { name: "Filter findings in ap-southeast-1 (1)" }));
    await screen.findByRole("button", { name: "View Synthetic location queue 0" });
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ location_scope: "region", resource_region: "ap-southeast-1", page: 1, page_size: 25 });
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "AWS Region code" }), { target: { value: "xx-empty-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Region" }));
    const empty = await screen.findByText("No findings match these filters");
    fireEvent.click(within(empty.parentElement!).getByRole("button", { name: "Clear filters" }));
    await screen.findByRole("button", { name: "View Synthetic location queue 0" });
    expect(screen.getByRole("combobox", { name: "Resource location" })).toHaveValue("all");
    expect(screen.queryByRole("textbox", { name: "AWS Region code" })).not.toBeInTheDocument();
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25 });
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith({});
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith({});
  });

  it("distinguishes findings without provider data and clears an empty provider cohort", async () => {
    serverFindings[0].provider = syntheticProvider("ACTIVE");
    render(<App />);
    await screen.findByRole("button", { name: `View ${serverFindings[0].title}` });
    fireEvent.change(screen.getByRole("combobox", { name: "Provider status" }), { target: { value: "none" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: `View ${serverFindings[0].title}` })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: `View ${serverFindings[1].title}` })).toBeInTheDocument();
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25, provider_status: "none" });
    expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith({ provider_status: "none" });
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith({ provider_status: "none" });
    fireEvent.change(screen.getByRole("combobox", { name: "Provider status" }), { target: { value: "RESOLVED" } });
    const empty = await screen.findByText("No findings match these filters");
    fireEvent.click(within(empty.parentElement!).getByRole("button", { name: "Clear filters" }));
    await screen.findByRole("button", { name: `View ${serverFindings[0].title}` });
    expect(screen.getByRole("combobox", { name: "Provider status" })).toHaveValue("all");
  });

  it("returns to page one when a provider status is selected from a later queue page", async () => {
    serverFindings = Array.from({ length: 30 }, (_, index) => ({
      ...demoFindings[0], id: `synthetic-filter-${index}`, title: `Synthetic provider queue ${index}`,
      provider: syntheticProvider(index === 0 ? "ARCHIVED" : "ACTIVE"), observed_at: new Date().toISOString(),
    }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByRole("button", { name: "View Synthetic provider queue 25" });
    fireEvent.change(screen.getByRole("combobox", { name: "Provider status" }), { target: { value: "ARCHIVED" } });
    await screen.findByRole("button", { name: "View Synthetic provider queue 0" });
    expect(mockedApi.listFindings).toHaveBeenLastCalledWith({ page: 1, page_size: 25, provider_status: "ARCHIVED" });
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });

  it.each(["Reload details", "Refresh finding"] as const)("reuses the note request after a lost response through %s", async (control) => {
    const finding = serverFindings[0];
    serverNotes[finding.id] = [];
    serverHistory[finding.id] = [];
    const save = mockedApi.addNote.getMockImplementation()!;
    let savedNote: FindingNote;
    mockedApi.addNote.mockImplementationOnce(async (...args) => {
      savedNote = await save(...args);
      throw new Error("Synthetic response lost after the server committed.");
    }).mockImplementationOnce(async () => savedNote);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    const field = await screen.findByRole("textbox", { name: "Add an investigation note" });
    const body = "Synthetic note recorded before its response was lost.";
    fireEvent.change(field, { target: { value: `  ${body}  ` } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await screen.findByRole("button", { name: "Reload details" });
    fireEvent.click(screen.getByRole("button", { name: control }));
    await screen.findByText(body, { selector: ".note-card p" });
    expect(field).toHaveValue(`  ${body}  `);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add note" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(field).toHaveValue(""));
    const first = mockedApi.addNote.mock.calls[0];
    expect(first).toEqual([finding.id, body, expect.stringMatching(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)]);
    expect(mockedApi.addNote.mock.calls[1]).toEqual(first);
    expect(serverNotes[finding.id]).toHaveLength(1);
    expect(serverHistory[finding.id]).toHaveLength(1);
    expect(serverFindings[0].version).toBe(finding.version);
  });

  it.each(["edit", "reopen"] as const)("starts a new note request after a failed save when the analyst chooses to %s", async (change) => {
    const finding = serverFindings[0];
    mockedApi.addNote.mockRejectedValueOnce(new ApiError(503, { detail: "Synthetic note service failure." }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    let field = await screen.findByRole("textbox", { name: "Add an investigation note" });
    const original = "Synthetic original note intent.";
    fireEvent.change(field, { target: { value: original } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await screen.findByText("Synthetic note service failure.");
    if (change === "reopen") {
      fireEvent.keyDown(window, { key: "Escape" });
      fireEvent.click(screen.getByRole("button", { name: `View ${finding.title}` }));
      field = await screen.findByRole("textbox", { name: "Add an investigation note" });
    }
    const next = change === "edit" ? "Synthetic edited note intent." : original;
    fireEvent.change(field, { target: { value: next } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(field).toHaveValue(""));
    const [first, second] = mockedApi.addNote.mock.calls;
    expect(first[1]).toBe(original);
    expect(second[1]).toBe(next);
    expect(second[2]).toEqual(expect.any(String));
    expect(second[2]).not.toBe(first[2]);
  });

  it("uses a new request for an intentional identical note after a successful save", async () => {
    const finding = serverFindings[0];
    serverNotes[finding.id] = [];
    serverHistory[finding.id] = [];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    const field = await screen.findByRole("textbox", { name: "Add an investigation note" });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.change(field, { target: { value: "Synthetic intentionally repeated note." } });
      await waitFor(() => expect(screen.getByRole("button", { name: "Add note" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Add note" }));
      await waitFor(() => expect(field).toHaveValue(""));
    }
    const [first, second] = mockedApi.addNote.mock.calls;
    expect(first[1]).toBe(second[1]);
    expect(first[2]).not.toBe(second[2]);
    expect(serverNotes[finding.id]).toHaveLength(2);
    expect(serverHistory[finding.id]).toHaveLength(2);
  });

  it("shows new records beyond page one after saves while retaining the other draft", async () => {
    const finding = serverFindings[1];
    serverNotes[finding.id] = Array.from({ length: 25 }, (_, index) => ({
      id: `synthetic-old-note-${index}`, author: analyst.username,
      body: `Synthetic earlier note ${index + 1}.`, created_at: finding.observed_at,
    }));
    serverHistory[finding.id] = Array.from({ length: 25 }, (_, index) => ({
      id: `synthetic-old-event-${index}`, actor: analyst.username,
      event_type: "finding.note_added", occurred_at: finding.observed_at,
      details: { note_id: `synthetic-old-note-${index}` }, request_id: null,
    }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    await screen.findByText("Synthetic earlier note 25.");
    const reason = "Synthetic resolution draft kept while paging and adding a note.";
    fireEvent.change(screen.getByRole("textbox", { name: "Resolution reason" }), { target: { value: reason } });
    fireEvent.change(screen.getByRole("textbox", { name: "Add an investigation note" }), { target: { value: "Synthetic newly saved note 26." } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await screen.findByLabelText("26 notes");
    const notes = screen.getByRole("region", { name: "Investigation notes" });
    const activity = screen.getByRole("region", { name: "Analyst activity" });
    expect(within(notes).getByLabelText("26 notes")).toBeInTheDocument();
    expect(within(notes).getByText("Synthetic newly saved note 26.", { selector: ".note-card p" })).toBeInTheDocument();
    await within(activity).findByText("Page 2 of 2");
    expect(screen.getByRole("textbox", { name: "Resolution reason" })).toHaveValue(reason);
    fireEvent.change(screen.getByRole("textbox", { name: "Add an investigation note" }), { target: { value: "Synthetic next note draft." } });
    fireEvent.click(within(notes).getByRole("button", { name: "Older notes" }));
    await within(notes).findByText("Synthetic earlier note 1.");
    expect(within(activity).getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add an investigation note" })).toHaveValue("Synthetic next note draft.");
    expect(screen.getByRole("textbox", { name: "Resolution reason" })).toHaveValue(reason);
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await within(activity).findByText("Changed status to resolved");
    expect(within(activity).getByLabelText("27 activity events")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add an investigation note" })).toHaveValue("Synthetic next note draft.");
    expect(mockedApi.addNote).toHaveBeenCalledTimes(1);
    expect(mockedApi.changeStatus).toHaveBeenCalledTimes(1);
    expect(mockedApi.listNotes).toHaveBeenCalledWith(finding.id, 2);
    expect(mockedApi.listHistory).toHaveBeenCalledWith(finding.id, 2);
  });

  it("keeps editing and activity available when the notes read fails", async () => {
    mockedApi.listNotes.mockRejectedValueOnce(new Error("Synthetic notes read failure."));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${serverFindings[1].title}` }));
    await screen.findByRole("button", { name: "Retry investigation notes" });
    expect(screen.getByRole("button", { name: "Save status" })).toBeEnabled();
    expect(await screen.findByText("Changed status to investigating")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Add an investigation note" }), { target: { value: "Synthetic draft kept during a notes retry." } });
    fireEvent.click(screen.getByRole("button", { name: "Retry investigation notes" }));
    await screen.findByText(/Sample note: verify the policy scope/);
    expect(screen.getByRole("textbox", { name: "Add an investigation note" })).toHaveValue("Synthetic draft kept during a notes retry.");
    expect(mockedApi.addNote).not.toHaveBeenCalled();
    expect(mockedApi.getFinding).toHaveBeenCalledTimes(1);
  });

  it("requires a successful details reload after a conflict refresh fails", async () => {
    const finding = serverFindings[1];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    await screen.findByRole("heading", { name: finding.title });
    fireEvent.change(screen.getByRole("textbox", { name: "Resolution reason" }), { target: { value: "Synthetic retained resolution." } });
    fireEvent.change(screen.getByRole("textbox", { name: "Add an investigation note" }), { target: { value: "Synthetic retained note." } });
    mockedApi.changeStatus.mockRejectedValueOnce(new ApiError(409, { detail: "Synthetic version conflict." }));
    mockedApi.getFinding.mockRejectedValueOnce(new ApiError(503, { detail: "Synthetic reload failed." }));
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await screen.findByText("Synthetic reload failed.");
    expect(screen.getByRole("button", { name: "Save status" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Resolution reason" })).toHaveValue("Synthetic retained resolution.");
    fireEvent.click(screen.getByRole("button", { name: "Reload details" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save status" })).toBeEnabled());
    expect(screen.getByRole("textbox", { name: "Add an investigation note" })).toHaveValue("Synthetic retained note.");
    expect(mockedApi.changeStatus).toHaveBeenCalledTimes(1);
    expect(mockedApi.addNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await screen.findByText("Analyst status: Resolved");
  });

  it.each([
    { action: "status", outcome: "success", reopen: false },
    { action: "status", outcome: "failure", reopen: false },
    { action: "note", outcome: "success", reopen: false },
    { action: "note", outcome: "failure", reopen: true },
  ] as const)("isolates a delayed $action $outcome from the next review (reopen=$reopen)", async ({ action, outcome, reopen }) => {
    const original = serverFindings[0];
    const next = reopen ? original : serverFindings[1];
    let finishSave: () => Promise<void> = async () => {};
    const failure = new ApiError(503, { detail: "Synthetic previous-review failure." });
    if (action === "status") {
      const save = mockedApi.changeStatus.getMockImplementation()!;
      mockedApi.changeStatus.mockImplementationOnce((...args) => new Promise((resolve, reject) => {
        finishSave = async () => { if (outcome === "failure") reject(failure); else resolve(await save(...args)); };
      }));
    } else {
      const save = mockedApi.addNote.getMockImplementation()!;
      mockedApi.addNote.mockImplementationOnce((...args) => new Promise((resolve, reject) => {
        finishSave = async () => { if (outcome === "failure") reject(failure); else resolve(await save(...args)); };
      }));
    }
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${original.title}` }));
    await screen.findByRole("heading", { name: original.title });
    if (action === "note") fireEvent.change(screen.getByRole("textbox", { name: "Add an investigation note" }), {
      target: { value: "Synthetic submitted note from the first review." },
    });
    fireEvent.click(screen.getByRole("button", { name: action === "status" ? "Save status" : "Add note" }));
    if (action === "status") fireEvent.keyDown(window, { key: "Escape" });
    else fireEvent.click(screen.getAllByRole("button", { name: "Close finding details" })[1]);
    fireEvent.click(screen.getByRole("button", { name: `View ${next.title}` }));
    await screen.findByRole("heading", { name: next.title });
    const newDraft = "Synthetic draft belonging to the next review.";
    fireEvent.change(screen.getByRole("textbox", { name: "Add an investigation note" }), { target: { value: newDraft } });
    await act(async () => { await finishSave(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add note" })).toBeEnabled());
    expect(screen.getByRole("heading", { name: next.title })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add an investigation note" })).toHaveValue(newDraft);
    expect(screen.queryByText(failure.message)).not.toBeInTheDocument();
    expect(mockedApi.getFinding).toHaveBeenCalledTimes(2);
    if (outcome === "success") await waitFor(() => expect(mockedApi.listFindings).toHaveBeenCalledTimes(2));
  });

  it("keeps review drafts while refreshing after a provider-version conflict", async () => {
    const finding = serverFindings[1];
    const initialStatusEvents = serverHistory[finding.id].filter((event) => event.event_type === "finding.status_changed").length;
    finding.source = "aws-access-analyzer";
    finding.provider = {
      status: "ACTIVE", is_public: true,
      created_at: "2026-10-30T08:00:00Z", updated_at: "2026-10-30T09:00:00Z",
      analyzed_at: "2026-10-30T09:05:00Z",
    };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    await screen.findByRole("heading", { name: finding.title });
    const reason = "Synthetic resolution draft retained across a provider update.";
    const note = "Synthetic note draft retained across the same update.";
    fireEvent.change(screen.getByRole("textbox", { name: "Resolution reason" }), { target: { value: reason } });
    fireEvent.change(screen.getByRole("textbox", { name: "Add an investigation note" }), { target: { value: note } });
    const refreshed: Finding = {
      ...finding, version: finding.version + 1, severity: "medium",
      provider: { ...finding.provider, status: "ARCHIVED", is_public: false, updated_at: "2026-10-31T09:00:00Z" },
    };
    serverFindings[1] = refreshed;
    let finishReload: (value: Finding) => void = () => {};
    mockedApi.getFinding.mockImplementationOnce(() => new Promise((resolve) => { finishReload = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await screen.findByText(/Your draft has been kept/);
    await waitFor(() => expect(mockedApi.getFinding).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Save status" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Resolution reason" })).toHaveValue(reason);
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    expect(mockedApi.changeStatus).toHaveBeenCalledTimes(1);
    await act(async () => { finishReload(refreshed); });
    await within(screen.getByRole("region", { name: "Provider context" })).findByText("Archived");
    expect(screen.getByRole("combobox", { name: "Move finding to status" })).toHaveValue("resolved");
    expect(screen.getByRole("textbox", { name: "Resolution reason" })).toHaveValue(reason);
    expect(screen.getByRole("textbox", { name: "Add an investigation note" })).toHaveValue(note);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save status" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await screen.findByText("Analyst status: Resolved");
    expect(mockedApi.changeStatus).toHaveBeenNthCalledWith(1, finding.id, "resolved", finding.version, reason);
    expect(mockedApi.changeStatus).toHaveBeenNthCalledWith(2, finding.id, "resolved", refreshed.version, reason);
    expect(screen.getByRole("textbox", { name: "Add an investigation note" })).toHaveValue(note);
    expect(serverHistory[finding.id].filter((event) => event.event_type === "finding.status_changed")).toHaveLength(initialStatusEvents + 1);
    await waitFor(() => expect(screen.getByRole("region", { name: "Findings table" })).toHaveAttribute("aria-busy", "false"));
  });

  it.each(["status", "note"] as const)("keeps the queue usable after a failed %s save", async (action) => {
    const failure = new ApiError(503, { detail: "Synthetic save failed." });
    if (action === "status") mockedApi.changeStatus.mockRejectedValueOnce(failure);
    else mockedApi.addNote.mockRejectedValueOnce(failure);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "View Repeated failed console sign-ins" }));
    await screen.findByRole("heading", { name: "Repeated failed console sign-ins" });
    const dialog = screen.getByRole("dialog", { name: "Investigation" });
    if (action === "note") fireEvent.change(within(dialog).getByRole("textbox", { name: "Add an investigation note" }), {
      target: { value: "Synthetic note retained after a failed save." },
    });
    const buttonName = action === "status" ? "Save status" : "Add note";
    fireEvent.click(within(dialog).getByRole("button", { name: buttonName }));
    await within(dialog).findByText("Synthetic save failed.");
    expect(screen.getByRole("region", { name: "Findings table" })).toHaveAttribute("aria-busy", "false");
    expect(mockedApi.listFindings).toHaveBeenCalledTimes(1);
    if (action === "note") expect(within(dialog).getByRole("textbox", { name: "Add an investigation note" }))
      .toHaveValue("Synthetic note retained after a failed save.");
    fireEvent.click(within(dialog).getByRole("button", { name: buttonName }));
    await waitFor(() => expect(action === "status" ? mockedApi.changeStatus : mockedApi.addNote).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockedApi.listFindings).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("region", { name: "Findings table" })).toHaveAttribute("aria-busy", "false"));
  });

  it("retains provider context after an analyst status change", async () => {
    const finding = serverFindings[0];
    finding.source = "aws-access-analyzer";
    finding.severity = "medium";
    finding.source_event_id = "0".repeat(64);
    finding.provider = {
      status: "ARCHIVED",
      is_public: false,
      created_at: "2026-10-30T08:00:00Z",
      updated_at: "2026-10-31T09:00:00Z",
      analyzed_at: "2026-10-31T09:05:00Z",
    };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    const context = await screen.findByRole("region", { name: "Provider context" });
    expect(within(context).getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Analyst status: New")).toBeInTheDocument();
    await screen.findByText("No provider changes have been recorded for this finding.");
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await screen.findByText("Analyst status: Investigating");
    await waitFor(() => expect(mockedApi.listProviderHistory).toHaveBeenCalledTimes(2));
    expect(within(screen.getByRole("region", { name: "Provider context" }))
      .getByText("Archived")).toBeInTheDocument();
    expect(serverFindings[0].provider).toEqual(finding.provider);
  });

  it("resets failed analytics when a filter starts a new request", async () => {
    mockedApi.getAnalytics.mockRejectedValueOnce(new Error("Synthetic chart failure"));
    mockedApi.getRegionAnalytics.mockRejectedValueOnce(new Error("Synthetic Region failure"));
    render(<App />);
    await screen.findAllByText(/Analytics unavailable:/);
    await screen.findByText(/Region analytics unavailable:/);

    let finishAnalytics: (result: FindingAnalytics) => void = () => {};
    let finishRegions: (result: FindingRegionAnalytics) => void = () => {};
    mockedApi.getAnalytics.mockImplementationOnce(() => new Promise((resolve) => {
      finishAnalytics = resolve;
    }));
    mockedApi.getRegionAnalytics.mockImplementationOnce(() => new Promise((resolve) => {
      finishRegions = resolve;
    }));
    fireEvent.change(screen.getByRole("combobox", { name: "Analyst status" }), {
      target: { value: "investigating" },
    });
    expect(screen.getAllByText("Loading analytics…")).toHaveLength(2);
    expect(screen.getByText("Loading Region analytics…")).toBeInTheDocument();
    expect(screen.queryByText(/Region analytics unavailable:/)).not.toBeInTheDocument();
    expect(screen.queryAllByText(/Analytics unavailable:/)).toHaveLength(0);

    const window = { days: 30, start: "2026-10-14", end: "2026-11-12", timezone: "UTC" as const };
    await act(async () => {
      finishAnalytics({ window, total: 0, by_resource_type: [], by_observed_day: [] });
      finishRegions({ window, total: 0, by_region: [], by_scope: { region: 0, global: 0, unknown: 0 } });
    });
    expect(screen.queryByText("Loading Region analytics…")).not.toBeInTheDocument();
    expect(screen.queryAllByText("Loading analytics…")).toHaveLength(0);
    expect(within(screen.getByRole("region", { name: "Finding analytics" }))
      .getAllByText("No findings match these filters in this period.")).toHaveLength(2);
  });

  it("renders HTML-like finding and note content as plain text", async () => {
    const finding = serverFindings[0];
    finding.title = '<img data-ci-xss src=x onerror="alert(1)">';
    finding.description = '<script data-ci-xss>alert(1)</script>';
    const noteBody = '<a data-ci-xss href="javascript:alert(1)">open</a>';
    serverNotes[finding.id] = [{
      id: "synthetic-xss-note",
      author: analyst.username,
      body: noteBody,
      created_at: finding.observed_at,
    }];
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: `View ${finding.title}` }));
    await screen.findByRole("heading", { name: finding.title });
    const dialog = screen.getByRole("dialog", { name: "Investigation" });
    expect(await within(dialog).findByText(finding.description)).toBeInTheDocument();
    expect(await within(dialog).findByText(noteBody)).toBeInTheDocument();
    expect(container.querySelector("[data-ci-xss]")).toBeNull();
  });

  it("shows the authenticated dashboard and server summary", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Findings overview" })).toBeInTheDocument();
    expect(screen.getByText("Synthetic data")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Total findings").closest(".summary-card")).toHaveTextContent("6"),
    );
    expect(screen.getByText("analyst.demo")).toBeInTheDocument();
  });

  it("sends status filters to the API and displays the filtered page", async () => {
    render(<App />);

    await screen.findByRole("button", { name: "View Repeated failed console sign-ins" });
    fireEvent.change(screen.getByRole("combobox", { name: "Analyst status" }), {
      target: { value: "investigating" },
    });

    await waitFor(() =>
      expect(mockedApi.listFindings).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, status: "investigating" }),
      ),
    );
    expect(await screen.findByText("Storage policy allows public access")).toBeInTheDocument();
    expect(screen.queryByText("Repeated failed console sign-ins")).not.toBeInTheDocument();
  });

  it("sends the triage-priority filter through the existing severity API field", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "View Repeated failed console sign-ins" });
    fireEvent.change(screen.getByRole("combobox", { name: "Triage priority" }), {
      target: { value: "high" },
    });
    await waitFor(() => expect(mockedApi.listFindings).toHaveBeenLastCalledWith(
      expect.objectContaining({ severity: "high", page: 1 }),
    ));
    await waitFor(() => expect(mockedApi.getAnalytics).toHaveBeenLastCalledWith({ severity: "high" }));
    expect(mockedApi.getRegionAnalytics).toHaveBeenLastCalledWith({ severity: "high" });
    expect(await screen.findByText("Storage policy allows public access")).toBeInTheDocument();
    expect(screen.queryByText("Repeated failed console sign-ins")).not.toBeInTheDocument();
  });

  it("loads finding details, notes, and audit history", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "View Storage policy allows public access" }));

    await screen.findByRole("heading", { name: "Storage policy allows public access" });
    const dialog = screen.getByRole("dialog", { name: "Investigation" });
    expect(within(dialog).getByRole("heading", { name: "Storage policy allows public access" })).toBeInTheDocument();
    expect(await within(dialog).findByText(/Sample note: verify the policy scope/)).toBeInTheDocument();
    expect(await within(dialog).findByText("Changed status to investigating")).toBeInTheDocument();
  });

  it("saves an analyst status change and adds an audited note", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "View Repeated failed console sign-ins" }));
    await screen.findByRole("heading", { name: "Repeated failed console sign-ins" });
    let dialog = screen.getByRole("dialog", { name: "Investigation" });

    fireEvent.click(await within(dialog).findByRole("button", { name: "Save status" }));
    await waitFor(() =>
      expect(mockedApi.changeStatus).toHaveBeenCalledWith(
        demoFindings[0].id,
        "investigating",
        1,
        null,
      ),
    );
    await waitFor(() => expect(mockedApi.getFinding).toHaveBeenCalledTimes(2));
    await screen.findByRole("textbox", { name: "Add an investigation note" });
    dialog = screen.getByRole("dialog", { name: "Investigation" });

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Add an investigation note" }), {
      target: { value: "Reviewed adjacent synthetic identity activity." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add note" }));

    await waitFor(() =>
      expect(mockedApi.addNote).toHaveBeenCalledWith(
        demoFindings[0].id,
        "Reviewed adjacent synthetic identity activity.",
        expect.any(String),
      ),
    );
    expect(await within(dialog).findByText("Reviewed adjacent synthetic identity activity.")).toBeInTheDocument();
  });

  it("keeps viewer sessions read-only", async () => {
    mockedApi.getSession.mockResolvedValue({ ...analyst, role: "viewer" });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "View Repeated failed console sign-ins" }));
    await screen.findByRole("heading", { name: "Repeated failed console sign-ins" });
    const dialog = screen.getByRole("dialog", { name: "Investigation" });

    expect(within(dialog).getByText("Viewer access is read-only.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Save status" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: "Add an investigation note" })).not.toBeInTheDocument();
  });

  it("signs in with credentials after an anonymous session check", async () => {
    mockedApi.getSession.mockRejectedValueOnce(
      new ApiError(401, { title: "Authentication required", detail: "Sign in to continue." }),
    );
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sign in to your workspace" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Username" }), {
      target: { value: "analyst.demo" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);

    expect(await screen.findByRole("heading", { name: "Findings overview" })).toBeInTheDocument();
    expect(mockedApi.login).toHaveBeenCalledWith("analyst.demo", "synthetic-password");
  });
});
