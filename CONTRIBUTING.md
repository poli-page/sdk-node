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

Releases are **manual**. There is no CI workflow that auto-publishes — by design. The only supported publishing path is `scripts/publish.sh` (also available as `pnpm release`).

1. Bump version in `package.json`.
2. Move `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md`.
3. Commit `chore(release): X.Y.Z`.
4. From a clean main branch, run:
   ```bash
   pnpm release           # full release
   pnpm release:dry-run   # everything except the actual `pnpm publish`
   ```
   The script runs pre-flight checks (clean tree, on main, tag doesn't exist), lint/typecheck/tests, builds, packs, shows the tarball contents, and asks you to confirm before publishing. On success, it creates a local `vX.Y.Z` tag.
5. Push the tag manually when you're ready: `git push origin vX.Y.Z`.

You must be logged in to npm (`pnpm whoami` should print your user). The script does not touch npm tokens, secrets, or CI — it's a local-machine release.
