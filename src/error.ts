/** @internal */
type SdkInternalCode = 'invalid_options' | 'network_error' | 'timeout' | 'aborted';

/** @internal */
type ApiCode =
	// auth
	| 'MISSING_API_KEY'
	| 'INVALID_API_KEY'
	// billing / lifecycle
	| 'PAYMENT_REQUIRED'
	| 'FORBIDDEN'
	| 'ORGANIZATION_CANCELLED'
	| 'ORGANIZATION_PURGED'
	// not found / gone
	| 'NOT_FOUND'
	| 'VERSION_NOT_FOUND'
	| 'DOCUMENT_NOT_FOUND'
	| 'GONE'
	// validation
	| 'VALIDATION_ERROR'
	| 'MISSING_DATA'
	| 'MISSING_PROJECT_OR_TEMPLATE'
	| 'MISSING_TEMPLATE_SLUG'
	| 'INVALID_VERSION_FORMAT'
	| 'VERSION_REQUIRED'
	| 'INVALID_VERSION_FOR_KEY_ENV'
	// rate / quota
	| 'QUOTA_EXCEEDED'
	| 'OVERAGE_CAP_EXCEEDED'
	// server
	| 'INTERNAL_ERROR';

/**
 * Known error codes raised by the SDK or returned by the API.
 * The `(string & {})` extension keeps autocomplete on known codes while
 * still accepting forward-compat codes the API may add in the future.
 */
export type PoliPageErrorCode = SdkInternalCode | ApiCode | (string & {});

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

	constructor(message: string, code: PoliPageErrorCode, status?: number, requestId?: string) {
		super(message);
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
	 * `true` for HTTP 429 — too many requests. The SDK has already retried up
	 * to `maxRetries` times before surfacing this; back off further at the
	 * caller level if you see it.
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
	 * (missing data, missing project/template, bad version, etc.).
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
	 * timeout). Caller-aborted requests (`code: 'aborted'`) are never retryable.
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
