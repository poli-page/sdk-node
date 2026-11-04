# Releasing

## Versions

`@poli-page/sdk` shares its major.minor with the Poli Page API: SDK `0.13.x`
talks to API `0.13` and passes the [API contract](https://github.com/poli-page/api-contract)
`v0.13.0`, and is released once the API runs that version. Patch numbers are
free: a fix to the SDK alone is a patch, whatever the API's patch. A change
of the API contract, a new SDK feature and a raise of the minimum Node.js
version are each a minor. The SDK may skip minors when it has nothing to ship
for one. Both `scripts/publish.sh` and the Release workflow refuse a version
whose major.minor differs from the contract version pinned in
`.github/workflows/ci.yml` (`scripts/check-contract-version.sh`).

## Steps

1. On a branch, set the version in `package.json` and `package-lock.json`, move
   the `[Unreleased]` entries of `CHANGELOG.md` under `## [X.Y.Z] - <date>`,
   and merge it to `main` through a pull request.
2. Tag the merge commit `vX.Y.Z` and push the tag. The Release workflow
   (`.github/workflows/release.yml`) checks that the tag matches
   `package.json`, that the version is not on npm yet and that the pinned API
   contract has the tag's major.minor, then runs the full checks.
3. Approve the `npm-publish` environment. The workflow publishes to npm with
   provenance (OIDC Trusted Publishing) and creates the GitHub Release from the
   `CHANGELOG.md` section.

`scripts/publish.sh` is the break-glass path when GitHub Actions or npm OIDC is
unavailable: it runs the same checks locally, then publishes without
provenance. `npm run release:dry-run` runs everything except the publish.
