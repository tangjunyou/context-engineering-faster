import type { ContextFlowEdge, ContextFlowNode, Variable } from "./types";
import i18n from "@/i18n";

export const initialVariables: Variable[] = [
  {
    id: "var_lang",
    name: "language",
    type: "static",
    value: "中文",
    description: i18n.t("initialData.vars.langDesc"),
    source: i18n.t("initialData.vars.systemConfig"),
  },
  {
    id: "var_time",
    name: "current_time",
    type: "dynamic",
    value: "2024-05-20 14:30:00",
    description: i18n.t("initialData.vars.timeDesc"),
    source: i18n.t("initialData.vars.systemClock"),
  },
  {
    id: "var_user_name",
    name: "user_name",
    type: "dynamic",
    value: "Alex",
    description: i18n.t("initialData.vars.userNameDesc"),
    source: i18n.t("initialData.vars.userProfile"),
  },
  {
    id: "var_query",
    name: "user_query",
    type: "dynamic",
    value: "帮我查一下最近的订单状态",
    description: i18n.t("initialData.vars.queryDesc"),
    source: i18n.t("initialData.vars.chatInterface"),
  },
];

export const initialNodes: ContextFlowNode[] = [
  {
    id: "node_system",
    type: "contextNode",
    position: { x: 250, y: 0 },
    data: {
      label: i18n.t("initialData.nodes.systemPrompt"),
      type: "system_prompt",
      content:
        "你是一个专业的智能助手。请使用 {{language}} 回答用户的问题。\n你的目标是准确、简洁地帮助用户解决问题。",
      variables: ["var_lang"],
      description: i18n.t("initialData.nodes.systemPromptDesc"),
    },
  },
  {
    id: "node_tools",
    type: "contextNode",
    position: { x: 250, y: 180 },
    data: {
      label: i18n.t("initialData.nodes.toolDefinitions"),
      type: "tools",
      content:
        '[\n  {\n    "name": "get_order_status",\n    "description": "查询订单状态",\n    "parameters": { ... }\n  }\n]',
      variables: [],
      description: i18n.t("initialData.nodes.toolsDesc"),
    },
  },
  {
    id: "node_memory",
    type: "contextNode",
    position: { x: 250, y: 360 },
    data: {
      label: i18n.t("initialData.nodes.memoryBlocks"),
      type: "memory",
      content: i18n.t("initialData.nodes.memoryContent"),
      variables: ["var_user_name"],
      description: i18n.t("initialData.nodes.memoryDesc"),
    },
  },
  {
    id: "node_history",
    type: "contextNode",
    position: { x: 250, y: 540 },
    data: {
      label: i18n.t("initialData.nodes.messageHistory"),
      type: "messages",
      content: i18n.t("initialData.nodes.historyContent"),
      variables: [],
      description: i18n.t("initialData.nodes.historyDesc"),
    },
  },
  {
    id: "node_metadata",
    type: "contextNode",
    position: { x: 250, y: 720 },
    data: {
      label: i18n.t("initialData.nodes.systemMetadata"),
      type: "metadata",
      content: i18n.t("initialData.nodes.metadataContent"),
      variables: ["var_time"],
      description: i18n.t("initialData.nodes.metadataDesc"),
    },
  },
  {
    id: "node_input",
    type: "contextNode",
    position: { x: 250, y: 900 },
    data: {
      label: i18n.t("initialData.nodes.userInput"),
      type: "user_input",
      content: "{{user_query}}",
      variables: ["var_query"],
      description: i18n.t("initialData.nodes.inputDesc"),
    },
  },
];

export const initialEdges: ContextFlowEdge[] = [
  { id: "e1-2", source: "node_system", target: "node_tools", animated: true },
  { id: "e2-3", source: "node_tools", target: "node_memory", animated: true },
  { id: "e3-4", source: "node_memory", target: "node_history", animated: true },
  {
    id: "e4-5",
    source: "node_history",
    target: "node_metadata",
    animated: true,
  },
  { id: "e5-6", source: "node_metadata", target: "node_input", animated: true },
];
