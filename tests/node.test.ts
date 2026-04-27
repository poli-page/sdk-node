import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PoliPage } from '../src/index.js';
import { renderToFile } from '../src/node.js';

let server: Server;
let baseUrl: string;
let tempDir: string;

beforeAll(async () => {
	server = createServer((_req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/pdf' });
		res.end(Buffer.from('%PDF-1.4 stream test'));
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
		await renderToFile(client, { template: '<p>x</p>', data: {} }, out);
		const content = await readFile(out);
		expect(new TextDecoder().decode(content.subarray(0, 4))).toBe('%PDF');
		expect(content.length).toBeGreaterThan(0);
	});

	it('creates parent directories that do not exist', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		const out = join(tempDir, 'nested', 'deeply', 'b.pdf');
		await renderToFile(client, { template: '<p>x</p>', data: {} }, out);
		const s = await stat(out);
		expect(s.isFile()).toBe(true);
	});

	it('overwrites existing files', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		const out = join(tempDir, 'c.pdf');
		await renderToFile(client, { template: '<p>x</p>', data: {} }, out);
		const first = (await stat(out)).size;
		await renderToFile(client, { template: '<p>x</p>', data: {} }, out);
		const second = (await stat(out)).size;
		expect(second).toBe(first);
	});
});
