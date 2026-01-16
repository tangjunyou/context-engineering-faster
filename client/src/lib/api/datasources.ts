import { requestJson } from "./client";

export type DataSource = {
  id: string;
  name: string;
  driver: string;
  url: string;
  allowImport?: boolean;
  allowWrite?: boolean;
  allowSchema?: boolean;
  allowDelete?: boolean;
  updatedAt: string;
};

export async function listDataSources(): Promise<DataSource[]> {
  return requestJson<DataSource[]>("/api/datasources");
}

export async function createDataSource(input: {
  name: string;
  driver: string;
  url: string;
  allowImport?: boolean;
  allowWrite?: boolean;
  allowSchema?: boolean;
  allowDelete?: boolean;
}): Promise<DataSource> {
  return requestJson<DataSource>("/api/datasources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function createLocalSqliteDataSource(input: {
  name: string;
}): Promise<DataSource> {
  return requestJson<DataSource>("/api/datasources/local/sqlite", {
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
  input: {
    name?: string;
    driver?: string;
    url?: string;
    allowImport?: boolean;
    allowWrite?: boolean;
    allowSchema?: boolean;
    allowDelete?: boolean;
  }
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

export async function listDataSourceTables(input: {
  dataSourceId: string;
}): Promise<{ tables: string[] }> {
  return requestJson<{ tables: string[] }>(
    `/api/datasources/${input.dataSourceId}/tables`
  );
}

export type ColumnInfo = {
  name: string;
  dataType: string;
  nullable: boolean;
};

export type SqliteRow = Record<string, unknown>;

export async function listSqliteTableRows(input: {
  dataSourceId: string;
  table: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: SqliteRow[] }> {
  const url = new URL(
    `/api/sql/datasources/${input.dataSourceId}/tables/${encodeURIComponent(
      input.table
    )}/rows`,
    window.location.origin
  );
  if (input.limit != null) url.searchParams.set("limit", String(input.limit));
  if (input.offset != null)
    url.searchParams.set("offset", String(input.offset));
  return requestJson<{ rows: SqliteRow[] }>(url.pathname + url.search);
}

export async function insertSqliteTableRow(input: {
  dataSourceId: string;
  table: string;
  row: Record<string, unknown>;
}): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(
    `/api/sql/datasources/${input.dataSourceId}/tables/${encodeURIComponent(
      input.table
    )}/rows/insert`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: input.row }),
    }
  );
}

export async function deleteSqliteTableRow(input: {
  dataSourceId: string;
  table: string;
  rowId: number;
}): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(
    `/api/sql/datasources/${input.dataSourceId}/tables/${encodeURIComponent(
      input.table
    )}/rows/delete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rowId: input.rowId }),
    }
  );
}

export async function createSqliteTable(input: {
  dataSourceId: string;
  table: string;
  columns: { name: string; dataType: string; nullable?: boolean }[];
}): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(
    `/api/sql/datasources/${input.dataSourceId}/tables/create`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        table: input.table,
        columns: input.columns,
      }),
    }
  );
}

export async function listTableColumns(input: {
  dataSourceId: string;
  table: string;
}): Promise<{ columns: ColumnInfo[] }> {
  const { dataSourceId, table } = input;
  return requestJson<{ columns: ColumnInfo[] }>(
    `/api/datasources/${dataSourceId}/tables/${encodeURIComponent(table)}/columns`
  );
}
