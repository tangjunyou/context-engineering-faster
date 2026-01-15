import { requestJson } from "./client";

export type RenderSessionResponse = {
  value: string;
};

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
