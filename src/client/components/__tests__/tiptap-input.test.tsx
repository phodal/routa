import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TiptapInput } from "../tiptap-input";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      chatPanel: {
        fileHint: "file",
        agentHint: "agent",
        skillHint: "skill",
        noResults: "No results",
        cloneRepoFirst: "Clone a repository first",
        selectModel: "Select model",
        defaultModel: "Default model",
        filterModels: "Filter models",
        noModelsFound: "No models found",
        brave: "Brave",
        plan: "Plan",
        build: "Build",
        inputLabel: "Input",
        outputLabel: "Output",
        tokens: "tokens",
      },
      common: {
        send: "Send",
        stop: "Stop",
      },
    },
  }),
}));

vi.mock("../repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker" />,
}));

vi.mock("../acp-provider-dropdown", () => ({
  AcpProviderDropdown: () => <div data-testid="provider-dropdown" />,
}));

vi.mock("../utils/diagnostics", () => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("../utils/theme", () => ({
  isDarkThemeActive: () => false,
}));

describe("TiptapInput paste handling", () => {
  it("inserts pasted images into the editor without triggering send", async () => {
    const onSend = vi.fn();

    class MockFileReader {
      public onload: ((event: { target: { result: string } }) => void) | null = null;

      readAsDataURL() {
        this.onload?.({ target: { result: "data:image/png;base64,ZmFrZQ==" } });
      }
    }

    vi.stubGlobal("FileReader", MockFileReader);

    render(
      <TiptapInput
        onSend={onSend}
        selectedProvider="claude"
        onRepoChange={vi.fn()}
        repoSelection={null}
      />,
    );

    const editor = screen.getByRole("textbox");
    const imageFile = new File(["fake"], "paste.png", { type: "image/png" });
    const getAsFile = vi.fn(() => imageFile);

    fireEvent.paste(editor, {
      clipboardData: {
        items: [{ type: "image/png", getAsFile }],
        files: [imageFile],
        types: ["Files"],
        getData: vi.fn(() => ""),
      },
    });

    await waitFor(() => {
      expect(document.querySelector("img[src=\"data:image/png;base64,ZmFrZQ==\"]")).toBeTruthy();
    });

    expect(getAsFile).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
