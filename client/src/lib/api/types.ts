export type ApiErrorKind = "network" | "timeout" | "http" | "parse";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly url?: string;
  readonly bodyText?: string;

  constructor(
    message: string,
    options: {
      kind: ApiErrorKind;
      status?: number;
      url?: string;
      bodyText?: string;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.kind = options.kind;
    this.status = options.status;
    this.url = options.url;
    this.bodyText = options.bodyText;
  }
}
