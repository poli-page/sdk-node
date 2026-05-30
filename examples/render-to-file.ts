// Demonstrates: renderToFile(client, input, outputPath) from @poli-page/sdk/node.
import { PoliPage } from '@poli-page/sdk';
import { renderToFile } from '@poli-page/sdk/node';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

await renderToFile(
  client,
  {
    project: 'billing',
    template: 'invoice',
    data: { invoiceNumber: 'INV-001', total: 1280 },
  },
  './invoices/INV-001.pdf',
);

// Streams response bytes directly to disk with bounded memory.
// Parent directories are created automatically.
console.log('Wrote ./invoices/INV-001.pdf');
