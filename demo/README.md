# `@poli-page/sdk` — runnable demos

Small, self-contained programs that exercise the SDK end-to-end against a real Poli Page API. Each demo walks through every public method of the SDK with comments explaining what each call does and when you'd use it. Use them as a learning tool, a smoke test before publishing, or a reference when porting to other languages.

## TL;DR

```bash
# from the repo root
npm run demo            # runs the Node ESM demo (default)
npm run demo:esm        # same — explicit
npm run demo:cjs        # the CommonJS demo
npm run demo:edge       # boots the Cloudflare Worker demo with `wrangler dev`
```

The first invocation builds the SDK, installs the demo's deps, then runs. Subsequent runs skip what's already cached.

## Which demo for which use case?

Pick the demo that matches **your target runtime**, not just the runtime you're typing in right now. All three hit the same API and exercise the same public methods — the difference is *how the SDK is loaded and run*, which is what determines whether your integration will work end-to-end.

| Your situation | Run | What it proves |
|---|---|---|
| Modern Node.js service (`"type": "module"`, `.mjs`, ESM `import`) | `npm run demo:esm` | The default ESM resolution path — same one you get from `import { PoliPage } from '@poli-page/sdk'`. **Start here if you're unsure.** |
| Node.js codebase using CommonJS (`require`, `.cjs`, older bundlers, ts-node default) | `npm run demo:cjs` | The CJS resolution path through the dual exports map, including `require('@poli-page/sdk/node')` for `renderToFile`. |
| Edge runtime — Cloudflare Workers, Vercel Edge, Deno Deploy, or Bun | `npm run demo:edge` | Boots inside `wrangler dev` with **no `nodejs_compat` flag**, confirming the main entry uses only Web Platform APIs (`fetch`, `ReadableStream`, `AbortSignal`, `globalThis.crypto`). |
| Validating an SDK upgrade before rolling out | All three | Catches regressions across every resolution path the package ships. |
| Porting the SDK to another language (Python, PHP, Go, …) | `npm run demo:esm` | Canonical reference. Walks the public methods in the order other-language demos should mirror. See *Notes for SDK porters* below. |

Notes:

- **You don't need all three.** If you only ship to Node ESM, `demo:esm` is enough.
- **The two Node demos write to sibling folders** (`demo/node/output-esm/` and `demo/node/output-cjs/`), so you can `diff` them to confirm both module systems return byte-equivalent results.
- **The edge demo is the only one that renders an HTML report in the browser.** Node demos write artifacts to disk; the worker shows them inline at `localhost:8787`.

## Step 1 — Get an API key (you'll need this every time)

Every demo talks to the Poli Page API, which requires an API key. **You only need a `pp_test_*` key** — test keys never bill, and never send real documents.

### How to create one

1. Sign in at **https://app.poli.page**.
2. Go to your organization's API keys page:
   ```
   https://app.poli.page/orgs/{YOUR_ORG}/keys
   ```
   Replace `{YOUR_ORG}` with your **organization slug** — you can see it in the URL whenever you're inside your dashboard. For example, if your dashboard URL is `https://app.poli.page/orgs/acme/dashboard`, your slug is `acme` and the keys page is at `https://app.poli.page/orgs/acme/keys`.
3. Click **Create key** and copy the value (starts with `pp_test_`).

### One canonical place for the key — `.env` at the SDK repo root

Every demo (Node ESM, Node CJS, Cloudflare Worker) resolves `POLI_PAGE_API_KEY` from these sources, in order:

1. **`process.env`** — wins if set in your shell. Best for CI.
2. **`.env` at the SDK repo root** — the canonical project file, survives across runs. Gitignored.
3. **Interactive prompt** — if neither of the above has the key, the demo prints full instructions on where to create one, accepts it on stdin, **and appends it to `.env`** at the repo root so future runs skip the prompt.

The "first run prompts, subsequent runs are silent" experience is the design goal. After answering the prompt once, every demo (incl. the Worker) finds the key automatically.

**Optional setup before the first run** — if you'd rather not paste the key interactively:

```bash
cp .env.example .env
# then edit .env and replace `pp_test_replace_me` with your real key
```

The Cloudflare Worker demo passes the resolved key to `wrangler dev` via `--var POLI_PAGE_API_KEY:…` at boot — there is no `.dev.vars` file in this project. In production you use `wrangler secret put POLI_PAGE_API_KEY` instead. See `demo/edge/cloudflare-worker/README.md`.

## Step 2 — Run a demo

### Node (ESM and CJS)

```bash
npm run demo:esm    # writes to demo/node/output-esm/
npm run demo:cjs    # writes to demo/node/output-cjs/
```

Each run produces four output files:

| File | What |
|---|---|
| `render.pdf` | PDF bytes (in-memory, `client.render.pdf()`) |
| `stream.pdf` | PDF bytes (streamed, `client.render.pdfStream()`) |
| `file.pdf` | PDF bytes (streamed-to-disk, `renderToFile()`) |
| `preview.html` | Engine HTML output (`client.documents.preview(id)`, after storing the document via `client.render.document()`) — open in any browser |

The three PDFs are byte-identical (modulo creation timestamps) — that's the cross-method consistency check. To verify:

```bash
diff <(pdftotext demo/node/output-esm/render.pdf -) <(pdftotext demo/node/output-esm/file.pdf -)
# → no output means identical text
```

### Cloudflare Worker (edge)

```bash
npm run demo:edge
```

This boots `wrangler dev` on `localhost:8787`. In another terminal:

```bash
curl -o /tmp/edge.pdf http://localhost:8787 && open /tmp/edge.pdf
```

The worker has **no `nodejs_compat` flag** — its clean boot is the runtime proof that the SDK's main entry runs on Workers, Vercel Edge, Deno, and Bun without any Node compatibility layer. See `demo/edge/cloudflare-worker/README.md` for production deploy.

## Layout

```
demo/
├── README.md                    ← (this file)
├── _shared.mjs                  ← key + base-URL resolution shared by all demos
├── node/                        ← plain Node.js (≥ 20.18)
│   ├── package.json
│   ├── esm-demo.mjs             #   ESM — uses `import`
│   └── cjs-demo.cjs             #   CommonJS — uses `require`
└── edge/
    └── cloudflare-worker/       ← runs unchanged on Workers / Vercel Edge / Deno / Bun
        ├── README.md
        ├── package.json
        ├── wrangler.toml
        └── worker.mjs
```

The demos use the `getting-started/welcome/1.0.0` project template that's auto-provisioned in every Poli Page org — no template files ship with the demos.

## Running the demos directly (without the root-level scripts)

The root-level `npm run demo*` scripts are convenience wrappers. You can also run any demo directly:

```bash
# Node demos
cd demo/node
npm install
npm run demo:esm
npm run demo:cjs

# Cloudflare Worker
cd demo/edge/cloudflare-worker
npm install
echo "POLI_PAGE_API_KEY=pp_test_..." > .dev.vars
npm run dev
```

## Notes for SDK porters

These demos are also the canonical reference when implementing other Poli Page SDKs (Python, PHP, Go, etc.). Each language's demo should:

- Walk the same methods in the same order: `render.pdf` → `render.pdfStream` → `renderToFile` (or equivalent, where the language supports it) → `render.document` → `documents.preview(id)` → error handling.
- Use the auto-provisioned `getting-started/welcome/1.0.0` project template so the demo works out of the box for any newcomer with a fresh API key — no template files in-tree, no project setup needed.
- Show error handling at the bottom — trigger a real API error, catch the language's error type, expose `code`/`status`/`requestId`/predicate helpers.
- Prompt for the API key when `POLI_PAGE_API_KEY` isn't set, with the same instructional copy as the Node demo.

## What these demos are NOT

- **Not the test suite.** Unit tests live in `tests/`, integration tests in `tests/integration/`. These demos are for human eyes.
- **Not packaged with the published npm tarball.** The SDK's `package.json` `files` field whitelists `dist`, `README.md`, and `LICENSE` only.
