const RETRY_AFTER_CAP_MS = 30_000;

/**
 * Parse the `Retry-After` response header. Accepts either an integer number
 * of seconds or an HTTP-date. Returns the delay in milliseconds, capped at
 * 30 s. Returns `undefined` when the header is missing or unparseable.
 */
export function parseRetryAfter(headerValue: string | null): number | undefined {
	if (!headerValue) return undefined;
	const seconds = Number(headerValue);
	if (Number.isFinite(seconds)) {
		return Math.min(Math.max(seconds * 1000, 0), RETRY_AFTER_CAP_MS);
	}
	const dateMs = Date.parse(headerValue);
	if (Number.isFinite(dateMs)) {
		const delta = dateMs - Date.now();
		return Math.min(Math.max(delta, 0), RETRY_AFTER_CAP_MS);
	}
	return undefined;
}

/**
 * Compute the delay before the next retry attempt. When `retryAfterMs` is
 * defined, return it as-is (server-explicit, no jitter). Otherwise apply
 * exponential backoff `baseDelay × 2^(attempt-1)` multiplied by a jitter
 * factor in `[0.5, 1.5)`. `attempt` is 1-based: 1 means the first retry.
 */
export function computeBackoff(
	attempt: number,
	baseDelay: number,
	retryAfterMs: number | undefined,
): number {
	if (retryAfterMs !== undefined) return retryAfterMs;
	const exp = baseDelay * Math.pow(2, attempt - 1);
	const jitterFactor = 0.5 + Math.random();
	return Math.round(exp * jitterFactor);
}

/**
 * Parse a non-2xx response body into a `{ code, message }` pair. Falls back
 * to `INTERNAL_ERROR` when the body is not parseable JSON.
 */
export function parseErrorBody(
	body: string,
	status: number,
): { code: string; message: string } {
	try {
		const json = JSON.parse(body) as { code?: string; message?: string; error?: string };
		const code = json.code ?? json.message ?? json.error ?? 'unknown_error';
		const message = json.message ?? `API error (${status}): ${code}`;
		return { code, message };
	} catch {
		return {
			code: 'INTERNAL_ERROR',
			message: `API error ${status}: response body was not valid JSON`,
		};
	}
}

/**
 * Build the standard request headers. `Accept` is `application/pdf` for the
 * PDF render path and `application/json` otherwise. `userAgent` is supplied
 * by the caller so this module stays free of the build-time `__SDK_VERSION__`
 * global.
 */
export function buildHeaders(
	path: string,
	apiKey: string,
	idempotencyKey: string,
	userAgent: string,
): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		Accept: path === '/v1/render/pdf' ? 'application/pdf' : 'application/json',
		Authorization: `Bearer ${apiKey}`,
		'User-Agent': userAgent,
		'Idempotency-Key': idempotencyKey,
	};
}
