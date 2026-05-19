# `src/index.ts` `#request` Decomposition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the ~110-line `#request` method in `src/index.ts` into named, single-purpose units (pure helpers in `src/internal/http.ts`, `#sendOnce`, `#runWithRetry`, thin `#request`) without changing public API or behavior. Fold in the `node:crypto` → `globalThis.crypto` isomorphism fix while v1 is unpublished.

**Architecture:** Four sequential commits. Commits 1–2 are pure refactors guarded by the existing `tests/index.test.ts` suite. Commit 3 is an isolated runtime fix (additive). Commit 4 adds belt-and-suspenders unit tests for the new helpers. `git bisect` stays useful at every commit.

**Tech Stack:** TypeScript (ES2022 target, strict), Vitest, pnpm, ESLint flat config, tsup. Node ≥ 20.18.

**Spec:** `docs/superpowers/specs/2026-04-27-index-refactor-design.md`

---

## File Structure

| File | Status after refactor | Responsibility |
|---|---|---|
| `src/index.ts` | Modified — shrinks from 288 → ~140 lines | `PoliPage` class: constructor, public methods, `#request` (thin), `#runWithRetry`, `#sendOnce`, `#fireHook`, `#sleep` |
| `src/internal/http.ts` | New | Pure HTTP helpers: `parseRetryAfter`, `computeBackoff`, `parseErrorBody`, `buildHeaders`. No `this`, no fetch, no timers, no `node:*` imports. |
| `src/error.ts` | Unchanged | `PoliPageError` class. |
| `src/types.ts` | Unchanged | Public types. |
| `src/node.ts` | Unchanged | `renderToFile` (Node-only sub-export). |
| `src/global.d.ts` | Unchanged | `__SDK_VERSION__` build-time global. |
| `tests/index.test.ts` | Unchanged through commits 1–2; **modified in commit 3** to add isomorphism assertions | Existing 50+ tests are the safety net. |
| `tests/internal/http.test.ts` | New in commit 4 | Unit tests for the four pure helpers. |
| `CHANGELOG.md` | Modified in commit 3 only | Add a "Fixed" entry under `[Unreleased]`. |

`src/internal/` is **not** added to `package.json` `exports` — internal-only.

---

## Behavior Preservation Checklist

These must remain true at every commit. The existing test suite covers them:

- `User-Agent` is `poli-page-sdk-node/<version>`; `Accept` is `application/pdf` for `/v1/render/pdf`, else `application/json`; `Authorization: Bearer <key>`; `Idempotency-Key` is auto-generated UUID v4 reused across retries; `Content-Type: application/json`.
- Retry rules: 5xx and 429 retried; 4xx (except 429) not retried; network errors and timeouts retried.
- `Retry-After` capped at 30 s; HTTP-date format supported; past-date treated as 0; no jitter when `Retry-After` is present.
- Jitter `× [0.5, 1.5]` applied to `retryDelay × 2^(attempt-1)` only when `Retry-After` is absent. `Math.random()` called exactly once per backoff calculation.
- 2xx `/v1/render/pdf` with non-`application/pdf` Content-Type → `PoliPageError` with `code: 'INTERNAL_ERROR'` and the HTTP status.
- Non-2xx body that is not parseable JSON → `PoliPageError` with `code: 'INTERNAL_ERROR'`.
- Caller-abort short-circuits the loop, fires `onError`, throws `'aborted'`.
- Hooks fire synchronously; hook errors are caught and silently swallowed.
- Hook firing order matches existing tests: `onRequest` per attempt, `onResponse` only on `response.ok`, `onRetry` before each retry sleep with the previous error as `reason`, `onError` once when the call gives up terminally.

---

## Task 1: Extract pure helpers to `src/internal/http.ts`

**Files:**
- Create: `src/internal/http.ts`
- Modify: `src/index.ts` (replace inline blocks with helper calls; remove `#headers` private method; remove `parseRetryAfter` from top of file; remove `RETRY_AFTER_CAP_MS` constant)

This task lifts four already-pure-or-easily-purifiable code blocks into a sibling module. No behavior change. The existing test suite is the safety net.

- [ ] **Step 1.1: Create `src/internal/http.ts` with all four helpers**

```ts
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
```

- [ ] **Step 1.2: Update `src/index.ts` — replace top-of-file `parseRetryAfter` and `RETRY_AFTER_CAP_MS` with an import**

Remove lines 35–51 (the `RETRY_AFTER_CAP_MS` const and the `parseRetryAfter` function). Add to the import block at the top of the file (after the `error.ts` import line):

```ts
import { parseRetryAfter, computeBackoff, parseErrorBody, buildHeaders } from './internal/http.js';
```

- [ ] **Step 1.3: Update `src/index.ts` — replace the inline backoff block in `#request`**

Replace lines 178–186 (the `if/else` block computing `delay`):

```ts
				if (attempt > 0) {
					let delay: number;
					if (nextRetryAfterMs !== undefined) {
						delay = nextRetryAfterMs; // server-explicit, no jitter
					} else {
						const exp = this.#retryDelay * Math.pow(2, attempt - 1);
						const jitterFactor = 0.5 + Math.random(); // [0.5, 1.5)
						delay = Math.round(exp * jitterFactor);
					}
```

with:

```ts
				if (attempt > 0) {
					const delay = computeBackoff(attempt, this.#retryDelay, nextRetryAfterMs);
```

- [ ] **Step 1.4: Update `src/index.ts` — replace the inline error-body parse in `#request`**

Replace lines 248–258 (the `errorBody` / `try { JSON.parse(...) } catch` block):

```ts
				const errorBody = await response.text();
				let code: string;
				let message: string;
				try {
					const json = JSON.parse(errorBody) as { code?: string; message?: string; error?: string };
					code = json.code ?? json.message ?? json.error ?? 'unknown_error';
					message = json.message ?? `API error (${response.status}): ${code}`;
				} catch {
					code = 'INTERNAL_ERROR';
					message = `API error ${response.status}: response body was not valid JSON`;
				}
```

with:

```ts
				const errorBody = await response.text();
				const { code, message } = parseErrorBody(errorBody, response.status);
```

- [ ] **Step 1.5: Update `src/index.ts` — replace `#headers` private method with `buildHeaders` call**

Remove the entire `#headers` method (lines 149–158).

In `#request`, replace the existing `headers: this.#headers(path, idempotencyKey),` (line 209) with:

```ts
						headers: buildHeaders(
							path,
							this.#apiKey,
							idempotencyKey,
							`poli-page-sdk-node/${__SDK_VERSION__}`,
						),
```

- [ ] **Step 1.6: Run lint, typecheck, and the full unit suite**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: lint clean, typecheck clean, all existing tests pass (including all "retry logic", "Idempotency-Key", "HTTP transport headers", and "observability hooks" describe blocks).

If `Math.random` invocation count tests fail, ensure `computeBackoff` calls `Math.random()` exactly once per call when `retryAfterMs` is undefined. If the "caps Retry-After at 30 seconds" test fails, the `RETRY_AFTER_CAP_MS` constant was lost or moved incorrectly — it should live exactly once, in `src/internal/http.ts`.

- [ ] **Step 1.7: Commit**

```bash
git add src/internal/http.ts src/index.ts
git commit -m "$(cat <<'EOF'
refactor: extract pure http helpers to src/internal/http.ts

Lift parseRetryAfter, computeBackoff, parseErrorBody, and buildHeaders
out of #request and the inline blocks in src/index.ts. Pure functions,
no this, no fetch, no node:* imports. Behavior unchanged — existing
unit suite is the safety net.

EOF
)"
```

---

## Task 2: Split `#request` into `#sendOnce` and `#runWithRetry`

**Files:**
- Modify: `src/index.ts` (replace `#request` body, add `#sendOnce` and `#runWithRetry` methods, add local `SendOnceResult` type)

This task decomposes the retry loop. `#request` becomes a 4-line orchestrator that only generates the idempotency key and delegates to `#runWithRetry`. The behavior is preserved exactly — caller-aborts still throw immediately, timeouts/network errors still fold into the loop, hook firing order is unchanged.

- [ ] **Step 2.1: Add `SendOnceResult` discriminated union type**

In `src/index.ts`, after the `import { PoliPageError }` line and before `const DEFAULT_BASE_URL`, add:

```ts
type SendOnceResult =
	| { ok: true; response: Response }
	| { ok: false; error: PoliPageError; retryAfterMs: number | undefined; retryable: boolean };
```

- [ ] **Step 2.2: Replace the entire `#request` method block with three methods**

Locate the `async #request(...)` method (currently around lines 160–270). Replace it — and the `#sleep` method that follows — with the four method definitions below. The `#sleep` method body stays identical; it just keeps its position relative to the new methods.

```ts
	async #request(
		path: string,
		body: object,
		signal?: AbortSignal,
		callerIdempotencyKey?: string,
	): Promise<Response> {
		const idempotencyKey = callerIdempotencyKey ?? randomUUID();
		return this.#runWithRetry(path, body, idempotencyKey, signal);
	}

	async #runWithRetry(
		path: string,
		body: object,
		idempotencyKey: string,
		signal: AbortSignal | undefined,
	): Promise<Response> {
		if (signal?.aborted) {
			const abortedError = new PoliPageError('Request was aborted', 'aborted');
			this.#fireHook(this.#onError, abortedError);
			throw abortedError;
		}

		let lastError: PoliPageError | undefined;
		let nextRetryAfterMs: number | undefined;

		for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
			if (attempt > 0) {
				const delay = computeBackoff(attempt, this.#retryDelay, nextRetryAfterMs);
				this.#fireHook(this.#onRetry, {
					attempt: attempt + 1,
					delayMs: delay,
					reason: lastError!,
				});
				await this.#sleep(delay, signal);
				nextRetryAfterMs = undefined;
			}

			const result = await this.#sendOnce(path, body, idempotencyKey, attempt + 1, signal);

			if (result.ok) return result.response;

			lastError = result.error;
			nextRetryAfterMs = result.retryAfterMs;

			if (!result.retryable) {
				this.#fireHook(this.#onError, lastError);
				throw lastError;
			}
		}

		this.#fireHook(this.#onError, lastError!);
		throw lastError!;
	}

	async #sendOnce(
		path: string,
		body: object,
		idempotencyKey: string,
		attempt: number,
		signal: AbortSignal | undefined,
	): Promise<SendOnceResult> {
		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), this.#timeout);
		const composed = signal
			? AbortSignal.any([signal, timeoutController.signal])
			: timeoutController.signal;

		this.#fireHook(this.#onRequest, {
			method: 'POST',
			url: `${this.#baseUrl}${path}`,
			attempt,
		});

		const t0 = Date.now();
		let response: Response;
		try {
			response = await fetch(`${this.#baseUrl}${path}`, {
				method: 'POST',
				headers: buildHeaders(
					path,
					this.#apiKey,
					idempotencyKey,
					`poli-page-sdk-node/${__SDK_VERSION__}`,
				),
				body: JSON.stringify(body),
				signal: composed,
			});
		} catch (err) {
			clearTimeout(timeoutId);
			if (signal?.aborted) {
				const abortedError = new PoliPageError('Request was aborted', 'aborted');
				this.#fireHook(this.#onError, abortedError);
				throw abortedError;
			}
			const aborted = err instanceof Error && err.name === 'AbortError';
			const error = new PoliPageError(
				aborted ? `Request timed out after ${this.#timeout}ms` : (err as Error).message,
				aborted ? 'timeout' : 'network_error',
			);
			return { ok: false, error, retryAfterMs: undefined, retryable: true };
		}
		clearTimeout(timeoutId);

		if (response.ok) {
			this.#fireHook(this.#onResponse, {
				status: response.status,
				requestId: response.headers.get('x-request-id') ?? undefined,
				durationMs: Date.now() - t0,
			});
			return { ok: true, response };
		}

		const requestId = response.headers.get('x-request-id') ?? undefined;
		const retryable = response.status >= 500 || response.status === 429;
		const retryAfterMs = retryable
			? parseRetryAfter(response.headers.get('retry-after'))
			: undefined;

		const errorBody = await response.text();
		const { code, message } = parseErrorBody(errorBody, response.status);
		const error = new PoliPageError(message, code, response.status, requestId);

		return { ok: false, error, retryAfterMs, retryable };
	}

	#sleep(ms: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, ms);
			if (signal) {
				const onAbort = () => {
					clearTimeout(timer);
					reject(new PoliPageError('Request was aborted', 'aborted'));
				};
				if (signal.aborted) {
					onAbort();
				} else {
					signal.addEventListener('abort', onAbort, { once: true });
				}
			}
		});
	}
```

- [ ] **Step 2.3: Run lint, typecheck, and the full unit suite**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all 50+ existing tests pass. Pay particular attention to:
- `'calls onRequest with method, url, attempt'` — `onRequest` fires from `#sendOnce` per attempt
- `'calls onResponse with status, requestId, durationMs'` — `onResponse` fires only on `response.ok`
- `'calls onRetry with attempt, delayMs, reason on retried failures'` — `onRetry` fires from `#runWithRetry` before each sleep
- `'calls onError with the thrown PoliPageError when call fails terminally'` — `onError` fires once on terminal failure
- `'aborts in-flight request when caller signal is aborted'` — caller-abort throws from inside `#sendOnce`'s catch block
- `'rejects immediately if signal is already aborted before call'` — pre-flight check in `#runWithRetry`
- `'reuses the same Idempotency-Key across retry attempts of one call'` — key generated once in `#request`, threaded through

If any test fails, the most likely cause is misordered hook firing or `attempt + 1` arithmetic being off by one. Compare side-by-side with the original `#request` body (git diff against `HEAD~1`).

- [ ] **Step 2.4: Commit**

```bash
git add src/index.ts
git commit -m "$(cat <<'EOF'
refactor: split #request into #sendOnce + #runWithRetry

Decompose the ~110-line #request method into a thin orchestrator
(#request: idempotency-key generation + delegate), a loop
(#runWithRetry: backoff, hook firing, terminal error), and a single
attempt (#sendOnce: fetch + timeout + abort + error parsing).
#sendOnce returns a tagged union so the loop can decide retry
without exception-as-control-flow. Caller-aborts still throw to
short-circuit the loop. No behavior change.

EOF
)"
```

---

## Task 3: Make the main entry truly isomorphic (`fix:` commit)

**Files:**
- Create: `tests/isomorphism.test.ts`
- Modify: `src/index.ts` (remove `node:crypto` import, replace `randomUUID()` call)
- Modify: `CHANGELOG.md`

The v1 design (§2) claims main entry is isomorphic. Today's `src/index.ts:8` imports from `node:crypto`, breaking on Cloudflare Workers and Vercel Edge. Fix is one import removal + one call-site change. Add a regression test that scans the source files for `node:*` imports.

- [ ] **Step 3.1: Write the failing isomorphism test**

Create `tests/isomorphism.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ISOMORPHIC_SOURCES = [
	'../src/index.ts',
	'../src/internal/http.ts',
	'../src/types.ts',
	'../src/error.ts',
];

describe('main entry is isomorphic', () => {
	for (const relativePath of ISOMORPHIC_SOURCES) {
		it(`${relativePath} contains no \`node:*\` imports`, () => {
			const source = readFileSync(resolve(__dirname, relativePath), 'utf-8');
			expect(source).not.toMatch(/from\s+['"]node:/);
		});
	}
});
```

- [ ] **Step 3.2: Run the new test to confirm it fails for the right reason**

Run: `pnpm test tests/isomorphism.test.ts`
Expected: `../src/index.ts contains no \`node:*\` imports` FAILS (because line 8 still has `import { randomUUID } from 'node:crypto'`). The other three files should already pass.

- [ ] **Step 3.3: Replace `node:crypto` import with `globalThis.crypto`**

In `src/index.ts`:

Remove the line:
```ts
import { randomUUID } from 'node:crypto';
```

In the `#request` method, replace:
```ts
		const idempotencyKey = callerIdempotencyKey ?? randomUUID();
```

with:
```ts
		const idempotencyKey = callerIdempotencyKey ?? globalThis.crypto.randomUUID();
```

- [ ] **Step 3.4: Run the isomorphism test to confirm it passes**

Run: `pnpm test tests/isomorphism.test.ts`
Expected: all four assertions PASS.

- [ ] **Step 3.5: Run the full unit suite**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all tests pass — including the existing `'auto-generates an Idempotency-Key header in UUID v4 format'` test (`globalThis.crypto.randomUUID()` returns a v4 UUID on Node ≥ 19).

- [ ] **Step 3.6: Add a CHANGELOG entry**

Edit `CHANGELOG.md`. Under the existing `## [Unreleased]` → `### Fixed` section (currently has two bullets at lines 36–38), append a third bullet:

```
- Main entry no longer imports from `node:crypto`. Idempotency-key generation now uses `globalThis.crypto.randomUUID()`, making the main entry truly isomorphic (Cloudflare Workers, Vercel Edge, Deno, Bun all supported).
```

- [ ] **Step 3.7: Commit**

```bash
git add src/index.ts tests/isomorphism.test.ts CHANGELOG.md
git commit -m "$(cat <<'EOF'
fix: use globalThis.crypto.randomUUID for isomorphic main entry

The main entry's job is to work on every JS runtime — that's what
justifies the Uint8Array return type and the @poli-page/sdk/node
sub-export. Importing from node:crypto silently broke Cloudflare
Workers, Vercel Edge, and Deno. Switch to globalThis.crypto.randomUUID()
which is available since Node 19 (engine floor is 20.18+).

Adds tests/isomorphism.test.ts as a regression guard that asserts
src/index.ts, src/internal/http.ts, src/types.ts, and src/error.ts
contain no node:* imports.

EOF
)"
```

---

## Task 4: Unit tests for `src/internal/http.ts`

**Files:**
- Create: `tests/internal/http.test.ts`

Pure-function tests for the four helpers. No HTTP server, no fetch mocking — fast and deterministic. The existing end-to-end suite in `tests/index.test.ts` already exercises these helpers transitively; this task adds direct coverage as belt-and-suspenders so future edits to a helper get caught at the lowest level.

- [ ] **Step 4.1: Create `tests/internal/http.test.ts` with the full test suite**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	parseRetryAfter,
	computeBackoff,
	parseErrorBody,
	buildHeaders,
} from '../../src/internal/http.js';

describe('parseRetryAfter', () => {
	it('returns undefined for null', () => {
		expect(parseRetryAfter(null)).toBeUndefined();
	});

	it('returns undefined for empty string', () => {
		expect(parseRetryAfter('')).toBeUndefined();
	});

	it('returns 0 for "0"', () => {
		expect(parseRetryAfter('0')).toBe(0);
	});

	it('returns 5000 for "5"', () => {
		expect(parseRetryAfter('5')).toBe(5000);
	});

	it('caps at 30000ms for very large second values', () => {
		expect(parseRetryAfter('999')).toBe(30_000);
		expect(parseRetryAfter('100000')).toBe(30_000);
	});

	it('returns undefined for non-numeric, non-date strings', () => {
		expect(parseRetryAfter('abc')).toBeUndefined();
		expect(parseRetryAfter('not a date')).toBeUndefined();
	});

	it('returns 0 for past HTTP-date', () => {
		const past = new Date(Date.now() - 60_000).toUTCString();
		expect(parseRetryAfter(past)).toBe(0);
	});

	it('returns ~delta milliseconds for a future HTTP-date', () => {
		const future = new Date(Date.now() + 5_000).toUTCString();
		const result = parseRetryAfter(future);
		expect(result).toBeGreaterThan(3_000);
		expect(result).toBeLessThanOrEqual(5_000);
	});

	it('caps a very-far-future HTTP-date at 30000ms', () => {
		const farFuture = new Date(Date.now() + 60 * 60_000).toUTCString();
		expect(parseRetryAfter(farFuture)).toBe(30_000);
	});
});

describe('computeBackoff', () => {
	beforeEach(() => {
		vi.spyOn(Math, 'random').mockReturnValue(0); // jitterFactor = 0.5
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns retryAfterMs as-is when defined (no jitter)', () => {
		expect(computeBackoff(1, 500, 1000)).toBe(1000);
		expect(computeBackoff(3, 500, 250)).toBe(250);
	});

	it('returns 0 when retryAfterMs is 0 (treats falsy 0 as defined)', () => {
		expect(computeBackoff(1, 500, 0)).toBe(0);
	});

	it('applies exponential backoff when retryAfterMs is undefined', () => {
		// jitterFactor = 0.5 (Math.random mocked to 0)
		expect(computeBackoff(1, 500, undefined)).toBe(250); // 500 * 1 * 0.5
		expect(computeBackoff(2, 500, undefined)).toBe(500); // 500 * 2 * 0.5
		expect(computeBackoff(3, 500, undefined)).toBe(1000); // 500 * 4 * 0.5
	});

	it('applies maximum jitter when Math.random returns 0.999...', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.999); // jitterFactor ≈ 1.499
		expect(computeBackoff(1, 500, undefined)).toBeCloseTo(750, -1);
	});

	it('jitter factor stays within [0.5, 1.5) for any Math.random output', () => {
		vi.restoreAllMocks();
		const samples: number[] = [];
		for (let i = 0; i < 200; i++) {
			samples.push(computeBackoff(1, 1000, undefined));
		}
		for (const d of samples) {
			expect(d).toBeGreaterThanOrEqual(500);
			expect(d).toBeLessThanOrEqual(1500);
		}
	});
});

describe('parseErrorBody', () => {
	it('extracts code and message from a complete JSON body', () => {
		const result = parseErrorBody(
			'{"code":"VALIDATION_ERROR","message":"data is required"}',
			400,
		);
		expect(result).toEqual({ code: 'VALIDATION_ERROR', message: 'data is required' });
	});

	it('falls back to message as code when code is absent', () => {
		const result = parseErrorBody('{"message":"something broke"}', 400);
		expect(result).toEqual({ code: 'something broke', message: 'something broke' });
	});

	it('falls back to error field as code when code and message absent', () => {
		const result = parseErrorBody('{"error":"oops"}', 400);
		expect(result).toEqual({ code: 'oops', message: 'API error (400): oops' });
	});

	it('returns unknown_error code when JSON has no recognised fields', () => {
		const result = parseErrorBody('{}', 400);
		expect(result).toEqual({
			code: 'unknown_error',
			message: 'API error (400): unknown_error',
		});
	});

	it('returns INTERNAL_ERROR when body is not valid JSON', () => {
		const result = parseErrorBody('not json', 502);
		expect(result).toEqual({
			code: 'INTERNAL_ERROR',
			message: 'API error 502: response body was not valid JSON',
		});
	});

	it('returns INTERNAL_ERROR for HTML error pages', () => {
		const result = parseErrorBody('<html>upstream gone</html>', 502);
		expect(result.code).toBe('INTERNAL_ERROR');
		expect(result.message).toContain('502');
	});

	it('returns INTERNAL_ERROR for empty body', () => {
		const result = parseErrorBody('', 500);
		expect(result.code).toBe('INTERNAL_ERROR');
	});
});

describe('buildHeaders', () => {
	const ua = 'poli-page-sdk-node/1.0.0';

	it('sets Accept: application/pdf for /v1/render/pdf', () => {
		const h = buildHeaders('/v1/render/pdf', 'pp_test_x', 'idem-1', ua);
		expect(h.Accept).toBe('application/pdf');
	});

	it('sets Accept: application/json for /v1/render/preview', () => {
		const h = buildHeaders('/v1/render/preview', 'pp_test_x', 'idem-1', ua);
		expect(h.Accept).toBe('application/json');
	});

	it('sets Accept: application/json for /v1/render/thumbnails', () => {
		const h = buildHeaders('/v1/render/thumbnails', 'pp_test_x', 'idem-1', ua);
		expect(h.Accept).toBe('application/json');
	});

	it('always sets Content-Type: application/json', () => {
		const h = buildHeaders('/v1/render/pdf', 'pp_test_x', 'idem-1', ua);
		expect(h['Content-Type']).toBe('application/json');
	});

	it('sets Authorization with Bearer prefix', () => {
		const h = buildHeaders('/v1/render/pdf', 'pp_test_xyz', 'idem-1', ua);
		expect(h.Authorization).toBe('Bearer pp_test_xyz');
	});

	it('sets the supplied User-Agent verbatim', () => {
		const h = buildHeaders('/v1/render/pdf', 'pp_test_x', 'idem-1', 'custom-ua/9.9.9');
		expect(h['User-Agent']).toBe('custom-ua/9.9.9');
	});

	it('sets the Idempotency-Key header from the argument', () => {
		const h = buildHeaders('/v1/render/pdf', 'pp_test_x', 'idem-abc-123', ua);
		expect(h['Idempotency-Key']).toBe('idem-abc-123');
	});
});
```

- [ ] **Step 4.2: Run the new test file to confirm it passes**

Run: `pnpm test tests/internal/http.test.ts`
Expected: all helper tests PASS.

- [ ] **Step 4.3: Run the full unit suite (sanity)**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: full suite green (existing tests + isomorphism tests + new helper tests).

- [ ] **Step 4.4: Commit**

```bash
git add tests/internal/http.test.ts
git commit -m "$(cat <<'EOF'
test: unit tests for src/internal/http.ts helpers

Direct coverage for parseRetryAfter (seconds, HTTP-date, past, cap,
garbage, null), computeBackoff (exponential, jitter range, retry-after
override, falsy-0), parseErrorBody (JSON code/message/error, malformed,
HTML, empty), and buildHeaders (path-driven Accept, Bearer, UA pass-through,
idempotency key).

EOF
)"
```

---

## Final Verification

After all four commits:

- [ ] **Run the full test matrix**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: clean lint, clean typecheck, all unit tests pass — including the existing 50+ in `tests/index.test.ts`, the four new `tests/isomorphism.test.ts` cases, and the helper tests in `tests/internal/http.test.ts`.

- [ ] **Run integration tests if `POLI_PAGE_API_KEY` is set**

```bash
POLI_PAGE_API_KEY=pp_test_... pnpm test:integration
```

Expected: 4 integration tests pass against `https://api-develop.poli.page`.

- [ ] **Inspect the diff against the pre-refactor commit**

```bash
git log --oneline HEAD~4..HEAD
git diff HEAD~4 -- src/index.ts | wc -l
git diff HEAD~4 -- src/internal/http.ts | wc -l
```

Expected: 4 commits (`refactor:`, `refactor:`, `fix:`, `test:`); `src/index.ts` shrinks substantially; `src/internal/http.ts` is the new ~70-line helper module.

- [ ] **Verify the line-count goal**

```bash
wc -l src/index.ts src/internal/http.ts
```

Expected: `src/index.ts` ≈ 140 lines, `src/internal/http.ts` ≈ 70 lines.

---

## Self-Review Notes

- **Spec coverage**: every section of the spec maps to a task. §4.1 helpers → Task 1. §4.2 `#sendOnce` + §4.3 `#runWithRetry` + §4.4 `#request` thin → Task 2. §6 isomorphism fix → Task 3. §4.1 helper tests (deferred per §5 plan) → Task 4. §5 file layout reflected in the File Structure section above.
- **Type consistency**: `SendOnceResult` defined once in Task 2.1, referenced in Task 2.2. `parseRetryAfter`, `computeBackoff`, `parseErrorBody`, `buildHeaders` signatures defined in Task 1.1, called consistently in Task 1.3, 1.4, 1.5 (replacements in `index.ts`) and Task 2.2 (the new `#sendOnce`).
- **Behavior preservation**: each refactor step is paired with a "run the suite" gate. The isomorphism test in Task 3 explicitly catches `node:*` regressions across all four isomorphic source files (`src/index.ts`, `src/internal/http.ts`, `src/types.ts`, `src/error.ts`).
- **No placeholders**: all code blocks contain the exact code to be written. All commands are runnable as-is.
