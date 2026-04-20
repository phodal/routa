import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const {
  getStoredThemePreference,
  resolveThemePreference,
  setThemePreference,
  subscribeToThemePreference,
} = vi.hoisted(() => ({
  getStoredThemePreference: vi.fn(() => "light"),
  resolveThemePreference: vi.fn(() => "light"),
  setThemePreference: vi.fn((theme: "light" | "dark" | "system") => theme),
  subscribeToThemePreference: vi.fn(() => () => {}),
}));

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      settings: {
        theme: "Theme",
        light: "Light",
        dark: "Dark",
        system: "System",
      },
    },
  }),
}));

vi.mock("../../utils/theme", () => ({
  getStoredThemePreference,
  resolveThemePreference,
  setThemePreference,
  subscribeToThemePreference,
}));

import { ThemeSwitcher } from "../theme-switcher";

describe("ThemeSwitcher", () => {
  it("renders the theme label when requested", () => {
    render(<ThemeSwitcher showLabel />);

    expect(screen.getByText("Theme")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Light" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Dark" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "System" })).not.toBeNull();
  });

  it("keeps server markup deterministic and syncs the mounted title afterward", async () => {
    getStoredThemePreference.mockReturnValue("dark");
    resolveThemePreference.mockReturnValue("dark");

    expect(renderToString(<ThemeSwitcher compact />)).toContain('title="Dark · System"');

    render(<ThemeSwitcher compact />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dark" }).getAttribute("title")).toBe("Dark");
    });
  });

  it("updates the theme preference when a button is clicked", () => {
    render(<ThemeSwitcher compact />);

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(setThemePreference).toHaveBeenCalledWith("dark");
  });

  it("marks only the system button as active when the system preference is selected", async () => {
    getStoredThemePreference.mockReturnValue("system");
    resolveThemePreference.mockReturnValue("dark");

    render(<ThemeSwitcher compact />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "System" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe("false");
    });
  });
});
