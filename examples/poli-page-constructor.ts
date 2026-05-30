// Demonstrates: new PoliPage(options) — the only entry point.
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({
  apiKey: process.env.POLI_PAGE_API_KEY!,
  timeout: 60_000,
  maxRetries: 2,
});

// The same `client` instance is reused for every render and document call.
void client;
