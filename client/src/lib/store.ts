import { create } from 'zustand';
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  addEdge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import { initialNodes, initialEdges, initialVariables } from './initialData';
import { Variable } from './types';

type RFState = {
  nodes: Node[];
  edges: Edge[];
  variables: Variable[];
  selectedNodeId: string | null;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addNode: (node: Node) => void;
  updateNodeData: (id: string, data: any) => void;
  selectNode: (id: string | null) => void;
  updateVariable: (variable: Variable) => void;
  addVariable: (variable: Variable) => void;
  deleteVariable: (id: string) => void;
};

export const useStore = create<RFState>((set, get) => ({
  nodes: initialNodes,
  edges: initialEdges,
  variables: initialVariables,
  selectedNodeId: null,
  onNodesChange: (changes: NodeChange[]) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },
  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },
  onConnect: (connection: Connection) => {
    set({
      edges: addEdge(connection, get().edges),
    });
  },
  addNode: (node: Node) => {
    set({
      nodes: [...get().nodes, node],
    });
  },
  updateNodeData: (id: string, data: any) => {
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
