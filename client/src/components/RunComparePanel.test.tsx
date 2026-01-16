import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty" },
  useTranslation: () => ({
    t: (key: string, vars?: any) => {
      if (key === "datasetCenter.compareMeta")
        return `A=${vars?.a ?? ""};B=${vars?.b ?? ""}`;
      return key;
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/api/runs", () => ({
  listDatasetRunsForRow: vi.fn(async () => [
    {
      runId: "run_new",
      createdAt: "2",
      rowIndex: 0,
      status: "succeeded",
      outputDigest: "d1",
      missingVariablesCount: 0,
    },
    {
      runId: "run_old",
      createdAt: "1",
      rowIndex: 0,
      status: "succeeded",
      outputDigest: "d1",
      missingVariablesCount: 0,
    },
  ]),
  getRun: vi.fn(async (runId: string) => ({
    runId,
    createdAt: runId === "run_new" ? "2" : "1",
    projectId: "p1",
    datasetId: "ds1",
    rowIndex: 0,
    status: "succeeded",
    outputDigest: "d1",
    missingVariablesCount: 0,
    trace: {
      runId: `t_${runId}`,
      createdAt: "now",
      outputStyle: "labeled",
      text: "Hello\nWorld",
      segments: [],
      messages: [],
    },
  })),
}));

describe("RunComparePanel", () => {
  it("shows stable when digests match", async () => {
    const RunComparePanel = (await import("@/components/RunComparePanel"))
      .default;
    render(<RunComparePanel datasetId="ds1" rowCount={2} />);
    expect(
      await screen.findByText("datasetCenter.compareStable")
    ).toBeInTheDocument();
    expect(await screen.findByText(/A=run_new;B=run_old/)).toBeInTheDocument();
  });
});
