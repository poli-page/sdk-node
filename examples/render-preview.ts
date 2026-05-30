// Demonstrates: client.render.preview(input) — accepts project mode OR inline mode.
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

// Project mode: render the stored template's HTML preview.
const preview = await client.render.preview({
  project: 'billing',
  template: 'invoice',
  data: { invoiceNumber: 'INV-001', total: 1280 },
});

console.log(`Preview: ${preview.totalPages} pages, ${preview.environment} env`);
console.log(`HTML length: ${preview.html.length}`);
