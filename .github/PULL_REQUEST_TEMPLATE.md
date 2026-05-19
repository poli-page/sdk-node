<!--
Thanks for the PR! A few quick notes before submitting:
- Keep the title in Conventional Commits style (feat: / fix: / docs: / refactor: / test: / chore:).
- For breaking changes, prefix with `feat!:` or `fix!:` and call them out below.
- Run `pnpm lint && pnpm typecheck && pnpm test` locally — the pre-push hook does this too.
-->

## Summary

<!-- One or two sentences on what this PR changes and why. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (requires a major version bump and a MIGRATION.md entry)
- [ ] Docs / chore / refactor (no behavior change)

## Verification

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm lint:pack` (if the manifest, exports, or build changed)
- [ ] Updated `CHANGELOG.md` under `[Unreleased]`
- [ ] Updated `MIGRATION.md` (breaking changes only)

## Related issues

<!-- e.g. Closes #123 -->
