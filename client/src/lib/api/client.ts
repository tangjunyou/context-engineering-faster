import { z } from "zod";
import { ApiError } from "./types";

export type JsonSchema<T> = z.ZodType<T>;

type RequestJsonOptions<T> = {
  baseUrl?: string;
  headers?: HeadersInit;
  schema?: JsonSchema<T>;
  timeoutMs?: number;
};

export async function requestJson<T>(
  input: string,
  init: RequestInit = {},
  options: RequestJsonOptions<T> = {}
): Promise<T> {
  const { baseUrl = "", headers, schema, timeoutMs = 15_000 } = options;

  const url = input.startsWith("http") ? input : `${baseUrl}${input}`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
        ...(headers ?? {}),
      },
      signal: controller.signal,
    });

    const bodyText = await res.text();

    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, {
        kind: "http",
        status: res.status,
        url,
        bodyText,
      });
    }

    let json: unknown;
    try {
      json = bodyText.length ? JSON.parse(bodyText) : null;
    } catch (cause) {
      throw new ApiError("响应不是有效 JSON", {
        kind: "parse",
        url,
        bodyText,
        cause,
      });
    }

    if (schema) {
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new ApiError("响应不符合预期结构", {
          kind: "parse",
          url,
          bodyText,
          cause: parsed.error,
        });
      }
      return parsed.data;
    }

    return json as T;
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw new ApiError("请求超时", { kind: "timeout", url, cause });
    }
    throw new ApiError("网络请求失败", { kind: "network", url, cause });
  } finally {
    window.clearTimeout(timeoutId);
  }
}
