import { requestJson } from "./client";

export type VectorCollection = {
  name: string;
  dimension: number;
  distance: string;
  createdAt: string;
};

export async function listVectorCollections(): Promise<VectorCollection[]> {
  return requestJson<VectorCollection[]>("/api/vector/collections");
}

export async function createVectorCollection(input: {
  name: string;
  dimension: number;
  distance: "cosine";
}): Promise<VectorCollection> {
  return requestJson<VectorCollection>("/api/vector/collections/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type VectorPoint = {
  id: string;
  vector: number[];
  payload?: Record<string, unknown>;
  batchId?: string;
};

export async function upsertVectorPoints(input: {
  collection: string;
  points: VectorPoint[];
  batchId?: string;
}): Promise<{ upserted: number }> {
  return requestJson<{ upserted: number }>("/api/vector/points/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type VectorFilter = {
  must?: { key: string; match: { value: unknown } }[];
};

export async function searchVector(input: {
  collection: string;
  vector: number[];
  topK?: number;
  filter?: VectorFilter;
}): Promise<{ hits: { id: string; score: number; payload: unknown }[] }> {
  return requestJson<{
    hits: { id: string; score: number; payload: unknown }[];
  }>("/api/vector/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteVectorPoints(input: {
  collection: string;
  filter?: VectorFilter;
  batchId?: string;
}): Promise<{ deleted: number }> {
  return requestJson<{ deleted: number }>("/api/vector/points/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
