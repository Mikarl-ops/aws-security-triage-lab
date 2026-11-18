import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { demoFindings } from "../demoData";
import type { Finding } from "../types";
import { FindingDetails } from "./FindingDetails";

vi.mock("./AnalystRecords", () => ({ AnalystHistory: () => null, FindingNotes: () => null }));

function props() {
  return {
    loading: false, busy: false, error: null, canUpdate: true,
    onClose: vi.fn(), onRetry: vi.fn(),
    onChangeStatus: vi.fn().mockResolvedValue(true), onAddNote: vi.fn().mockResolvedValue(true),
  };
}

describe("finding review drafts", () => {
  it.each(["status", "note"] as const)("keeps text typed while a %s save is pending", async (action) => {
    const callbacks = props();
    let finishSave: (success: boolean) => void = () => {};
    const pending = () => new Promise<boolean>((resolve) => { finishSave = resolve; });
    if (action === "status") callbacks.onChangeStatus.mockImplementationOnce(pending);
    else callbacks.onAddNote.mockImplementationOnce(pending);
    render(<FindingDetails {...callbacks} finding={{ ...demoFindings[0], status: "investigating" }} />);
    const field = screen.getByRole("textbox", { name: action === "status" ? "Resolution reason" : "Add an investigation note" });
    fireEvent.change(field, { target: { value: "Synthetic submitted text." } });
    fireEvent.click(screen.getByRole("button", { name: action === "status" ? "Save status" : "Add note" }));
    fireEvent.change(field, { target: { value: "Synthetic newer text typed during the save." } });
    await act(async () => { finishSave(true); });
    expect(field).toHaveValue("Synthetic newer text typed during the save.");
    if (action === "status") expect(callbacks.onChangeStatus).toHaveBeenCalledWith("resolved", "Synthetic submitted text.");
    else expect(callbacks.onAddNote).toHaveBeenCalledWith("Synthetic submitted text.");
  });

  it("selects a valid transition when initially unloaded details arrive", () => {
    const callbacks = props();
    const { rerender } = render(<FindingDetails {...callbacks} finding={null} loading={true} />);
    rerender(<FindingDetails {...callbacks} finding={demoFindings[0]} />);
    expect(screen.getByRole("combobox", { name: "Move finding to status" })).toHaveValue("investigating");
    expect(screen.getByRole("button", { name: "Save status" })).toBeEnabled();
  });

  it("keeps text while constraining a refreshed status selection to allowed transitions", () => {
    const callbacks = props();
    const finding: Finding = { ...demoFindings[0], status: "investigating" };
    const { rerender } = render(<FindingDetails {...callbacks} finding={finding} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Move finding to status" }), { target: { value: "dismissed" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Resolution reason" }), { target: { value: "Synthetic resolution draft." } });
    fireEvent.change(screen.getByRole("textbox", { name: "Add an investigation note" }), { target: { value: "Synthetic note draft." } });
    rerender(<FindingDetails {...callbacks} finding={{ ...finding, status: "resolved", version: 4 }} />);
    expect(screen.getByRole("combobox", { name: "Move finding to status" })).toHaveValue("investigating");
    expect(screen.getByRole("textbox", { name: "Add an investigation note" })).toHaveValue("Synthetic note draft.");
    expect(screen.queryByRole("textbox", { name: "Resolution reason" })).not.toBeInTheDocument();
    expect(callbacks.onChangeStatus).not.toHaveBeenCalled();
    rerender(<FindingDetails {...callbacks} finding={{ ...finding, version: 5 }} />);
    expect(screen.getByRole("combobox", { name: "Move finding to status" })).toHaveValue("dismissed");
    expect(screen.getByRole("textbox", { name: "Resolution reason" })).toHaveValue("Synthetic resolution draft.");
  });
});
