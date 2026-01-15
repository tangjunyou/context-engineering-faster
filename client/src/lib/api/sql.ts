import { requestJson } from "./client";

export type SqlQueryResponse = {
  value: string;
  rows: Record<string, unknown>[];
};

export async function sqlQuery(input: {
  url?: string;
  dataSourceId?: string;
  query: string;
  rowLimit?: number;
}): Promise<SqlQueryResponse> {
  return requestJson<SqlQueryResponse>("/api/sql/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
