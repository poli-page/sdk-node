# `@poli-page/sdk` — release readiness punch-list

**Status**: Captured 2026-04-29, before tagging 1.0.0
**Source**: derived from the production-grade SDK audit run on 2026-04-28 against the published tarballs of `stripe@22.1.0`, `@anthropic-ai/sdk@0.91.1`, `openai@6.35.0`, and `@vercel/sdk@1.19.40`, plus npm/`arethetypeswrong`/`publint`/SemVer/Keep-a-Changelog docs.

## Verdict

The SDK is roughly 80% of the way to 1.0.0-shippable. The work to date covered the architectural pieces (refactor, isomorphism, demos, manual publish flow) — what remains is a half-day of validation gates and a few documentation polish items. Once the items in §1 are green, the SDK is publishable.

---

## §1 — Must-do (blocks 1.0)

These are validation gates that catch real bugs cheaply. Without them, a 1.0 release could ship subtle breakage that only surfaces in user reports.

- [ ] **Add `arethetypeswrong` to CI.** Catches `FalseCJS`, `FalseESM`, `CJSResolvesToESM`, `FalseExportDefault`, `MissingExportEquals`, `NamedExports`. The published types are currently unvalidated against TypeScript's resolver matrix — could be wrong without us knowing.
  - **How**: `pnpm add -D @arethetypeswrong/cli`, add a `pretest` or `prepublishOnly` step: `attw --pack`. Add to `ci.yml`.
  - **Acceptance**: zero problems reported on `pnpm pack` output, all eight problem categories.
  - **Effort**: ~30 min.

- [ ] **Add `publint` to CI.** Catches `exports` map misordering, dual-package hazards, condition issues, sideEffects misconfig, missing files. Different blind spot from `attw`.
  - **How**: `pnpm add -D publint`, run `publint --strict` against the packed tarball.
  - **Acceptance**: zero errors, zero warnings.
  - **Effort**: ~15 min.

- [ ] **Replace the fake CI pack smoke with a real install smoke.** `ci.yml:48` only does `tar -tf | grep` — file existence, not resolution. A real smoke packs the tarball, installs it into a throwaway directory, and runs `import`/`require` from both ESM and CJS. Without this, nothing in CI catches a broken `exports` map.
  - **How**: in `ci.yml`, after `pnpm pack`: create a tmp dir, `pnpm init -y` + install the tarball, write `smoke.mjs` with `import {PoliPage} from '@poli-page/sdk'` and `smoke.cjs` with `require`, run both.
  - **Acceptance**: both files run without error and `console.log(typeof PoliPage)` prints `function`.
  - **Effort**: ~45 min (CI debugging usually takes longer than expected).

- [ ] **Wire `pnpm test:types` into CI.** The script and the type tests in `tests/types.test-d.ts` exist but `ci.yml` never calls them. Type regressions ship silently.
  - **How**: add `- name: Type tests\n  run: pnpm test:types` to the matrix job in `ci.yml`.
  - **Acceptance**: type tests run on every push and PR.
  - **Effort**: ~5 min.

- [ ] **Tighten `prepublishOnly`.** Currently runs only `build`. If anyone bypasses `scripts/publish.sh` and runs `pnpm publish` directly, lint/typecheck/test are skipped. Belt-and-suspenders.
  - **How**: change `package.json`'s `prepublishOnly` to `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
  - **Acceptance**: `pnpm publish --dry-run` runs all four checks.
  - **Effort**: ~2 min.

- [ ] **Add `@example` blocks to public methods.** `render`, `renderStream`, `preview`, `thumbnails`, `renderToFile`, the `PoliPage` constructor, `PoliPageError` predicates. One realistic example per symbol drives editor autocomplete UX.
  - **How**: TSDoc with `@example` triple-fenced code blocks in `src/index.ts`, `src/error.ts`, `src/node.ts`.
  - **Acceptance**: every public symbol has an `@example` in the published `.d.ts`. Hovering in VS Code shows the example.
  - **Effort**: ~30 min.

- [ ] **Decide and document the browser-support story.** The README is silent. The SDK is now isomorphic enough to work in browsers (proven by `tests/isomorphism.test.ts`), but you haven't said "yes" or "no" or "yes via this caveat". Ambiguity bites.
  - **How**: add a short "Runtime support" section to the README — name what's supported (Node 20.18+, Cloudflare Workers, Vercel Edge, Deno, Bun) and what isn't (browsers if not, or browsers via X if yes).
  - **Acceptance**: a user reading the README can answer "does it run in my runtime?" in 10 seconds.
  - **Effort**: ~10 min.

- [ ] **Add `MIGRATION.md` stub.** Even a one-paragraph file is the right precedent: 0.1.0 was unpublished, no migration needed today, future major bumps document changes here.
  - **How**: `MIGRATION.md` at repo root, template the structure with `## 1.0` heading.
  - **Acceptance**: file exists, references it from the CHANGELOG.
  - **Effort**: ~5 min.

- [ ] **Add a bundle-size budget to CI.** Today's package is 12 KB minified ESM; without enforcement, drift to 50 KB across releases is invisible. Catches accidental fat dependencies.
  - **How**: `pnpm add -D size-limit @size-limit/preset-small-lib`, configure a 50 KB budget in `package.json` `size-limit` field, add a CI step `pnpm size`.
  - **Acceptance**: CI fails if `dist/index.js` exceeds 50 KB minified+gzipped.
  - **Effort**: ~20 min.

- [ ] **Document the prerelease channel policy in `CONTRIBUTING.md`.** Once 1.0.0 ships, every breaking change needs a major bump. Without a `1.0.0-rc.N`/`-beta.N` channel published under the `next` dist-tag, the path from "breaking change in main" to "user can opt in" is undocumented.
  - **How**: add a section to `CONTRIBUTING.md` covering: when to use `latest` vs `next` dist-tag, how to publish a prerelease (`pnpm publish --tag next`), how users opt in (`pnpm add @poli-page/sdk@next`).
  - **Acceptance**: a future contributor reading `CONTRIBUTING.md` knows how to ship an alpha/beta/rc.
  - **Effort**: ~15 min.

- [ ] **Generate and host TypeDoc.** README is good for "first paint" but doesn't render method-by-method API reference. Most production SDKs auto-generate this and host it.
  - **How**: `pnpm add -D typedoc`, configure `typedoc.json` to read from `src/index.ts` + `src/node.ts`, output to `docs-site/`. Either commit the output or wire to GitHub Pages via Actions. Update `README` to link to it.
  - **Acceptance**: a docs site exists and the README links to it. Hovering over a method in the docs site shows the same `@example` blocks as the editor.
  - **Effort**: ~half-day (typedoc config + hosting + cross-linking with `docs.poli.page`).

**Total §1 effort**: ~half a day, mostly mechanical. The longest single item is TypeDoc.

---

## §2 — Should-do (1.0 or 1.1)

Quality-of-life work. None of these block a 1.0 publish. They make the SDK feel polished and reduce ongoing maintenance burden.

- [ ] **Ship declaration maps** (`.d.ts.map`, `.d.cts.map`). Lets users "Go to Definition" jump into the typed source. Anthropic and OpenAI both ship them.
  - **How**: in `tsup.config.ts`, set `dts: { entry: ..., declarationMap: true }` (or equivalent).
  - **Effort**: ~10 min.

- [ ] **Add a CI badge row to the README**: npm version, install size (via packagephobia), CI status, license, types (TypeScript). Trust signals for prospective users.
  - **Effort**: ~15 min.

- [ ] **Build framework-specific recipes under `examples/`.** The `demo/` covers the SDK API tour but doesn't show "drop into a Next.js App Router handler" or "AWS Lambda function" — that's where most users actually adopt.
  - **Suggested entries**: `examples/nextjs-app-router/`, `examples/express/`, `examples/aws-lambda/`. Each its own `package.json`, README, and a single working file.
  - **Effort**: ~half day per recipe.

- [ ] **Add Dependabot or Renovate config.** Automated dev-dep updates with a weekly cadence. Security baseline.
  - **How**: `.github/dependabot.yml` with `npm` ecosystem on `weekly` schedule.
  - **Effort**: ~10 min.

- [ ] **Add GitHub issue and PR templates.** Light touch, sets expectations on bug reports.
  - **How**: `.github/ISSUE_TEMPLATE/{bug.yml, feature.yml}`, `.github/PULL_REQUEST_TEMPLATE.md`.
  - **Effort**: ~30 min.

- [ ] **Manual-trigger publish workflow with `--provenance`.** `npm publish --provenance` requires GitHub Actions OIDC, which we removed. A `workflow_dispatch` workflow that publishes on a button-click in the GitHub UI (after entering the version as input) gives you both manual control AND signed Sigstore attestation. Best of both.
  - **How**: new `.github/workflows/publish.yml` with `on: workflow_dispatch` only (no auto-trigger), inputs for `version`, runs the same gates as `scripts/publish.sh`, calls `pnpm publish --provenance`.
  - **Trade-off vs. local script**: no local-machine state pollution, signed attestation; but adds a CI dependency. Document both paths in `CONTRIBUTING.md` and let the maintainer pick per release.
  - **Effort**: ~1 hour.

- [ ] **Add `arethetypeswrong` and `publint` badges to the README** once §1's checks land. Standard trust signals in the TypeScript ecosystem.
  - **Effort**: ~5 min.

---

## §3 — Won't-do (judgment calls explained)

These were flagged by the audit as "MUST" but I believe the existing approach is correct. Documenting here so we don't re-debate them every six months.

- **Single `PoliPageError` class with predicate methods (not a class hierarchy).** Stripe and Anthropic ship subclasses (`AuthError`, `RateLimitError`, etc.). Our shape — `err.isAuthError()` — avoids the well-known cross-realm `instanceof` bug, narrows cleaner in TypeScript, and is the right call for an SDK that gets bundled into edge runtimes where realm boundaries matter. **Keep as is.**
- **`demo/` instead of `examples/`.** Convention varies. `demo/` reads as "runnable end-to-end programs"; `examples/` reads as "code snippets". Both are legitimate. The README is explicit about which ours are. **Keep `demo/` for runnable demos; if/when we add framework recipes (§2), put them under `examples/`** — both directories can coexist with different roles.
- **No retry on `408 Request Timeout`.** Some SDKs do; the spec is silent. The current rule (5xx + 429 + transport errors) is conservative and correct — modern HTTP servers rarely return 408, and when they do it's arguably a "client should rethink" signal rather than a transient failure. **Keep as is.**
- **No `CODEOWNERS` file.** Single-maintainer repo for the foreseeable future. Adding one would be theatre. **Skip until there are 2+ regular maintainers.**

---

## §4 — Recommended execution order

Optimized for fast feedback and minimum disruption to the working state.

1. **§1 — `prepublishOnly` tightening** (2 min) — risk-free, immediate.
2. **§1 — `MIGRATION.md` stub** (5 min) — documentation, no code changes.
3. **§1 — Browser-support paragraph in README** (10 min) — documentation only.
4. **§1 — `pnpm test:types` in CI** (5 min) — one CI line.
5. **§1 — `arethetypeswrong` + `publint` in CI** (1 hour combined) — first real validation gate. Likely surfaces something to fix; budget time for it.
6. **§1 — Real install smoke in CI** (45 min) — second validation gate.
7. **§1 — `size-limit` budget** (20 min) — third validation gate.
8. **§1 — `@example` blocks on public methods** (30 min) — code touches `src/`, but no behavior change.
9. **§1 — Prerelease channel policy in `CONTRIBUTING.md`** (15 min) — documentation.
10. **§1 — TypeDoc setup + hosted site** (half a day) — biggest item, do last to maintain momentum.

After step 10: tag `1.0.0`, run `pnpm release`, push the tag. The SDK is publishable.

§2 items can land in 1.0 if there's time, otherwise as 1.0.x patches or 1.1.

---

## §5 — What's already done (for context)

So this list reads as "what's left", here's a snapshot of what's already in place. None of these need touching for 1.0.

| Area | Status |
|---|---|
| `package.json` shape (exports, sideEffects, files allowlist, engines, scoped, public access) | ✓ |
| Dual ESM + CJS build via tsup | ✓ |
| Dual `.d.ts` + `.d.cts` types | ✓ |
| Source maps shipped | ✓ |
| Subpath export `./node` for filesystem helpers | ✓ |
| Isomorphic main entry (no `node:*` imports), regression test | ✓ |
| 93 tests passing (50+ unit + 30 helper + 4 integration + isomorphism) | ✓ |
| `PoliPageError` with code/status/requestId/predicate helpers | ✓ |
| Retry policy (5xx/429, jitter `[0.5, 1.5)`, `Retry-After` honored, cap 30s) | ✓ |
| Auto idempotency keys reused across retries | ✓ |
| Per-call `timeout` and `AbortSignal` | ✓ |
| Observability hooks: `onRequest`, `onResponse`, `onRetry`, `onError` | ✓ |
| Pre-push hook (lint + typecheck + unit + integration, with `SKIP_INTEGRATION` bypass) | ✓ |
| Manual-only release path (`scripts/publish.sh`, `pnpm release`) | ✓ |
| Demos: Node ESM, Node CJS, Cloudflare Worker, all driven by one shared `_shared.mjs` | ✓ |
| API key resolution: env → `.env` (repo root) → prompt-and-persist | ✓ |
| Demo specification doc for porting to other languages | ✓ (in platform repo) |
| Repo hygiene: `LICENSE`, `README`, `CHANGELOG`, `CONTRIBUTING`, `SECURITY` | ✓ |
| CI matrix: Node 20/22/24 | ✓ |
