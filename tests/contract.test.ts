/**
 * Conformance with the Poli Page API contract (https://github.com/poli-page/api-contract).
 *
 * CI copies the pinned `contract.json` with the `poli-page/api-contract` action and sets
 * `POLI_CONTRACT` to its path. Every `kind: 'sdk'` case runs against a local HTTP server that
 * answers the case's `responses` in order and records each request; the test then compares the
 * recorded requests, the `onRequest` / `onRetry` events and the normalized result with the
 * case's `expect`. Timing is checked as lower bounds, measured on the server.
 *
 * `contract-skip.json` maps the case ids allowed to fail to the reason. A listed case that
 * passes, or a listed id the contract does not have, fails the run.
 *
 * Locally: `POLI_CONTRACT=/path/to/contract.json npm test`. Without it the suite is skipped,
 * except in CI, where a missing contract is an error.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { PoliPage, PoliPageError, type RenderInput } from '../src/index.js';

// ---------------------------------------------------------------------------
// Contract format 1 (README of poli-page/api-contract)
// ---------------------------------------------------------------------------

const KNOWN_FORMAT_VERSION = 1;

/** The client's key when a case sets no `apiKey` (the contract's `{{apiKey}}`). */
const TEST_API_KEY = 'pp_sandbox_00000000000000000000000000000000';

/** Every case is given this long; the slowest (two 1 s Retry-After waits) takes about 2 s. */
const CASE_TIMEOUT_MS = 20_000;

interface ClientOptions {
	maxRetries: number;
	retryDelayMs: number;
	timeoutMs: number;
}

interface SdkCall {
	method: string;
	args: readonly unknown[];
	cancelAfterMs?: number;
}

interface MockResponse {
	status: number;
	headers?: Readonly<Record<string, string>>;
	json?: unknown;
	text?: string;
	base64?: string;
}

interface MockFault {
	fault: 'drop' | 'hang';
}

type MockStep = MockResponse | MockFault;

interface ExpectedRequest {
	method: string;
	path: string;
	auth: 'bearer' | 'none';
	idempotencyKey: 'stable' | 'absent';
	json?: unknown;
	minGapMsBefore?: number;
}

type Delay = number | { min: number; max: number };

type ExpectedEvent =
	| { type: 'request'; attempt: number }
	| { type: 'retry'; attempt: number; delayMs: Delay };

interface NormalizedError {
	code: string;
	status: number | null;
	message: string;
	requestId: string | null;
	retryable: boolean;
	isAuthError: boolean;
	isRateLimitError: boolean;
	isValidationError: boolean;
	isNetworkError: boolean;
}

type NormalizedResult = { ok: true; value: unknown } | { ok: false; error: NormalizedError };

interface SdkCase {
	kind: 'sdk';
	id: string;
	title: string;
	requires?: string;
	apiKey?: string;
	options: ClientOptions;
	call: SdkCall;
	responses: readonly MockStep[];
	expect: {
		requests: readonly ExpectedRequest[];
		events: readonly ExpectedEvent[];
		result: NormalizedResult;
	};
	stopAfterRetryEvents?: number;
}

interface ContractCase {
	kind: string;
	id: string;
}

interface Policy {
	cancellationSdks: readonly string[];
	normalizations: readonly { id: string; text: string }[];
}

interface Contract {
	formatVersion: number;
	policy: Policy;
	cases: readonly ContractCase[];
}

function isSdkCase(c: ContractCase): c is SdkCase {
	return c.kind === 'sdk';
}

function loadContract(path: string): Contract {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
	if (typeof parsed !== 'object' || parsed === null || !('formatVersion' in parsed)) {
		throw new Error(`${path} is not a contract.json: it has no formatVersion`);
	}
	if (parsed.formatVersion !== KNOWN_FORMAT_VERSION) {
		throw new Error(
			`contract.json formatVersion ${String(parsed.formatVersion)} is not supported ` +
				`(this test reads format ${KNOWN_FORMAT_VERSION}): update tests/contract.test.ts`,
		);
	}
	return parsed as Contract;
}

function loadSkipList(): Readonly<Record<string, string>> {
	const parsed: unknown = JSON.parse(
		readFileSync(new URL('./contract-skip.json', import.meta.url), 'utf8'),
	);
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('tests/contract-skip.json must be an object of case id to reason');
	}
	const skip: Record<string, string> = {};
	for (const [id, reason] of Object.entries(parsed as Record<string, unknown>)) {
		if (typeof reason !== 'string' || reason.trim() === '') {
			throw new Error(`tests/contract-skip.json: "${id}" needs a reason`);
		}
		skip[id] = reason;
	}
	return skip;
}

// ---------------------------------------------------------------------------
// Normalizations (policy.normalizations): the only rewrites applied to a native result
// ---------------------------------------------------------------------------

/** The normalization ids this file applies; each must be listed in the contract's policy. */
const NORMALIZATIONS_USED = [
	'N-STATUS-NULL',
	'N-REQID-NULL',
	'N-BYTES',
	'N-DELETE-NULL',
	'N-THUMBS-ARRAY',
	'N-PREVIEW',
	'N-DESCRIPTOR',
	'N-DURATION-MS',
] as const;

/** sdk-specification.md §7.1: the descriptor fields (N-DESCRIPTOR). */
const DESCRIPTOR_FIELDS = [
	'documentId',
	'organizationId',
	'projectId',
	'projectSlug',
	'templateId',
	'templateSlug',
	'environment',
	'apiKeyId',
	'format',
	'orientation',
	'locale',
	'pageCount',
	'sizeBytes',
	'createdAt',
	'metadata',
	'presignedPdfUrl',
	'expiresAt',
] as const;

/** N-DESCRIPTOR. */
function descriptor(value: object): Record<string, unknown> {
	const source = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const field of DESCRIPTOR_FIELDS) {
		if (field in source) out[field] = source[field];
	}
	return out;
}

/** N-BYTES. */
function bytes(data: Uint8Array): { sha256: string; length: number } {
	return { sha256: createHash('sha256').update(data).digest('hex'), length: data.length };
}

/** N-STATUS-NULL, N-REQID-NULL; anything that is not a PoliPageError shows up in the diff. */
function normalizeError(err: unknown): NormalizedError {
	if (err instanceof PoliPageError) {
		return {
			code: err.code,
			status: err.status ?? null,
			message: err.message,
			requestId: err.requestId ?? null,
			retryable: err.isRetryable(),
			isAuthError: err.isAuthError(),
			isRateLimitError: err.isRateLimitError(),
			isValidationError: err.isValidationError(),
			isNetworkError: err.isNetworkError(),
		};
	}
	return {
		code: 'not a PoliPageError',
		status: null,
		message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
		requestId: null,
		retryable: false,
		isAuthError: false,
		isRateLimitError: false,
		isValidationError: false,
		isNetworkError: false,
	};
}

// ---------------------------------------------------------------------------
// Placeholders: {{mock}}, {{apiKey}}, {{httpDate+N}}
// ---------------------------------------------------------------------------

function substitute(value: unknown, mock: string): unknown {
	if (typeof value === 'string') {
		return value.replace(/\{\{([^}]*)\}\}/g, (_match, name: string) => {
			if (name === 'mock') return mock;
			if (name === 'apiKey') return TEST_API_KEY;
			const date = /^httpDate\+(\d+)$/.exec(name);
			if (date) {
				// An HTTP-date has whole seconds: round to the nearest one.
				const at = Date.now() + Number(date[1]) * 1000;
				return new Date(Math.round(at / 1000) * 1000).toUTCString();
			}
			throw new Error(`Unknown contract placeholder {{${name}}}`);
		});
	}
	if (Array.isArray(value)) return value.map((item) => substitute(item, mock));
	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, substitute(item, mock)]),
		);
	}
	return value;
}

// ---------------------------------------------------------------------------
// Mock server
// ---------------------------------------------------------------------------

interface RecordedRequest {
	method: string;
	path: string;
	headers: IncomingMessage['headers'];
	body: string;
	/** performance.now() when the request reached the server. */
	at: number;
}

interface MockServer {
	origin: string;
	requests: RecordedRequest[];
	close(): Promise<void>;
}

function answer(res: ServerResponse, step: MockResponse, origin: string): void {
	const headers = substitute(step.headers ?? {}, origin) as Record<string, string>;
	const hasHeader = (name: string) =>
		Object.keys(headers).some((key) => key.toLowerCase() === name);
	let body: string | Buffer | undefined;
	if (step.json !== undefined) {
		body = JSON.stringify(substitute(step.json, origin));
		if (!hasHeader('content-type')) headers['content-type'] = 'application/json';
	} else if (step.text !== undefined) {
		body = step.text;
	} else if (step.base64 !== undefined) {
		body = Buffer.from(step.base64, 'base64');
	}
	res.writeHead(step.status, headers);
	res.end(body);
}

async function startMockServer(steps: readonly MockStep[]): Promise<MockServer> {
	const requests: RecordedRequest[] = [];
	let origin = '';
	const server = createServer((req, res) => {
		const at = performance.now();
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
		req.on('end', () => {
			requests.push({
				method: req.method ?? '',
				path: req.url ?? '',
				headers: req.headers,
				body: Buffer.concat(chunks).toString('utf8'),
				at,
			});
			const step = steps[requests.length - 1];
			if (step === undefined) {
				// More requests than the case has answers: make it visible in the diff.
				answer(res, { status: 599, json: { error: 'MOCK_EXHAUSTED' } }, origin);
			} else if ('fault' in step) {
				if (step.fault === 'drop') req.socket.destroy();
				// 'hang': never answer.
			} else {
				answer(res, step, origin);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	origin = `http://127.0.0.1:${port}`;
	return {
		origin,
		requests,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

// ---------------------------------------------------------------------------
// Calling the SDK
// ---------------------------------------------------------------------------

function stringArg(args: readonly unknown[], index: number): string {
	const value = args[index];
	if (typeof value !== 'string') throw new Error(`call.args[${index}] must be a string`);
	return value;
}

function objectArg(args: readonly unknown[], index: number): object | undefined {
	const value = args[index];
	if (value === undefined) return undefined;
	if (typeof value !== 'object' || value === null) {
		throw new Error(`call.args[${index}] must be an object`);
	}
	return value;
}

/** Calls `call.method` and returns its normalized value. */
async function invoke(
	client: PoliPage,
	call: SdkCall,
	signal: AbortSignal | undefined,
): Promise<unknown> {
	const { args } = call;
	switch (call.method) {
		case 'render.pdf': {
			const input = objectArg(args, 0) as RenderInput;
			return bytes(await client.render.pdf({ ...input, signal }));
		}
		case 'render.pdfStream': {
			const input = objectArg(args, 0) as RenderInput;
			const stream = await client.render.pdfStream({ ...input, signal });
			return bytes(new Uint8Array(await new Response(stream).arrayBuffer()));
		}
		case 'render.document': {
			const input = objectArg(args, 0) as RenderInput;
			return descriptor(await client.render.document({ ...input, signal }));
		}
		case 'documents.get':
			return descriptor(await client.documents.get(stringArg(args, 0), { signal }));
		case 'documents.preview': {
			// N-PREVIEW
			const { html, pageCount } = await client.documents.preview(stringArg(args, 0), {
				signal,
			});
			return { html, pageCount };
		}
		case 'documents.thumbnails':
			// N-THUMBS-ARRAY: the SDK already returns the unwrapped array.
			return await client.documents.thumbnails(
				stringArg(args, 0),
				objectArg(args, 1),
				{ signal },
			);
		case 'documents.delete':
			// N-DELETE-NULL
			await client.documents.delete(stringArg(args, 0), { signal });
			return null;
		default:
			throw new Error(`Unknown SDK method in the contract: ${call.method}`);
	}
}

// ---------------------------------------------------------------------------
// Running and comparing one case
// ---------------------------------------------------------------------------

type ActualEvent =
	| { type: 'request'; attempt: number }
	| { type: 'retry'; attempt: number; delayMs: number };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function header(req: RecordedRequest, name: string): string | undefined {
	const value = req.headers[name];
	return Array.isArray(value) ? value.join(', ') : value;
}

/**
 * The recorded requests in the shape of `expect.requests`. A field that breaks the expectation
 * keeps the observed value, so the diff shows it.
 */
function describeRequests(
	recorded: readonly RecordedRequest[],
	expected: readonly ExpectedRequest[],
	apiKey: string,
): unknown[] {
	let firstKey: string | undefined;
	return recorded.map((req, i) => {
		const want = expected[i];
		const authorization = header(req, 'authorization');
		const auth =
			authorization === undefined
				? 'none'
				: authorization === `Bearer ${apiKey}`
					? 'bearer'
					: `unexpected Authorization: ${authorization}`;
		const key = header(req, 'idempotency-key');
		let idempotencyKey: string;
		if (key === undefined) {
			idempotencyKey = 'absent';
		} else if (!UUID_V4.test(key)) {
			idempotencyKey = `not a lowercase UUID v4: ${key}`;
		} else {
			firstKey ??= key;
			idempotencyKey = key === firstKey ? 'stable' : `changed: ${firstKey} then ${key}`;
		}
		const out: Record<string, unknown> = {
			method: req.method,
			path: req.path,
			auth,
			idempotencyKey,
		};
		if (want !== undefined && 'json' in want) {
			try {
				out.json = JSON.parse(req.body) as unknown;
			} catch {
				out.json = `body is not JSON: ${req.body}`;
			}
		}
		if (want?.minGapMsBefore !== undefined) {
			const previous = recorded[i - 1];
			const gap = previous === undefined ? 0 : req.at - previous.at;
			out.minGapMsBefore =
				gap >= want.minGapMsBefore ? want.minGapMsBefore : `only ${gap.toFixed(1)} ms`;
		}
		return out;
	});
}

/** The observed events, with a delay inside an expected range shown as that range. */
function describeEvents(
	actual: readonly ActualEvent[],
	expected: readonly ExpectedEvent[],
): unknown[] {
	return actual.map((event, i) => {
		const want = expected[i];
		if (
			event.type === 'retry' &&
			want?.type === 'retry' &&
			typeof want.delayMs === 'object' &&
			event.delayMs >= want.delayMs.min &&
			event.delayMs < want.delayMs.max
		) {
			return { ...event, delayMs: want.delayMs };
		}
		return event;
	});
}

/** Expectations cut at the `stopAfterRetryEvents`-th retry event, when the case sets one. */
function expectedPrefix(c: SdkCase): {
	events: readonly ExpectedEvent[];
	requests: readonly ExpectedRequest[];
	checkResult: boolean;
} {
	const stop = c.stopAfterRetryEvents;
	if (stop === undefined) {
		return { events: c.expect.events, requests: c.expect.requests, checkResult: true };
	}
	let retries = 0;
	const end = c.expect.events.findIndex(
		(event) => event.type === 'retry' && ++retries === stop,
	);
	if (end === -1) throw new Error(`stopAfterRetryEvents ${stop}: the case has fewer retries`);
	const events = c.expect.events.slice(0, end + 1);
	const attempts = events.filter((event) => event.type === 'request').length;
	return { events, requests: c.expect.requests.slice(0, attempts), checkResult: false };
}

async function runCase(c: SdkCase): Promise<void> {
	if (c.requires !== undefined && c.requires !== 'cancellation') {
		throw new Error(`Unknown case requirement: ${c.requires}`);
	}
	const server = await startMockServer(c.responses);
	const apiKey = c.apiKey ?? TEST_API_KEY;
	const events: ActualEvent[] = [];
	const needsSignal = c.call.cancelAfterMs !== undefined || c.stopAfterRetryEvents !== undefined;
	const controller = needsSignal ? new AbortController() : undefined;
	let cancelTimer: ReturnType<typeof setTimeout> | undefined;
	let retries = 0;
	let result: NormalizedResult;
	try {
		const client = new PoliPage({
			apiKey,
			baseUrl: server.origin,
			maxRetries: c.options.maxRetries,
			retryDelay: c.options.retryDelayMs,
			timeout: c.options.timeoutMs,
			onRequest: (e) => events.push({ type: 'request', attempt: e.attempt }),
			onRetry: (e) => {
				// N-DURATION-MS: Node durations are already integer milliseconds.
				events.push({ type: 'retry', attempt: e.attempt, delayMs: e.delayMs });
				retries += 1;
				if (retries === c.stopAfterRetryEvents) controller?.abort();
			},
		});
		if (c.call.cancelAfterMs !== undefined) {
			cancelTimer = setTimeout(() => controller?.abort(), c.call.cancelAfterMs);
		}
		result = { ok: true, value: await invoke(client, c.call, controller?.signal) };
	} catch (err) {
		result = { ok: false, error: normalizeError(err) };
	} finally {
		clearTimeout(cancelTimer);
		await server.close();
	}

	const want = expectedPrefix(c);
	const mock = server.origin;
	expect(describeRequests(server.requests, want.requests, apiKey), 'requests').toEqual(
		substitute(want.requests, mock),
	);
	expect(describeEvents(events, want.events), 'onRequest / onRetry events').toEqual(want.events);
	if (want.checkResult) {
		expect(result, 'result').toEqual(substitute(c.expect.result, mock));
	}
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const contractPath = process.env.POLI_CONTRACT;

if (!contractPath) {
	if (process.env.CI) {
		describe('API contract', () => {
			it('POLI_CONTRACT is set', () => {
				throw new Error(
					'POLI_CONTRACT is not set: in CI the "API contract" step must provide ' +
						'contract.json (poli-page/api-contract action, output `path`)',
				);
			});
		});
	} else {
		describe.skip('API contract (skipped: set POLI_CONTRACT to a contract.json path)', () => {
			it('runs the contract cases', () => {});
		});
	}
} else {
	const contract = loadContract(contractPath);
	const skip = loadSkipList();
	const sdkCases = contract.cases.filter(isSdkCase);
	const runsCancellation = contract.policy.cancellationSdks.includes('node');

	describe('API contract', () => {
		it('applies only the normalizations the contract allows', () => {
			const allowed = contract.policy.normalizations.map((n) => n.id);
			const disallowed = NORMALIZATIONS_USED.filter((id) => !allowed.includes(id));
			expect(disallowed, 'normalizations the contract no longer allows').toEqual([]);
		});

		it('contract-skip.json lists only cases of the contract', () => {
			const known = new Set(sdkCases.map((c) => c.id));
			const unknown = Object.keys(skip).filter((id) => !known.has(id));
			expect(unknown, 'ids the contract does not have: remove them from contract-skip.json').toEqual(
				[],
			);
		});

		for (const c of sdkCases) {
			if (c.requires === 'cancellation' && !runsCancellation) {
				it.skip(`${c.id} (the contract does not list node as supporting cancellation)`, () => {});
				continue;
			}
			const reason = skip[c.id];
			if (reason === undefined) {
				it(c.id, () => runCase(c), CASE_TIMEOUT_MS);
				continue;
			}
			it(
				`${c.id} (expected to fail: ${reason})`,
				async () => {
					let failed = false;
					try {
						await runCase(c);
					} catch {
						failed = true;
					}
					if (!failed) {
						throw new Error(`${c.id} passes now: remove it from tests/contract-skip.json`);
					}
				},
				CASE_TIMEOUT_MS,
			);
		}
	});
}
