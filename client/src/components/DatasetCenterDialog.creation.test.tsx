import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStore } from "@/lib/store";

// Mocks
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
  },
}));

// Mock API
const createDatasetMock = vi.fn();
vi.mock("@/lib/api/datasets", () => ({
  listDatasets: vi.fn(async () => []),
  getDataset: vi.fn(async () => ({})),
  createDataset: (...args: any[]) => createDatasetMock(...args),
  deleteDataset: vi.fn(),
}));

// Mock other APIs to prevent crash
vi.mock("@/lib/api/jobs", () => ({ embedToVectorJob: vi.fn() }));
vi.mock("@/lib/api/runs", () => ({ 
  replayDataset: vi.fn(), 
  getRun: vi.fn(),
  listDatasetRuns: vi.fn(),
  listDatasetRunsForRow: vi.fn()
}));

describe("DatasetCenterDialog (Creation Flow)", () => {
  it("switches to form view when clicking create", async () => {
    const { DatasetCenterDialog } = await import("@/components/DatasetCenterDialog");
    
    render(<DatasetCenterDialog open onOpenChange={() => {}} />);

    // Click "Create" button to open the form
    const createBtn = screen.getByText("datasetCenter.create");
    fireEvent.click(createBtn);

    // Should show "New Dataset" title
    expect(await screen.findByText("datasetCenter.newDataset")).toBeInTheDocument();
  });
});
