import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';
import type { PoliPage } from './index.js';
import type { RenderInput } from './types.js';

/**
 * Render a PDF and write it to disk. Streams response bytes directly to the
 * file (memory-bounded). Creates parent directories. Overwrites existing files.
 *
 * Node-only — uses `node:fs/promises` and `node:fs`. Import from
 * `@poli-page/sdk/node` rather than the main entry.
 */
export async function renderToFile(
	client: PoliPage,
	input: RenderInput,
	outputPath: string,
): Promise<void> {
	await mkdir(dirname(outputPath), { recursive: true });
	const stream = await client.renderStream(input);
	const fileStream = createWriteStream(outputPath);
	await stream.pipeTo(Writable.toWeb(fileStream) as WritableStream<Uint8Array>);
}
