import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStore } from "@/lib/store";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty" },
  useTranslation: () => ({
    t: (key: string, vars?: any) => {
      if (key === "datasetCenter.rows") return `rows:${vars?.n ?? ""}`;
      if (key === "datasetCenter.runRow") return `row:${vars?.idx ?? ""}`;
      return key;
    },
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

vi.mock("@/lib/api/datasets", () => ({
  listDatasets: vi.fn(async () => [
    { id: "ds1", name: "D1", rowCount: 2, updatedAt: "now" },
  ]),
  getDataset: vi.fn(async () => ({
    id: "ds1",
    name: "D1",
    rows: [{ name: "Alice" }, { name: "Bob" }],
    createdAt: "now",
    updatedAt: "now",
  })),
  createDataset: vi.fn(),
  deleteDataset: vi.fn(),
}));

vi.mock("@/lib/api/jobs", () => ({
  embedToVectorJob: vi.fn(),
}));

vi.mock("@/lib/api/runs", () => ({
  replayDataset: vi.fn(async () => [
    {
      runId: "run_1",
      rowIndex: 0,
      status: "succeeded",
      outputDigest: "d1",
      missingVariablesCount: 0,
      createdAt: "now",
    },
  ]),
  getRun: vi.fn(async () => ({
    runId: "run_1",
    createdAt: "now",
    projectId: "p1",
    datasetId: "ds1",
    rowIndex: 0,
    status: "succeeded",
    outputDigest: "d1",
    missingVariablesCount: 0,
    trace: {
      runId: "t1",
      createdAt: "now",
      outputStyle: "labeled",
      text: "Hello",
      segments: [],
      messages: [],
    },
  })),
  listDatasetRuns: vi.fn(async () => []),
  listDatasetRunsForRow: vi.fn(async () => []),
}));

describe("DatasetCenterDialog (replay)", () => {
  it("runs replay for selected dataset and shows result rows", async () => {
    useStore.setState({
      projectId: "p1",
      projectName: "P",
      nodes: [],
      edges: [],
      variables: [],
      selectedNodeId: null,
    });

    const { DatasetCenterDialog } = await import(
      "@/components/DatasetCenterDialog"
    );

    render(<DatasetCenterDialog open onOpenChange={() => {}} />);

    expect(await screen.findByText("D1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("D1"));

    fireEvent.click(
      await screen.findByRole("button", { name: "datasetCenter.replay" })
    );

    expect(
      await screen.findByText("datasetCenter.replayResults")
    ).toBeInTheDocument();
    expect(await screen.findByText("row:0")).toBeInTheDocument();
    expect(await screen.findByText("run_1")).toBeInTheDocument();
  });
});
