import { requestJson } from "./client";

export type JobSummary = {
  id: string;
  jobType: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  summary?: string;
};

export type JobRecord = JobSummary & {
  stats: unknown;
  error?: string;
};

export async function listJobs(): Promise<JobSummary[]> {
  return requestJson<JobSummary[]>("/api/jobs");
}

export async function getJob(id: string): Promise<JobRecord> {
  return requestJson<JobRecord>(`/api/jobs/${id}`);
}

export async function embedToVectorJob(input: {
  datasetId: string;
  providerId: string;
  collection: string;
  idField: string;
  textField: string;
  payloadFields?: string[];
}): Promise<{ job: JobRecord }> {
  return requestJson<{ job: JobRecord }>("/api/jobs/embed-to-vector", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

