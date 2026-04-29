# `@poli-page/sdk` — runnable demos

Small, self-contained programs that exercise the SDK end-to-end against a real Poli Page API. Each demo walks through every public method of the SDK with comments explaining what each call does and when you'd use it. Use them as a learning tool, a smoke test before publishing, or a reference when porting to other languages.

## TL;DR

```bash
# from the repo root
pnpm demo               # runs the Node ESM demo (default)
pnpm demo:esm           # same — explicit
pnpm demo:cjs           # the CommonJS demo
pnpm demo:edge          # boots the Cloudflare Worker demo with `wrangler dev`
```

The first invocation builds the SDK, installs the demo's deps, then runs. Subsequent runs skip what's already cached.

## Which demo for which use case?

Pick the demo that matches **your target runtime**, not just the runtime you're typing in right now. All three hit the same API and exercise the same five public methods — the difference is *how the SDK is loaded and run*, which is what determines whether your integration will work end-to-end.

| Your situation | Run | What it proves |
|---|---|---|
| Modern Node.js service (`"type": "module"`, `.mjs`, ESM `import`) | `pnpm demo:esm` | The default ESM resolution path — same one you get from `import { PoliPage } from '@poli-page/sdk'`. **Start here if you're unsure.** |
| Node.js codebase using CommonJS (`require`, `.cjs`, older bundlers, ts-node default) | `pnpm demo:cjs` | The CJS resolution path through the dual exports map, including `require('@poli-page/sdk/node')` for `renderToFile`. |
| Edge runtime — Cloudflare Workers, Vercel Edge, Deno Deploy, or Bun | `pnpm demo:edge` | Boots inside `wrangler dev` with **no `nodejs_compat` flag**, confirming the main entry uses only Web Platform APIs (`fetch`, `ReadableStream`, `AbortSignal`, `globalThis.crypto`). |
| Validating an SDK upgrade before rolling out | All three | Catches regressions across every resolution path the package ships. |
| Porting the SDK to another language (Python, PHP, Go, …) | `pnpm demo:esm` | Canonical reference. Walks the public methods in the order other-language demos should mirror. See *Notes for SDK porters* below. |

Notes:

- **You don't need all three.** If you only ship to Node ESM, `demo:esm` is enough.
- **The two Node demos write to sibling folders** (`demo/node/output-esm/` and `demo/node/output-cjs/`), so you can `diff` them to confirm both module systems return byte-equivalent results.
- **The edge demo is the only one that renders an HTML report in the browser.** Node demos write artifacts to disk; the worker shows them inline at `localhost:8787`.

## Step 1 — Get an API key (you'll need this every time)

Every demo talks to the Poli Page API, which requires an API key. **You only need a `pp_test_*` key** — test keys hit the develop environment, never bill, and never send real documents.

### How to create one

1. Sign in at **https://app-develop.poli.page**.
2. Go to your organization's API keys page:
   ```
   https://app-develop.poli.page/orgs/{YOUR_ORG}/keys
   ```
   Replace `{YOUR_ORG}` with your **organization slug** — you can see it in the URL whenever you're inside your dashboard. For example, if your dashboard URL is `https://app-develop.poli.page/orgs/acme/dashboard`, your slug is `acme` and the keys page is at `https://app-develop.poli.page/orgs/acme/keys`.
3. Click **Create key**, choose the **develop** environment, and copy the value (starts with `pp_test_`).

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
pnpm demo:esm    # writes to demo/node/output-esm/
pnpm demo:cjs    # writes to demo/node/output-cjs/
```

Each run produces five output files:

| File | What |
|---|---|
| `render.pdf` | PDF bytes (in-memory, `client.render()`) |
| `stream.pdf` | PDF bytes (streamed, `client.renderStream()`) |
| `file.pdf` | PDF bytes (streamed-to-disk, `renderToFile()`) |
| `preview.html` | Engine HTML output (`client.preview()`) — open in any browser |
| `thumb-page-N.png` | One thumbnail per page (`client.thumbnails()`) |

The three PDFs are byte-identical (modulo creation timestamps) — that's the cross-method consistency check. To verify:

```bash
diff <(pdftotext demo/node/output-esm/render.pdf -) <(pdftotext demo/node/output-esm/file.pdf -)
# → no output means identical text
```

### Cloudflare Worker (edge)

```bash
pnpm demo:edge
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
├── templates/                   ← real templates, copied from the platform repo
│   └── invoice/
│       ├── invoice.html         #   Angular-style template with @if/@for,
│       └── invoice.json         #     poli-* chrome, format-responsive Tailwind
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

## Running the demos directly (without the root-level scripts)

The root-level `pnpm demo*` scripts are convenience wrappers. You can also run any demo directly:

```bash
# Node demos
cd demo/node
pnpm install
pnpm run demo:esm
pnpm run demo:cjs

# Cloudflare Worker
cd demo/edge/cloudflare-worker
pnpm install
echo "POLI_PAGE_API_KEY=pp_test_..." > .dev.vars
pnpm run dev
```

## Notes for SDK porters

These demos are also the canonical reference when implementing other Poli Page SDKs (Python, PHP, Go, etc.). Each language's demo should:

- Walk the same five methods in the same order: `render` → `renderStream` → `renderToFile` (or equivalent) → `preview` → `thumbnails`.
- Use the same shared template (`demo/templates/invoice/`) so cross-language outputs can be diffed for parity.
- Show error handling at the bottom — trigger a real API error, catch the language's error type, expose `code`/`status`/`requestId`/predicate helpers.
- Prompt for the API key when `POLI_PAGE_API_KEY` isn't set, with the same instructional copy as the Node demo.

## What these demos are NOT

- **Not the test suite.** Unit tests live in `tests/`, integration tests in `tests/integration/`. These demos are for human eyes.
- **Not packaged with the published npm tarball.** The SDK's `package.json` `files` field whitelists `dist`, `README.md`, and `LICENSE` only.
