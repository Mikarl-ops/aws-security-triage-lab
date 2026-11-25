import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FindingRegionAnalytics } from "../types";
import { RegionsMap } from "./RegionsMap";

const analytics: FindingRegionAnalytics = {
  window: { days: 30, start: "2026-10-27", end: "2026-11-25", timezone: "UTC" },
  total: 3, by_scope: { region: 1, global: 1, unknown: 1 },
  by_region: [{ region: "xx-future-1", count: 1 }],
};

describe("resource map selection", () => {
  it("offers keyboard-accessible location choices including an unplotted Region", () => {
    const select = vi.fn();
    render(<RegionsMap analytics={analytics} loading={false} error={null} onSelectLocation={select} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter findings in xx-future-1 (1)" }));
    expect(select).toHaveBeenLastCalledWith("region", "xx-future-1");
    expect(screen.getByText("List only")).toBeInTheDocument();
    for (const [label, scope] of [["regional resources", "region"], ["global resources", "global"], ["unknown locations", "unknown"]]) {
      fireEvent.click(screen.getByRole("button", { name: `Filter ${label} (1)` }));
      expect(select).toHaveBeenLastCalledWith(scope);
    }
  });

  it("disables zero-count choices and hides stale choices during loading or failure", () => {
    const select = vi.fn();
    const props = { analytics: { ...analytics, total: 1, by_scope: { region: 1, global: 0, unknown: 0 } }, onSelectLocation: select };
    const { rerender } = render(<RegionsMap {...props} loading={false} error={null} />);
    const empty = screen.getByRole("button", { name: "Filter global resources (0)" });
    expect(empty).toBeDisabled();
    fireEvent.click(empty);
    expect(select).not.toHaveBeenCalled();
    rerender(<RegionsMap {...props} loading={true} error={null} />);
    expect(screen.queryByRole("button", { name: /Filter findings in/ })).not.toBeInTheDocument();
    rerender(<RegionsMap {...props} loading={false} error="Synthetic map read failure." />);
    expect(screen.queryByRole("button", { name: /Filter regional resources/ })).not.toBeInTheDocument();
  });
});
