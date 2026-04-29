# Changelog

All notable changes to `@poli-page/sdk` (Node.js) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Breaking changes between major versions are summarized in [MIGRATION.md](MIGRATION.md).

## [Unreleased]

### Added
- `renderStream(input)` returning a `ReadableStream<Uint8Array>` for memory-bounded rendering of large PDFs.
- Per-call `signal?: AbortSignal` option for caller cancellation. Aborted requests throw `PoliPageError` with `code: 'aborted'`.
- Per-call `idempotencyKey?: string` option. The SDK auto-generates a UUID v4 key for every call (reused across retries) — override only when needed.
- Observability hooks: `onRequest`, `onResponse`, `onRetry`, `onError` in `PoliPageOptions`.
- Helper predicates on `PoliPageError`: `isAuthError()`, `isRateLimitError()`, `isValidationError()`, `isNetworkError()`, `isRetryable()`.
- `User-Agent` header (`poli-page-sdk-node/<version>`) and `Accept` header (`application/pdf` or `application/json`) sent per spec §8.1.
- Sub-export `@poli-page/sdk/node` exposing `renderToFile(client, input, path)` — Node-only, streams response bytes directly to disk.
- Honors the `Retry-After` response header (seconds or HTTP-date), capped at 30 s. No jitter applied when `Retry-After` is present.
- Retries on `429 Too Many Requests` in addition to 5xx.
- Jitter applied to exponential backoff (`× [0.5, 1.5]`) when `Retry-After` is absent.
- Dual ESM + CJS build via `tsup`. `package.json` declares `sideEffects: false` for tree-shaking.
- ESLint flat config + Prettier; pre-push hook runs lint, typecheck, and unit + integration tests.
- Integration test suite (`tests/integration/`) hits the develop API; gated by `POLI_PAGE_API_KEY`.

### Changed
- **BREAKING**: `render()` returns `Promise<Uint8Array>` (was `Promise<Buffer>`). Use `Buffer.from(uint8)` if a Node `Buffer` is specifically needed.
- **BREAKING**: `RenderInput` is now a discriminated union (`ProjectModeInput | InlineModeInput`). Invalid combos fail at compile time.
- **BREAKING**: `renderToFile` moved out of the `PoliPage` class. Import from `@poli-page/sdk/node`:
  ```ts
  import { renderToFile } from '@poli-page/sdk/node';
  await renderToFile(client, input, './out.pdf');
  ```
- Constructor now throws `PoliPageError` with `code: 'invalid_options'` (was `'invalid_api_key'`) when `apiKey` is missing.
- Minimum supported Node.js version is now 20.18 (was 22.13).

### Fixed
- Non-2xx response bodies that are not JSON now produce `PoliPageError` with `code: 'INTERNAL_ERROR'` and the HTTP status, instead of stuffing the raw body into the `code` field.
- 2xx PDF responses with a non-`application/pdf` Content-Type now throw `PoliPageError` instead of returning whatever bytes the server sent.
- Main entry no longer imports from `node:crypto`. Idempotency-key generation now uses `globalThis.crypto.randomUUID()`, making the main entry truly isomorphic (Cloudflare Workers, Vercel Edge, Deno, Bun all supported).

## [0.1.0] - 2026-04-26

### Added
- Initial repository scaffolding: `package.json`, TypeScript and Vitest config,
  MIT license, README, contributor-friendly file layout.
- Public type definitions: `PoliPageOptions`, `RenderInput`, `PreviewResult`,
  `Thumbnail`, `ThumbnailOptions`, and the typed `PoliPageError` class with
  `code`, `status`, and `requestId` fields.
- Strongly-typed `PageFormat` union covering all 12 canonical Poli Page
  formats (`A3`, `A4`, `A5`, `A6`, `B4`, `B5`, `Letter`, `Legal`, `Tabloid`,
  `Executive`, `Statement`, `Folio`) and `Orientation` union.
- Full HTTP transport for the four `PoliPage` methods (`render`,
  `renderToFile`, `preview`, `thumbnails`) using the global `fetch` API with
  Bearer authentication.
- Per-request `timeout` option (default 60s) backed by `AbortController`.
- Retry policy with exponential backoff: retries only on 5xx and network
  errors, never on 4xx; capped by `maxRetries` (default 2).
- Capture of `x-request-id` response header on errors for support and
  debugging.
- Test suite mirrors the platform spec: constructor, render, renderToFile,
  preview, thumbnails, retry logic, and request-id propagation.
