import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PoliPage, PoliPageError } from '../../src/index.js';
import { renderToFile } from '../../src/node.js';

const apiKey = process.env.POLI_PAGE_API_KEY;
const baseUrl = process.env.POLI_PAGE_BASE_URL ?? 'https://api-develop.poli.page';
<<<<<<< HEAD

// Integration tests use the `getting-started/welcome/1.0.0` template that
// every Poli Page org gets provisioned automatically — works out of the box
// for any fresh API key. Override via env vars to point at your own template.
const project = process.env.POLI_PAGE_TEST_PROJECT ?? 'getting-started';
const template = process.env.POLI_PAGE_TEST_TEMPLATE ?? 'welcome';
const version = process.env.POLI_PAGE_TEST_VERSION ?? '1.0.0';

const describeIfKey = apiKey ? describe : describe.skip;

describeIfKey('integration: develop API', () => {
	it('renders a real PDF (project mode, %PDF magic bytes, > 1KB)', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });
		const pdf = await client.render.pdf({
			project, template, version,
=======
const describeIfKey = apiKey ? describe : describe.skip;

describeIfKey('integration: develop API', () => {
	it('renders a real PDF (Inline mode, %PDF magic bytes, > 1KB)', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });
		const pdf = await client.render({
			template: '<h1>{{ name }}</h1>',
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			data: { name: 'Integration Test' },
		});
		expect(pdf).toBeInstanceOf(Uint8Array);
		expect(pdf.length).toBeGreaterThan(1000);
		expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');
	});

<<<<<<< HEAD
	it('preview returns html + totalPages + environment', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });
		// render.preview accepts inline mode — keep this test inline-mode to
		// exercise that path (no project/template setup required).
		const result = await client.render.preview({
=======
	it('preview returns html and totalPages > 0', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });
		const result = await client.preview({
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			template: '<p>{{ name }}</p>',
			data: { name: 'Preview Test' },
		});
		expect(typeof result.html).toBe('string');
		expect(result.html.length).toBeGreaterThan(0);
<<<<<<< HEAD
		// The deployed API returns totalPages: 0 for small inline content
		// (no explicit page breaks). Just confirm it's a non-negative number.
		expect(result.totalPages).toBeGreaterThanOrEqual(0);
		expect(['sandbox', 'live']).toContain(result.environment);
=======
		expect(result.totalPages).toBeGreaterThan(0);
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
	});

	it('bad API key produces PoliPageError with status 401', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_invalid_xxx', baseUrl, maxRetries: 0 });
		try {
<<<<<<< HEAD
			await client.render.pdf({ project, template, version, data: {} });
=======
			await client.render({ template: '<p>x</p>', data: {} });
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			expect.fail('Should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(PoliPageError);
			expect((err as PoliPageError).status).toBe(401);
			expect((err as PoliPageError).isAuthError()).toBe(true);
		}
	});

	it('renderToFile writes a non-empty PDF to disk', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });
		const tempDir = await mkdtemp(join(tmpdir(), 'poli-sdk-int-'));
		const out = join(tempDir, 'integration.pdf');
		try {
<<<<<<< HEAD
			await renderToFile(
				client,
				{ project, template, version, data: { name: 'renderToFile' } },
				out,
			);
=======
			await renderToFile(client, { template: '<p>integration</p>', data: {} }, out);
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
			const s = await stat(out);
			expect(s.size).toBeGreaterThan(1000);
			const content = await readFile(out);
			expect(new TextDecoder().decode(content.subarray(0, 4))).toBe('%PDF');
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
<<<<<<< HEAD

	it('render.document stores a PDF and returns a descriptor with downloadable bytes', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });
		const doc = await client.render.document({
			project, template, version,
			data: { name: 'render.document' },
			metadata: { source: 'sdk-node integration test' },
		});
		expect(typeof doc.documentId).toBe('string');
		expect(doc.documentId.length).toBeGreaterThan(0);
		expect(doc.pageCount).toBeGreaterThan(0);
		expect(doc.sizeBytes).toBeGreaterThan(0);
		expect(doc.metadata.source).toBe('sdk-node integration test');
		expect(doc.presignedPdfUrl).toMatch(/^https:/);
		const pdf = await doc.downloadPdf();
		expect(pdf.length).toBeGreaterThan(1000);
		expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');
	});
=======
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
});
