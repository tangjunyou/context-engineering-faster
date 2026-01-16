import { requestJson } from "./client";

export type Provider = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  defaultChatModel?: string;
  defaultEmbeddingModel?: string;
  updatedAt: string;
};

export async function listProviders(): Promise<Provider[]> {
  return requestJson<Provider[]>("/api/providers");
}

export async function createProvider(input: {
  name: string;
  provider: "siliconflow";
  baseUrl: string;
  apiKey: string;
  defaultChatModel?: string;
  defaultEmbeddingModel?: string;
}): Promise<Provider> {
  return requestJson<Provider>("/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateProvider(
  id: string,
  input: {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    defaultChatModel?: string;
    defaultEmbeddingModel?: string;
  }
): Promise<Provider> {
  return requestJson<Provider>(`/api/providers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteProvider(id: string): Promise<void> {
  await requestJson<null>(`/api/providers/${id}`, { method: "DELETE" });
}

export async function providerEmbeddings(input: {
  providerId: string;
  model?: string;
  input: string[];
}): Promise<{ embeddings: number[][] }> {
  return requestJson<{ embeddings: number[][] }>(`/api/providers/${input.providerId}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: input.model, input: input.input }),
  });
}

export async function providerChatCompletions(input: {
  providerId: string;
  model?: string;
  messages: { role: string; content: string; createdAt: string }[];
}): Promise<{ content: string; reasoningContent?: string }> {
  return requestJson<{ content: string; reasoningContent?: string }>(
    `/api/providers/${input.providerId}/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, messages: input.messages, stream: false }),
    }
  );
}

