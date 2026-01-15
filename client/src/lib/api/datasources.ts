import { requestJson } from "./client";

export type DataSource = {
  id: string;
  name: string;
  driver: string;
  url: string;
  updatedAt: string;
};

export async function listDataSources(): Promise<DataSource[]> {
  return requestJson<DataSource[]>("/api/datasources");
}

export async function createDataSource(input: {
  name: string;
  driver: string;
  url: string;
}): Promise<DataSource> {
  return requestJson<DataSource>("/api/datasources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function testDataSource(id: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/api/datasources/${id}/test`, {
    method: "POST",
  });
}

export async function updateDataSource(
  id: string,
  input: { name?: string; driver?: string; url?: string }
): Promise<DataSource> {
  return requestJson<DataSource>(`/api/datasources/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteDataSource(id: string): Promise<void> {
  await requestJson<null>(`/api/datasources/${id}`, { method: "DELETE" });
}

export type ColumnInfo = {
  name: string;
  dataType: string;
  nullable: boolean;
};

export async function listTableColumns(input: {
  dataSourceId: string;
  table: string;
}): Promise<{ columns: ColumnInfo[] }> {
  const { dataSourceId, table } = input;
  return requestJson<{ columns: ColumnInfo[] }>(
    `/api/datasources/${dataSourceId}/tables/${encodeURIComponent(table)}/columns`
  );
}
