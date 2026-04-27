/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { describe, expect, it } from "vitest";

import { CanvasHost } from "@/client/canvas-runtime";
import {
  Button,
  useCanvasAction,
  useCanvasState,
  useHostTheme,
} from "@/client/canvas-sdk";
import { lightTheme } from "../tokens";

function Probe(): JSX.Element {
  const theme = useHostTheme();
  const [count, setCount] = useCanvasState("count", 1);
  const dispatch = useCanvasAction();

  return (
    <div>
      <span data-testid="theme-color">{theme.text.primary}</span>
      <span data-testid="count">{count}</span>
      <Button onClick={() => setCount((value) => value + 1)}>Increment</Button>
      <Button onClick={() => dispatch({ type: "openAgent", agentId: "a1" })}>
        Dispatch
      </Button>
    </div>
  );
}

describe("canvas sdk hooks", () => {
  it("exposes Cursor-style theme tokens, state, and action dispatch", () => {
    const actions: unknown[] = [];

    render(
      <CanvasHost
        theme={lightTheme}
        canvasId="canvas-1"
        initialData={{ count: 2 }}
        onAction={(action) => actions.push(action)}
        applyBodyTheme={false}
      >
        <Probe />
      </CanvasHost>,
    );

    expect(screen.getByTestId("theme-color").textContent).toBe(
      lightTheme.text.primary,
    );
    expect(screen.getByTestId("count").textContent).toBe("2");

    fireEvent.click(screen.getByText("Increment"));
    expect(screen.getByTestId("count").textContent).toBe("3");

    fireEvent.click(screen.getByText("Dispatch"));
    expect(actions).toEqual([{ type: "openAgent", agentId: "a1" }]);
  });
});
