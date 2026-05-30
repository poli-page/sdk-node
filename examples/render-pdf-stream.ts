// Demonstrates: client.render.pdfStream(input) — project mode only.
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

const stream = await client.render.pdfStream({
  project: 'billing',
  template: 'invoice',
  data: { invoiceNumber: 'INV-001', total: 1280 },
});

// Pipe directly to an HTTP response or upload destination — bounded memory.
// In a Fastify route handler:
//   return reply.send(stream);
const reader = stream.getReader();
const { value: firstChunk } = await reader.read();
console.log(`First chunk: ${firstChunk?.byteLength ?? 0} bytes`);
