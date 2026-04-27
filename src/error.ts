type SdkInternalCode = 'invalid_options' | 'network_error' | 'timeout' | 'aborted';

type ApiCode =
	| 'INVALID_API_KEY'
	| 'MISSING_API_KEY'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'VERSION_NOT_FOUND'
	| 'VALIDATION_ERROR'
	| 'MISSING_DATA'
	| 'MISSING_PROJECT_OR_TEMPLATE'
	| 'MISSING_TEMPLATE_SLUG'
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

	isAuthError(): boolean {
		return this.status === 401 || this.status === 403;
	}

	isRateLimitError(): boolean {
		return this.status === 429;
	}

	isValidationError(): boolean {
		return this.status === 400;
	}

	isNetworkError(): boolean {
		return this.code === 'network_error' || this.code === 'timeout';
	}

	isRetryable(): boolean {
		if (this.code === 'aborted') return false;
		if (this.isNetworkError()) return true;
		if (this.status !== undefined && this.status >= 500) return true;
		if (this.status === 429) return true;
		return false;
	}
}
