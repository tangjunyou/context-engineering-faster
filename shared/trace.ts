export type TraceSeverity = "info" | "warn" | "error";

export type TraceOutputStyle = "plain" | "labeled";

export type TraceNodeKind =
  | "system"
  | "user"
  | "assistant"
  | "tool"
  | "memory"
  | "retrieval"
  | "text";

export type TraceMessage = {
  severity: TraceSeverity;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type TraceSegment = {
  nodeId: string;
  label: string;
  kind: TraceNodeKind;
  template: string;
  rendered: string;
  missingVariables: string[];
  messages: TraceMessage[];
};

export type TraceRun = {
  runId: string;
  createdAt: string;
  outputStyle: TraceOutputStyle;
  text: string;
  segments: TraceSegment[];
  messages: TraceMessage[];
};
