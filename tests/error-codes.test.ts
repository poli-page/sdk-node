import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { PoliPage, PoliPageError } from '../src/index.js';

let server: Server;
let baseUrl: string;
let mockHandler: (req: IncomingMessage, res: ServerResponse) => void;

function setMockHandler(handler: typeof mockHandler) {
	mockHandler = handler;
}

beforeAll(async () => {
	mockHandler = (_req, res) => {
		res.writeHead(500);
		res.end();
	};
	server = createServer((req, res) => {
		req.resume();
		req.on('end', () => mockHandler(req, res));
	});
	await new Promise<void>((resolve) => server.listen(0, () => resolve()));
	const addr = server.address();
	if (typeof addr === 'object' && addr) baseUrl = `http://localhost:${addr.port}`;
});

afterEach(() => {
	mockHandler = (_req, res) => {
		res.writeHead(500);
		res.end();
	};
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Helper: assert that calling `invoke` against a mock server that answers
 * with the API's error body `{ error, detail, requestId }` surfaces the code
 * and detail verbatim on the thrown PoliPageError, with the HTTP status and
 * the x-request-id header.
 */
async function expectCode(opts: {
	status: number;
	code: string;
	invoke: (client: PoliPage) => Promise<unknown>;
}) {
	setMockHandler((_req, res) => {
		res.writeHead(opts.status, {
			'Content-Type': 'application/json',
			'x-request-id': 'req_test_42',
		});
		res.end(
			JSON.stringify({ error: opts.code, detail: `Synthetic ${opts.code}`, requestId: 'req_test_42' }),
		);
	});
	const client = new PoliPage({ apiKey: 'pp_sandbox_abc', baseUrl, maxRetries: 0 });
	await expect(opts.invoke(client)).rejects.toMatchObject({
		name: 'PoliPageError',
		code: opts.code,
		status: opts.status,
		requestId: 'req_test_42',
		message: `Synthetic ${opts.code}`,
	});
	// And it's actually a PoliPageError:
	try {
		await opts.invoke(client);
	} catch (err) {
		expect(err).toBeInstanceOf(PoliPageError);
	}
}

const render = (c: PoliPage) => c.render.pdf({ project: 'p', template: 't', data: {} });

describe('API error code propagation', () => {
	it.each([
		[403, 'ORGANIZATION_CANCELLED'],
		[410, 'ORGANIZATION_PURGED'],
		[403, 'ORGANIZATION_PAYMENT_GRACE'],
		[503, 'ORGANIZATION_MIGRATING'],
		[403, 'ENVIRONMENT_PROTECTED'],
		[400, 'ENVIRONMENT_MISMATCH'],
		[404, 'PROJECT_NOT_FOUND'],
		[404, 'PROJECT_NOT_IN_ENVIRONMENT'],
		[404, 'ENVIRONMENT_NOT_FOUND'],
		[404, 'TEMPLATE_NOT_FOUND'],
		[400, 'TEMPLATE_ERROR'],
		[400, 'TEMPLATE_UNSAFE'],
		[400, 'EMPTY_DOCUMENT'],
		[400, 'PROJECT_REQUIRED_FOR_DOCUMENT'],
		[413, 'RENDER_BODY_TOO_LARGE'],
		[413, 'DOCUMENT_TOO_LARGE'],
		[429, 'QUOTA_EXCEEDED'],
		[429, 'OVERAGE_CAP_EXCEEDED'],
		[429, 'RATE_LIMIT_EXCEEDED'],
		[500, 'RENDERING_ENGINE_ERROR'],
		[500, 'TEMPLATE_HTML_MISSING'],
		[500, 'STORAGE_ERROR'],
		[502, 'STORAGE_ACCESS_DENIED'],
		[503, 'PUBLISH_IN_PROGRESS'],
		[504, 'RENDER_TIMEOUT'],
	])('propagates %i %s from render.pdf', async (status, code) => {
		await expectCode({ status, code, invoke: render });
	});

	it('propagates DOCUMENT_NOT_FOUND (404) from documents.get', async () => {
		await expectCode({
			status: 404,
			code: 'DOCUMENT_NOT_FOUND',
			invoke: (c) => c.documents.get('doc_missing'),
		});
	});

	it('propagates DOCUMENT_GONE (410) from documents.get on a deleted document', async () => {
		await expectCode({
			status: 410,
			code: 'DOCUMENT_GONE',
			invoke: (c) => c.documents.get('doc_deleted'),
		});
	});

	it.each([
		[400, 'MISSING_ORG_CONTEXT'],
		[403, 'NOT_A_MEMBER'],
		[426, 'CLIENT_VERSION_UNSUPPORTED'],
	])('propagates %i %s from documents.get', async (status, code) => {
		await expectCode({ status, code, invoke: (c) => c.documents.get('doc_abc') });
	});

	it('propagates THUMBNAILS_NOT_AVAILABLE (403) from documents.thumbnails', async () => {
		await expectCode({
			status: 403,
			code: 'THUMBNAILS_NOT_AVAILABLE',
			invoke: (c) => c.documents.thumbnails('doc_abc'),
		});
	});

	it('surfaces a 404 { error: TEMPLATE_NOT_FOUND, detail } with the detail as message', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					error: 'TEMPLATE_NOT_FOUND',
					detail: 'Template "does-not-exist" not found in project "getting-started"',
					requestId: 'req_tpl',
				}),
			);
		});
		const client = new PoliPage({ apiKey: 'pp_sandbox_abc', baseUrl });
		await expect(
			client.render.pdf({ project: 'getting-started', template: 'does-not-exist', data: {} }),
		).rejects.toMatchObject({
			name: 'PoliPageError',
			code: 'TEMPLATE_NOT_FOUND',
			status: 404,
			message: 'Template "does-not-exist" not found in project "getting-started"',
		});
	});

	it.each([
		[400, 'MISSING_ORG_CONTEXT'],
		[403, 'NOT_A_MEMBER'],
		[404, 'ENVIRONMENT_NOT_FOUND'],
		[426, 'CLIENT_VERSION_UNSUPPORTED'],
		[400, 'TEMPLATE_UNSAFE'],
	])('does not retry %i %s', async (status, code) => {
		let attempts = 0;
		setMockHandler((_req, res) => {
			attempts++;
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: code, detail: `Synthetic ${code}`, requestId: 'req_nr' }));
		});
		const client = new PoliPage({ apiKey: 'pp_sandbox_abc', baseUrl, maxRetries: 2, retryDelay: 1 });
		const err: unknown = await render(client).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(PoliPageError);
		expect((err as PoliPageError).isRetryable()).toBe(false);
		expect(attempts).toBe(1);
	});

	it.each([
		[500, 'RENDERING_ENGINE_ERROR'],
		[500, 'TEMPLATE_HTML_MISSING'],
		[500, 'STORAGE_ERROR'],
	])('retries %i %s, then surfaces it once retries are exhausted', async (status, code) => {
		let attempts = 0;
		setMockHandler((_req, res) => {
			attempts++;
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: code, detail: `Synthetic ${code}`, requestId: 'req_r' }));
		});
		const client = new PoliPage({ apiKey: 'pp_sandbox_abc', baseUrl, maxRetries: 2, retryDelay: 1 });
		const err: unknown = await render(client).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(PoliPageError);
		expect((err as PoliPageError).code).toBe(code);
		expect((err as PoliPageError).isRetryable()).toBe(true);
		expect(attempts).toBe(3);
	});

	it('passes an unknown code through verbatim', async () => {
		await expectCode({ status: 409, code: 'SOMETHING_THE_SDK_HAS_NEVER_SEEN', invoke: render });
	});
});

describe('renders during a publish', () => {
	it('retries 503 PUBLISH_IN_PROGRESS after Retry-After, then surfaces it once retries are exhausted', async () => {
		let attempts = 0;
		setMockHandler((_req, res) => {
			attempts++;
			res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1' });
			res.end(
				JSON.stringify({
					error: 'PUBLISH_IN_PROGRESS',
					detail: 'A publish is in progress for this project',
					requestId: 'req_pub',
				}),
			);
		});
		const delays: number[] = [];
		const client = new PoliPage({
			apiKey: 'pp_sandbox_abc',
			baseUrl,
			maxRetries: 1,
			retryDelay: 10_000,
			onRetry: (e) => delays.push(e.delayMs),
		});
		const t0 = Date.now();
		await expect(render(client)).rejects.toMatchObject({
			name: 'PoliPageError',
			code: 'PUBLISH_IN_PROGRESS',
			status: 503,
		});
		expect(attempts).toBe(2);
		expect(delays).toEqual([1000]);
		expect(Date.now() - t0).toBeGreaterThanOrEqual(950);
	});

	it('succeeds when the publish ends before retries are exhausted', async () => {
		let attempts = 0;
		setMockHandler((req, res) => {
			if (req.url?.startsWith('/presigned/')) {
				res.writeHead(200, { 'Content-Type': 'application/pdf' });
				res.end(Buffer.from('%PDF-1.4 ok'));
				return;
			}
			attempts++;
			if (attempts === 1) {
				res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0' });
				res.end(JSON.stringify({ error: 'PUBLISH_IN_PROGRESS', requestId: 'req_pub' }));
				return;
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					documentId: 'doc_1', organizationId: 'org', projectId: 'p', projectSlug: 'p',
					templateId: 't', templateSlug: 't', environment: 'sandbox', apiKeyId: 'k',
					format: 'A4', orientation: 'portrait', locale: null, pageCount: 1, sizeBytes: 1,
					createdAt: 'now', metadata: {}, presignedPdfUrl: `${baseUrl}/presigned/ok.pdf`,
					expiresAt: 'later',
				}),
			);
		});
		const client = new PoliPage({ apiKey: 'pp_sandbox_abc', baseUrl });
		const pdf = await render(client);
		expect(attempts).toBe(2);
		expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');
	});
});
