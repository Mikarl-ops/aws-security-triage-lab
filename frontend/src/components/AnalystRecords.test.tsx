import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api";
import type { AuditEvent, FindingNote, PageResponse } from "../types";
import { AnalystHistory, FindingNotes } from "./AnalystRecords";

vi.mock("../api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api")>();
  return { ...original, api: { ...original.api, listNotes: vi.fn(), listHistory: vi.fn() } };
});

const timestamp = "2026-11-18T01:00:00Z";
const note: FindingNote = { id: "synthetic-note", author: "synthetic-analyst", body: "Synthetic latest note.", created_at: timestamp };
const event: AuditEvent = {
  id: "synthetic-event", actor: "synthetic-analyst", event_type: "finding.status_changed",
  occurred_at: timestamp, details: { to_status: "resolved" }, request_id: null,
};
const empty = { items: [], page: 1, page_size: 25, total: 0, pages: 1 };
const notes = vi.mocked(api.listNotes);
const history = vi.mocked(api.listHistory);

beforeEach(() => {
  notes.mockReset().mockResolvedValue(empty);
  history.mockReset().mockResolvedValue(empty);
});

describe("paged analyst records", () => {
  it("opens the newest note page, reports the full total, and reads older pages", async () => {
    notes.mockResolvedValueOnce({ ...empty, total: 28, pages: 2 })
      .mockResolvedValueOnce({ ...empty, items: [note], page: 2, total: 28, pages: 2 })
      .mockResolvedValueOnce({ ...empty, items: [{ ...note, id: "older", body: "Synthetic older note." }], total: 28, pages: 2 });
    render(<FindingNotes findingId="synthetic-finding" onReloadFinding={vi.fn()} />);
    await screen.findByText(note.body);
    expect(notes).toHaveBeenNthCalledWith(1, "synthetic-finding", 1);
    expect(notes).toHaveBeenNthCalledWith(2, "synthetic-finding", 2);
    expect(screen.getByLabelText("28 notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Newer notes" })).toBeDisabled();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Older notes" }));
    await screen.findByText("Synthetic older note.");
    expect(screen.getByRole("button", { name: "Older notes" })).toBeDisabled();
    expect(screen.queryByText(note.body)).not.toBeInTheDocument();
    expect(notes).toHaveBeenLastCalledWith("synthetic-finding", 1);
    expect(history).not.toHaveBeenCalled();
  });

  it("keeps the previous page's records hidden during a delayed navigation", async () => {
    history.mockResolvedValueOnce({ ...empty, total: 26, pages: 2 })
      .mockResolvedValueOnce({ ...empty, items: [event], page: 2, total: 26, pages: 2 });
    let finish: (value: PageResponse<AuditEvent>) => void = () => {};
    history.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<AnalystHistory findingId="synthetic-finding" onReloadFinding={vi.fn()} />);
    await screen.findByText("Changed status to resolved");
    fireEvent.click(screen.getByRole("button", { name: "Older activity events" }));
    expect(screen.queryByText("Changed status to resolved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Older activity events" })).toBeDisabled();
    await act(async () => { finish({ ...empty, items: [{ ...event, details: { to_status: "investigating" } }], total: 26, pages: 2 }); });
    await screen.findByText("Changed status to investigating");
    expect(history).toHaveBeenLastCalledWith("synthetic-finding", 1);
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("retries a failed newest-page read without exposing raw errors", async () => {
    notes.mockResolvedValueOnce({ ...empty, total: 26, pages: 2 })
      .mockRejectedValueOnce(new Error("synthetic-sensitive-driver-message"))
      .mockResolvedValueOnce({ ...empty, total: 26, pages: 2 })
      .mockResolvedValueOnce({ ...empty, items: [note], page: 2, total: 26, pages: 2 });
    render(<FindingNotes findingId="synthetic-finding" onReloadFinding={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry investigation notes" }));
    await screen.findByText(note.body);
    expect(notes).toHaveBeenCalledTimes(4);
    expect(screen.queryByText(/synthetic-sensitive/)).not.toBeInTheDocument();
  });

  it("retries a failed older-page read at the requested page", async () => {
    history.mockResolvedValueOnce({ ...empty, total: 26, pages: 2 })
      .mockResolvedValueOnce({ ...empty, items: [event], page: 2, total: 26, pages: 2 })
      .mockRejectedValueOnce(new Error("Synthetic older-page read failure."))
      .mockResolvedValueOnce({ ...empty, items: [{ ...event, details: { to_status: "investigating" } }], total: 26, pages: 2 });
    render(<AnalystHistory findingId="synthetic-finding" onReloadFinding={vi.fn()} />);
    await screen.findByText("Changed status to resolved");
    fireEvent.click(screen.getByRole("button", { name: "Older activity events" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry analyst activity" }));
    await screen.findByText("Changed status to investigating");
    expect(history).toHaveBeenLastCalledWith("synthetic-finding", 1);
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it.each(["notes", "history"] as const)("shows empty %s without paging controls", async (kind) => {
    render(kind === "notes"
      ? <FindingNotes findingId="synthetic-finding" onReloadFinding={vi.fn()} />
      : <AnalystHistory findingId="synthetic-finding" onReloadFinding={vi.fn()} />);
    await screen.findByText(kind === "notes" ? "No notes have been added to this finding." : "No activity has been recorded yet.");
    expect(screen.getByLabelText(kind === "notes" ? "0 notes" : "0 activity events")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it.each(["notes", "history"] as const)("recovers an expired %s session through the finding reload", async (kind) => {
    const read = kind === "notes" ? notes : history;
    read.mockRejectedValueOnce(new ApiError(401, { detail: "Synthetic expired session." }));
    const reload = vi.fn();
    render(kind === "notes"
      ? <FindingNotes findingId="synthetic-finding" onReloadFinding={reload} />
      : <AnalystHistory findingId="synthetic-finding" onReloadFinding={reload} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reload finding details" }));
    expect(reload).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
  });

  it("ignores an earlier finding's delayed response and does not discover its next page", async () => {
    let finish: (value: PageResponse<FindingNote>) => void = () => {};
    notes.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ ...empty, items: [note], total: 1 });
    const props = { onReloadFinding: vi.fn() };
    const { rerender } = render(<FindingNotes {...props} findingId="synthetic-first" />);
    rerender(<FindingNotes {...props} findingId="synthetic-second" />);
    await screen.findByText(note.body);
    await act(async () => { finish({ ...empty, total: 26, pages: 2 }); });
    expect(notes).toHaveBeenCalledTimes(2);
    expect(notes).toHaveBeenLastCalledWith("synthetic-second", 1);
    expect(screen.getByText(note.body)).toBeInTheDocument();
  });

  it("returns to the newest page after a records revision changes", async () => {
    notes.mockResolvedValueOnce({ ...empty, items: [note], total: 1 });
    const props = { findingId: "synthetic-finding", onReloadFinding: vi.fn() };
    const { rerender } = render(<FindingNotes {...props} revision={0} />);
    await screen.findByText(note.body);
    notes.mockResolvedValueOnce({ ...empty, total: 26, pages: 2 })
      .mockResolvedValueOnce({ ...empty, items: [{ ...note, body: "Synthetic new record after refresh." }], total: 26, page: 2, pages: 2 });
    rerender(<FindingNotes {...props} revision={1} />);
    await screen.findByText("Synthetic new record after refresh.");
    expect(notes).toHaveBeenLastCalledWith("synthetic-finding", 2);
    await waitFor(() => expect(screen.queryByText(note.body)).not.toBeInTheDocument());
  });
});
