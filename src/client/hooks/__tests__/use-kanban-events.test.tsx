import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useKanbanEvents } from "../use-kanban-events";

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly url: string;
  readonly close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  fail() {
    this.onerror?.(new Event("error"));
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

function HookHarness({ workspaceId, onInvalidate }: { workspaceId: string; onInvalidate: () => void }) {
  useKanbanEvents({ workspaceId, onInvalidate });
  return null;
}

describe("useKanbanEvents", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockEventSource.reset();
  });

  it("ignores the initial connected event but invalidates on actual kanban changes", () => {
    const onInvalidate = vi.fn();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    render(<HookHarness workspaceId="workspace-1" onInvalidate={onInvalidate} />);

    const source = MockEventSource.instances[0];
    expect(source?.url).toContain("/api/kanban/events?workspaceId=workspace-1");

    source.emit({ type: "connected" });
    expect(onInvalidate).not.toHaveBeenCalled();

    source.emit({ type: "kanban:changed" });
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it("throttles rapid fitness change events", () => {
    vi.useFakeTimers();
    const onInvalidate = vi.fn();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    render(<HookHarness workspaceId="workspace-1" onInvalidate={onInvalidate} />);

    const source = MockEventSource.instances[0];
    source.emit({ type: "connected" });
    source.emit({ type: "fitness:changed" });
    source.emit({ type: "fitness:changed" });

    expect(onInvalidate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(749);
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(onInvalidate).toHaveBeenCalledTimes(2);
  });

  it("invalidates when the SSE connection reconnects after the first connect", () => {
    vi.useFakeTimers();
    const onInvalidate = vi.fn();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    render(<HookHarness workspaceId="workspace-1" onInvalidate={onInvalidate} />);

    const firstSource = MockEventSource.instances[0];
    firstSource.emit({ type: "connected" });
    firstSource.fail();

    vi.advanceTimersByTime(3_000);

    const secondSource = MockEventSource.instances[1];
    expect(secondSource).toBeTruthy();

    secondSource.emit({ type: "connected" });
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });
});
