import type { TraceRun, TraceOutputStyle } from "@shared/trace";
import { requestJson } from "./client";

export type ExecuteNode = {
  id: string;
  label: string;
  kind: string;
  content: string;
};

export type ExecuteVariable = {
  id: string;
  name: string;
  value: string;
};

export async function executeTrace(input: {
  nodes: ExecuteNode[];
  variables: ExecuteVariable[];
  outputStyle: TraceOutputStyle;
}): Promise<TraceRun> {
  return requestJson<TraceRun>("/api/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
