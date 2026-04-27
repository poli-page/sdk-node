import { describe, it, expect } from 'vitest';
import { PoliPageError } from '../src/error.js';

describe('PoliPageError', () => {
	it('isAuthError() is true for status 401 and 403', () => {
		expect(new PoliPageError('m', 'INVALID_API_KEY', 401).isAuthError()).toBe(true);
		expect(new PoliPageError('m', 'FORBIDDEN', 403).isAuthError()).toBe(true);
		expect(new PoliPageError('m', 'NOT_FOUND', 404).isAuthError()).toBe(false);
		expect(new PoliPageError('m', 'network_error').isAuthError()).toBe(false);
	});

	it('isRateLimitError() is true for status 429', () => {
		expect(new PoliPageError('m', 'rate_limited', 429).isRateLimitError()).toBe(true);
		expect(new PoliPageError('m', 'INTERNAL_ERROR', 500).isRateLimitError()).toBe(false);
	});

	it('isValidationError() is true for status 400', () => {
		expect(new PoliPageError('m', 'VALIDATION_ERROR', 400).isValidationError()).toBe(true);
		expect(new PoliPageError('m', 'INVALID_API_KEY', 401).isValidationError()).toBe(false);
	});

	it('isNetworkError() is true for code "network_error" and "timeout"', () => {
		expect(new PoliPageError('m', 'network_error').isNetworkError()).toBe(true);
		expect(new PoliPageError('m', 'timeout').isNetworkError()).toBe(true);
		expect(new PoliPageError('m', 'aborted').isNetworkError()).toBe(false);
		expect(new PoliPageError('m', 'INTERNAL_ERROR', 500).isNetworkError()).toBe(false);
	});

	it('isRetryable() is true for 5xx, 429, network_error, timeout', () => {
		expect(new PoliPageError('m', 'INTERNAL_ERROR', 500).isRetryable()).toBe(true);
		expect(new PoliPageError('m', 'INTERNAL_ERROR', 502).isRetryable()).toBe(true);
		expect(new PoliPageError('m', 'rate_limited', 429).isRetryable()).toBe(true);
		expect(new PoliPageError('m', 'network_error').isRetryable()).toBe(true);
		expect(new PoliPageError('m', 'timeout').isRetryable()).toBe(true);
		expect(new PoliPageError('m', 'VALIDATION_ERROR', 400).isRetryable()).toBe(false);
		expect(new PoliPageError('m', 'aborted').isRetryable()).toBe(false);
	});

	it('preserves message, code, status, requestId fields', () => {
		const err = new PoliPageError('boom', 'INTERNAL_ERROR', 500, 'req_abc');
		expect(err.message).toBe('boom');
		expect(err.code).toBe('INTERNAL_ERROR');
		expect(err.status).toBe(500);
		expect(err.requestId).toBe('req_abc');
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(PoliPageError);
		expect(err.name).toBe('PoliPageError');
	});
});
