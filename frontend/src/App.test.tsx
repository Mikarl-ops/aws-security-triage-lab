import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { App } from "./App";
import { demoFindings, demoHistoryByFinding, demoNotesByFinding } from "./demoData";
import type { AuditEvent, Finding, FindingNote, FindingStatus, FindingSummary, SessionUser } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      getSession: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getSummary: vi.fn(),
      listFindings: vi.fn(),
      getFinding: vi.fn(),
      listNotes: vi.fn(),
      listHistory: vi.fn(),
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
  mockedApi.listFindings.mockImplementation(async (filters) => {
    const matching = serverFindings.filter(
      (finding) =>
        (!filters.status || finding.status === filters.status) &&
        (!filters.severity || finding.severity === filters.severity) &&
        (!filters.source || finding.source === filters.source),
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
  mockedApi.listNotes.mockImplementation(async (findingId) => {
    const items = serverNotes[findingId] ?? [];
    return { items, page: 1, page_size: 25, total: items.length, pages: items.length ? 1 : 0 };
  });
  mockedApi.listHistory.mockImplementation(async (findingId) => {
    const items = serverHistory[findingId] ?? [];
    return { items, page: 1, page_size: 25, total: items.length, pages: items.length ? 1 : 0 };
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
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
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

  it("loads finding details, notes, and audit history", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "View Storage policy allows public access" }));

    await screen.findByRole("heading", { name: "Storage policy allows public access" });
    const dialog = screen.getByRole("dialog", { name: "Investigation" });
    expect(within(dialog).getByRole("heading", { name: "Storage policy allows public access" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Sample note: verify the policy scope/)).toBeInTheDocument();
    expect(within(dialog).getByText("Changed status to investigating")).toBeInTheDocument();
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
