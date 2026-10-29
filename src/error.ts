/** @internal */
type SdkInternalCode = 'invalid_options' | 'network_error' | 'timeout' | 'aborted';

/** @internal */
type ApiCode =
	// auth
	| 'MISSING_API_KEY'
	| 'INVALID_API_KEY'
	// organization / access
	| 'FORBIDDEN'
	| 'ORGANIZATION_CANCELLED'
	| 'ORGANIZATION_PURGED'
	| 'ORGANIZATION_PAYMENT_GRACE'
	| 'ORGANIZATION_MIGRATING'
	| 'ENVIRONMENT_PROTECTED'
	| 'THUMBNAILS_NOT_AVAILABLE'
	// not found / gone
	| 'NOT_FOUND'
	| 'PROJECT_NOT_FOUND'
	| 'PROJECT_NOT_IN_ENVIRONMENT'
	| 'TEMPLATE_NOT_FOUND'
	| 'DOCUMENT_NOT_FOUND'
	| 'DOCUMENT_GONE'
	// validation
	| 'VALIDATION_ERROR'
	| 'MISSING_DATA'
	| 'MISSING_TEMPLATE_SLUG'
	| 'PROJECT_REQUIRED_FOR_DOCUMENT'
	| 'ENVIRONMENT_MISMATCH'
	| 'EMPTY_DOCUMENT'
	| 'TEMPLATE_ERROR'
	| 'RENDER_BODY_TOO_LARGE'
	| 'DOCUMENT_TOO_LARGE'
	// rate / quota
	| 'QUOTA_EXCEEDED'
	| 'OVERAGE_CAP_EXCEEDED'
	| 'RATE_LIMIT_EXCEEDED'
	// server
	| 'INTERNAL_ERROR'
	| 'STORAGE_ACCESS_DENIED'
	| 'PUBLISH_IN_PROGRESS'
	| 'RENDER_TIMEOUT';

/**
 * Known error codes raised by the SDK or returned by the API.
 * The `(string & {})` extension keeps autocomplete on known codes while
 * still accepting forward-compat codes the API may add in the future.
 */
export type PoliPageErrorCode = SdkInternalCode | 'DOWNLOAD_FAILED' | ApiCode | (string & {});

/**
 * Codes that are never retried although their status is (a 429 or a 5xx): the quota codes
 * last until the monthly reset, and `STORAGE_ACCESS_DENIED` until the customer restores its
 * bucket role, so waiting and trying again cannot help.
 *
 * @internal
 */
const NON_RETRYABLE_CODES: readonly string[] = [
	'QUOTA_EXCEEDED',
	'OVERAGE_CAP_EXCEEDED',
	'STORAGE_ACCESS_DENIED',
];

/**
 * Single error type for everything raised by the SDK: API errors,
 * network failures, timeouts, caller cancellation, and constructor
 * validation failures.
 *
 * @example
 * ```ts
 * import { PoliPage, PoliPageError } from '@poli-page/sdk';
 *
 * try {
 *   await client.render.pdf({ project: 'billing', template: 'invoice', data: { ... } });
 * } catch (err) {
 *   if (err instanceof PoliPageError) {
 *     if (err.isAuthError())      return refreshCredentials();
 *     if (err.isRateLimitError()) return queueForLater();
 *     console.error(err.code, err.status, err.requestId);
 *   }
 *   throw err;
 * }
 * ```
 */
export class PoliPageError extends Error {
	readonly code: PoliPageErrorCode;
	readonly status?: number;
	readonly requestId?: string;

	/**
	 * @param options - `cause`: the underlying error (for example the `fetch` failure behind a
	 *   `network_error`), kept for debugging; the message stays the documented one.
	 */
	constructor(
		message: string,
		code: PoliPageErrorCode,
		status?: number,
		requestId?: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = 'PoliPageError';
		this.code = code;
		this.status = status;
		this.requestId = requestId;
	}

	/**
	 * `true` for HTTP 401 / 403 — invalid, missing, or unauthorized API key.
	 *
	 * @example
	 * ```ts
	 * if (err.isAuthError()) {
	 *   await refreshCredentials();
	 * }
	 * ```
	 */
	isAuthError(): boolean {
		return this.status === 401 || this.status === 403;
	}

	/**
	 * `true` for HTTP 429 — too many requests. For `RATE_LIMIT_EXCEEDED` the
	 * SDK has already retried up to `maxRetries` times before surfacing this;
	 * back off further at the caller level if you see it. `QUOTA_EXCEEDED` and
	 * `OVERAGE_CAP_EXCEEDED` are surfaced at once, without retries.
	 *
	 * @example
	 * ```ts
	 * if (err.isRateLimitError()) {
	 *   await sleep(60_000);
	 * }
	 * ```
	 */
	isRateLimitError(): boolean {
		return this.status === 429;
	}

	/**
	 * `true` for HTTP 400 — request payload failed validation
	 * (missing data, unknown field, template error, etc.).
	 *
	 * @example
	 * ```ts
	 * if (err.isValidationError()) {
	 *   console.error('Bad input:', err.code, err.message);
	 * }
	 * ```
	 */
	isValidationError(): boolean {
		return this.status === 400;
	}

	/**
	 * `true` for transport-level failures: DNS errors, connection refused,
	 * TLS failures (`code: 'network_error'`) or per-request timeouts
	 * (`code: 'timeout'`). No `status` is set in these cases.
	 *
	 * @example
	 * ```ts
	 * if (err.isNetworkError()) {
	 *   metrics.increment('poli.network_error');
	 * }
	 * ```
	 */
	isNetworkError(): boolean {
		return this.code === 'network_error' || this.code === 'timeout';
	}

	/**
	 * `true` if the SDK considers this error retryable (5xx, 429, network,
	 * timeout). Caller-aborted requests (`code: 'aborted'`) are never retryable,
	 * and neither are `QUOTA_EXCEEDED`, `OVERAGE_CAP_EXCEEDED` (429) and
	 * `STORAGE_ACCESS_DENIED` (502): retrying cannot help until the quota resets
	 * or the bucket access is restored.
	 *
	 * The SDK already retries internally up to `maxRetries`; this predicate is
	 * mostly useful when an outer queue / scheduler decides whether to re-enqueue.
	 *
	 * @example
	 * ```ts
	 * if (err.isRetryable()) {
	 *   queue.requeue(job);
	 * }
	 * ```
	 */
	isRetryable(): boolean {
		if (this.code === 'aborted') return false;
		if (NON_RETRYABLE_CODES.includes(this.code)) return false;
		if (this.isNetworkError()) return true;
		if (this.status !== undefined && this.status >= 500) return true;
		if (this.status === 429) return true;
		return false;
	}

	/**
	 * Canonical wire payload for framework integrations:
	 * `{ code, message, status, requestId }`. `status` surfaces 503 for
	 * connection failures (`code: 'network_error'`), 504 for timeouts, and
	 * the API status otherwise. The `status` property on the exception
	 * itself stays unchanged — only the payload surfaces 503/504, so
	 * existing callers reading `err.status` are unaffected.
	 */
	toPayload(): { code: PoliPageErrorCode; message: string; status: number | null; requestId: string | null } {
		let status: number | null = this.status ?? null;
		if (status === null) {
			if (this.code === 'timeout') status = 504;
			else if (this.code === 'network_error') status = 503;
		}
		return {
			code: this.code,
			message: this.message,
			status,
			requestId: this.requestId ?? null,
		};
	}
}
