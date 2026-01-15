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
