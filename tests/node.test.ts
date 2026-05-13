import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PoliPage } from '../src/index.js';
import { renderToFile } from '../src/node.js';

let server: Server;
let baseUrl: string;
let tempDir: string;

/**
 * Stub descriptor returned by the mock /v1/render endpoint, matching the
 * wire shape required by `RawDocumentDescriptor` in src/types.ts.
 */
const sampleDescriptor = {
	documentId: 'doc_node_x',
	organizationId: 'org_x',
	projectId: 'proj_p',
	projectSlug: 'p',
	templateId: 'tpl_t',
	templateSlug: 't',
	version: '1.0.0',
	environment: 'sandbox',
	apiKeyId: 'key_x',
	format: 'A4',
	orientation: 'portrait',
	locale: 'en-US',
	pageCount: 1,
	sizeBytes: 100,
	createdAt: '2026-01-01T00:00:00Z',
	metadata: {},
	expiresAt: '2026-01-01T00:15:00Z',
};

/**
 * Routes the two-call render flow. POST /v1/render returns a JSON descriptor
 * pointing at the same server's /presigned/* path, which returns PDF bytes.
 */
function defaultHandler(req: IncomingMessage, res: ServerResponse) {
	if (req.url === '/v1/render') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				...sampleDescriptor,
				presignedPdfUrl: `${baseUrl}/presigned/node.pdf`,
			}),
		);
		return;
	}
	if (req.url?.startsWith('/presigned/')) {
		res.writeHead(200, { 'Content-Type': 'application/pdf' });
		res.end(Buffer.from('%PDF-1.4 stream test'));
		return;
	}
	res.writeHead(404);
	res.end();
}

beforeAll(async () => {
	server = createServer((req, res) => {
		req.resume();
		req.on('end', () => defaultHandler(req, res));
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const addr = server.address();
	if (typeof addr === 'object' && addr) baseUrl = `http://localhost:${addr.port}`;
	tempDir = await mkdtemp(join(tmpdir(), 'poli-sdk-node-'));
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await rm(tempDir, { recursive: true, force: true });
});

describe('renderToFile (sub-export)', () => {
	it('writes a non-empty PDF to disk', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		const out = join(tempDir, 'a.pdf');
		await renderToFile(client, { project: 'p', template: 't', version: '1.0.0', data: {} }, out);
		const content = await readFile(out);
		expect(new TextDecoder().decode(content.subarray(0, 4))).toBe('%PDF');
		expect(content.length).toBeGreaterThan(0);
	});

	it('creates parent directories that do not exist', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		const out = join(tempDir, 'nested', 'deeply', 'b.pdf');
		await renderToFile(client, { project: 'p', template: 't', version: '1.0.0', data: {} }, out);
		const s = await stat(out);
		expect(s.isFile()).toBe(true);
	});

	it('overwrites existing files', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		const out = join(tempDir, 'c.pdf');
		await renderToFile(client, { project: 'p', template: 't', version: '1.0.0', data: {} }, out);
		const first = (await stat(out)).size;
		await renderToFile(client, { project: 'p', template: 't', version: '1.0.0', data: {} }, out);
		const second = (await stat(out)).size;
		expect(second).toBe(first);
	});
});
