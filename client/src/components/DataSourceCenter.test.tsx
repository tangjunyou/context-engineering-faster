import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useStore } from "@/lib/store";

const t = vi.hoisted(() => (key: string) => key);

const apiSpies = vi.hoisted(() => ({
  listDataSources: vi.fn(),
  deleteDataSource: vi.fn(),
  testDataSource: vi.fn(async () => ({ ok: true })),
  updateDataSource: vi.fn(),
  listMilvusCollections: vi.fn(),
  listDataSourceTables: vi.fn(async () => ({ tables: ["items"] })),
  previewTableRows: vi.fn(),
  milvusInsert: vi.fn(),
  milvusQuery: vi.fn(),
  milvusSearch: vi.fn(),
}));

const sqlSpies = vi.hoisted(() => ({
  sqlQuery: vi.fn(async () => ({ value: "1", rows: [{ value: 1 }] })),
}));

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
    info: vi.fn(),
  },
}));

vi.mock("@/components/CreateDataSourceDialog", () => ({
  CreateDataSourceDialog: () => null,
}));

vi.mock("@/components/ImportCsvDialog", () => ({
  ImportCsvDialog: () => null,
}));

vi.mock("@/components/SqlBrowserDialog", () => ({
  SqlBrowserDialog: () => null,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button type="button">{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => (
    <button type="button">{children}</button>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder ?? ""}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange }: any) => (
    <button
      type="button"
      aria-pressed={checked ? "true" : "false"}
      onClick={() => onCheckedChange(!checked)}
    >
      switch
    </button>
  ),
}));

vi.mock("@/lib/api/datasources", () => apiSpies);
vi.mock("@/lib/api/sql", () => sqlSpies);

describe("DataSourceCenter", () => {
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
    apiSpies.listDataSources.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows empty-state onboarding when there are no datasources", async () => {
    apiSpies.listDataSources.mockResolvedValueOnce([]);
    const { default: DataSourceCenter } = await import(
      "@/components/DataSourceCenter"
    );
    render(<DataSourceCenter />);
    await screen.findByText("开始使用数据源");
    expect(screen.getAllByText("dataSourceManager.new").length).toBeGreaterThan(
      0
    );
  });

  it("renders SQL tabs for SQL drivers and Milvus tab for milvus", async () => {
    apiSpies.listDataSources.mockResolvedValueOnce([
      {
        id: "ds_sqlite",
        name: "sqlite-demo",
        driver: "sqlite",
        url: "<redacted>",
        allowImport: true,
        allowWrite: true,
        allowSchema: true,
        allowDelete: true,
        updatedAt: "0",
      },
      {
        id: "ds_milvus",
        name: "milvus-demo",
        driver: "milvus",
        url: "<redacted>",
        allowImport: false,
        allowWrite: false,
        allowSchema: false,
        allowDelete: false,
        updatedAt: "0",
      },
    ]);
    const { default: DataSourceCenter } = await import(
      "@/components/DataSourceCenter"
    );
    render(<DataSourceCenter />);

    await screen.findAllByText("sqlite-demo");
    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(screen.getByText("Builder")).toBeInTheDocument();
    expect(screen.queryByText("Milvus")).toBeNull();

    screen.getByText("milvus-demo").click();
    await screen.findAllByText("milvus-demo");
    expect(screen.getByText("Milvus")).toBeInTheDocument();
    expect(screen.queryByText("Explore")).toBeNull();
  });

  it("creates a SQL variable and attaches it to selected node", async () => {
    apiSpies.listDataSources.mockResolvedValueOnce([
      {
        id: "ds_sqlite",
        name: "sqlite-demo",
        driver: "sqlite",
        url: "<redacted>",
        allowImport: true,
        allowWrite: true,
        allowSchema: true,
        allowDelete: true,
        updatedAt: "0",
      },
    ]);
    const { default: DataSourceCenter } = await import(
      "@/components/DataSourceCenter"
    );
    render(<DataSourceCenter />);

    await screen.findAllByText("sqlite-demo");
    screen.getByText("生成变量").click();

    const state = useStore.getState();
    expect(state.variables.length).toBe(1);
    expect(state.variables[0].type).toBe("dynamic");
    expect(state.variables[0].resolver).toBe("sql://ds_sqlite");
    expect(state.nodes[0].data.variables.includes(state.variables[0].id)).toBe(
      true
    );
  });

  it("creates a Milvus variable and attaches it to selected node", async () => {
    apiSpies.listDataSources.mockResolvedValueOnce([
      {
        id: "ds_milvus",
        name: "milvus-demo",
        driver: "milvus",
        url: "<redacted>",
        allowImport: false,
        allowWrite: false,
        allowSchema: false,
        allowDelete: false,
        updatedAt: "0",
      },
    ]);
    const { default: DataSourceCenter } = await import(
      "@/components/DataSourceCenter"
    );
    render(<DataSourceCenter />);

    await screen.findAllByText("milvus-demo");
    screen.getByText("生成变量").click();

    const state = useStore.getState();
    expect(state.variables.length).toBe(1);
    expect(state.variables[0].type).toBe("dynamic");
    expect(state.variables[0].resolver).toBe("milvus://ds_milvus");
    expect(state.nodes[0].data.variables.includes(state.variables[0].id)).toBe(
      true
    );
  });
});
