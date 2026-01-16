import { requestJson } from "./client";
import type { ContextFlowEdge, ContextFlowNode, Variable } from "@/lib/types";

export type ProjectState = {
  nodes: ContextFlowNode[];
  edges: ContextFlowEdge[];
  variables: Variable[];
};

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: string;
};

export type ProjectDoc = {
  id: string;
  name: string;
  state: ProjectState;
  updatedAt: string;
};

export async function listProjects(): Promise<ProjectSummary[]> {
  return requestJson<ProjectSummary[]>("/api/projects");
}

export async function createProject(input: {
  name: string;
  state: ProjectState;
}): Promise<ProjectDoc> {
  return requestJson<ProjectDoc>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getProject(id: string): Promise<ProjectDoc> {
  return requestJson<ProjectDoc>(`/api/projects/${id}`);
}

export async function upsertProject(
  id: string,
  input: { name: string; state: ProjectState }
): Promise<ProjectDoc> {
  return requestJson<ProjectDoc>(`/api/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

