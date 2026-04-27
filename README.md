# Poli Page SDK for Node.js

[![npm version](https://img.shields.io/npm/v/@poli-page/sdk.svg)](https://www.npmjs.com/package/@poli-page/sdk)
[![CI](https://github.com/poli-page/sdk-node/actions/workflows/ci.yml/badge.svg)](https://github.com/poli-page/sdk-node/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@poli-page/sdk.svg)](LICENSE)
[![node](https://img.shields.io/node/v/@poli-page/sdk.svg)](https://nodejs.org/)

Official Node.js SDK for [Poli Page](https://poli.page) — render polished PDFs from HTML templates via the Poli Page API.

→ Full SDK reference: **https://docs-develop.poli.page/reference/sdk**

## Install

```bash
npm install @poli-page/sdk
# or
pnpm add @poli-page/sdk
```

Requires Node.js 20.18 or later.

## Quick start

### Project mode — render a published template by slug

```ts
import { PoliPage } from '@poli-page/sdk';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });

const pdf = await client.render({
  project: 'billing',
  template: 'invoice',
  data: { invoiceNumber: 'INV-001', total: 1280 },
});
// pdf is a Uint8Array
```

### Inline mode — pass raw HTML

```ts
const pdf = await client.render({
  template: '<h1>Hello {{ name }}</h1>',
  data: { name: 'World' },
});
```

### Write a PDF to disk

```ts
import { PoliPage } from '@poli-page/sdk';
import { renderToFile } from '@poli-page/sdk/node';

const client = new PoliPage({ apiKey: process.env.POLI_PAGE_API_KEY! });
await renderToFile(
  client,
  { project: 'billing', template: 'invoice', data: { invoiceNumber: 'INV-001' } },
  './invoices/INV-001.pdf',
);
```

`renderToFile` streams response bytes directly to disk (bounded memory).

### Stream — for large PDFs or piping to S3 / HTTP responses

```ts
const stream = await client.renderStream({
  project: 'billing',
  template: 'invoice',
  data: { ... },
});
// stream is a ReadableStream<Uint8Array>
await s3.upload({ Bucket: 'invoices', Key: 'INV-001.pdf', Body: stream }).promise();
```

## Authentication & environments

The mode is determined by the API key prefix:

- `pp_test_…` → sandbox mode (not billed, generous rate limits)
- `pp_live_…` → live mode (billed, production rate limits)

Both prefixes hit the same endpoint (`https://api.poli.page`).

For the develop environment:
```ts
const client = new PoliPage({
  apiKey: process.env.POLI_PAGE_API_KEY!,
  baseUrl: 'https://api-develop.poli.page',
});
```

## Methods

| Method | Returns | Description |
| ------ | ------- | ----------- |
| `render(input)` | `Promise<Uint8Array>` | Render a PDF, return bytes |
| `renderStream(input)` | `Promise<ReadableStream<Uint8Array>>` | Render and stream the response |
| `preview(input)` | `Promise<{ html, totalPages }>` | Paginated HTML preview |
| `thumbnails(input, options)` | `Promise<Thumbnail[]>` | Page thumbnails as base64 images |
| `renderToFile(client, input, path)` *(from `@poli-page/sdk/node`)* | `Promise<void>` | Render a PDF and stream it to disk |

## Configuration

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `apiKey` | string | (required) | `pp_test_*` or `pp_live_*` API key |
| `baseUrl` | string | `https://api.poli.page` | API base URL |
| `maxRetries` | number | 2 | Max retry attempts on retryable errors |
| `retryDelay` | number (ms) | 500 | Base delay before the first retry |
| `timeout` | number (ms) | 60000 | Per-request timeout |
| `onRequest` | function | — | Called before each HTTP attempt |
| `onResponse` | function | — | Called on each successful response |
| `onRetry` | function | — | Called when a retry is scheduled |
| `onError` | function | — | Called when a call terminates in error |

## Error handling

The SDK throws a single error type, `PoliPageError`, for every failure (API errors, network failures, timeouts, caller cancellation):

```ts
import { PoliPage, PoliPageError } from '@poli-page/sdk';

try {
  await client.render({ ... });
} catch (err) {
  if (err instanceof PoliPageError) {
    if (err.isAuthError())       return refreshCredentials();
    if (err.isRateLimitError())  return queueForLater();
    if (err.isValidationError()) console.error('Bad input:', err.message);
    if (err.isNetworkError())    console.error('Network/timeout');
    if (err.isRetryable())       /* SDK already retried up to maxRetries */;
    console.error(err.code, err.status, err.requestId);
  }
  throw err;
}
```

→ Full error reference: https://docs-develop.poli.page/reference/sdk#errors

## Cancellation

Pass an `AbortSignal` to cancel a render in flight:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

const pdf = await client.render({ ..., signal: controller.signal });
```

When the signal aborts, the SDK throws `PoliPageError` with `code: 'aborted'`.

## Observability

Hooks fire at well-defined points. They are sync, optional, and never break the request:

```ts
const client = new PoliPage({
  apiKey: process.env.POLI_PAGE_API_KEY!,
  onRequest:  ({ method, url, attempt })           => log.debug({ method, url, attempt }),
  onResponse: ({ status, requestId, durationMs })  => metrics.histogram('poli.duration', durationMs),
  onRetry:    ({ attempt, delayMs, reason })       => log.warn(`retry ${attempt} after ${delayMs}ms: ${reason.code}`),
  onError:    (err)                                => sentry.captureException(err),
});
```

## Retries & idempotency

The SDK retries on **5xx**, **429**, **network errors**, and **timeouts**. Backoff is exponential (`retryDelay × 2^N`) with jitter, capped by `Retry-After` when the server provides it. Every call sends an auto-generated `Idempotency-Key` (UUID v4); pass `idempotencyKey` in the input to override.

→ Full retry semantics: https://docs-develop.poli.page/reference/sdk#retries

## TypeScript

Full type definitions ship with the package. `RenderInput` is a discriminated union — invalid combos (e.g. `project` without `template`) fail at compile time.

## Requirements

Node.js 20.18 or later.

## Documentation & support

- API reference: [docs.poli.page](https://docs.poli.page)
- SDK reference (develop): [docs-develop.poli.page/reference/sdk](https://docs-develop.poli.page/reference/sdk)
- Sign up & generate API keys: [app.poli.page](https://app.poli.page)
- Issues: [github.com/poli-page/sdk-node/issues](https://github.com/poli-page/sdk-node/issues)
- Security: see [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE) © Poli Page
