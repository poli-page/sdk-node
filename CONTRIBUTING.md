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

### Stable vs. prerelease channels

Two npm dist-tags are used:

- **`latest`** — the default. `npm install @poli-page/sdk` resolves here. Only stable releases (`1.2.3`, no prerelease suffix) ship to `latest`.
- **`next`** — opt-in prereleases (`1.2.3-rc.1`, `2.0.0-beta.0`, `1.3.0-alpha.2`). Used to validate breaking changes or large features before promoting them to `latest`.

#### Cutting a prerelease

The version string in `package.json` carries the prerelease suffix. A prerelease for the upcoming 2.0:

1. Bump version in `package.json` to e.g. `2.0.0-rc.1`.
2. Move `[Unreleased]` → `[2.0.0-rc.1] - YYYY-MM-DD` in `CHANGELOG.md`.
3. Commit, then publish to the `next` tag:
   ```bash
   pnpm publish --tag next --access public
   ```
   `scripts/publish.sh` always publishes to `latest`; for prereleases run `pnpm publish` directly with `--tag next` (or extend the script with a `--tag` flag if it becomes a frequent path).
4. Tag the commit locally: `git tag v2.0.0-rc.1 && git push origin v2.0.0-rc.1`.

Users opt in by version range or dist-tag:

```bash
npm install @poli-page/sdk@next        # latest prerelease
npm install @poli-page/sdk@2.0.0-rc.1  # specific prerelease
```

#### Promoting a prerelease to stable

When the prerelease is ready, cut a stable release at the same semver minus the suffix:

1. Bump `package.json` to `2.0.0` (drop the suffix).
2. Move the prerelease entries in `CHANGELOG.md` under `[2.0.0] - YYYY-MM-DD`.
3. Run `pnpm release` (publishes to `latest` via `scripts/publish.sh`).

`latest` and `next` should never point at the same version — once `next` is promoted, the next prerelease starts a new pre-suffix sequence (e.g. `2.1.0-beta.0`).
