import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocationFilter } from "./LocationFilter";

describe("resource location controls", () => {
  it("applies a complete normalized code and can return to all Regions", () => {
    const change = vi.fn();
    render(<LocationFilter scope="region" region="ap-southeast-1" onChange={change} />);
    const field = screen.getByRole("textbox", { name: "AWS Region code" });
    fireEvent.change(field, { target: { value: "  US-WEST-2  " } });
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByText(/Applied Region: ap-southeast-1/)).toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form", { name: "Filter by AWS Region" }));
    expect(change).toHaveBeenLastCalledWith("region", "us-west-2");
    expect(field).toHaveValue("us-west-2");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Region" }));
    expect(change).toHaveBeenLastCalledWith("region", "");
  });

  it.each(["ap-southeast", "a".repeat(30) + "-x-1"])("rejects an invalid code before changing filters: %s", (value) => {
    const change = vi.fn();
    render(<LocationFilter scope="region" region="" onChange={change} />);
    fireEvent.change(screen.getByRole("textbox", { name: "AWS Region code" }), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Region" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Use a Region code/);
    expect(change).not.toHaveBeenCalled();
  });

  it("replaces an unapplied draft after a map selection and clears the Region on a scope change", () => {
    const change = vi.fn();
    const { rerender } = render(<LocationFilter scope="region" region="ap-southeast-1" onChange={change} />);
    fireEvent.change(screen.getByRole("textbox", { name: "AWS Region code" }), { target: { value: "unapplied-draft" } });
    rerender(<LocationFilter scope="region" region="xx-future-1" onChange={change} />);
    expect(screen.getByRole("textbox", { name: "AWS Region code" })).toHaveValue("xx-future-1");
    fireEvent.change(screen.getByRole("combobox", { name: "Resource location" }), { target: { value: "global" } });
    expect(change).toHaveBeenLastCalledWith("global", "");
    rerender(<LocationFilter scope="global" region="" onChange={change} />);
    expect(screen.queryByRole("textbox", { name: "AWS Region code" })).not.toBeInTheDocument();
  });
});
