import { createWithEqualityFn } from "zustand/traditional";
import {
  Connection,
  EdgeChange,
  NodeChange,
  addEdge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import { initialNodes, initialEdges, initialVariables } from './initialData';
import type { ContextFlowEdge, ContextFlowNode, ContextNodeData, Variable } from "./types";

type RFState = {
  nodes: ContextFlowNode[];
  edges: ContextFlowEdge[];
  variables: Variable[];
  selectedNodeId: string | null;
  onNodesChange: OnNodesChange<ContextFlowNode>;
  onEdgesChange: OnEdgesChange<ContextFlowEdge>;
  onConnect: OnConnect;
  addNode: (node: ContextFlowNode) => void;
  updateNodeData: (id: string, data: Partial<ContextNodeData>) => void;
  selectNode: (id: string | null) => void;
  updateVariable: (variable: Variable) => void;
  addVariable: (variable: Variable) => void;
  deleteVariable: (id: string) => void;
};

export const useStore = createWithEqualityFn<RFState>()((set, get) => ({
  nodes: initialNodes,
  edges: initialEdges,
  variables: initialVariables,
  selectedNodeId: null,
  onNodesChange: (changes: NodeChange<ContextFlowNode>[]) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },
  onEdgesChange: (changes: EdgeChange<ContextFlowEdge>[]) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },
  onConnect: (connection: Connection) => {
    set({
      edges: addEdge(connection, get().edges),
    });
  },
  addNode: (node: ContextFlowNode) => {
    set({
      nodes: [...get().nodes, node],
    });
  },
  updateNodeData: (id: string, data: Partial<ContextNodeData>) => {
    set({
      nodes: get().nodes.map((node) => {
        if (node.id === id) {
          return { ...node, data: { ...node.data, ...data } };
        }
        return node;
      }),
    });
  },
  selectNode: (id: string | null) => {
    set({ selectedNodeId: id });
  },
  updateVariable: (updatedVariable: Variable) => {
    set({
      variables: get().variables.map((v) =>
        v.id === updatedVariable.id ? updatedVariable : v
      ),
    });
  },
  addVariable: (variable: Variable) => {
    set({
      variables: [...get().variables, variable],
    });
  },
  deleteVariable: (id: string) => {
    set({
      variables: get().variables.filter((v) => v.id !== id),
    });
  },
}));
