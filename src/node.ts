import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';
import type { PoliPage } from './index.js';
<<<<<<< HEAD
import type { ProjectModeInput } from './types.js';
=======
import type { RenderInput } from './types.js';
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17

/**
 * Render a PDF and write it to disk. Streams response bytes directly to the
 * file (memory-bounded). Creates parent directories. Overwrites existing files.
 *
 * Node-only — uses `node:fs/promises` and `node:fs`. Import from
 * `@poli-page/sdk/node` rather than the main entry.
 *
 * @example
 * ```ts
 * import { PoliPage } from '@poli-page/sdk';
 * import { renderToFile } from '@poli-page/sdk/node';
 *
 * const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });
 * await renderToFile(
 *   client,
 *   { project: 'billing', template: 'invoice', data: { invoiceNumber: 'INV-001' } },
 *   './invoices/INV-001.pdf',
 * );
 * ```
 */
export async function renderToFile(
	client: PoliPage,
<<<<<<< HEAD
	input: ProjectModeInput,
	outputPath: string,
): Promise<void> {
	await mkdir(dirname(outputPath), { recursive: true });
	const stream = await client.render.pdfStream(input);
=======
	input: RenderInput,
	outputPath: string,
): Promise<void> {
	await mkdir(dirname(outputPath), { recursive: true });
	const stream = await client.renderStream(input);
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
	const fileStream = createWriteStream(outputPath);
	await stream.pipeTo(Writable.toWeb(fileStream) as WritableStream<Uint8Array>);
}
