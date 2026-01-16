import { requestJson } from "./client";
import type { TraceRun } from "@shared/trace";

export type RunSummary = {
  runId: string;
  createdAt: string;
  rowIndex: number;
  status: string;
  outputDigest: string;
  missingVariablesCount: number;
};

export type RunRecord = RunSummary & {
  projectId: string;
  datasetId: string;
  trace: TraceRun;
};

export async function replayDataset(input: {
  datasetId: string;
  projectId: string;
  limit?: number;
  offset?: number;
}): Promise<RunSummary[]> {
  const { datasetId, ...body } = input;
  return requestJson<RunSummary[]>(`/api/datasets/${datasetId}/replay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function listDatasetRuns(
  datasetId: string
): Promise<RunSummary[]> {
  return requestJson<RunSummary[]>(`/api/datasets/${datasetId}/runs`);
}

export async function listDatasetRunsForRow(
  datasetId: string,
  input: { rowIndex: number; limit?: number }
): Promise<RunSummary[]> {
  const params = new URLSearchParams();
  params.set("rowIndex", String(input.rowIndex));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  return requestJson<RunSummary[]>(
    `/api/datasets/${datasetId}/runs?${params.toString()}`
  );
}

export async function getRun(runId: string): Promise<RunRecord> {
  return requestJson<RunRecord>(`/api/runs/${runId}`);
}
