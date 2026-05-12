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
 * Helper: assert that calling `invoke` against a mock server that returns
 * the given (status, code, message) surfaces those fields verbatim on the
 * thrown PoliPageError, including x-request-id propagation.
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
		res.end(JSON.stringify({ code: opts.code, message: `Synthetic ${opts.code}` }));
	});
	const client = new PoliPage({ apiKey: 'pp_test_abc', baseUrl, maxRetries: 0 });
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

describe('spec §7.2 error code propagation', () => {
	it('propagates STORAGE_REQUIRED (403) from render.document on Free tier', async () => {
		await expectCode({
			status: 403,
			code: 'STORAGE_REQUIRED',
			invoke: (c) => c.render.document({ template: '<p>x</p>', data: {} }),
		});
	});

	it('propagates PAYMENT_REQUIRED (402)', async () => {
		await expectCode({
			status: 402,
			code: 'PAYMENT_REQUIRED',
			invoke: (c) => c.render.pdf({ template: '<p>x</p>', data: {} }),
		});
	});

	it('propagates ORGANIZATION_CANCELLED (403)', async () => {
		await expectCode({
			status: 403,
			code: 'ORGANIZATION_CANCELLED',
			invoke: (c) => c.render.pdf({ template: '<p>x</p>', data: {} }),
		});
	});

	it('propagates ORGANIZATION_PURGED (410)', async () => {
		await expectCode({
			status: 410,
			code: 'ORGANIZATION_PURGED',
			invoke: (c) => c.render.pdf({ template: '<p>x</p>', data: {} }),
		});
	});

	it('propagates DOCUMENT_NOT_FOUND (404) from documents.get', async () => {
		await expectCode({
			status: 404,
			code: 'DOCUMENT_NOT_FOUND',
			invoke: (c) => c.documents.get('doc_missing'),
		});
	});

	it('propagates GONE (410) from documents.get on a soft-deleted document', async () => {
		await expectCode({
			status: 410,
			code: 'GONE',
			invoke: (c) => c.documents.get('doc_deleted'),
		});
	});

	it('propagates QUOTA_EXCEEDED (429) on Free monthly limit', async () => {
		await expectCode({
			status: 429,
			code: 'QUOTA_EXCEEDED',
			invoke: (c) => c.render.pdf({ template: '<p>x</p>', data: {} }),
		});
	});

	it('propagates OVERAGE_CAP_EXCEEDED (429) on paid overage cap', async () => {
		await expectCode({
			status: 429,
			code: 'OVERAGE_CAP_EXCEEDED',
			invoke: (c) => c.render.pdf({ template: '<p>x</p>', data: {} }),
		});
	});

	it('propagates INVALID_VERSION_FORMAT (400) on bad version string', async () => {
		await expectCode({
			status: 400,
			code: 'INVALID_VERSION_FORMAT',
			invoke: (c) => c.render.pdf({
				project: 'p', template: 't', version: 'latest', data: {},
			}),
		});
	});

	it('propagates VERSION_REQUIRED (400) on live key without version', async () => {
		await expectCode({
			status: 400,
			code: 'VERSION_REQUIRED',
			invoke: (c) => c.render.pdf({ project: 'p', template: 't', data: {} }),
		});
	});

	it('propagates INVALID_VERSION_FOR_KEY_ENV (400)', async () => {
		await expectCode({
			status: 400,
			code: 'INVALID_VERSION_FOR_KEY_ENV',
			invoke: (c) => c.render.pdf({
				project: 'p', template: 't', version: '1.0.0', data: {},
			}),
		});
	});
});
