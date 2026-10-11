export class RpcHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
    public readonly retryAfterMs?: number,
  ) {
    super(
      `Ethereum RPC HTTP error: ${status}`,
    );

    this.name = 'RpcHttpError';
  }
}

export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(
      `Ethereum JSON-RPC error ${code}: ${message}`,
    );

    this.name = 'JsonRpcError';
  }
}

export class RpcTimeoutError extends Error {
  constructor(
    timeoutMs: number,
  ) {
    super(
      `Ethereum RPC request timed out after ${timeoutMs}ms`,
    );

    this.name = 'RpcTimeoutError';
  }
}
// Network, HTTP және JSON-RPC қателерін бөлек тануға мүмкіндік береді.
// 429 response ішіндегі Retry-After уақытын error-мен бірге сақтайды.