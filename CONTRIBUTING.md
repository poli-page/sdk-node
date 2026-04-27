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
