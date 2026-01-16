import { requestJson } from "./client";

export type ImportCsvResult = { jobId: string; insertedRows: number };

export type ImportJobSummary = {
  id: string;
  dataSourceId: string;
  driver: string;
  table: string;
  status: string;
  insertedRows?: number;
  createdAt: string;
  finishedAt?: string;
};

export type ImportJobRecord = ImportJobSummary & {
  header: boolean;
  error?: string;
};

export async function importCsvToSqlDataSource(input: {
  dataSourceId: string;
  table: string;
  header: boolean;
  file: File;
}): Promise<ImportCsvResult> {
  const url = new URL(
    `/api/datasources/${input.dataSourceId}/import/csv`,
    window.location.origin
  );
  url.searchParams.set("table", input.table);
  url.searchParams.set("header", input.header ? "true" : "false");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "text/csv",
    },
    body: input.file,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  return JSON.parse(text) as ImportCsvResult;
}

export async function listImportJobs(): Promise<ImportJobSummary[]> {
  return requestJson<ImportJobSummary[]>("/api/imports");
}

export async function getImportJob(id: string): Promise<ImportJobRecord> {
  return requestJson<ImportJobRecord>(`/api/imports/${id}`);
}

export const importCsvToSqliteDataSource = importCsvToSqlDataSource;
