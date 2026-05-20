# Cloudflare Workers demo

Exercises every public method of the SDK from inside a Cloudflare Worker and renders an HTML report with the results. The worker has **no `nodejs_compat` flag** — every API the SDK touches (`fetch`, `ReadableStream`, `AbortSignal`, `globalThis.crypto`) is part of the Web Platform standard, so the same code runs on Workers, Vercel Edge, Deno Deploy, and Bun without changes.

The report covers:

| Step | Method | What you see |
|---|---|---|
| 1 | `render.pdf()` | byte count + download link to the PDF |
| 2 | `render.pdfStream()` | byte count + download link |
| 3 | `render.document()` | `documentId` of the stored document + presigned PDF link |
| 4 | `documents.preview(id)` | inline iframe rendering the stored document's HTML |
| 5 | error handling | a deliberate 400, caught and inspected |

The independent calls (`render.pdf`, `render.pdfStream`, `render.document`, and the deliberate-error call) run in parallel via `Promise.allSettled`. The `documents.preview(id)` call necessarily waits for `render.document` to land first (it needs the id). `renderToFile` is intentionally absent — it's a Node-only sub-export and would defeat the point of an edge-runtime demo.

## Run

```bash
cd demo/edge/cloudflare-worker
npm install
npm run dev
```

That single command:
1. Resolves `POLI_PAGE_API_KEY` from `process.env` or `.env` at the SDK repo root. Prompts on first run and saves the answer to `.env` so the next run is silent.
2. Starts `wrangler dev` on `localhost:8787`, passing the key as a CLI binding (`--var POLI_PAGE_API_KEY:…`). There's no `.dev.vars` file in this project — the key resolution lives in `demo/_shared.mjs`, shared with the Node demos.
3. Auto-opens the report page in your default browser as soon as the worker is ready.

You'll see the report page with all five steps inline. The fact that `wrangler dev` boots without a `nodejs_compat` warning is the proof that the SDK is genuinely isomorphic.

## Deploy (optional)

```bash
wrangler secret put POLI_PAGE_API_KEY
npm run deploy
```
