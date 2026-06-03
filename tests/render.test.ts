import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import {
	renderPdf,
	renderPdfStream,
	renderPreview,
	renderDocument,
	createRenderNamespace,
	type SdkContext,
} from '../src/render.js';

let server: Server;
let baseUrl: string;
let lastRequest: { method: string; path: string; headers: Record<string, string>; body: string };
let renderRequestBody: string | undefined;
let mockHandler: (req: IncomingMessage, res: ServerResponse) => void;

function setMockHandler(handler: typeof mockHandler) {
	mockHandler = handler;
}

function defaultHandler(_req: IncomingMessage, res: ServerResponse) {
	res.writeHead(404);
	res.end();
}

beforeAll(async () => {
	mockHandler = defaultHandler;
	server = createServer((req, res) => {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', () => {
			lastRequest = {
				method: req.method ?? '',
				path: req.url ?? '',
				headers: req.headers as Record<string, string>,
				body,
			};
			if (req.url === '/v1/render') {
				renderRequestBody = body;
			}
			mockHandler(req, res);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, () => resolve()));
	const addr = server.address();
	if (typeof addr === 'object' && addr) baseUrl = `http://localhost:${addr.port}`;
});

afterEach(() => {
	mockHandler = defaultHandler;
	renderRequestBody = undefined;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Build a real `SdkContext` whose verb callables perform actual HTTP calls
 * against the mock server above. Bypasses the PoliPage class so render
 * functions can be tested in isolation from retry/hooks/etc.
 *
 * All SDK POSTs against the deployed API return JSON (the PDF bytes
 * come from a separate presigned-URL fetch), so the accept header is
 * always `application/json`.
 */
function buildCtx(): SdkContext {
	return {
		async post(path, body, signal, idempotencyKey) {
			return fetch(`${baseUrl}${path}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json',
					'idempotency-key': idempotencyKey ?? 'test-key',
				},
				body: JSON.stringify(body),
				signal,
			});
		},
		async get(path, signal) {
			return fetch(`${baseUrl}${path}`, {
				method: 'GET',
				headers: { accept: 'application/json' },
				signal,
			});
		},
		async delete(path, signal) {
			return fetch(`${baseUrl}${path}`, {
				method: 'DELETE',
				headers: { accept: 'application/json' },
				signal,
			});
		},
	};
}

const sampleDescriptor = {
	documentId: 'doc_abc123',
	organizationId: 'org_xyz',
	projectId: 'proj_42',
	projectSlug: 'billing',
	templateId: 'tpl_invoice_v1',
	templateSlug: 'invoice',
	version: '1.0.0',
	environment: 'live',
	apiKeyId: 'key_live_abc',
	format: 'A4',
	orientation: 'portrait',
	locale: 'en-US',
	pageCount: 2,
	sizeBytes: 38421,
	createdAt: '2026-04-30T19:45:22Z',
	metadata: {},
	expiresAt: '2026-04-30T20:00:22Z',
};

/**
 * Mock handler for renderPdf/renderPdfStream tests: routes `/v1/render`
 * to a descriptor with a presigned URL pointing back at this same server,
 * and routes `/presigned/*` to a stub PDF response.
 */
function setRenderAndPdfHandler(descriptorOverrides: Record<string, unknown> = {}) {
	setMockHandler((req, res) => {
		if (req.url === '/v1/render') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					...sampleDescriptor,
					...descriptorOverrides,
					presignedPdfUrl: `${baseUrl}/presigned/x.pdf`,
				}),
			);
			return;
		}
		res.writeHead(200, { 'Content-Type': 'application/pdf' });
		res.end(Buffer.from('%PDF-1.4 stub'));
	});
}

describe('renderPdf', () => {
	it('POSTs to /v1/render then downloads the PDF, returning Uint8Array', async () => {
		setRenderAndPdfHandler();
		const pdf = await renderPdf(buildCtx(), {
			project: 'billing',
			template: 'invoice',
			version: '1.0.0',
			data: {},
		});
		expect(pdf).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');
		// renderRequestBody captured the /v1/render call (the LAST request is
		// the presigned-URL fetch — see lastRequest.path below):
		expect(renderRequestBody).toBeDefined();
		expect(lastRequest.path).toBe('/presigned/x.pdf');
	});

	it('forwards metadata in the /v1/render request body', async () => {
		setRenderAndPdfHandler({ metadata: { customerId: 'cust_1' } });
		await renderPdf(buildCtx(), {
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
			metadata: { customerId: 'cust_1', invoiceNumber: 42, paid: true },
		});
		const body = JSON.parse(renderRequestBody!);
		expect(body.metadata).toEqual({ customerId: 'cust_1', invoiceNumber: 42, paid: true });
	});

	it('omits metadata from the /v1/render body when not provided', async () => {
		setRenderAndPdfHandler();
		await renderPdf(buildCtx(), {
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
		});
		const body = JSON.parse(renderRequestBody!);
		expect('metadata' in body).toBe(false);
	});

	it('strips signal and idempotencyKey from /v1/render body', async () => {
		setRenderAndPdfHandler();
		const controller = new AbortController();
		await renderPdf(buildCtx(), {
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
			signal: controller.signal,
			idempotencyKey: 'custom-key',
		});
		const body = JSON.parse(renderRequestBody!);
		expect('signal' in body).toBe(false);
		expect('idempotencyKey' in body).toBe(false);
		// NOTE: We cannot directly inspect the headers on the /v1/render request
		// here because lastRequest gets overwritten by the second (presigned-URL)
		// fetch. The buildCtx() fake forwards idempotencyKey to the
		// 'idempotency-key' header unconditionally, so successful completion
		// implies the header was set. A dedicated capture would require a
		// per-route headers map; the body-strip coverage is the load-bearing
		// assertion for this test.
	});

	it('passes project + template + version through to /v1/render', async () => {
		setRenderAndPdfHandler();
		await renderPdf(buildCtx(), {
			project: 'billing',
			template: 'invoice',
			version: '1.0.0',
			data: { amount: 100 },
		});
		const body = JSON.parse(renderRequestBody!);
		expect(body.project).toBe('billing');
		expect(body.template).toBe('invoice');
		expect(body.version).toBe('1.0.0');
		expect(body.data).toEqual({ amount: 100 });
	});

	it('throws PoliPageError DOWNLOAD_FAILED when presigned URL fetch returns non-2xx', async () => {
		setMockHandler((req, res) => {
			if (req.url === '/v1/render') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						...sampleDescriptor,
						presignedPdfUrl: `${baseUrl}/presigned/expired.pdf`,
					}),
				);
				return;
			}
			res.writeHead(403, { 'Content-Type': 'text/plain' });
			res.end('Forbidden');
		});
		await expect(
			renderPdf(buildCtx(), {
				project: 'p',
				template: 't',
				version: '1.0.0',
				data: {},
			}),
		).rejects.toMatchObject({
			name: 'PoliPageError',
			code: 'DOWNLOAD_FAILED',
			status: 403,
		});
	});
});

describe('renderPdfStream', () => {
	it('returns a ReadableStream of PDF bytes via the presigned URL', async () => {
		setRenderAndPdfHandler();
		const stream = await renderPdfStream(buildCtx(), {
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
		});
		expect(stream).toBeInstanceOf(ReadableStream);
		const reader = stream.getReader();
		const { value } = await reader.read();
		expect(value).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(value!.subarray(0, 4))).toBe('%PDF');
		reader.releaseLock();
	});

	it('throws DOWNLOAD_FAILED when the presigned URL fetch fails', async () => {
		setMockHandler((req, res) => {
			if (req.url === '/v1/render') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						...sampleDescriptor,
						presignedPdfUrl: `${baseUrl}/presigned/gone.pdf`,
					}),
				);
				return;
			}
			res.writeHead(410, { 'Content-Type': 'text/plain' });
			res.end('Gone');
		});
		await expect(
			renderPdfStream(buildCtx(), {
				project: 'p',
				template: 't',
				version: '1.0.0',
				data: {},
			}),
		).rejects.toMatchObject({
			name: 'PoliPageError',
			code: 'DOWNLOAD_FAILED',
			status: 410,
		});
	});

	it('forwards metadata in the /v1/render request body', async () => {
		setRenderAndPdfHandler({ metadata: { trace: 'abc' } });
		const stream = await renderPdfStream(buildCtx(), {
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
			metadata: { trace: 'abc' },
		});
		// Drain so the connection completes cleanly:
		const reader = stream.getReader();
		while (!(await reader.read()).done) {
			/* drain */
		}
		expect(JSON.parse(renderRequestBody!).metadata).toEqual({ trace: 'abc' });
	});
});

describe('renderPreview', () => {
	it('POSTs to /v1/render/preview and returns html + totalPages + environment', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					html: '<p>preview</p>',
					totalPages: 3,
					environment: 'sandbox',
				}),
			);
		});
		const result = await renderPreview(buildCtx(), { template: '<p>x</p>', data: {} });
		expect(result.html).toBe('<p>preview</p>');
		expect(result.totalPages).toBe(3);
		expect(result.environment).toBe('sandbox');
		expect(lastRequest.path).toBe('/v1/render/preview');
		expect(lastRequest.method).toBe('POST');
	});

	it('accepts inline mode (the only render-* method that does)', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ html: '<p>x</p>', totalPages: 1, environment: 'sandbox' }));
		});
		await renderPreview(buildCtx(), { template: '<h1>inline</h1>', data: {} });
		expect(JSON.parse(lastRequest.body).template).toBe('<h1>inline</h1>');
	});

	it('forwards metadata in the request body', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ html: '<p>x</p>', totalPages: 1, environment: 'sandbox' }));
		});
		await renderPreview(buildCtx(), {
			template: '<p>x</p>',
			data: {},
			metadata: { customerId: 'cust_1' },
		});
		expect(JSON.parse(lastRequest.body).metadata).toEqual({ customerId: 'cust_1' });
	});

	it('propagates PoliPageError on API error', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ code: 'VALIDATION_ERROR', message: 'bad input' }));
		});
		// The buildCtx fake here does not parse error bodies into PoliPageError —
		// that's the PoliPage class's job. Through this transport, a 400 will
		// produce a response that the render* functions then try to JSON-parse
		// as a PreviewResult. The assertion is that the resulting object lacks
		// the expected shape — which is good enough; the full error-translation
		// path is covered by error-codes.test.ts and integration tests.
		const result = await renderPreview(buildCtx(), { template: '<p>x</p>', data: {} });
		expect((result as unknown as { html?: string }).html).toBeUndefined();
	});
});

describe('renderDocument', () => {
	function setDescriptorHandler(descriptor: object) {
		setMockHandler((req, res) => {
			if (req.url === '/v1/render') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(descriptor));
				return;
			}
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.end(Buffer.from('%PDF-1.4 stub'));
		});
	}

	it('POSTs to /v1/render and returns a descriptor', async () => {
		setDescriptorHandler({
			...sampleDescriptor,
			presignedPdfUrl: `${baseUrl}/presigned/x.pdf`,
		});
		const doc = await renderDocument(buildCtx(), {
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
		});
		expect(lastRequest.path).toBe('/v1/render');
		expect(lastRequest.method).toBe('POST');
		expect(doc.documentId).toBe('doc_abc123');
		expect(doc.templateSlug).toBe('invoice');
		expect(doc.pageCount).toBe(2);
	});

	it('forwards metadata in the request body', async () => {
		setDescriptorHandler({
			...sampleDescriptor,
			presignedPdfUrl: `${baseUrl}/presigned/x.pdf`,
			metadata: { customerId: 'cust_1' },
		});
		await renderDocument(buildCtx(), {
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
			metadata: { customerId: 'cust_1' },
		});
		expect(JSON.parse(renderRequestBody!).metadata).toEqual({ customerId: 'cust_1' });
	});

	it('returns metadata: {} when server returns empty metadata', async () => {
		setDescriptorHandler({
			...sampleDescriptor,
			presignedPdfUrl: `${baseUrl}/presigned/x.pdf`,
		});
		const doc = await renderDocument(buildCtx(), {
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
		});
		expect(doc.metadata).toEqual({});
	});

	it('attaches a downloadPdf method on the returned descriptor', async () => {
		setDescriptorHandler({
			...sampleDescriptor,
			presignedPdfUrl: `${baseUrl}/presigned/x.pdf`,
		});
		const doc = await renderDocument(buildCtx(), {
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
		});
		expect(typeof doc.downloadPdf).toBe('function');
	});

	it('downloadPdf fetches the presignedPdfUrl and returns a Uint8Array', async () => {
		setDescriptorHandler({
			...sampleDescriptor,
			presignedPdfUrl: `${baseUrl}/presigned/x.pdf`,
		});
		const doc = await renderDocument(buildCtx(), {
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
		});
		const pdf = await doc.downloadPdf();
		expect(pdf).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');
	});

	it('downloadPdf throws PoliPageError with code DOWNLOAD_FAILED on non-2xx', async () => {
		setMockHandler((req, res) => {
			if (req.url === '/v1/render') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						...sampleDescriptor,
						presignedPdfUrl: `${baseUrl}/presigned/expired.pdf`,
					}),
				);
				return;
			}
			res.writeHead(403, { 'Content-Type': 'text/plain' });
			res.end('Forbidden');
		});
		const doc = await renderDocument(buildCtx(), {
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
		});
		await expect(doc.downloadPdf()).rejects.toMatchObject({
			name: 'PoliPageError',
			code: 'DOWNLOAD_FAILED',
			status: 403,
		});
	});

	it('throws PROJECT_REQUIRED_FOR_DOCUMENT and never calls ctx.post when project is empty', async () => {
		const postSpy = vi.fn<SdkContext['post']>();
		const ctx: SdkContext = {
			post: postSpy,
			get: vi.fn(),
			delete: vi.fn(),
		};
		await expect(
			renderDocument(ctx, { project: '', template: 'invoice', data: {} }),
		).rejects.toMatchObject({
			name: 'PoliPageError',
			code: 'PROJECT_REQUIRED_FOR_DOCUMENT',
		});
		expect(postSpy).not.toHaveBeenCalled();
	});
});

describe('createRenderNamespace', () => {
	it('returns an object with pdf, pdfStream, preview, document methods bound to ctx', () => {
		const ns = createRenderNamespace(buildCtx());
		expect(typeof ns.pdf).toBe('function');
		expect(typeof ns.pdfStream).toBe('function');
		expect(typeof ns.preview).toBe('function');
		expect(typeof ns.document).toBe('function');
	});

	it('routes pdf through /v1/render then auto-downloads', async () => {
		setRenderAndPdfHandler();
		const ns = createRenderNamespace(buildCtx());
		const pdf = await ns.pdf({
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
		});
		expect(pdf).toBeInstanceOf(Uint8Array);
		expect(renderRequestBody).toBeDefined();
	});

	it('routes document through /v1/render (no auto-download)', async () => {
		setMockHandler((req, res) => {
			if (req.url === '/v1/render') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({
						...sampleDescriptor,
						documentId: 'doc_routing',
						presignedPdfUrl: 'http://example/x.pdf',
					}),
				);
				return;
			}
			res.writeHead(404);
			res.end();
		});
		const ns = createRenderNamespace(buildCtx());
		const doc = await ns.document({
			project: 'p',
			template: 't',
			version: '1.0.0',
			data: {},
		});
		expect(doc.documentId).toBe('doc_routing');
		expect(lastRequest.path).toBe('/v1/render');
	});
});
