import { requestJson } from "./client";

export type VariableLibrarySummary = {
  id: string;
  name: string;
  type: string;
  updatedAt: string;
  currentVersionId: string;
  tags: string[];
};

export type VariableLibraryData = {
  name: string;
  type: string;
  value: string;
  description?: string;
  source?: string;
  resolver?: string;
  tags: string[];
};

export type VariableLibraryVersion = {
  versionId: string;
  createdAt: string;
  data: VariableLibraryData;
};

export type VariableLibraryItem = {
  id: string;
  projectId: string;
  currentVersionId: string;
  createdAt: string;
  updatedAt: string;
  versions: VariableLibraryVersion[];
};

export async function listVariableLibrary(
  projectId: string
): Promise<VariableLibrarySummary[]> {
  return requestJson<VariableLibrarySummary[]>(
    `/api/projects/${projectId}/variable-library`
  );
}

export async function createVariableLibraryItem(
  projectId: string,
  input: {
    name: string;
    type: string;
    value: string;
    description?: string;
    source?: string;
    resolver?: string;
    tags?: string[];
  }
): Promise<VariableLibraryItem> {
  return requestJson<VariableLibraryItem>(
    `/api/projects/${projectId}/variable-library`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
}

export async function getVariableLibraryItem(
  projectId: string,
  id: string
): Promise<VariableLibraryItem> {
  return requestJson<VariableLibraryItem>(
    `/api/projects/${projectId}/variable-library/${id}`
  );
}

export async function updateVariableLibraryItem(
  projectId: string,
  id: string,
  input: {
    name?: string;
    type?: string;
    value?: string;
    description?: string;
    source?: string;
    resolver?: string;
    tags?: string[];
  }
): Promise<VariableLibraryItem> {
  return requestJson<VariableLibraryItem>(
    `/api/projects/${projectId}/variable-library/${id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
}

export async function rollbackVariableLibraryItem(
  projectId: string,
  id: string,
  versionId: string
): Promise<VariableLibraryItem> {
  return requestJson<VariableLibraryItem>(
    `/api/projects/${projectId}/variable-library/${id}/rollback`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    }
  );
}

export async function cloneVariableLibraryItem(
  projectId: string,
  id: string
): Promise<VariableLibraryItem> {
  return requestJson<VariableLibraryItem>(
    `/api/projects/${projectId}/variable-library/${id}/clone`,
    { method: "POST" }
  );
}

export async function deleteVariableLibraryItem(
  projectId: string,
  id: string
): Promise<void> {
  await requestJson<unknown>(
    `/api/projects/${projectId}/variable-library/${id}`,
    {
      method: "DELETE",
    }
  );
}

export type VariableTestResponse = {
  ok: boolean;
  value: string;
  debug?: unknown;
  trace: { severity: string; code: string; message: string; details?: unknown };
};

export async function testVariable(
  projectId: string,
  input: {
    id: string;
    name: string;
    type: string;
    value: string;
    resolver?: string;
  }
): Promise<VariableTestResponse> {
  return requestJson<VariableTestResponse>(
    `/api/projects/${projectId}/variable-library/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
}
