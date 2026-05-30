// Demonstrates: client.render.pdf(input) — project mode only.
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

const pdf = await client.render.pdf({
  project: 'billing',
  template: 'invoice',
  data: { invoiceNumber: 'INV-001', total: 1280 },
});

// `pdf` is a Uint8Array of PDF bytes.
console.log(`Rendered ${pdf.byteLength} bytes`);
