// Normalizes whatever the Soroswap SDK rejects a quote call with into a safe, loggable shape.
//
// @soroswap/sdk wraps axios: when the upstream API responds with an error status, its response
// interceptor rejects with the raw response body (a plain object, not an Error) so the original
// message from Soroswap is preserved; when the request never gets a response at all (network error,
// timeout, DNS failure), it rejects with the original AxiosError instead. Either shape can reach us,
// and neither is safe to log or return to the browser as-is: an AxiosError carries `.config`, which
// includes the outgoing request's headers -- and this route sends `Authorization: Bearer <SOROSWAP_API_KEY>`
// on every request. Only an explicit allowlist of fields is ever read out.

const SAFE_FIELDS = ["error", "message", "status", "statusCode", "code", "details", "response", "data"] as const;

// A denylist as a second line of defense: even an allowlisted field like `details`, if it happens to
// be an object, is scrubbed key-by-key against this pattern before being logged.
const SENSITIVE_KEY_PATTERN = /auth|cookie|token|secret|password|private|seed|key/i;

function sanitizeShallow(value: unknown, depth = 0): unknown {
  if (depth > 2) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) => sanitizeShallow(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        continue;
      }
      out[key] = typeof entryValue === "object" && entryValue !== null ? sanitizeShallow(entryValue, depth + 1) : entryValue;
    }
    return out;
  }
  return value;
}

function pickSafeFields(source: unknown): Record<string, unknown> | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }
  const record = source as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of SAFE_FIELDS) {
    const value = record[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[field] = value;
    } else if (typeof value === "object" && value !== null) {
      out[field] = sanitizeShallow(value);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface QuoteErrorInfo {
  /** A short, safe-to-display summary of what went wrong. */
  message: string;
  /** HTTP status the upstream reported, if any was found. */
  status?: number;
  /** An upstream error code, if any was found (e.g. an axios error code like ECONNABORTED). */
  code?: string;
  /** Any other safely-extracted, redacted diagnostic fields. Never includes request/auth data. */
  details?: Record<string, unknown>;
}

/**
 * Extracts a safe diagnostic summary from whatever a failed `client.quote()` call rejected with.
 *
 * Never returns anything derived from an Error's `.config`, `.request`, or raw `.response` (only the
 * allowlisted primitive fields inside those), so a caller can log or return the result without risking
 * exposing SOROSWAP_API_KEY, authorization headers, cookies, or other request/response internals.
 */
export function describeQuoteError(error: unknown): QuoteErrorInfo {
  if (error instanceof Error) {
    const extra = error as Error & {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      response?: { status?: unknown; data?: unknown };
    };
    const status =
      typeof extra.status === "number"
        ? extra.status
        : typeof extra.statusCode === "number"
          ? extra.statusCode
          : typeof extra.response?.status === "number"
            ? extra.response.status
            : undefined;
    const code = typeof extra.code === "string" ? extra.code : undefined;
    const details = extra.response ? pickSafeFields(extra.response.data) : undefined;
    return {
      message: error.message || "quote request failed",
      status,
      code,
      details,
    };
  }

  if (typeof error === "string") {
    return { message: error };
  }

  if (error && typeof error === "object") {
    const safe = pickSafeFields(error);
    const message =
      (typeof safe?.message === "string" && safe.message) ||
      (typeof safe?.error === "string" && safe.error) ||
      "quote request failed";
    const status = typeof safe?.status === "number" ? safe.status : typeof safe?.statusCode === "number" ? safe.statusCode : undefined;
    const code = typeof safe?.code === "string" ? safe.code : undefined;
    return { message, status, code, details: safe };
  }

  return { message: "quote request failed" };
}

export interface QuoteErrorResponseBody {
  error: string;
  diagnostic: {
    requestId: string;
    upstreamStatus?: number;
    upstreamCode?: string;
    upstreamMessage: string;
  };
}

/**
 * Shapes an already-sanitized {@link QuoteErrorInfo} plus a request id into the exact, minimal JSON
 * body the 502 response returns to the browser.
 *
 * Temporary: this exists so the real upstream failure can be captured from the browser/curl while
 * Vercel's function-log UI isn't surfacing the equivalent console.error payload. It only ever reads
 * `info.status`/`info.code`/`info.message` -- fields describeQuoteError has already redacted -- and
 * deliberately omits `info.details`, to keep the client-facing payload as small as the diagnosis needs.
 */
export function buildQuoteErrorResponseBody(info: QuoteErrorInfo, requestId: string): QuoteErrorResponseBody {
  return {
    error: info.message,
    diagnostic: {
      requestId,
      upstreamStatus: info.status,
      upstreamCode: info.code,
      upstreamMessage: info.message,
    },
  };
}
