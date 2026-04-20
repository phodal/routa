import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  KanbanDescriptionEditor,
  htmlToMarkdown,
  markdownToHtml,
} from "../kanban-description-editor";

const mockRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};

const rectList = {
  0: mockRect,
  length: 1,
  item: () => mockRect,
  [Symbol.iterator]: function* iterator() {
    yield mockRect;
  },
};

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      kanban: {
        descriptionPlaceholder: "Write a description",
        editingMarkdown: "Editing markdown",
        renderedMarkdown: "Rendered markdown",
        noDescriptionYet: "No description yet",
      },
      kanbanDetail: {
        description: "Description",
      },
      common: {
        cancel: "Cancel",
        save: "Save",
        edit: "Edit",
      },
      workspace: {
        saving: "Saving",
      },
    },
  }),
}));

function selectEditorText(editor: HTMLElement) {
  const selection = window.getSelection();
  const firstParagraph = editor.querySelector("p");
  const textNode = firstParagraph?.firstChild;
  if (!selection || !textNode) {
    throw new Error("Expected Tiptap editor text node");
  }

  const range = document.createRange();
  range.selectNodeContents(textNode);
  selection.removeAllRanges();
  selection.addRange(range);
}

function mockEditorLayoutApis(editor: HTMLElement) {
  Object.defineProperty(editor, "getBoundingClientRect", {
    value: () => mockRect,
    configurable: true,
  });
  Object.defineProperty(editor, "getClientRects", {
    value: () => rectList,
    configurable: true,
  });
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    value: () => mockRect,
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    value: () => rectList,
    configurable: true,
  });
  Object.defineProperty(Text.prototype, "getBoundingClientRect", {
    value: () => mockRect,
    configurable: true,
  });
  Object.defineProperty(Text.prototype, "getClientRects", {
    value: () => rectList,
    configurable: true,
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    value: () => mockRect,
    configurable: true,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    value: () => rectList,
    configurable: true,
  });
});

afterAll(() => {
  delete ((HTMLElement.prototype as unknown) as Record<string, unknown>).getBoundingClientRect;
  delete ((HTMLElement.prototype as unknown) as Record<string, unknown>).getClientRects;
  delete ((Text.prototype as unknown) as Record<string, unknown>).getBoundingClientRect;
  delete ((Text.prototype as unknown) as Record<string, unknown>).getClientRects;
  delete ((Range.prototype as unknown) as Record<string, unknown>).getBoundingClientRect;
  delete ((Range.prototype as unknown) as Record<string, unknown>).getClientRects;
});

describe("KanbanDescriptionEditor markdown conversion", () => {
  it("preserves bullet and ordered list structure when converting edited HTML back to markdown", () => {
    const markdown = htmlToMarkdown(`
      <ul>
        <li>First item</li>
        <li>Second item
          <ol>
            <li>Nested first</li>
            <li>Nested second</li>
          </ol>
        </li>
      </ul>
    `);

    expect(markdown).toBe("- First item\n- Second item\n  1. Nested first\n  2. Nested second");
  });

  it("escapes markdown-sensitive inline content during roundtrip serialization", () => {
    const markdown = htmlToMarkdown("<p><strong>Bold</strong> + [link-like] text</p>");

    expect(markdown).toBe("**Bold** \\+ \\[link\\-like\\] text");
    expect(markdownToHtml(markdown)).toContain("<strong>Bold</strong>");
  });

  it.each([
    { buttonLabel: "UL", expectedMarkdown: "- List item" },
    { buttonLabel: "OL", expectedMarkdown: "1. List item" },
  ])("saves $buttonLabel toolbar toggles through the live Tiptap editor", async ({
    buttonLabel,
    expectedMarkdown,
  }) => {
    const onSave = vi.fn(async () => {});

    render(<KanbanDescriptionEditor value="List item" onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = document.querySelector("[contenteditable='true']");
    if (!(editor instanceof HTMLElement)) {
      throw new Error("Expected TipTap editor");
    }

    await waitFor(() => {
      expect(editor.innerHTML).toContain("List item");
    });

    mockEditorLayoutApis(editor);
    selectEditorText(editor);
    fireEvent.click(screen.getByRole("button", { name: buttonLabel }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expectedMarkdown);
    });
  });
});
