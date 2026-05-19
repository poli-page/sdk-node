# `@poli-page/sdk` v1.0.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `@poli-page/sdk` from 0.1.0 (unpublished scaffold) to 1.0.0 (production-ready, contract-stable, published on npm).

**Architecture:** Single Node SDK package, dual ESM+CJS build via tsup, isomorphic main entry returning `Uint8Array`, Node-only helpers under `@poli-page/sdk/node` sub-export. HTTP transport with retry/backoff/jitter, observability hooks, caller cancellation via `AbortSignal`. Spec-driven TDD development.

**Tech Stack:** TypeScript 5.9, Vitest 4 (unit + typecheck), tsup (build), ESLint 9 flat config + `typescript-eslint`, Prettier, simple-git-hooks (pre-push), pnpm 9, GitHub Actions (CI + tag-driven publish), Node 20.18+.

**Companion docs:**
- Spec: `docs/superpowers/specs/2026-04-27-sdk-node-v1-design.md` (this repo)
- Multi-language SDK contract: platform repo `docs/onboarding/micka/sdk-specification.md`
- Methodology: platform repo `docs/onboarding/micka/agent-guide.md`

**Repo paths used in this plan:**
- SDK repo: `/Users/mickael/Projects/sdk-node/`
- Platform repo (for spec doc updates): `/Users/mickael/Projects/poli-page/`

---

## Phase 0 — Foundation (no behavior change)

**Goal:** Update tooling, build, CI, and repo hygiene before touching `src/`. Each task is independent; CI must stay green throughout.

---

### Task 0.1: Update Node version floor and types

**Files:**
- Modify: `package.json` (engines, devDependencies)
- Create: `.nvmrc`

- [ ] **Step 1: Edit `package.json`**

Change `"engines": { "node": ">=22.13.0" }` to `">=20.18.0"`.

Change `"devDependencies": { "@types/node": "^22.19.17" }` to `"^20.19.0"` (latest 20.x major matching the new floor).

- [ ] **Step 2: Create `.nvmrc`**

```
20.18.0
```

- [ ] **Step 3: Reinstall dev deps**

Run: `pnpm install`
Expected: lockfile updates `@types/node` to a 20.x version, no errors.

- [ ] **Step 4: Verify build still works**

Run: `pnpm build && pnpm test`
Expected: build succeeds, all 11 existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .nvmrc
git commit -m "chore: lower Node floor to 20.18 to match CI matrix"
```

---

### Task 0.2: Add ESLint flat config

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json` (scripts, devDependencies)

- [ ] **Step 1: Install ESLint and typescript-eslint**

Run: `pnpm add -D eslint typescript-eslint @eslint/js`
Expected: 3 dev deps added.

- [ ] **Step 2: Create `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
	},
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/no-floating-promises': 'error',
		},
	},
	{
		files: ['tests/**/*.ts'],
		rules: {
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
		},
	},
);
```

- [ ] **Step 3: Add lint script to `package.json`**

In the `scripts` block, add:
```json
"lint": "eslint .",
"lint:fix": "eslint . --fix"
```

- [ ] **Step 4: Run lint, fix any errors**

Run: `pnpm lint`
Expected: passes, or trivial issues that `pnpm lint:fix` resolves. If non-trivial issues remain in `src/index.ts` (e.g., unused `lastError`), fix manually with minimal-change edits — do not refactor logic in this task.

- [ ] **Step 5: Verify tests still pass**

Run: `pnpm test`
Expected: all 11 tests pass.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js package.json pnpm-lock.yaml
git commit -m "chore: add ESLint flat config with typescript-eslint recommended-type-checked"
```

---

### Task 0.3: Switch build from `tsc` to `tsup` (dual ESM+CJS)

**Files:**
- Create: `tsup.config.ts`
- Modify: `package.json` (scripts, devDependencies, exports, files, sideEffects)
- Modify: `tsconfig.json` (no emit needed, narrow it to typecheck-only)

- [ ] **Step 1: Install tsup**

Run: `pnpm add -D tsup`

- [ ] **Step 2: Create `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	sourcemap: true,
	target: 'node20.18',
	define: {
		__SDK_VERSION__: JSON.stringify(pkg.version),
	},
});
```

- [ ] **Step 3: Update `tsconfig.json`**

Replace contents with:
```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "nodenext",
		"moduleResolution": "nodenext",
		"lib": ["ES2022"],
		"strict": true,
		"esModuleInterop": true,
		"skipLibCheck": true,
		"forceConsistentCasingInFileNames": true,
		"resolveJsonModule": true,
		"declaration": true,
		"sourceMap": true,
		"noEmit": true
	},
	"include": ["src/**/*", "tests/**/*", "tsup.config.ts", "eslint.config.js"]
}
```

(`noEmit: true` means `tsc` is now typecheck-only. Tsup handles emission.)

- [ ] **Step 4: Update `package.json` scripts**

Replace `"build"` and `"typecheck"` with:
```json
"build": "tsup",
"typecheck": "tsc --noEmit",
```

- [ ] **Step 5: Update `package.json` `exports` and add `sideEffects`**

```json
"main": "./dist/index.cjs",
"module": "./dist/index.js",
"types": "./dist/index.d.ts",
"exports": {
	".": {
		"types": "./dist/index.d.ts",
		"import": "./dist/index.js",
		"require": "./dist/index.cjs"
	}
},
"sideEffects": false,
```

- [ ] **Step 6: Add `__SDK_VERSION__` ambient declaration**

Create `src/global.d.ts`:
```ts
declare const __SDK_VERSION__: string;
```

- [ ] **Step 7: Build and verify outputs**

Run: `pnpm build`
Expected: `dist/` contains `index.js`, `index.cjs`, `index.d.ts`, sourcemaps. No errors.

Run: `ls dist/`
Expected output includes: `index.cjs`, `index.cjs.map`, `index.d.ts`, `index.js`, `index.js.map`.

- [ ] **Step 8: Verify the package is loadable in both formats**

Run:
```bash
node -e "import('@poli-page/sdk').then(m => console.log(typeof m.PoliPage))"  # ESM
```
Wait — that won't work because we haven't published. Instead:
```bash
node --experimental-vm-modules -e "import('./dist/index.js').then(m => console.log('ESM ok:', typeof m.PoliPage))"
node -e "console.log('CJS ok:', typeof require('./dist/index.cjs').PoliPage)"
```
Expected: both print `ESM ok: function` and `CJS ok: function`.

- [ ] **Step 9: Verify tests still pass**

Run: `pnpm test`
Expected: all 11 tests pass (Vitest reads source TS, not built output).

- [ ] **Step 10: Commit**

```bash
git add tsup.config.ts tsconfig.json package.json pnpm-lock.yaml src/global.d.ts
git commit -m "chore: switch build to tsup, dual ESM+CJS, add sideEffects: false"
```

---

### Task 0.4: Add CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node-version: [20, 22, 24]
    steps:
      - uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build

      - name: Pack smoke test
        run: |
          pnpm pack
          tar -tf poli-page-sdk-*.tgz | grep -E "package/dist/index\.(js|cjs|d\.ts)$" || (echo "Missing dist files in pack" && exit 1)
          tar -tf poli-page-sdk-*.tgz | grep -E "package/(README\.md|LICENSE|package\.json)$" || (echo "Missing top-level files in pack" && exit 1)
```

- [ ] **Step 2: Verify workflow YAML is valid**

Run: `pnpm exec js-yaml .github/workflows/ci.yml > /dev/null` (if `js-yaml` not installed: skip; manual review of indentation is sufficient.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow (Node 20/22/24 matrix)"
```

---

### Task 0.5: Add publish workflow

**Files:**
- Create: `.github/workflows/publish.yml`

- [ ] **Step 1: Create `.github/workflows/publish.yml`**

```yaml
name: Publish

on:
  push:
    tags: ['v*.*.*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node 22
        uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org/
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build

      - name: Verify tag matches package version
        run: |
          PKG_VERSION=$(node -p "require('./package.json').version")
          TAG_VERSION="${GITHUB_REF#refs/tags/v}"
          if [ "$PKG_VERSION" != "$TAG_VERSION" ]; then
            echo "Tag $TAG_VERSION does not match package.json version $PKG_VERSION"
            exit 1
          fi

      - name: Publish to npm
        run: pnpm publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Add note about NPM_TOKEN secret**

(Manual action by Mickael, not a code step) — the `NPM_TOKEN` secret must exist in GitHub repo settings before tagging v1.0.0. Document this in `CONTRIBUTING.md` (Task 0.7).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci: add tag-driven publish workflow (v*.*.*)"
```

---

### Task 0.6: Add simple-git-hooks with pre-push hook (unit tests only for now)

**Files:**
- Modify: `package.json` (devDependencies, scripts, simple-git-hooks block)

Note: integration tests are added in Phase 3. The pre-push hook starts as `pnpm test` only, then is upgraded in Task 3.3.

- [ ] **Step 1: Install simple-git-hooks**

Run: `pnpm add -D simple-git-hooks`

- [ ] **Step 2: Add `simple-git-hooks` block and `prepare` script to `package.json`**

In `scripts`:
```json
"prepare": "simple-git-hooks"
```

At the top level of `package.json`:
```json
"simple-git-hooks": {
	"pre-push": "pnpm test"
}
```

- [ ] **Step 3: Activate the hook**

Run: `pnpm install` (the `prepare` script runs automatically and writes `.git/hooks/pre-push`)
Expected: `.git/hooks/pre-push` exists and is executable.

- [ ] **Step 4: Verify hook works**

Run: `cat .git/hooks/pre-push`
Expected: file exists, contains `pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add simple-git-hooks pre-push hook (pnpm test)"
```

---

### Task 0.7: Add SECURITY.md and CONTRIBUTING.md

**Files:**
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create `SECURITY.md`**

```md
# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities to **security@poli.page**.

Do not file public GitHub issues for security concerns.
We aim to respond within 48 hours.

## Supported Versions

Only the latest minor version of `@poli-page/sdk` receives security updates.
```

- [ ] **Step 2: Create `CONTRIBUTING.md`**

```md
# Contributing to `@poli-page/sdk`

Thanks for your interest. A few short rules:

## Working method

We use **TDD**: write a failing test first, then the minimum code to pass. See
the platform `agent-guide.md` for the full methodology.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Local development

```bash
pnpm install
pnpm test         # unit tests
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm build        # tsup, outputs dist/
```

## Integration tests

Integration tests hit the develop API. They run automatically on `git push`
via a pre-push hook (`simple-git-hooks`). To run them locally:

```bash
export POLI_PAGE_API_KEY=pp_test_...
pnpm test:integration
```

To skip integration tests on push (e.g. doc-only changes):

```bash
SKIP_INTEGRATION=1 git push
```

## Releasing

1. Bump version in `package.json`.
2. Move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md`.
3. Commit `chore(release): X.Y.Z`.
4. Tag `vX.Y.Z` and push the tag — CI publishes to npm.

The repo must have an `NPM_TOKEN` secret configured in GitHub settings for
the publish workflow to succeed.
```

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md CONTRIBUTING.md
git commit -m "docs: add SECURITY.md and CONTRIBUTING.md"
```

---

### Task 0.8: Verify Phase 0 end-to-end

- [ ] **Step 1: Full local verification**

Run:
```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm pack
tar -tf poli-page-sdk-*.tgz
rm poli-page-sdk-*.tgz
```
Expected: every step passes; tarball contains `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`, `README.md`, `LICENSE`, `package.json`.

- [ ] **Step 2: Push to origin**

Run: `git push`
Expected: pre-push hook runs `pnpm test` (passes), commits land on origin/main, CI starts on GitHub.

- [ ] **Step 3: Verify CI is green**

Manual: open the GitHub Actions page, confirm the CI run is green across Node 20, 22, 24.

If a matrix entry fails, fix and re-push before continuing to Phase 1.

---

## Phase 1 — Spec compliance fixes

**Goal:** close the 8 spec-compliance gaps in §3 of the design spec. No new public API, just correctness.

Pattern for every task in this phase: write failing test → run (RED) → implement minimal fix → run (GREEN) → commit.

---

### Task 1.1: Add `User-Agent` and `Accept` headers

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Add inside the existing `describe('PoliPage SDK', () => { ... })` block, after the existing `describe('render()', () => { ... })`:

```ts
describe('HTTP transport headers', () => {
	it('sends User-Agent header in the form poli-page-sdk-node/<version>', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		await client.render({ template: '<p>x</p>', data: {} });
		const ua = lastRequest.headers['user-agent'];
		expect(ua).toMatch(/^poli-page-sdk-node\/\d+\.\d+\.\d+/);
	});

	it('sends Accept: application/pdf for render', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		await client.render({ template: '<p>x</p>', data: {} });
		expect(lastRequest.headers.accept).toBe('application/pdf');
	});

	it('sends Accept: application/json for preview', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ html: '', totalPages: 1 }));
		});
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		await client.preview({ template: '<p>x</p>', data: {} });
		expect(lastRequest.headers.accept).toBe('application/json');
	});

	it('sends Accept: application/json for thumbnails', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ thumbnails: [] }));
		});
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		await client.thumbnails({ template: '<p>x</p>', data: {} }, { width: 200 });
		expect(lastRequest.headers.accept).toBe('application/json');
	});

	it('sends Content-Type: application/json on every POST', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		await client.render({ template: '<p>x</p>', data: {} });
		expect(lastRequest.headers['content-type']).toBe('application/json');
	});
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm test -- -t "HTTP transport headers"`
Expected: 5 tests fail (User-Agent, 3 Accept variants, plus the existing Content-Type test should already pass since the SDK sends it). The User-Agent test in particular should fail: header is undefined.

- [ ] **Step 3: Implement headers**

In `src/index.ts`, find the `#request` method's `fetch(...)` call. Replace the `headers` block:

```ts
headers: {
	'Content-Type': 'application/json',
	Authorization: `Bearer ${this.#apiKey}`,
},
```

with a method that knows the path:

Add a private method to `PoliPage`:
```ts
#headers(path: string): Record<string, string> {
	const accept = path === '/v1/render/pdf' ? 'application/pdf' : 'application/json';
	return {
		'Content-Type': 'application/json',
		Accept: accept,
		Authorization: `Bearer ${this.#apiKey}`,
		'User-Agent': `poli-page-sdk-node/${__SDK_VERSION__}`,
	};
}
```

In the `fetch` call, replace the inline headers block with:
```ts
headers: this.#headers(path),
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test -- -t "HTTP transport headers"`
Expected: 5 tests pass.

- [ ] **Step 5: Run full suite**

Run: `pnpm test`
Expected: all tests pass (16 total now).

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: send User-Agent and Accept headers per spec §8.1"
```

---

### Task 1.2: Validate PDF Content-Type on 2xx render responses

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing test**

Add inside `describe('render()', () => { ... })`:

```ts
it('rejects 2xx render response if Content-Type is not application/pdf', async () => {
	setMockHandler((_req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.end('<html>oops</html>');
	});
	const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
	await expect(client.render({ template: '<p>x</p>', data: {} })).rejects.toMatchObject({
		name: 'PoliPageError',
		code: 'INTERNAL_ERROR',
	});
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test -- -t "rejects 2xx render response"`
Expected: FAIL — current code returns the buffer regardless of Content-Type.

- [ ] **Step 3: Implement Content-Type check in `render()`**

In `src/index.ts`, modify `render`:
```ts
async render(input: RenderInput): Promise<Buffer> {
	const response = await this.#request('/v1/render/pdf', input);
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('application/pdf')) {
		const requestId = response.headers.get('x-request-id') ?? undefined;
		throw new PoliPageError(
			`Expected application/pdf response, got ${contentType || 'no content-type'}`,
			'INTERNAL_ERROR',
			response.status,
			requestId,
		);
	}
	const arrayBuffer = await response.arrayBuffer();
	return Buffer.from(arrayBuffer);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test`
Expected: all tests pass (17 total).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: validate PDF Content-Type on 2xx render responses (spec §8.3)"
```

---

### Task 1.3: Map non-JSON error body to `INTERNAL_ERROR`

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing test**

Add inside `describe('render()', () => { ... })`:

```ts
it('maps non-2xx HTML body to PoliPageError with code INTERNAL_ERROR and HTTP status', async () => {
	setMockHandler((_req, res) => {
		res.writeHead(502, { 'Content-Type': 'text/html' });
		res.end('<html>upstream gone</html>');
	});
	const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
	await expect(client.render({ template: '<p>x</p>', data: {} })).rejects.toMatchObject({
		name: 'PoliPageError',
		code: 'INTERNAL_ERROR',
		status: 502,
	});
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test -- -t "non-2xx HTML body"`
Expected: FAIL — current code sets `code` to the raw HTML body string.

- [ ] **Step 3: Fix the JSON-parse fallback**

In `src/index.ts`, in the `#request` method, find the `try { JSON.parse(errorBody); ... } catch { ... }` block. Replace the catch branch:
```ts
} catch {
	code = errorBody || 'unknown_error';
	message = `API error (${response.status}): ${code}`;
}
```
with:
```ts
} catch {
	code = 'INTERNAL_ERROR';
	message = `API error ${response.status}: response body was not valid JSON`;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test`
Expected: all tests pass (18 total).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "fix: map non-JSON error body to INTERNAL_ERROR (spec §8.3)"
```

---

### Task 1.4: Honor `Retry-After` header

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Add inside the existing `describe('retry logic', () => { ... })` block:

```ts
it('honors Retry-After header in seconds (uses it instead of exponential backoff)', async () => {
	let attempts = 0;
	const startTimes: number[] = [];
	setMockHandler((_req, res) => {
		startTimes.push(Date.now());
		attempts++;
		if (attempts < 2) {
			res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '0' });
			res.end(JSON.stringify({ code: 'unavailable' }));
		} else {
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.end(Buffer.from('%PDF-1.4 ok'));
		}
	});
	const client = new PoliPage({
		apiKey: 'pp_test_x',
		baseUrl,
		maxRetries: 2,
		retryDelay: 10_000, // would make exponential backoff at least 10s — but Retry-After: 0 should override
	});
	const t0 = Date.now();
	await client.render({ template: '<p>x</p>', data: {} });
	const elapsed = Date.now() - t0;
	expect(elapsed).toBeLessThan(500); // Retry-After: 0 → immediate retry
});

it('caps Retry-After at 30 seconds', async () => {
	// We can't actually wait 30s in a test. Verify by mocking timers.
	const { vi } = await import('vitest');
	vi.useFakeTimers();
	let attempts = 0;
	setMockHandler((_req, res) => {
		attempts++;
		if (attempts < 2) {
			res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '999' });
			res.end(JSON.stringify({ code: 'unavailable' }));
		} else {
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.end(Buffer.from('%PDF-1.4 ok'));
		}
	});
	const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2 });
	const promise = client.render({ template: '<p>x</p>', data: {} });
	await vi.advanceTimersByTimeAsync(30_000);
	await promise;
	expect(attempts).toBe(2);
	vi.useRealTimers();
});

it('parses Retry-After in HTTP-date format', async () => {
	const { vi } = await import('vitest');
	vi.useFakeTimers();
	const futureDate = new Date(Date.now() + 2_000).toUTCString();
	let attempts = 0;
	setMockHandler((_req, res) => {
		attempts++;
		if (attempts < 2) {
			res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': futureDate });
			res.end(JSON.stringify({ code: 'unavailable' }));
		} else {
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.end(Buffer.from('%PDF-1.4 ok'));
		}
	});
	const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2 });
	const promise = client.render({ template: '<p>x</p>', data: {} });
	await vi.advanceTimersByTimeAsync(2_500);
	await promise;
	expect(attempts).toBe(2);
	vi.useRealTimers();
});

it('treats past-dated Retry-After as immediate retry', async () => {
	const pastDate = new Date(Date.now() - 60_000).toUTCString();
	let attempts = 0;
	setMockHandler((_req, res) => {
		attempts++;
		if (attempts < 2) {
			res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': pastDate });
			res.end(JSON.stringify({ code: 'unavailable' }));
		} else {
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.end(Buffer.from('%PDF-1.4 ok'));
		}
	});
	const client = new PoliPage({
		apiKey: 'pp_test_x',
		baseUrl,
		maxRetries: 2,
		retryDelay: 10_000, // big — should be skipped because Retry-After is present (even if past-dated)
	});
	const t0 = Date.now();
	await client.render({ template: '<p>x</p>', data: {} });
	const elapsed = Date.now() - t0;
	expect(elapsed).toBeLessThan(500);
});
```

- [ ] **Step 2: Run, verify failures**

Run: `pnpm test -- -t "Retry-After"`
Expected: 4 tests fail.

- [ ] **Step 3: Implement Retry-After parser**

In `src/index.ts`, add module-level helper functions before the `PoliPage` class:

```ts
const RETRY_AFTER_CAP_MS = 30_000;

function parseRetryAfter(headerValue: string | null): number | undefined {
	if (!headerValue) return undefined;
	// Try integer seconds
	const seconds = Number(headerValue);
	if (Number.isFinite(seconds)) {
		return Math.min(Math.max(seconds * 1000, 0), RETRY_AFTER_CAP_MS);
	}
	// Try HTTP-date
	const dateMs = Date.parse(headerValue);
	if (Number.isFinite(dateMs)) {
		const delta = dateMs - Date.now();
		return Math.min(Math.max(delta, 0), RETRY_AFTER_CAP_MS);
	}
	return undefined;
}
```

- [ ] **Step 4: Plumb Retry-After through retry logic**

In `src/index.ts`, modify the `#request` method. Track the last `Retry-After` value when a retryable error occurs, and use it as the next delay:

The current loop body (simplified):
```ts
for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
	if (attempt > 0) {
		const delay = this.#retryDelay * Math.pow(2, attempt - 1);
		await new Promise((resolve) => setTimeout(resolve, delay));
	}
	// ... fetch + handle response ...
}
```

Refactor to:
```ts
let nextRetryAfterMs: number | undefined;
for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
	if (attempt > 0) {
		const delay =
			nextRetryAfterMs !== undefined
				? nextRetryAfterMs
				: this.#retryDelay * Math.pow(2, attempt - 1);
		await new Promise((resolve) => setTimeout(resolve, delay));
		nextRetryAfterMs = undefined;
	}
	// ... fetch ...
	// On 5xx response that we'll retry:
	nextRetryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
	// ... build PoliPageError, decide whether to retry ...
}
```

(See Task 1.5 for retrying 429 — for now, only 5xx triggers Retry-After capture.)

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test`
Expected: 22 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: honor Retry-After header (cap 30s, supports seconds and HTTP-date)"
```

---

### Task 1.5: Retry on 429

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing test**

Add inside `describe('retry logic', () => { ... })`:

```ts
it('retries on 429 with Retry-After delay', async () => {
	let attempts = 0;
	setMockHandler((_req, res) => {
		attempts++;
		if (attempts < 2) {
			res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
			res.end(JSON.stringify({ code: 'rate_limited' }));
		} else {
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.end(Buffer.from('%PDF-1.4 ok'));
		}
	});
	const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2, retryDelay: 10 });
	const pdf = await client.render({ template: '<p>x</p>', data: {} });
	expect(attempts).toBe(2);
	expect(Buffer.isBuffer(pdf)).toBe(true);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test -- -t "retries on 429"`
Expected: FAIL — current code throws on 429 because `response.status < 500` is true.

- [ ] **Step 3: Update retry condition**

In `src/index.ts`, in `#request`, find:
```ts
// Only retry on server errors (5xx)
if (response.status < 500) throw lastError;
```

Replace with:
```ts
// Retry on 5xx and 429; 4xx (except 429) is never retried.
const isRetryable = response.status >= 500 || response.status === 429;
if (!isRetryable) throw lastError;
```

Also update the Retry-After capture to fire on 429 too — confirm `nextRetryAfterMs = parseRetryAfter(...)` runs whenever the response is retryable (it should already, since the header is read before the `isRetryable` check based on the Phase 1.4 implementation; verify when integrating).

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test`
Expected: 23 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: retry on 429 in addition to 5xx (spec §7.1 update)"
```

---

### Task 1.6: Add jitter to exponential backoff (only when Retry-After absent)

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Add inside `describe('retry logic', () => { ... })`:

```ts
it('applies jitter to exponential backoff (delay falls in [0.5×, 1.5×])', async () => {
	const { vi } = await import('vitest');
	vi.useFakeTimers();

	const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

	let attempts = 0;
	setMockHandler((_req, res) => {
		attempts++;
		if (attempts < 2) {
			res.writeHead(503, { 'Content-Type': 'application/json' }); // no Retry-After
			res.end(JSON.stringify({ code: 'unavailable' }));
		} else {
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.end(Buffer.from('%PDF-1.4 ok'));
		}
	});

	const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2, retryDelay: 1000 });
	const promise = client.render({ template: '<p>x</p>', data: {} });
	await vi.runAllTimersAsync();
	await promise;

	// Find the first setTimeout used for the backoff delay (filter out fetch/abort timers > our retryDelay range)
	const delays = setTimeoutSpy.mock.calls
		.map((c) => c[1] as number)
		.filter((d) => d >= 500 && d <= 1500);
	expect(delays.length).toBeGreaterThan(0);
	expect(delays[0]).toBeGreaterThanOrEqual(500); // 1000 × 0.5
	expect(delays[0]).toBeLessThanOrEqual(1500); // 1000 × 1.5

	vi.useRealTimers();
});

it('does not apply jitter when Retry-After is present', async () => {
	const { vi } = await import('vitest');
	vi.useFakeTimers();
	const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

	let attempts = 0;
	setMockHandler((_req, res) => {
		attempts++;
		if (attempts < 2) {
			res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '2' });
			res.end(JSON.stringify({ code: 'unavailable' }));
		} else {
			res.writeHead(200, { 'Content-Type': 'application/pdf' });
			res.end(Buffer.from('%PDF-1.4 ok'));
		}
	});

	const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 2 });
	const promise = client.render({ template: '<p>x</p>', data: {} });
	await vi.runAllTimersAsync();
	await promise;

	// The delay should be exactly 2000ms (server-explicit, no jitter)
	const has2000 = setTimeoutSpy.mock.calls.some((c) => c[1] === 2000);
	expect(has2000).toBe(true);

	vi.useRealTimers();
});
```

- [ ] **Step 2: Run, verify failures**

Run: `pnpm test -- -t "jitter"`
Expected: first test fails (delay is exactly 1000ms, no jitter applied), second test passes if Phase 1.4 was correct.

- [ ] **Step 3: Apply jitter only when Retry-After absent**

In `src/index.ts`, modify the delay calculation in `#request`:

```ts
if (attempt > 0) {
	let delay: number;
	if (nextRetryAfterMs !== undefined) {
		delay = nextRetryAfterMs; // server-explicit, no jitter
	} else {
		const exp = this.#retryDelay * Math.pow(2, attempt - 1);
		const jitterFactor = 0.5 + Math.random(); // [0.5, 1.5)
		delay = Math.round(exp * jitterFactor);
	}
	await new Promise((resolve) => setTimeout(resolve, delay));
	nextRetryAfterMs = undefined;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test`
Expected: 25 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: apply jitter to exponential backoff (spec §7.2 update)"
```

---

### Task 1.7: Constructor throws `'invalid_options'` (not `'invalid_api_key'`)

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update existing test and add new one**

Find and replace the existing constructor test:
```ts
it('throws when apiKey is missing', () => {
	expect(() => new PoliPage({ apiKey: '' })).toThrow(PoliPageError);
});
```
with:
```ts
it('throws PoliPageError with code "invalid_options" when apiKey is missing', () => {
	expect(() => new PoliPage({ apiKey: '' })).toThrowError(
		expect.objectContaining({ name: 'PoliPageError', code: 'invalid_options' }),
	);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test -- -t "invalid_options"`
Expected: FAIL — code is currently `'invalid_api_key'`.

- [ ] **Step 3: Update constructor**

In `src/index.ts`, find:
```ts
if (!options.apiKey) {
	throw new PoliPageError('apiKey is required', 'invalid_api_key');
}
```
Replace with:
```ts
if (!options.apiKey) {
	throw new PoliPageError('apiKey is required', 'invalid_options');
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test`
Expected: 25 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "fix: constructor throws code 'invalid_options' (was 'invalid_api_key')"
```

---

### Task 1.8: Update platform spec doc

**Files (in platform repo `/Users/mickael/Projects/poli-page/`):**
- Modify: `docs/onboarding/micka/sdk-specification.md`

- [ ] **Step 1: Edit §6.4 — reserved SDK-internal codes**

In `docs/onboarding/micka/sdk-specification.md` §6.4, find the table of non-API errors:

```md
| Code            | Cause                                                |
| --------------- | ---------------------------------------------------- |
| `network_error` | DNS, connection refused, TLS failure, etc.           |
| `timeout`       | Per-request timeout exceeded (see §3.2 `timeout`).   |
```

Replace with:
```md
| Code              | Cause                                                |
| ----------------- | ---------------------------------------------------- |
| `network_error`   | DNS, connection refused, TLS failure, etc.           |
| `timeout`         | Per-request timeout exceeded (see §3.2 `timeout`).   |
| `aborted`         | Caller cancelled the request via `AbortSignal`.      |
| `invalid_options` | Constructor option missing or malformed (e.g. empty `apiKey`). |
```

- [ ] **Step 2: Edit §7.1 — add 429**

Replace:
```md
- Only **5xx responses** are retried.
- **4xx responses are never retried** — they indicate a client error and retrying will not help.
- Network errors and timeouts **are retried** (treated as transient).
- A maximum of `maxRetries` additional attempts after the initial one (so default 2 retries = up to 3 total attempts).
- Backoff is **exponential**: the delay before retry N is `retryDelay * 2^(N-1)`.
```

with:
```md
- **5xx responses** and **429 Too Many Requests** are retried.
- **Other 4xx responses are never retried** — they indicate a client error and retrying will not help.
- Network errors and timeouts **are retried** (treated as transient).
- A maximum of `maxRetries` additional attempts after the initial one (so default 2 retries = up to 3 total attempts).
- Backoff is **exponential**: the delay before retry N is `retryDelay * 2^(N-1)`, with jitter (see §7.2).
- When the response carries a **`Retry-After`** header (seconds or HTTP-date), the SDK honors it as the next delay, capped at 30 seconds. Past-dated HTTP-date values are treated as immediate retry. **No jitter is applied when `Retry-After` is present** — the server is being explicit.
```

- [ ] **Step 3: Edit §7.2 — clarify jitter and add Retry-After interaction**

Replace the current §7.2 block with:
```md
### 7.2 Default schedule

When `Retry-After` is **absent**, the delay before retry N is computed as:

`delay = retryDelay * 2^(N-1) * jitter`, where `jitter` is a random factor in `[0.5, 1.5]`.

| Attempt | Base delay (default `retryDelay = 500`) | With jitter (range)         |
| ------- | --------------------------------------- | --------------------------- |
| 1st     | Immediate                               | —                           |
| 2nd     | `500 ms`                                | `[250 ms, 750 ms]`          |
| 3rd     | `1000 ms`                               | `[500 ms, 1500 ms]`         |

When `Retry-After` is **present**, its value (capped at 30 s) is used as-is — no jitter, no exponential backoff.
```

- [ ] **Step 4: Verify the markdown still renders cleanly**

Manual: open `sdk-specification.md` in a Markdown previewer, scroll through §6 and §7. No broken table alignment, no typos.

- [ ] **Step 5: Commit in the platform repo**

```bash
cd /Users/mickael/Projects/poli-page
git add docs/onboarding/micka/sdk-specification.md
git commit -m "docs(spec): retry policy honors Retry-After, includes 429 and jitter"
```

(Mickael decides when to push this commit — it can be batched with other platform-repo changes.)

- [ ] **Step 6: Return to SDK repo**

```bash
cd /Users/mickael/Projects/sdk-node
```

---

## Phase 2 — Public API additions (the breaking-change phase)

**Goal:** Ship the v1.0.0 public surface. This is the only window for breaking changes.

This phase introduces new files (`src/error.ts`, `src/types.ts`, `src/node.ts`) and reorganizes `src/index.ts`. Each task is TDD-driven where applicable.

---

### Task 2.1: Change `render()` return type from `Buffer` to `Uint8Array`

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update existing tests to use `Uint8Array`**

Find every `Buffer.isBuffer(pdf)` assertion in `tests/index.test.ts`. Replace with:
```ts
expect(pdf).toBeInstanceOf(Uint8Array);
```

Find `pdf.toString().startsWith('%PDF')`. Replace with:
```ts
expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test`
Expected: assertions fail because `render()` still returns `Buffer`. (Note: `Buffer` is also a `Uint8Array`, so `instanceof` checks may still pass — but the type signature change matters most. If `instanceof` passes, focus on the `TextDecoder` substitution to confirm bytes are correct.)

- [ ] **Step 3: Change return type and conversion**

In `src/index.ts`, modify `render()`:
```ts
async render(input: RenderInput): Promise<Uint8Array> {
	const response = await this.#request('/v1/render/pdf', input);
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('application/pdf')) {
		const requestId = response.headers.get('x-request-id') ?? undefined;
		throw new PoliPageError(
			`Expected application/pdf response, got ${contentType || 'no content-type'}`,
			'INTERNAL_ERROR',
			response.status,
			requestId,
		);
	}
	const arrayBuffer = await response.arrayBuffer();
	return new Uint8Array(arrayBuffer);
}
```

Modify `renderToFile()` (still in `src/index.ts` for now; will be moved in Task 2.8):
```ts
async renderToFile(input: RenderInput, outputPath: string): Promise<void> {
	const bytes = await this.render(input);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, bytes);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat!: render() returns Uint8Array (was Buffer)

BREAKING CHANGE: Public render() return type changed from Buffer to
Uint8Array for runtime portability. Node consumers can use
Buffer.from(uint8) when a Buffer is specifically required."
```

---

### Task 2.2: Extract types into `src/types.ts` and discriminate `RenderInput`

**Files:**
- Create: `src/types.ts`
- Modify: `src/index.ts` (re-export from types.ts)

- [ ] **Step 1: Create `src/types.ts`**

```ts
/**
 * Canonical Poli Page page formats. The full list is documented in the
 * platform spec (`docs/spec/page-formats.md`) and must match every other SDK.
 */
export type PageFormat =
	| 'A3'
	| 'A4'
	| 'A5'
	| 'A6'
	| 'B4'
	| 'B5'
	| 'Letter'
	| 'Legal'
	| 'Tabloid'
	| 'Executive'
	| 'Statement'
	| 'Folio';

export type Orientation = 'portrait' | 'landscape';

interface BaseRenderInput {
	/** Template data (variables, locale hints, etc.). Required. */
	data: Record<string, unknown>;
	/** Page format override. */
	format?: PageFormat;
	/** Page orientation override. */
	orientation?: Orientation;
	/** BCP 47 locale (e.g. `en-US`, `fr-FR`) for page numbers and formatting. */
	locale?: string;
	/** Optional caller cancellation. Composed with the SDK's internal timeout. */
	signal?: AbortSignal;
	/** Optional override for the auto-generated UUID v4 idempotency key. */
	idempotencyKey?: string;
}

/**
 * Render against a stored project + template by slug. Use `version` to target
 * a specific published version; omit to render the draft.
 */
export interface ProjectModeInput extends BaseRenderInput {
	project: string;
	template: string;
	version?: string;
}

/**
 * Render with raw HTML inline. No project resolution.
 */
export interface InlineModeInput extends BaseRenderInput {
	project?: never;
	template: string;
	version?: never;
}

/**
 * Input accepted by all render methods. Either project mode (resolved by slug)
 * or inline mode (raw HTML in `template`).
 */
export type RenderInput = ProjectModeInput | InlineModeInput;

export interface PreviewResult {
	html: string;
	totalPages: number;
}

export interface ThumbnailOptions {
	width: number;
	format?: 'png' | 'jpeg';
	quality?: number;
	page?: number;
	pages?: number[];
}

export interface Thumbnail {
	page: number;
	width: number;
	height: number;
	contentType: string;
	data: string;
}

export interface RequestEvent {
	method: string;
	url: string;
	attempt: number;
}

export interface ResponseEvent {
	status: number;
	requestId?: string;
	durationMs: number;
}

export interface RetryEvent {
	attempt: number;
	delayMs: number;
	reason: import('./error.js').PoliPageError;
}

export interface PoliPageOptions {
	apiKey: string;
	baseUrl?: string;
	maxRetries?: number;
	retryDelay?: number;
	timeout?: number;
	onRequest?: (e: RequestEvent) => void;
	onResponse?: (e: ResponseEvent) => void;
	onRetry?: (e: RetryEvent) => void;
	onError?: (err: import('./error.js').PoliPageError) => void;
}
```

(Note: `RetryEvent.reason` and `onError` reference `PoliPageError` from `./error.js` which doesn't exist yet — Task 2.3 creates it. Tests in this task don't import these, so the file compiles via type-only imports.)

- [ ] **Step 2: Re-export public types from `src/index.ts`**

In `src/index.ts`, replace the type definitions block (the `PoliPageOptions`, `PageFormat`, `Orientation`, `RenderInput`, `PreviewResult`, `Thumbnail`, `ThumbnailOptions` interfaces and types) with:

```ts
export type {
	PageFormat,
	Orientation,
	ProjectModeInput,
	InlineModeInput,
	RenderInput,
	PreviewResult,
	Thumbnail,
	ThumbnailOptions,
	PoliPageOptions,
	RequestEvent,
	ResponseEvent,
	RetryEvent,
} from './types.js';

import type { RenderInput, PreviewResult, Thumbnail, ThumbnailOptions, PoliPageOptions } from './types.js';
```

(Use `import type` for what `src/index.ts` itself uses; the `export type` line re-exports for consumers.)

- [ ] **Step 3: Verify typecheck and tests still pass**

Run: `pnpm typecheck && pnpm test`
Expected: both pass; the discriminated union doesn't break existing tests because they use shapes that match either `ProjectModeInput` or `InlineModeInput`.

- [ ] **Step 4: Create type-level tests file `tests/types.test-d.ts`**

```ts
import { expectTypeOf, test } from 'vitest';
import type { RenderInput, ProjectModeInput, InlineModeInput } from '../src/types.js';
import { PoliPage } from '../src/index.js';

test('ProjectModeInput requires project and template', () => {
	expectTypeOf<{ project: string; template: string; data: Record<string, unknown> }>().toMatchTypeOf<ProjectModeInput>();
});

test('InlineModeInput requires template, forbids project', () => {
	expectTypeOf<{ template: string; data: Record<string, unknown> }>().toMatchTypeOf<InlineModeInput>();
});

test('render() rejects invalid combos at compile time', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
	// Valid inline mode:
	void c.render({ template: '<p>x</p>', data: {} });
	// Valid project mode:
	void c.render({ project: 'billing', template: 'invoice', data: {} });
	// @ts-expect-error — project mode requires template
	void c.render({ project: 'billing', data: {} });
	// @ts-expect-error — at least template required
	void c.render({ data: {} });
});

test('render returns Promise<Uint8Array>', () => {
	const c = new PoliPage({ apiKey: 'pp_test_x' });
	expectTypeOf(c.render).returns.resolves.toEqualTypeOf<Uint8Array>();
});
```

- [ ] **Step 5: Configure Vitest typecheck**

Modify `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		typecheck: {
			enabled: true,
			include: ['tests/**/*.test-d.ts'],
		},
	},
});
```

- [ ] **Step 6: Run typecheck tests**

Run: `pnpm vitest run --typecheck`
Expected: 4 type tests pass.

- [ ] **Step 7: Add `test:types` script**

In `package.json` `scripts`:
```json
"test:types": "vitest run --typecheck"
```

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/index.ts tests/types.test-d.ts vitest.config.ts package.json
git commit -m "feat!: extract types and discriminate RenderInput (project vs inline mode)

BREAKING CHANGE: RenderInput is now a discriminated union; combos that
previously compiled but failed at runtime (e.g. project without template)
now fail at compile time."
```

---

### Task 2.3: Extract `PoliPageError` to `src/error.ts` with typed `code` and predicates

**Files:**
- Create: `src/error.ts`
- Create: `tests/error.test.ts`
- Modify: `src/index.ts` (re-export from error.ts, remove inline class)

- [ ] **Step 1: Write failing tests in `tests/error.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { PoliPageError } from '../src/error.js';

describe('PoliPageError', () => {
	it('isAuthError() is true for status 401 and 403', () => {
		expect(new PoliPageError('m', 'INVALID_API_KEY', 401).isAuthError()).toBe(true);
		expect(new PoliPageError('m', 'FORBIDDEN', 403).isAuthError()).toBe(true);
		expect(new PoliPageError('m', 'NOT_FOUND', 404).isAuthError()).toBe(false);
		expect(new PoliPageError('m', 'network_error').isAuthError()).toBe(false);
	});

	it('isRateLimitError() is true for status 429', () => {
		expect(new PoliPageError('m', 'rate_limited', 429).isRateLimitError()).toBe(true);
		expect(new PoliPageError('m', 'INTERNAL_ERROR', 500).isRateLimitError()).toBe(false);
	});

	it('isValidationError() is true for status 400', () => {
		expect(new PoliPageError('m', 'VALIDATION_ERROR', 400).isValidationError()).toBe(true);
		expect(new PoliPageError('m', 'INVALID_API_KEY', 401).isValidationError()).toBe(false);
	});

	it('isNetworkError() is true for code "network_error" and "timeout"', () => {
		expect(new PoliPageError('m', 'network_error').isNetworkError()).toBe(true);
		expect(new PoliPageError('m', 'timeout').isNetworkError()).toBe(true);
		expect(new PoliPageError('m', 'aborted').isNetworkError()).toBe(false);
		expect(new PoliPageError('m', 'INTERNAL_ERROR', 500).isNetworkError()).toBe(false);
	});

	it('isRetryable() is true for 5xx, 429, network_error, timeout', () => {
		expect(new PoliPageError('m', 'INTERNAL_ERROR', 500).isRetryable()).toBe(true);
		expect(new PoliPageError('m', 'INTERNAL_ERROR', 502).isRetryable()).toBe(true);
		expect(new PoliPageError('m', 'rate_limited', 429).isRetryable()).toBe(true);
		expect(new PoliPageError('m', 'network_error').isRetryable()).toBe(true);
		expect(new PoliPageError('m', 'timeout').isRetryable()).toBe(true);
		expect(new PoliPageError('m', 'VALIDATION_ERROR', 400).isRetryable()).toBe(false);
		expect(new PoliPageError('m', 'aborted').isRetryable()).toBe(false);
	});

	it('preserves message, code, status, requestId fields', () => {
		const err = new PoliPageError('boom', 'INTERNAL_ERROR', 500, 'req_abc');
		expect(err.message).toBe('boom');
		expect(err.code).toBe('INTERNAL_ERROR');
		expect(err.status).toBe(500);
		expect(err.requestId).toBe('req_abc');
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(PoliPageError);
		expect(err.name).toBe('PoliPageError');
	});
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test tests/error.test.ts`
Expected: FAIL — `src/error.ts` doesn't exist.

- [ ] **Step 3: Create `src/error.ts`**

```ts
type SdkInternalCode = 'invalid_options' | 'network_error' | 'timeout' | 'aborted';

type ApiCode =
	| 'INVALID_API_KEY'
	| 'MISSING_API_KEY'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'VERSION_NOT_FOUND'
	| 'VALIDATION_ERROR'
	| 'MISSING_DATA'
	| 'MISSING_PROJECT_OR_TEMPLATE'
	| 'MISSING_TEMPLATE_SLUG'
	| 'INTERNAL_ERROR';

/**
 * Known error codes raised by the SDK or returned by the API.
 * The `(string & {})` extension keeps autocomplete on known codes while
 * still accepting forward-compat codes the API may add in the future.
 */
export type PoliPageErrorCode = SdkInternalCode | ApiCode | (string & {});

/**
 * Single error type for everything raised by the SDK: API errors,
 * network failures, timeouts, caller cancellation, and constructor
 * validation failures.
 */
export class PoliPageError extends Error {
	readonly code: PoliPageErrorCode;
	readonly status?: number;
	readonly requestId?: string;

	constructor(message: string, code: PoliPageErrorCode, status?: number, requestId?: string) {
		super(message);
		this.name = 'PoliPageError';
		this.code = code;
		this.status = status;
		this.requestId = requestId;
	}

	isAuthError(): boolean {
		return this.status === 401 || this.status === 403;
	}

	isRateLimitError(): boolean {
		return this.status === 429;
	}

	isValidationError(): boolean {
		return this.status === 400;
	}

	isNetworkError(): boolean {
		return this.code === 'network_error' || this.code === 'timeout';
	}

	isRetryable(): boolean {
		if (this.code === 'aborted') return false;
		if (this.isNetworkError()) return true;
		if (this.status !== undefined && this.status >= 500) return true;
		if (this.status === 429) return true;
		return false;
	}
}
```

- [ ] **Step 4: Replace inline `PoliPageError` in `src/index.ts`**

Find the existing `PoliPageError` class definition in `src/index.ts` and delete it. Add at the top of `src/index.ts`:
```ts
export { PoliPageError, type PoliPageErrorCode } from './error.js';
import { PoliPageError } from './error.js';
```

- [ ] **Step 5: Run all tests, verify pass**

Run: `pnpm test`
Expected: existing tests still pass + 6 new error tests pass (31 total).

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add src/error.ts src/index.ts tests/error.test.ts
git commit -m "feat: typed PoliPageError code union + predicates (isAuthError, isRateLimitError, isRetryable, isNetworkError, isValidationError)"
```

---

### Task 2.4: Per-call `signal?: AbortSignal` (caller cancellation)

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe` block in `tests/index.test.ts`:

```ts
describe('cancellation (signal option)', () => {
	it('aborts in-flight request when caller signal is aborted', async () => {
		setMockHandler((_req, res) => {
			// Hang the response so we can abort mid-flight
			setTimeout(() => res.end(Buffer.from('%PDF-1.4 ok')), 5_000);
		});
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
		const controller = new AbortController();
		const promise = client.render({ template: '<p>x</p>', data: {}, signal: controller.signal });
		setTimeout(() => controller.abort(), 50);
		await expect(promise).rejects.toMatchObject({ name: 'PoliPageError', code: 'aborted' });
	});

	it('rejects immediately if signal is already aborted before call', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
		const controller = new AbortController();
		controller.abort();
		await expect(
			client.render({ template: '<p>x</p>', data: {}, signal: controller.signal }),
		).rejects.toMatchObject({ name: 'PoliPageError', code: 'aborted' });
	});

	it('aborted error has no status (transport-level)', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
		const controller = new AbortController();
		controller.abort();
		try {
			await client.render({ template: '<p>x</p>', data: {}, signal: controller.signal });
			expect.fail('Should have thrown');
		} catch (err) {
			expect((err as PoliPageError).status).toBeUndefined();
		}
	});
});
```

- [ ] **Step 2: Run, verify failures**

Run: `pnpm test -- -t "cancellation"`
Expected: 3 tests fail.

- [ ] **Step 3: Implement signal handling**

In `src/index.ts`, modify `#request` to accept and compose a caller signal. Refactor the method signature:

```ts
async #request(path: string, body: object, signal?: AbortSignal): Promise<Response> {
	if (signal?.aborted) {
		throw new PoliPageError('Request was aborted', 'aborted');
	}

	let lastError: PoliPageError | undefined;
	let nextRetryAfterMs: number | undefined;

	for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
		if (attempt > 0) {
			let delay: number;
			if (nextRetryAfterMs !== undefined) {
				delay = nextRetryAfterMs;
			} else {
				const exp = this.#retryDelay * Math.pow(2, attempt - 1);
				const jitterFactor = 0.5 + Math.random();
				delay = Math.round(exp * jitterFactor);
			}
			await this.#sleep(delay, signal);
			nextRetryAfterMs = undefined;
		}

		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), this.#timeout);
		const composed = signal
			? AbortSignal.any([signal, timeoutController.signal])
			: timeoutController.signal;

		let response: Response;
		try {
			response = await fetch(`${this.#baseUrl}${path}`, {
				method: 'POST',
				headers: this.#headers(path),
				body: JSON.stringify(body),
				signal: composed,
			});
		} catch (err) {
			clearTimeout(timeoutId);
			if (signal?.aborted) {
				throw new PoliPageError('Request was aborted', 'aborted');
			}
			const aborted = err instanceof Error && err.name === 'AbortError';
			lastError = new PoliPageError(
				aborted ? `Request timed out after ${this.#timeout}ms` : (err as Error).message,
				aborted ? 'timeout' : 'network_error',
			);
			if (attempt < this.#maxRetries) continue;
			throw lastError;
		}
		clearTimeout(timeoutId);

		if (response.ok) return response;

		const requestId = response.headers.get('x-request-id') ?? undefined;
		nextRetryAfterMs = parseRetryAfter(response.headers.get('retry-after'));

		const errorBody = await response.text();
		let code: string;
		let message: string;
		try {
			const json = JSON.parse(errorBody) as { code?: string; message?: string; error?: string };
			code = json.code ?? json.error ?? 'unknown_error';
			message = json.message ?? `API error (${response.status}): ${code}`;
		} catch {
			code = 'INTERNAL_ERROR';
			message = `API error ${response.status}: response body was not valid JSON`;
		}

		lastError = new PoliPageError(message, code, response.status, requestId);

		const isRetryable = response.status >= 500 || response.status === 429;
		if (!isRetryable) throw lastError;
	}

	throw lastError!;
}

#sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		if (signal) {
			const onAbort = () => {
				clearTimeout(timer);
				reject(new PoliPageError('Request was aborted', 'aborted'));
			};
			if (signal.aborted) {
				onAbort();
			} else {
				signal.addEventListener('abort', onAbort, { once: true });
			}
		}
	});
}
```

Update each render method to forward `input.signal` to `#request`:

```ts
async render(input: RenderInput): Promise<Uint8Array> {
	const response = await this.#request('/v1/render/pdf', input, input.signal);
	// ...
}
async preview(input: RenderInput): Promise<PreviewResult> {
	const response = await this.#request('/v1/render/preview', input, input.signal);
	// ...
}
async thumbnails(input: RenderInput, options: ThumbnailOptions): Promise<Thumbnail[]> {
	const body = { ...input, thumbnails: options };
	const response = await this.#request('/v1/render/thumbnails', body, input.signal);
	// ...
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test`
Expected: 34 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: per-call AbortSignal support, code 'aborted' for caller cancellation"
```

---

### Task 2.5: Auto-generated UUID v4 `Idempotency-Key`

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe` block:

```ts
describe('Idempotency-Key', () => {
	it('auto-generates an Idempotency-Key header in UUID v4 format', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		await client.render({ template: '<p>x</p>', data: {} });
		const key = lastRequest.headers['idempotency-key'];
		expect(key).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	it('reuses the same Idempotency-Key across retry attempts of one call', async () => {
		const keys: string[] = [];
		let attempts = 0;
		setMockHandler((req, res) => {
			keys.push(req.headers['idempotency-key'] as string);
			attempts++;
			if (attempts < 3) {
				res.writeHead(503, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ code: 'unavailable' }));
			} else {
				res.writeHead(200, { 'Content-Type': 'application/pdf' });
				res.end(Buffer.from('%PDF-1.4 ok'));
			}
		});
		const client = new PoliPage({
			apiKey: 'pp_test_x',
			baseUrl,
			maxRetries: 3,
			retryDelay: 10,
		});
		await client.render({ template: '<p>x</p>', data: {} });
		expect(keys).toHaveLength(3);
		expect(new Set(keys).size).toBe(1);
	});

	it('uses caller-provided idempotencyKey when set', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		await client.render({ template: '<p>x</p>', data: {}, idempotencyKey: 'caller-key-123' });
		expect(lastRequest.headers['idempotency-key']).toBe('caller-key-123');
	});
});
```

- [ ] **Step 2: Run, verify failures**

Run: `pnpm test -- -t "Idempotency-Key"`
Expected: 3 tests fail.

- [ ] **Step 3: Plumb the idempotency key through `#request`**

In `src/index.ts`, modify `#headers` to take an optional key:

```ts
#headers(path: string, idempotencyKey: string): Record<string, string> {
	const accept = path === '/v1/render/pdf' ? 'application/pdf' : 'application/json';
	return {
		'Content-Type': 'application/json',
		Accept: accept,
		Authorization: `Bearer ${this.#apiKey}`,
		'User-Agent': `poli-page-sdk-node/${__SDK_VERSION__}`,
		'Idempotency-Key': idempotencyKey,
	};
}
```

In `#request`, generate the key once outside the retry loop:

```ts
async #request(
	path: string,
	body: object,
	signal?: AbortSignal,
	callerIdempotencyKey?: string,
): Promise<Response> {
	if (signal?.aborted) {
		throw new PoliPageError('Request was aborted', 'aborted');
	}
	const idempotencyKey = callerIdempotencyKey ?? randomUUID();
	// ... rest of method, replacing this.#headers(path) with this.#headers(path, idempotencyKey) ...
}
```

Add at the top of `src/index.ts`:
```ts
import { randomUUID } from 'node:crypto';
```

Update render/preview/thumbnails calls to pass the key:
```ts
const response = await this.#request('/v1/render/pdf', input, input.signal, input.idempotencyKey);
```

- [ ] **Step 4: Strip `signal` and `idempotencyKey` from the JSON body**

In `#request`, the body must not include `signal` or `idempotencyKey` (they're SDK options, not API fields). Add:

```ts
const { signal: _s, idempotencyKey: _i, ...wireBody } = body as Record<string, unknown>;
// ...
body: JSON.stringify(wireBody),
```

(Or, more cleanly, do this at the call site in render/preview/thumbnails before passing to `#request`. Pick the cleaner approach when implementing.)

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test`
Expected: 37 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: auto-generate UUID v4 Idempotency-Key, override-able via input.idempotencyKey"
```

---

### Task 2.6: Observability hooks (`onRequest`, `onResponse`, `onRetry`, `onError`)

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe` block:

```ts
describe('observability hooks', () => {
	it('calls onRequest with method, url, attempt', async () => {
		const events: { method: string; url: string; attempt: number }[] = [];
		const client = new PoliPage({
			apiKey: 'pp_test_x',
			baseUrl,
			onRequest: (e) => events.push(e),
		});
		await client.render({ template: '<p>x</p>', data: {} });
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ method: 'POST', attempt: 1 });
		expect(events[0].url).toContain('/v1/render/pdf');
	});

	it('calls onResponse with status, requestId, durationMs', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/pdf', 'x-request-id': 'req_xyz' });
			res.end(Buffer.from('%PDF-1.4 ok'));
		});
		const events: { status: number; requestId?: string; durationMs: number }[] = [];
		const client = new PoliPage({
			apiKey: 'pp_test_x',
			baseUrl,
			onResponse: (e) => events.push(e),
		});
		await client.render({ template: '<p>x</p>', data: {} });
		expect(events).toHaveLength(1);
		expect(events[0].status).toBe(200);
		expect(events[0].requestId).toBe('req_xyz');
		expect(events[0].durationMs).toBeGreaterThanOrEqual(0);
	});

	it('calls onRetry with attempt, delayMs, reason on retried failures', async () => {
		const events: { attempt: number; delayMs: number; reason: PoliPageError }[] = [];
		let attempts = 0;
		setMockHandler((_req, res) => {
			attempts++;
			if (attempts < 2) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ code: 'oops' }));
			} else {
				res.writeHead(200, { 'Content-Type': 'application/pdf' });
				res.end(Buffer.from('%PDF-1.4 ok'));
			}
		});
		const client = new PoliPage({
			apiKey: 'pp_test_x',
			baseUrl,
			maxRetries: 2,
			retryDelay: 5,
			onRetry: (e) => events.push(e),
		});
		await client.render({ template: '<p>x</p>', data: {} });
		expect(events).toHaveLength(1);
		expect(events[0].attempt).toBe(2);
		expect(events[0].reason).toBeInstanceOf(PoliPageError);
	});

	it('calls onError with the thrown PoliPageError when call fails terminally', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ code: 'VALIDATION_ERROR' }));
		});
		const errors: PoliPageError[] = [];
		const client = new PoliPage({
			apiKey: 'pp_test_x',
			baseUrl,
			onError: (err) => errors.push(err),
		});
		await expect(client.render({ template: '<p>x</p>', data: {} })).rejects.toBeInstanceOf(PoliPageError);
		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('VALIDATION_ERROR');
	});

	it('hook errors do not break the request', async () => {
		const client = new PoliPage({
			apiKey: 'pp_test_x',
			baseUrl,
			onRequest: () => {
				throw new Error('hook blew up');
			},
			onResponse: () => {
				throw new Error('hook blew up');
			},
		});
		const pdf = await client.render({ template: '<p>x</p>', data: {} });
		expect(pdf).toBeInstanceOf(Uint8Array);
	});
});
```

- [ ] **Step 2: Run, verify failures**

Run: `pnpm test -- -t "observability hooks"`
Expected: 5 tests fail (or partially fail because hooks aren't implemented).

- [ ] **Step 3: Add hook fields and a safe-call helper**

In `src/index.ts`, add private fields to `PoliPage`:
```ts
readonly #onRequest?: (e: RequestEvent) => void;
readonly #onResponse?: (e: ResponseEvent) => void;
readonly #onRetry?: (e: RetryEvent) => void;
readonly #onError?: (err: PoliPageError) => void;
```

In the constructor, store them:
```ts
this.#onRequest = options.onRequest;
this.#onResponse = options.onResponse;
this.#onRetry = options.onRetry;
this.#onError = options.onError;
```

Add a helper method:
```ts
#fireHook<T>(hook: ((e: T) => void) | undefined, event: T): void {
	if (!hook) return;
	try {
		hook(event);
	} catch {
		// Hooks must not break the request.
	}
}
```

- [ ] **Step 4: Wire hooks into `#request`**

Modify `#request` to fire hooks at the right moments:

- Before `fetch`: `this.#fireHook(this.#onRequest, { method: 'POST', url: ..., attempt: attempt + 1 });`
- After receiving an `ok` response: `this.#fireHook(this.#onResponse, { status, requestId, durationMs });`
- After scheduling a retry (just before sleeping the next iteration): `this.#fireHook(this.#onRetry, { attempt: attempt + 1, delayMs, reason: lastError });`
- Wrap the whole `#request` call in render/preview/thumbnails with a try/catch that fires `onError` on terminal failure. Cleanest: do it inside `#request` at the throw sites. Example:

  ```ts
  if (!isRetryable) {
      this.#fireHook(this.#onError, lastError);
      throw lastError;
  }
  ```
  And similarly at the final `throw lastError!` line.

Track `t0 = Date.now()` before each fetch to compute `durationMs`.

The cleanest pattern (apply this to the existing loop):
```ts
for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
	if (attempt > 0) {
		const delay = /* computed as before */;
		this.#fireHook(this.#onRetry, { attempt: attempt + 1, delayMs: delay, reason: lastError! });
		await this.#sleep(delay, signal);
		nextRetryAfterMs = undefined;
	}
	this.#fireHook(this.#onRequest, {
		method: 'POST',
		url: `${this.#baseUrl}${path}`,
		attempt: attempt + 1,
	});
	const t0 = Date.now();
	// ... fetch ...
	if (response.ok) {
		this.#fireHook(this.#onResponse, {
			status: response.status,
			requestId: response.headers.get('x-request-id') ?? undefined,
			durationMs: Date.now() - t0,
		});
		return response;
	}
	// ... build lastError ...
	if (!isRetryable) {
		this.#fireHook(this.#onError, lastError);
		throw lastError;
	}
}
this.#fireHook(this.#onError, lastError!);
throw lastError!;
```

Also fire `onError` in the network-error branch when out of retries:
```ts
} catch (err) {
	// ... build lastError ...
	if (attempt < this.#maxRetries) continue;
	this.#fireHook(this.#onError, lastError);
	throw lastError;
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test`
Expected: 42 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: observability hooks (onRequest, onResponse, onRetry, onError)"
```

---

### Task 2.7: Add `renderStream()` method

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe` block:

```ts
describe('renderStream()', () => {
	it('returns a ReadableStream', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		const stream = await client.renderStream({ template: '<p>x</p>', data: {} });
		expect(stream).toBeInstanceOf(ReadableStream);
	});

	it('emits the same bytes as render()', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		const bytes = await client.render({ template: '<p>x</p>', data: {} });

		const stream = await client.renderStream({ template: '<p>x</p>', data: {} });
		const chunks: Uint8Array[] = [];
		for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
			chunks.push(chunk);
		}
		const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
		let offset = 0;
		for (const c of chunks) {
			total.set(c, offset);
			offset += c.length;
		}
		expect(total).toEqual(bytes);
	});

	it('propagates upstream errors as PoliPageError', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ code: 'VALIDATION_ERROR' }));
		});
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
		await expect(
			client.renderStream({ template: '<p>x</p>', data: {} }),
		).rejects.toMatchObject({ name: 'PoliPageError', code: 'VALIDATION_ERROR' });
	});

	it('rejects 2xx renderStream response if Content-Type is not application/pdf', async () => {
		setMockHandler((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end('<html>oops</html>');
		});
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl, maxRetries: 0 });
		await expect(
			client.renderStream({ template: '<p>x</p>', data: {} }),
		).rejects.toMatchObject({ name: 'PoliPageError', code: 'INTERNAL_ERROR' });
	});
});
```

- [ ] **Step 2: Run, verify failures**

Run: `pnpm test -- -t "renderStream"`
Expected: 4 tests fail (`renderStream` doesn't exist).

- [ ] **Step 3: Refactor `render()` to use `renderStream()`**

In `src/index.ts`, add:

```ts
async renderStream(input: RenderInput): Promise<ReadableStream<Uint8Array>> {
	const response = await this.#request('/v1/render/pdf', input, input.signal, input.idempotencyKey);
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('application/pdf')) {
		const requestId = response.headers.get('x-request-id') ?? undefined;
		throw new PoliPageError(
			`Expected application/pdf response, got ${contentType || 'no content-type'}`,
			'INTERNAL_ERROR',
			response.status,
			requestId,
		);
	}
	if (!response.body) {
		throw new PoliPageError('Response has no body', 'INTERNAL_ERROR', response.status);
	}
	return response.body as ReadableStream<Uint8Array>;
}
```

Modify `render()` to consume the stream:
```ts
async render(input: RenderInput): Promise<Uint8Array> {
	const stream = await this.renderStream(input);
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.length;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test`
Expected: 46 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: renderStream() returns ReadableStream<Uint8Array>; render() now uses it"
```

---

### Task 2.8: Move `renderToFile` to `@poli-page/sdk/node` sub-export, rebuild on `renderStream`

**Files:**
- Create: `src/node.ts`
- Create: `tests/node.test.ts`
- Modify: `src/index.ts` (remove `renderToFile`)
- Modify: `tsup.config.ts` (add second entry)
- Modify: `package.json` (`exports`, `files`)

- [ ] **Step 1: Write failing tests in `tests/node.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PoliPage } from '../src/index.js';
import { renderToFile } from '../src/node.js';

let server: Server;
let baseUrl: string;
let tempDir: string;

beforeAll(async () => {
	server = createServer((_req, res) => {
		res.writeHead(200, { 'Content-Type': 'application/pdf' });
		res.end(Buffer.from('%PDF-1.4 stream test'));
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const addr = server.address();
	if (typeof addr === 'object' && addr) baseUrl = `http://localhost:${addr.port}`;
	tempDir = await mkdtemp(join(tmpdir(), 'poli-sdk-node-'));
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await rm(tempDir, { recursive: true, force: true });
});

describe('renderToFile (sub-export)', () => {
	it('writes a non-empty PDF to disk', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		const out = join(tempDir, 'a.pdf');
		await renderToFile(client, { template: '<p>x</p>', data: {} }, out);
		const content = await readFile(out);
		expect(new TextDecoder().decode(content.subarray(0, 4))).toBe('%PDF');
		expect(content.length).toBeGreaterThan(0);
	});

	it('creates parent directories that do not exist', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		const out = join(tempDir, 'nested', 'deeply', 'b.pdf');
		await renderToFile(client, { template: '<p>x</p>', data: {} }, out);
		const s = await stat(out);
		expect(s.isFile()).toBe(true);
	});

	it('overwrites existing files', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_x', baseUrl });
		const out = join(tempDir, 'c.pdf');
		await renderToFile(client, { template: '<p>x</p>', data: {} }, out);
		const first = (await stat(out)).size;
		await renderToFile(client, { template: '<p>x</p>', data: {} }, out);
		const second = (await stat(out)).size;
		expect(second).toBe(first);
	});
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test tests/node.test.ts`
Expected: FAIL — `src/node.ts` doesn't exist.

- [ ] **Step 3: Create `src/node.ts`**

```ts
import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';
import type { PoliPage } from './index.js';
import type { RenderInput } from './types.js';

/**
 * Render a PDF and write it to disk. Streams response bytes directly to the
 * file (memory-bounded). Creates parent directories. Overwrites existing files.
 *
 * Node-only — uses `node:fs/promises` and `node:fs`. Import from
 * `@poli-page/sdk/node` rather than the main entry.
 */
export async function renderToFile(
	client: PoliPage,
	input: RenderInput,
	outputPath: string,
): Promise<void> {
	await mkdir(dirname(outputPath), { recursive: true });
	const stream = await client.renderStream(input);
	const fileStream = createWriteStream(outputPath);
	await stream.pipeTo(Writable.toWeb(fileStream) as WritableStream<Uint8Array>);
}
```

- [ ] **Step 4: Remove `renderToFile` method from `src/index.ts`**

Delete the `renderToFile` method on `PoliPage`. Also remove the `import { writeFile, mkdir } from 'node:fs/promises'` and `import { dirname } from 'node:path'` lines from the top of `src/index.ts` if no longer used.

- [ ] **Step 5: Update `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
	entry: ['src/index.ts', 'src/node.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	clean: true,
	sourcemap: true,
	target: 'node20.18',
	define: {
		__SDK_VERSION__: JSON.stringify(pkg.version),
	},
});
```

- [ ] **Step 6: Update `package.json` `exports` and `files`**

```json
"exports": {
	".": {
		"types": "./dist/index.d.ts",
		"import": "./dist/index.js",
		"require": "./dist/index.cjs"
	},
	"./node": {
		"types": "./dist/node.d.ts",
		"import": "./dist/node.js",
		"require": "./dist/node.cjs"
	}
}
```

`files` already contains `dist`, so no change needed there.

- [ ] **Step 7: Remove the now-broken `renderToFile()` test from `tests/index.test.ts`**

Find the existing `describe('renderToFile()', () => { ... })` block in `tests/index.test.ts` and delete it (the new tests live in `tests/node.test.ts`).

- [ ] **Step 8: Run all tests**

Run: `pnpm test`
Expected: all tests pass (~48 total: ~45 in `index.test.ts` + 3 in `node.test.ts` + 6 in `error.test.ts`, minus the 1 deleted `renderToFile` test).

Run: `pnpm typecheck`
Expected: passes.

Run: `pnpm build`
Expected: `dist/` contains both `index.{js,cjs,d.ts}` and `node.{js,cjs,d.ts}`.

- [ ] **Step 9: Commit**

```bash
git add src/node.ts src/index.ts tsup.config.ts package.json tests/node.test.ts tests/index.test.ts
git commit -m "feat!: move renderToFile to @poli-page/sdk/node, rebuild on renderStream

BREAKING CHANGE: renderToFile is no longer a method on PoliPage. Import
it from '@poli-page/sdk/node':

  import { renderToFile } from '@poli-page/sdk/node';
  await renderToFile(client, input, './out.pdf');

The new implementation streams response bytes directly to the file
(memory-bounded for large PDFs)."
```

---

## Phase 3 — Integration tests + pre-push hook

**Goal:** wire up the safety net for real-world API calls.

---

### Task 3.1: Create integration test file

**Files:**
- Create: `tests/integration/render.integration.test.ts`
- Create: `vitest.integration.config.ts`

- [ ] **Step 1: Create `vitest.integration.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/integration/**/*.test.ts'],
		testTimeout: 30_000,
	},
});
```

- [ ] **Step 2: Create `tests/integration/render.integration.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PoliPage, PoliPageError } from '../../src/index.js';
import { renderToFile } from '../../src/node.js';

const apiKey = process.env.POLI_PAGE_API_KEY;
const baseUrl = process.env.POLI_PAGE_BASE_URL ?? 'https://api-develop.poli.page';
const describeIfKey = apiKey ? describe : describe.skip;

describeIfKey('integration: develop API', () => {
	it('renders a real PDF (Inline mode, %PDF magic bytes, > 1KB)', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });
		const pdf = await client.render({
			template: '<h1>{{ name }}</h1>',
			data: { name: 'Integration Test' },
		});
		expect(pdf).toBeInstanceOf(Uint8Array);
		expect(pdf.length).toBeGreaterThan(1000);
		expect(new TextDecoder().decode(pdf.subarray(0, 4))).toBe('%PDF');
	});

	it('preview returns html and totalPages > 0', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });
		const result = await client.preview({
			template: '<p>{{ name }}</p>',
			data: { name: 'Preview Test' },
		});
		expect(typeof result.html).toBe('string');
		expect(result.html.length).toBeGreaterThan(0);
		expect(result.totalPages).toBeGreaterThan(0);
	});

	it('bad API key produces PoliPageError with status 401', async () => {
		const client = new PoliPage({ apiKey: 'pp_test_invalid_xxx', baseUrl, maxRetries: 0 });
		try {
			await client.render({ template: '<p>x</p>', data: {} });
			expect.fail('Should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(PoliPageError);
			expect((err as PoliPageError).status).toBe(401);
			expect((err as PoliPageError).isAuthError()).toBe(true);
		}
	});

	it('renderToFile writes a non-empty PDF to disk', async () => {
		const client = new PoliPage({ apiKey: apiKey!, baseUrl });
		const tempDir = await mkdtemp(join(tmpdir(), 'poli-sdk-int-'));
		const out = join(tempDir, 'integration.pdf');
		try {
			await renderToFile(client, { template: '<p>integration</p>', data: {} }, out);
			const s = await stat(out);
			expect(s.size).toBeGreaterThan(1000);
			const content = await readFile(out);
			expect(new TextDecoder().decode(content.subarray(0, 4))).toBe('%PDF');
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
```

- [ ] **Step 3: Add `test:integration` script to `package.json`**

```json
"test:integration": "vitest run --config vitest.integration.config.ts"
```

- [ ] **Step 4: Verify locally without a key (should skip)**

Run: `pnpm test:integration`
Expected: tests are skipped (`describe.skip`), exits 0.

- [ ] **Step 5: Test locally with a key**

Manual: obtain a `pp_test_*` key from Xavier or the develop dashboard. Create a `.env` file (do NOT commit) with `POLI_PAGE_API_KEY=pp_test_...`. Run:

```bash
export $(cat .env | xargs)
pnpm test:integration
```
Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/render.integration.test.ts vitest.integration.config.ts package.json
git commit -m "test: integration suite hits develop API (4 tests, env-gated by POLI_PAGE_API_KEY)"
```

---

### Task 3.2: Wire integration tests into the pre-push hook

**Files:**
- Modify: `package.json` (simple-git-hooks block)

- [ ] **Step 1: Update the pre-push hook to run integration tests with a bypass**

In `package.json`, replace the `simple-git-hooks` block:
```json
"simple-git-hooks": {
	"pre-push": "pnpm lint && pnpm typecheck && pnpm test && [ -n \"$SKIP_INTEGRATION\" ] || pnpm test:integration"
}
```

- [ ] **Step 2: Re-run prepare to update the hook**

Run: `pnpm install` (triggers `prepare` → `simple-git-hooks` updates `.git/hooks/pre-push`).

Verify: `cat .git/hooks/pre-push` contains the new command.

- [ ] **Step 3: Test the bypass**

Make a trivial doc change (e.g., add a blank line to `CONTRIBUTING.md`), commit it, and try:

```bash
SKIP_INTEGRATION=1 git push --dry-run origin main
```
Expected: hook fires, runs `lint + typecheck + test`, skips integration. Exits 0.

(If `--dry-run` doesn't trigger the hook on your git version, just create a throwaway test branch, push to it, and delete it after.)

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: pre-push hook now runs lint, typecheck, unit + integration tests (with SKIP_INTEGRATION bypass)"
```

---

### Task 3.3: Document the integration setup in CONTRIBUTING.md

**Files:**
- Modify: `CONTRIBUTING.md`

The existing `CONTRIBUTING.md` from Task 0.7 already mentions the integration tests and bypass. Verify the wording is still accurate.

- [ ] **Step 1: Verify CONTRIBUTING.md reflects Phase 3 reality**

Open `CONTRIBUTING.md` and confirm the Integration tests section reads:

```md
## Integration tests

Integration tests hit the develop API. They run automatically on `git push`
via a pre-push hook (`simple-git-hooks`). To run them locally:

bash
export POLI_PAGE_API_KEY=pp_test_...
pnpm test:integration

To skip integration tests on push (e.g. doc-only changes):

bash
SKIP_INTEGRATION=1 git push
```

If wording differs, update it. If it matches, no commit needed for this step.

---

## Phase 4 — Documentation

**Goal:** README rewrite per the design spec §7. CHANGELOG updated. Badges. ~180 lines.

---

### Task 4.1: Rewrite README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md` contents**

Open `README.md` and replace the entire file with the following (~180 lines):

```md
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
```

- [ ] **Step 2: Verify length**

Run: `wc -l README.md`
Expected: ~180 lines (give or take 20).

- [ ] **Step 3: Visual sanity check**

Open `README.md` in a Markdown previewer (VS Code preview, GitHub Desktop, etc.). Verify all code blocks render correctly, table alignment is good, no broken links.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for v1.0.0 (full method coverage, error handling, hooks, links to docs site)"
```

---

### Task 4.2: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update CHANGELOG with all v1.0.0 entries**

Replace the existing `## [Unreleased]` block with:

```md
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

## [0.1.0] - 2026-04-26

### Added
- Initial repository scaffolding: `package.json`, TypeScript and Vitest config, MIT license, README, contributor-friendly file layout.
- Public type definitions: `PoliPageOptions`, `RenderInput`, `PreviewResult`, `Thumbnail`, `ThumbnailOptions`, and the typed `PoliPageError` class with `code`, `status`, and `requestId` fields.
- Strongly-typed `PageFormat` union covering all 12 canonical Poli Page formats and `Orientation` union.
- Full HTTP transport for the four `PoliPage` methods (`render`, `renderToFile`, `preview`, `thumbnails`) using the global `fetch` API with Bearer authentication.
- Per-request `timeout` option (default 60s) backed by `AbortController`.
- Retry policy with exponential backoff: retries only on 5xx and network errors, never on 4xx; capped by `maxRetries` (default 2).
- Capture of `x-request-id` response header on errors for support and debugging.
- Test suite mirrors the platform spec: constructor, render, renderToFile, preview, thumbnails, retry logic, and request-id propagation.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for v1.0.0 (added/changed/fixed)"
```

---

## Phase 5 — Release

**Goal:** ship 1.0.0 to npm.

---

### Task 5.1: Final smoke run

- [ ] **Step 1: Local full pipeline**

Run:
```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:types
pnpm test:integration   # requires POLI_PAGE_API_KEY in env
pnpm build
pnpm pack
tar -tf poli-page-sdk-*.tgz
rm poli-page-sdk-*.tgz
```
Expected: every step passes. Tarball contains:
- `package/dist/index.js`, `index.cjs`, `index.d.ts`, `index.d.cts` (or just `.d.ts` if tsup emits one)
- `package/dist/node.js`, `node.cjs`, `node.d.ts`
- `package/README.md`, `LICENSE`, `package.json`

- [ ] **Step 2: Smoke install in a sandbox**

```bash
mkdir /tmp/poli-smoke && cd /tmp/poli-smoke
npm init -y
npm install /Users/mickael/Projects/sdk-node/poli-page-sdk-*.tgz   # path to a fresh pack
node -e "
  const { PoliPage } = require('@poli-page/sdk');
  console.log('CJS ok:', typeof PoliPage);
"
node --input-type=module -e "
  import { PoliPage } from '@poli-page/sdk';
  console.log('ESM ok:', typeof PoliPage);
"
node --input-type=module -e "
  import { renderToFile } from '@poli-page/sdk/node';
  console.log('sub-export ok:', typeof renderToFile);
"
cd - && rm -rf /tmp/poli-smoke
```
Expected: all three log `... ok: function`.

If any of these fail, fix before proceeding to Task 5.2.

---

### Task 5.2: Bump version and CHANGELOG

**Files:**
- Modify: `package.json` (version)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump `package.json` version to `1.0.0`**

Replace `"version": "0.1.0"` with `"version": "1.0.0"`.

- [ ] **Step 2: Move `[Unreleased]` to `[1.0.0] - YYYY-MM-DD`**

In `CHANGELOG.md`, replace `## [Unreleased]` (the heading line, not the body) with:
```
## [Unreleased]

## [1.0.0] - 2026-04-27
```
(adjust the date to the actual release day)

- [ ] **Step 3: Commit (NOT yet tagged)**

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): 1.0.0"
```

---

### Task 5.3: Tag and push

- [ ] **Step 1: Verify `NPM_TOKEN` secret exists in GitHub**

Manual: open `github.com/poli-page/sdk-node/settings/secrets/actions`. Confirm `NPM_TOKEN` is present. If missing, generate a granular access token at npmjs.com (scope: write to `@poli-page/sdk`) and add it.

- [ ] **Step 2: Push the release commit**

```bash
git push origin main
```
Expected: pre-push hook runs full suite, passes, commit lands on origin.

- [ ] **Step 3: Create the tag**

```bash
git tag v1.0.0
git push origin v1.0.0
```

- [ ] **Step 4: Watch the publish workflow**

Manual: open `github.com/poli-page/sdk-node/actions`. Find the `Publish` workflow run for tag `v1.0.0`. Confirm it goes green.

If it fails:
- Read the workflow logs.
- Common failure: `NPM_TOKEN` missing/expired → fix the secret, delete the tag (`git tag -d v1.0.0 && git push origin :refs/tags/v1.0.0`), re-tag, re-push.
- Common failure: `version` mismatch between tag and `package.json` → bump `package.json`, commit, delete tag, re-tag.

---

### Task 5.4: Verify on npm

- [ ] **Step 1: Confirm package is live**

Run:
```bash
pnpm view @poli-page/sdk
```
Expected: shows version `1.0.0`, repository link, etc.

- [ ] **Step 2: Install in a fresh sandbox and run quick-start**

```bash
mkdir /tmp/poli-prod-smoke && cd /tmp/poli-prod-smoke
npm init -y
npm install @poli-page/sdk
cat > smoke.mjs <<'EOF'
import { PoliPage } from '@poli-page/sdk';
const client = new PoliPage({
  apiKey: process.env.POLI_PAGE_API_KEY,
  baseUrl: 'https://api-develop.poli.page',
});
const pdf = await client.render({
  template: '<h1>npm install smoke test</h1>',
  data: {},
});
console.log('PDF size:', pdf.length, 'bytes');
console.log('Magic:', new TextDecoder().decode(pdf.subarray(0, 4)));
EOF
POLI_PAGE_API_KEY=pp_test_... node smoke.mjs
cd - && rm -rf /tmp/poli-prod-smoke
```
Expected: prints PDF size > 1000, Magic: `%PDF`.

- [ ] **Step 3: Update CHANGELOG.md if release date was off**

If the date in `[1.0.0] - ...` doesn't match the actual publish date, fix it with a small follow-up commit:
```bash
# (only if needed)
git add CHANGELOG.md
git commit -m "docs: correct 1.0.0 release date"
git push
```

🎉 1.0.0 is live. The SDK is ready for the recipes phase (P0 0.1) and downstream framework integrations (`@poli-page/nextjs`, `@poli-page/nestjs`).

---

## Self-review checklist (filled by author)

**Spec coverage:**
- §3 (8 spec gaps) → Tasks 1.1–1.7 + spec doc update in 1.8 ✅
- §4 (9 public API additions) → Tasks 2.1–2.8 (note: 2.9 is folded into 1.7 since the constructor change happens in Phase 1; the spec doc reflects this) ✅
- §5 (11 tooling items) → Tasks 0.1–0.7 ✅
- §6 (test plan) → distributed across all phases; integration suite in Task 3.1 ✅
- §7 (README) → Task 4.1 ✅
- §8 (5 phases) → Phase 0 (8 tasks), Phase 1 (8 tasks), Phase 2 (8 tasks), Phase 3 (3 tasks), Phase 4 (2 tasks), Phase 5 (4 tasks) — 33 tasks total ✅

**Placeholder scan:**
- No "TBD", "TODO", "implement later" anywhere.
- Every code step shows actual code.
- Every command is concrete with expected output.

**Type consistency:**
- `PoliPageError`'s `code` field uses `PoliPageErrorCode` consistently (defined in `src/error.ts` Task 2.3, referenced wherever errors are raised).
- `RenderInput` is consistently a discriminated union from Task 2.2 onward.
- `renderToFile` signature is `(client, input, outputPath)` everywhere (Tasks 2.8, 3.1, 4.1).
- `__SDK_VERSION__` global is declared in Task 0.3 and used in Task 1.1.
