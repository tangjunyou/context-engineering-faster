import type { Edge, Node } from "@xyflow/react";

export type NodeType = 'system_prompt' | 'tools' | 'memory' | 'retrieval' | 'messages' | 'metadata' | 'user_input';

export type VariableType = 'static' | 'dynamic';

export interface Variable {
  id: string;
  name: string;
  type: VariableType;
  value: string; // For static variables, this is the value. For dynamic, it's a placeholder or example.
  description?: string;
  source?: string;
}

export interface ContextNodeData extends Record<string, unknown> {
  label: string;
  type: NodeType;
  content: string;
  variables: string[]; // IDs of variables used in this node
  description?: string;
  isLocked?: boolean; // If true, cannot be deleted (e.g. System Prompt might be mandatory in some templates)
}

export type ContextFlowNode = Node<ContextNodeData>;
export type ContextFlowEdge = Edge;

export interface ProjectState {
  nodes: ContextFlowNode[];
  edges: ContextFlowEdge[];
  variables: Variable[];
}
