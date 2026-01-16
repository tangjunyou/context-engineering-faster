import type { ContextFlowEdge, ContextFlowNode, Variable } from "@/lib/types";

export type ContextTemplate = {
  id: string;
  name: string;
  description: string;
  nodes: ContextFlowNode[];
  edges: ContextFlowEdge[];
  variables: Variable[];
};

export const CONTEXT_TEMPLATES: ContextTemplate[] = [
  {
    id: "minimal_runnable",
    name: "最小可运行",
    description: "一个系统提示词 + 一个变量，立刻可预览与 trace。",
    nodes: [
      {
        id: "n_system",
        type: "contextNode",
        position: { x: 120, y: 120 },
        data: {
          label: "System",
          type: "system_prompt",
          content: "You are a helpful assistant.\\n\\nHello {{name}}.",
          variables: ["v_name"],
          isLocked: true,
        },
      },
    ],
    edges: [],
    variables: [
      {
        id: "v_name",
        name: "name",
        type: "static",
        value: "World",
        description: "新手示例变量",
        source: "template:minimal_runnable",
      },
    ],
  },
  {
    id: "qa_with_context",
    name: "带检索上下文的问答",
    description: "System + Retrieval + User Input，适合 RAG 的起点。",
    nodes: [
      {
        id: "n_system",
        type: "contextNode",
        position: { x: 120, y: 80 },
        data: {
          label: "System",
          type: "system_prompt",
          content:
            "你是一个严谨的问答助手。\\n\\n规则：仅基于提供的检索上下文回答；不确定时说明不知道。",
          variables: [],
          isLocked: true,
        },
      },
      {
        id: "n_retrieval",
        type: "contextNode",
        position: { x: 120, y: 220 },
        data: {
          label: "Retrieved Context",
          type: "retrieval",
          content: "{{retrieved_context}}",
          variables: ["v_retrieved_context"],
        },
      },
      {
        id: "n_user",
        type: "contextNode",
        position: { x: 120, y: 360 },
        data: {
          label: "User",
          type: "user_input",
          content: "{{question}}",
          variables: ["v_question"],
        },
      },
    ],
    edges: [
      { id: "e1", source: "n_system", target: "n_retrieval" },
      { id: "e2", source: "n_retrieval", target: "n_user" },
    ],
    variables: [
      {
        id: "v_question",
        name: "question",
        type: "static",
        value: "什么是上下文工程？",
        description: "用户问题",
        source: "template:qa_with_context",
      },
      {
        id: "v_retrieved_context",
        name: "retrieved_context",
        type: "static",
        value: "上下文工程：为模型提供相关信息与约束的系统化方法。",
        description: "检索到的上下文（示例）",
        source: "template:qa_with_context",
      },
    ],
  },
  {
    id: "tool_calling_stub",
    name: "工具调用（占位）",
    description: "System + Tools + User Input，用于工具型 agent 起步。",
    nodes: [
      {
        id: "n_system",
        type: "contextNode",
        position: { x: 120, y: 80 },
        data: {
          label: "System",
          type: "system_prompt",
          content:
            "你是一个工具型助手。\\n\\n当需要外部信息时，先调用工具，再根据工具结果回答。",
          variables: [],
          isLocked: true,
        },
      },
      {
        id: "n_tools",
        type: "contextNode",
        position: { x: 120, y: 220 },
        data: {
          label: "Tools",
          type: "tools",
          content: "{{tool_spec}}",
          variables: ["v_tool_spec"],
        },
      },
      {
        id: "n_user",
        type: "contextNode",
        position: { x: 120, y: 360 },
        data: {
          label: "User",
          type: "user_input",
          content: "{{question}}",
          variables: ["v_question"],
        },
      },
    ],
    edges: [
      { id: "e1", source: "n_system", target: "n_tools" },
      { id: "e2", source: "n_tools", target: "n_user" },
    ],
    variables: [
      {
        id: "v_question",
        name: "question",
        type: "static",
        value: "请总结这篇文章的要点。",
        description: "用户问题",
        source: "template:tool_calling_stub",
      },
      {
        id: "v_tool_spec",
        name: "tool_spec",
        type: "static",
        value:
          "tools:\\n- name: web_search\\n  description: 搜索网页并返回摘要\\n- name: fetch_url\\n  description: 拉取网页正文\\n",
        description: "工具说明（占位）",
        source: "template:tool_calling_stub",
      },
    ],
  },
];

export function getContextTemplateById(id: string): ContextTemplate {
  const tpl = CONTEXT_TEMPLATES.find(t => t.id === id);
  if (!tpl) {
    throw new Error(`Unknown context template: ${id}`);
  }
  return tpl;
}
