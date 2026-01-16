import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useStore } from "@/lib/store";

const t = vi.hoisted(() => (key: string) => key);

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty" },
  useTranslation: () => ({
    t,
  }),
}));

vi.mock("@/i18n", () => ({
  default: {
    t,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/components/ui/dialog", () => {
  return {
    useDialogComposition: () => ({
      isComposing: () => false,
      setComposing: () => {},
      justEndedComposing: () => false,
      markCompositionEnd: () => {},
    }),
    Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
    DialogContent: ({ children }: any) => <div>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => <div>{children}</div>,
  };
});

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/lib/api/datasources", () => ({
  listDataSourceTables: vi.fn(async () => ({ tables: ["public.items"] })),
  listTableColumns: vi.fn(async () => ({
    columns: [{ name: "id", dataType: "int", nullable: false }],
  })),
}));

vi.mock("@/lib/api/sql", () => ({
  sqlQuery: vi.fn(async () => ({ value: "1", rows: [{ id: 1 }] })),
}));

describe("SqlBrowserDialog", () => {
  beforeEach(() => {
    useStore.setState({
      nodes: [
        {
          id: "node_1",
          type: "contextNode",
          position: { x: 0, y: 0 },
          data: {
            label: "A",
            type: "system_prompt",
            content: "",
            variables: [],
          },
        },
      ],
      edges: [],
      variables: [],
      selectedNodeId: "node_1",
    });
  });

  it("creates a dynamic variable and attaches it to selected node", async () => {
    const { SqlBrowserDialog } = await import("@/components/SqlBrowserDialog");
    render(
      <SqlBrowserDialog
        open
        onOpenChange={() => {}}
        dataSourceId="ds_1"
        dataSourceName="sqlite-demo"
      />
    );

    await screen.findByText("public.items");
    screen.getByText("public.items").click();

    await waitFor(() => {
      expect(screen.getByText("sqlBrowser.createVariable")).toBeInTheDocument();
    });

    screen.getByText("sqlBrowser.createVariable").click();

    const state = useStore.getState();
    expect(state.variables.length).toBe(1);
    expect(state.variables[0].type).toBe("dynamic");
    expect(state.variables[0].resolver).toBe("sql://ds_1");
    const nodeVars = state.nodes[0].data.variables;
    expect(nodeVars.includes(state.variables[0].id)).toBe(true);
  });
});
