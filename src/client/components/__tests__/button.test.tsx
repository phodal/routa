import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "../button";

describe("Button", () => {
  it("uses semantic danger tokens for the danger variant", () => {
    render(<Button variant="danger">Delete</Button>);

    const button = screen.getByRole("button", { name: "Delete" });
    const className = button.className;

    expect(className).toContain("bg-[var(--danger-solid)]");
    expect(className).toContain("text-[var(--danger-on-solid)]");
    expect(className).toContain("hover:bg-[var(--danger-solid-hover)]");
    expect(className).toContain("focus:ring-[var(--danger-ring)]");
    expect(className).not.toMatch(/\bbg-red-\d+\b/);
    expect(className).not.toMatch(/\btext-red-\d+\b/);
    expect(className).not.toMatch(/\bfocus:ring-red-\d+\b/);
  });
});
