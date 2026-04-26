# Poli Page SDK for Node.js

[![npm version](https://img.shields.io/npm/v/@poli-page/sdk.svg)](https://www.npmjs.com/package/@poli-page/sdk)
[![license](https://img.shields.io/npm/l/@poli-page/sdk.svg)](LICENSE)

Official Node.js SDK for [Poli Page](https://poli.page) — render polished PDF documents from HTML templates via the Poli Page API.

> **Status**: in active development. The package is not yet published on npm. The public surface in `src/index.ts` is the contract — implementation is in progress.

## Install

```bash
npm install @poli-page/sdk
# or
pnpm add @poli-page/sdk
```

Requires Node.js 22.13 or later.

## Quick start

```ts
import { PoliPage } from '@poli-page/sdk';
import { writeFile } from 'node:fs/promises';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

// Project mode: render a published template by slug
const pdf = await client.render({
    project: 'billing',
    template: 'invoice',
    data: { invoiceNumber: 'INV-001', items: [/* ... */] },
});
await writeFile('invoice.pdf', pdf);

// Or use the convenience helper:
await client.renderToFile(
    { project: 'billing', template: 'invoice', data: { /* ... */ } },
    './invoices/INV-001.pdf'
);
```

### Inline mode

For quick experiments and tests, pass raw HTML directly in `template`:

```ts
const pdf = await client.render({
    template: '<div class="poli-header">Hello</div><p>World</p>',
    data: { title: 'Demo' },
});
```

## Sandbox vs live

The mode is determined by the API key prefix:

- `pp_test_…` → sandbox mode (not billed, generous rate limits)
- `pp_live_…` → live mode (billed, production rate limits)

Both prefixes hit the same endpoint (`https://api.poli.page`).

## Configuration

| Option       | Default                  | Description                                       |
| ------------ | ------------------------ | ------------------------------------------------- |
| `apiKey`     | —                        | Required. `pp_test_*` or `pp_live_*` API key.     |
| `baseUrl`    | `https://api.poli.page`  | Override for develop or self-hosted.              |
| `maxRetries` | `2`                      | Maximum retry attempts on retryable errors.       |
| `retryDelay` | `500` ms                 | Base delay before the first retry.                |
| `timeout`    | `60000` ms (60 s)        | Per-request timeout.                              |

## Methods

| Method                            | Description                                   |
| --------------------------------- | --------------------------------------------- |
| `render(input)`                   | Render a PDF, return raw bytes.               |
| `renderToFile(input, path)`       | Render a PDF and write it to disk.            |
| `preview(input)`                  | Return paginated HTML and total page count.   |
| `thumbnails(input, options)`      | Generate page thumbnails as base64 images.    |

See `src/index.ts` for the full type definitions.

## Documentation

- API reference: [docs.poli.page](https://docs.poli.page)
- Sign up and create an API key: [app.poli.page](https://app.poli.page)

## License

[MIT](LICENSE) © Poli Page
