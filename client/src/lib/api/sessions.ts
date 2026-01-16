import { requestJson } from "./client";

export type SessionMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export type SessionSummary = {
  id: string;
  name: string;
  updatedAt: string;
};

export type SessionDoc = {
  id: string;
  name: string;
  messages: SessionMessage[];
  updatedAt: string;
};

export type RenderSessionResponse = {
  value: string;
};

export async function listSessions(): Promise<SessionSummary[]> {
  return requestJson<SessionSummary[]>("/api/sessions");
}

export async function createSession(input: { name: string }): Promise<SessionDoc> {
  return requestJson<SessionDoc>("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getSession(id: string): Promise<SessionDoc> {
  return requestJson<SessionDoc>(`/api/sessions/${id}`);
}

export async function appendSessionMessages(input: {
  sessionId: string;
  messages: SessionMessage[];
}): Promise<SessionDoc> {
  return requestJson<SessionDoc>(`/api/sessions/${input.sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: input.messages }),
  });
}

export async function renderSession(input: {
  sessionId: string;
  maxMessages?: number;
}): Promise<RenderSessionResponse> {
  return requestJson<RenderSessionResponse>(
    `/api/sessions/${input.sessionId}/render`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxMessages: input.maxMessages }),
    }
  );
}
