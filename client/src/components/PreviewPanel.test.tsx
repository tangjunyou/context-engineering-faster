import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useStore } from "@/lib/store";

const wasmSpies = vi.hoisted(() => ({
  processContext: vi.fn(() => "PREVIEW"),
  free: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty" },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string) => key,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/wasm/context_engine", () => {
  class MockContextEngine {
    set_variables = vi.fn();
    process_context = wasmSpies.processContext;
    free = wasmSpies.free;
  }

  return {
    default: vi.fn(async () => {}),
    ContextEngine: MockContextEngine,
  };
});

vi.mock("@/lib/api/context-engine", () => ({
  executePreviewTrace: vi.fn(async () => {
    throw new Error("api unavailable");
  }),
  executeTrace: vi.fn(async () => {
    throw new Error("api unavailable");
  }),
}));

describe("PreviewPanel", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    wasmSpies.processContext.mockClear();
    wasmSpies.free.mockClear();
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.info).mockClear();
    vi.mocked(toast.success).mockClear();

    useStore.setState({
      nodes: [
        {
          id: "a",
          type: "contextNode",
          position: { x: 0, y: 0 },
          data: {
            label: "A",
            type: "system_prompt",
            content: "Hello {{name}}",
            variables: [],
          },
        },
      ],
      edges: [],
      variables: [
        {
          id: "v1",
          name: "name",
          type: "static",
          value: "World",
          description: "",
          source: "",
        },
      ],
      selectedNodeId: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces preview generation on state changes", async () => {
    const { default: PreviewPanel } = await import("@/components/PreviewPanel");
    render(<PreviewPanel />);

    await vi.advanceTimersByTimeAsync(300);
    expect(wasmSpies.processContext).toHaveBeenCalledTimes(1);

    useStore.setState({
      variables: [
        {
          id: "v1",
          name: "name",
          type: "static",
          value: "Alice",
          description: "",
          source: "",
        },
      ],
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(wasmSpies.processContext).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(wasmSpies.processContext).toHaveBeenCalledTimes(2);
  });

  it("sends variable resolver specs to backend preview API", async () => {
    const { executePreviewTrace } = await import("@/lib/api/context-engine");

    vi.mocked(executePreviewTrace).mockResolvedValue({
      runId: "run",
      createdAt: "now",
      outputStyle: "labeled",
      text: "OK",
      segments: [],
      messages: [],
    });

    useStore.setState({
      variables: [
        {
          id: "v1",
          name: "chat",
          type: "dynamic",
          value: "5",
          resolver: "chat://s1",
          description: "",
          source: "",
        },
        {
          id: "v2",
          name: "sql",
          type: "dynamic",
          value: "SELECT 1",
          resolver: "sql://ds1",
          description: "",
          source: "",
        },
      ],
    });

    const { default: PreviewPanel } = await import("@/components/PreviewPanel");
    render(<PreviewPanel />);

    await vi.advanceTimersByTimeAsync(300);

    expect(executePreviewTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: [
          {
            id: "v1",
            name: "chat",
            type: "dynamic",
            value: "5",
            resolver: "chat://s1",
          },
          {
            id: "v2",
            name: "sql",
            type: "dynamic",
            value: "SELECT 1",
            resolver: "sql://ds1",
          },
        ],
      })
    );
    expect(wasmSpies.processContext).not.toHaveBeenCalled();
  }, 20000);

  it("frees the WASM engine on unmount", async () => {
    const { default: PreviewPanel } = await import("@/components/PreviewPanel");
    const { unmount } = render(<PreviewPanel />);
    await vi.advanceTimersByTimeAsync(300);
    expect(wasmSpies.processContext.mock.calls.length).toBeGreaterThan(0);

    unmount();
    expect(wasmSpies.free).toHaveBeenCalledTimes(1);
  });

  it("notifies when a dependency cycle is detected", async () => {
    const { toast } = await import("sonner");
    const { default: PreviewPanel } = await import("@/components/PreviewPanel");
    useStore.setState({
      nodes: [
        {
          id: "a",
          type: "contextNode",
          position: { x: 0, y: 0 },
          data: {
            label: "A",
            type: "system_prompt",
            content: "",
            variables: [],
          },
        },
        {
          id: "b",
          type: "contextNode",
          position: { x: 0, y: 0 },
          data: {
            label: "B",
            type: "system_prompt",
            content: "",
            variables: [],
          },
        },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" },
      ],
    });

    render(<PreviewPanel />);

    await Promise.resolve();
    expect(toast.error).toHaveBeenCalledWith("preview.cycleDetected");
  });
});
