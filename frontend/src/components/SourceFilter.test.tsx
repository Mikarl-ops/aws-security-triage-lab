import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api";
import { SourceFilter } from "./SourceFilter";

vi.mock("../api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api")>(), api: { getSources: vi.fn() },
}));
const getSources = vi.mocked(api.getSources);

beforeEach(() => {
  getSources.mockReset();
  getSources.mockResolvedValue([]);
});

describe("complete source choices", () => {
  it("distinguishes a literal all source and keeps choices stable when the selected filter changes", async () => {
    getSources.mockResolvedValue(["synthetic-z", "all", "synthetic-a", "synthetic-z"]);
    const props = { value: "", revision: 0, onChange: vi.fn(), onSessionExpired: vi.fn() };
    const { rerender } = render(<SourceFilter {...props} />);
    await screen.findByRole("option", { name: "synthetic-a" });
    const select = screen.getByRole("combobox", { name: "Source" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All sources", "all", "synthetic-a", "synthetic-z",
    ]);
    fireEvent.change(select, { target: { value: "all" } });
    expect(props.onChange).toHaveBeenLastCalledWith("all");
    rerender(<SourceFilter {...props} value="all" />);
    expect(select).toHaveValue("all");
    expect(screen.getByRole("option", { name: "synthetic-z" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "" } });
    expect(props.onChange).toHaveBeenLastCalledWith("");
    expect(getSources).toHaveBeenCalledTimes(1);
  });

  it("keeps the selected source available after failure and recovers without changing filters", async () => {
    getSources.mockRejectedValueOnce(new ApiError(503, { detail: "Synthetic source-list failure." }));
    const props = { value: "synthetic-selected", revision: 0, onChange: vi.fn(), onSessionExpired: vi.fn() };
    render(<SourceFilter {...props} />);
    await screen.findByText(/Source list unavailable: Synthetic source-list failure/);
    expect(screen.queryByText("No sources are available yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Source" })).toHaveValue("synthetic-selected");
    getSources.mockResolvedValueOnce(["synthetic-new"]);
    fireEvent.click(screen.getByRole("button", { name: "Retry sources" }));
    await screen.findByRole("option", { name: "synthetic-new" });
    expect(screen.getByRole("combobox", { name: "Source" })).toHaveValue("synthetic-selected");
    expect(screen.queryByText(/Source list unavailable/)).not.toBeInTheDocument();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("retains known choices during refresh and ignores superseded results", async () => {
    getSources.mockResolvedValueOnce(["synthetic-known"]);
    const props = { value: "", revision: 0, onChange: vi.fn(), onSessionExpired: vi.fn() };
    const { rerender } = render(<SourceFilter {...props} />);
    await screen.findByRole("option", { name: "synthetic-known" });
    getSources.mockRejectedValueOnce(new Error("Synthetic unavailable service."));
    fireEvent.click(screen.getByRole("button", { name: "Refresh sources" }));
    await screen.findByRole("button", { name: "Retry sources" });
    expect(screen.getByRole("option", { name: "synthetic-known" })).toBeInTheDocument();
    let finishOld: (items: string[]) => void = () => {};
    let finishCurrent: (items: string[]) => void = () => {};
    getSources.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishCurrent = resolve; }));
    rerender(<SourceFilter {...props} revision={1} />);
    expect(screen.getByText("Loading sources…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh sources" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "synthetic-known" })).toBeInTheDocument();
    rerender(<SourceFilter {...props} revision={2} />);
    await act(async () => { finishCurrent(["synthetic-current"]); });
    await screen.findByRole("option", { name: "synthetic-current" });
    await act(async () => { finishOld(["synthetic-stale"]); });
    expect(screen.queryByRole("option", { name: "synthetic-stale" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "synthetic-known" })).not.toBeInTheDocument();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("reports an empty inventory and supports an explicit refresh", async () => {
    render(<SourceFilter value="" revision={0} onChange={vi.fn()} onSessionExpired={vi.fn()} />);
    await screen.findByText("No sources are available yet.");
    expect(screen.getByRole("option", { name: "All sources" })).toBeInTheDocument();
    getSources.mockResolvedValueOnce(["synthetic-added"]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh sources" }));
    await screen.findByRole("option", { name: "synthetic-added" });
    expect(screen.queryByText("No sources are available yet.")).not.toBeInTheDocument();
  });

  it("reports session expiry but ignores an expired response after unmounting", async () => {
    getSources.mockRejectedValueOnce(new ApiError(401, { detail: "Synthetic expired session." }));
    const props = { value: "", revision: 0, onChange: vi.fn(), onSessionExpired: vi.fn() };
    const first = render(<SourceFilter {...props} />);
    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalledTimes(1));
    first.unmount();
    let rejectLate: (error: Error) => void = () => {};
    getSources.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLate = reject; }));
    const second = render(<SourceFilter {...props} />);
    second.unmount();
    await act(async () => { rejectLate(new ApiError(401, { detail: "Synthetic stale expiry." })); });
    expect(props.onSessionExpired).toHaveBeenCalledTimes(1);
  });
});
