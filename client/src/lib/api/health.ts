import { requestJson } from "./client";

export type HealthzResponse = {
  status: "ok";
  dataKey?: { configured: boolean; error?: string };
};

export async function healthz(): Promise<HealthzResponse> {
  return requestJson<HealthzResponse>("/api/healthz");
}

