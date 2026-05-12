import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { documentsGet, documentsPreview } from '../src/documents.js';
import type { SdkContext } from '../src/render.js';

let server: Server;
let baseUrl: string;
let lastRequest: { method: string; path: string; headers: Record<string, string>; body: string };
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
			mockHandler(req, res);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, () => resolve()));
	const addr = server.address();
	if (typeof addr === 'object' && addr) baseUrl = `http://localhost:${addr.port}`;
});

afterEach(() => {
	mockHandler = defaultHandler;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

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

describe('documentsGet', () => {
	it('GETs /v1/documents/:id and returns a descriptor', async () => {
		setMockHandler((req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					...sampleDescriptor,
					presignedPdfUrl: `${baseUrl}/presigned/doc_abc123.pdf`,
				}),
			);
		});
		const doc = await documentsGet(buildCtx(), 'doc_abc123');
		expect(lastRequest.method).toBe('GET');
		expect(lastRequest.path).toBe('/v1/documents/doc_abc123');
		expect(doc.documentId).toBe('doc_abc123');
		expect(doc.templateSlug).toBe('invoice');
	});

	it('sends no request body', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ...sampleDescriptor, presignedPdfUrl: 'http://x' }));
		});
		await documentsGet(buildCtx(), 'doc_abc123');
		expect(lastRequest.body).toBe('');
	});

	it('attaches a downloadPdf method on the returned descriptor', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({ ...sampleDescriptor, presignedPdfUrl: `${baseUrl}/presigned/x.pdf` }),
			);
		});
		const doc = await documentsGet(buildCtx(), 'doc_abc123');
		expect(typeof doc.downloadPdf).toBe('function');
	});

	it('downloadPdf fetches the fresh presignedPdfUrl', async () => {
		setMockHandler((req, res) => {
			if (req.url?.startsWith('/v1/documents/')) {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					JSON.stringify({ ...sampleDescriptor, presignedPdfUrl: `${baseUrl}/presigned/fresh.pdf` }),
				);
				return;
			}
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.end(Buffer.from('%PDF-1.4 fresh'));
		});
		const doc = await documentsGet(buildCtx(), 'doc_abc123');
		const pdf = await doc.downloadPdf();
		expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');
	});
});

describe('documentsPreview', () => {
	it('GETs /v1/documents/:id/preview and returns html + totalPages', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ html: '<p>stored preview</p>', totalPages: 4 }));
		});
		const result = await documentsPreview(buildCtx(), 'doc_abc123');
		expect(lastRequest.method).toBe('GET');
		expect(lastRequest.path).toBe('/v1/documents/doc_abc123/preview');
		expect(result.html).toBe('<p>stored preview</p>');
		expect(result.totalPages).toBe(4);
	});

	it('sends no request body', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ html: '<p>x</p>', totalPages: 1 }));
		});
		await documentsPreview(buildCtx(), 'doc_abc123');
		expect(lastRequest.body).toBe('');
	});

	it('encodes special characters in the document ID', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ html: '<p>x</p>', totalPages: 1 }));
		});
		await documentsPreview(buildCtx(), 'doc/with/slashes');
		expect(lastRequest.path).toBe('/v1/documents/doc%2Fwith%2Fslashes/preview');
	});
});
