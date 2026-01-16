import { requestJson } from "./client";

export type DatasetSummary = {
  id: string;
  name: string;
  rowCount: number;
  updatedAt: string;
};

export type DatasetRecord = {
  id: string;
  name: string;
  rows: Record<string, unknown>[];
  createdAt: string;
  updatedAt: string;
};

export async function listDatasets(): Promise<DatasetSummary[]> {
  return requestJson<DatasetSummary[]>("/api/datasets");
}

export async function createDataset(input: {
  name: string;
  rows: Record<string, unknown>[];
}): Promise<DatasetRecord> {
  return requestJson<DatasetRecord>("/api/datasets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getDataset(id: string): Promise<DatasetRecord> {
  return requestJson<DatasetRecord>(`/api/datasets/${id}`);
}

export async function deleteDataset(id: string): Promise<void> {
  await requestJson<null>(`/api/datasets/${id}`, { method: "DELETE" });
}
