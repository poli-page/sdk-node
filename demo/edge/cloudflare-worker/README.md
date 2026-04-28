# Cloudflare Workers demo

Exercises every public method of the SDK from inside a Cloudflare Worker and renders an HTML report with the results. The worker has **no `nodejs_compat` flag** — every API the SDK touches (`fetch`, `ReadableStream`, `AbortSignal`, `globalThis.crypto`) is part of the Web Platform standard, so the same code runs on Workers, Vercel Edge, Deno Deploy, and Bun without changes.

The report covers:

| Step | Method | What you see |
|---|---|---|
| 1 | `render()` | byte count + download link to the PDF |
| 2 | `renderStream()` | byte count + download link |
| 3 | `renderToFile()` | skipped — Node-only sub-export |
| 4 | `preview()` | inline iframe rendering the engine's HTML |
| 5 | `thumbnails()` | grid of inline `<img>` page images |
| 6 | error handling | a deliberate 400, caught and inspected |

All five SDK calls run in parallel (`Promise.allSettled`) so the page renders in roughly the time of the slowest single call.

## Run

```bash
cd demo/edge/cloudflare-worker
pnpm install
pnpm run dev
```

That single command:
1. Prompts for an API key if `.dev.vars` doesn't have one (with full instructions on where to get one).
2. Starts `wrangler dev` on `localhost:8787`.
3. Auto-opens the report page in your default browser as soon as the worker is ready.

You'll see the report page with all six steps inline. The fact that `wrangler dev` boots without a `nodejs_compat` warning is the proof that the SDK is genuinely isomorphic.

## Deploy (optional)

```bash
wrangler secret put POLI_PAGE_API_KEY
pnpm run deploy
```
