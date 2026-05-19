#!/usr/bin/env bash
# scripts/publish.sh — manual release of @poli-page/sdk to npm.
#
# This is the ONLY supported publishing path. There is no CI workflow
# that auto-publishes — by design. Run this script from your machine
# when you're ready to ship a new version.
#
# What it does, in order:
#   1. Pre-flight: on main, clean tree, tag doesn't already exist.
#   2. Verify: lint, typecheck, unit tests (integration if API key is set).
#   3. Build: pnpm build.
#   4. Pack: pnpm pack — show tarball contents and size.
#   5. Confirm with the user before publishing.
#   6. Publish: pnpm publish --access public.
#   7. Tag: create v<version> locally (does NOT push — that's manual).
#
# Usage:
#   ./scripts/publish.sh           # full release
#   ./scripts/publish.sh --dry-run # everything except the actual publish
#
# Before running, you must have manually:
#   - bumped the version in package.json
#   - moved the [Unreleased] CHANGELOG section to a real version heading
#   - committed those changes to main

set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
	DRY_RUN=1
fi

# ─── colors (TTY-aware, NO_COLOR-aware) ─────────────────────────────────────
if [[ -t 1 && "${NO_COLOR:-}" != "1" ]]; then
	bold=$'\033[1m'
	dim=$'\033[2m'
	red=$'\033[31m'
	green=$'\033[32m'
	yellow=$'\033[33m'
	cyan=$'\033[36m'
	reset=$'\033[0m'
else
	bold=""; dim=""; red=""; green=""; yellow=""; cyan=""; reset=""
fi

step() { echo; echo "${cyan}${bold}▸ $1${reset}"; }
ok()   { echo "  ${green}✔${reset} $1"; }
fail() { echo "  ${red}✗${reset} $1" >&2; exit 1; }

# ─── 1. version + branding ──────────────────────────────────────────────────
NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")

echo
echo "  Releasing ${bold}${NAME}@${VERSION}${reset}"
[[ $DRY_RUN -eq 1 ]] && echo "  ${yellow}⚠  dry-run mode — will pack but NOT publish${reset}"

# ─── 2. pre-flight ──────────────────────────────────────────────────────────
step "Pre-flight checks"

current_branch=$(git rev-parse --abbrev-ref HEAD)
<<<<<<< HEAD
if [[ "$current_branch" != "main" ]]; then
	if [[ $DRY_RUN -eq 1 ]]; then
		echo "  ${yellow}⚠${reset} not on main (currently on $current_branch) — allowed for --dry-run"
	else
		fail "must be on main branch (currently on $current_branch)"
	fi
else
	ok "on main branch"
fi
=======
[[ "$current_branch" == "main" ]] || fail "must be on main branch (currently on $current_branch)"
ok "on main branch"
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17

if ! git diff --quiet HEAD || ! git diff --cached --quiet HEAD; then
	fail "working tree has uncommitted changes — commit or stash first"
fi
ok "working tree is clean"

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
	fail "tag v$VERSION already exists. Bump the version in package.json first."
fi
ok "tag v$VERSION does not exist yet"

# ─── 3. verify ──────────────────────────────────────────────────────────────
step "Lint, typecheck, unit tests"
pnpm lint
pnpm typecheck
pnpm test
ok "all checks passed"

if [[ -n "${POLI_PAGE_API_KEY:-}" ]]; then
	step "Integration tests (POLI_PAGE_API_KEY is set)"
	pnpm test:integration
	ok "integration tests passed"
else
	echo "  ${dim}(POLI_PAGE_API_KEY not set — skipping integration tests)${reset}"
fi

# ─── 4. build ───────────────────────────────────────────────────────────────
step "Build"
pnpm build
ok "built dist/"

# ─── 5. pack + inspect ──────────────────────────────────────────────────────
step "Pack"
TARBALL=$(pnpm pack | tail -n 1)
ok "packed: $TARBALL"
echo
echo "  ${dim}Tarball contents:${reset}"
tar -tzf "$TARBALL" | sed 's/^/    /'
echo
echo "  ${dim}Size:${reset} $(du -h "$TARBALL" | cut -f1)"

# ─── 6. confirm ─────────────────────────────────────────────────────────────
<<<<<<< HEAD
if [[ $DRY_RUN -eq 0 ]]; then
	echo
	read -r -p "  Publish ${bold}${NAME}@${VERSION}${reset} to npm? [y/N] " confirm
	if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
		echo "  ${yellow}aborted by user${reset}"
		rm -f "$TARBALL"
		exit 0
	fi
=======
echo
read -r -p "  Publish ${bold}${NAME}@${VERSION}${reset} to npm? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
	echo "  ${yellow}aborted by user${reset}"
	rm -f "$TARBALL"
	exit 0
>>>>>>> 8dbd01e0b0ef53739b0dfe402e28b4b0bcaf9a17
fi

# ─── 7. publish ─────────────────────────────────────────────────────────────
if [[ $DRY_RUN -eq 1 ]]; then
	step "Dry run — would have run: pnpm publish --access public"
	rm -f "$TARBALL"
	echo
	echo "  ${green}${bold}✔ Dry run complete${reset}"
	exit 0
fi

step "Publish to npm"
pnpm publish --access public
ok "published $NAME@$VERSION"

# ─── 8. tag (local only — push manually) ────────────────────────────────────
step "Tag"
git tag "v$VERSION"
ok "created local tag v$VERSION"
echo "  ${dim}push it when ready:${reset} ${cyan}git push origin v$VERSION${reset}"

# ─── cleanup ────────────────────────────────────────────────────────────────
rm -f "$TARBALL"

echo
echo "  ${green}${bold}✔ Released ${NAME}@${VERSION}${reset}"
echo "  ${dim}verify with:${reset} ${cyan}pnpm view ${NAME}@${VERSION}${reset}"
echo
