import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PoliPage, PoliPageError } from '../../src/index.js';
import { renderToFile } from '../../src/node.js';

const apiKey = process.env.POLI_PAGE_API_KEY;
const baseUrl = process.env.POLI_PAGE_BASE_URL ?? 'https://api.poli.page';

// Integration tests render the `getting-started` project's `welcome` template,
// published into every organization's sandbox environment — works out of the
// box with a sandbox key of a fresh organization. Override via env vars to
// point at a project published in your key's environment.
const project = process.env.POLI_PAGE_TEST_PROJECT ?? 'getting-started';
const template = process.env.POLI_PAGE_TEST_TEMPLATE ?? 'welcome';

const describeIfKey = apiKey ? describe : describe.skip;

describeIfKey('integration: API', () => {
	it('renders a real PDF (project mode, %PDF magic bytes, > 1KB)', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });
		const pdf = await client.render.pdf({
			project, template,
			data: { name: 'Integration Test' },
		});
		expect(pdf).toBeInstanceOf(Uint8Array);
		expect(pdf.length).toBeGreaterThan(1000);
		expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');
	});

	it('bad API key produces PoliPageError with status 401', async () => {
		const client = new PoliPage({ apiKey: 'pp_sandbox_00000000000000000000000000000000', baseUrl, maxRetries: 0 });
		try {
			await client.render.pdf({ project, template, data: {} });
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
			await renderToFile(
				client,
				{ project, template, data: { name: 'renderToFile' } },
				out,
			);
			const s = await stat(out);
			expect(s.size).toBeGreaterThan(1000);
			const content = await readFile(out);
			expect(new TextDecoder().decode(content.subarray(0, 4))).toBe('%PDF');
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it('render.document stores a PDF and returns a descriptor with downloadable bytes', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });
		const doc = await client.render.document({
			project, template,
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
});
