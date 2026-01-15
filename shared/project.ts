import type { TraceNodeKind } from "./trace";

export type ProjectNode = {
  id: string;
  label: string;
  kind: TraceNodeKind;
  content: string;
};

export type ProjectVariable = {
  id: string;
  name: string;
  value: string;
};

export type Project = {
  id: string;
  name: string;
  nodes: ProjectNode[];
  variables: ProjectVariable[];
  updatedAt: string;
};

