#!/usr/bin/env bash
# Deploys Logic 2010 to https://motiwala.ca/logic2010/. Run from a development machine:
#
#   deploy/deploy.sh [--dry-run] [--skip-build] [--host root@motiwala.ca]
#   deploy/deploy.sh --rollback [<release-id>] [--dry-run]
#
# 1. builds the app (npm ci && npm run build → dist/)
# 2. on the server (deploy/remote.sh prepare): system user logic2010, /opt/logic2010,
#    /var/lib/logic2010 (mode 700), pinned Node in /opt/logic2010/node (SHA-256 checked)
# 3. uploads dist/, server/ and deploy/ to /opt/logic2010/app/releases/<release-id>/
# 4. on the server (deploy/remote.sh activate): backs up the database, installs the systemd
#    units, points /opt/logic2010/app/current at the new release, restarts logic2010.service,
#    smoke-tests it on 127.0.0.1:8710 (switching back if it fails), installs the Apache
#    snippet (reloading Apache only if `apachectl configtest` passes), keeps 5 releases.
#
# --dry-run builds nothing and changes nothing: it prints the commands, and on the server
# runs only read-only checks (printing every command that would change something).
# Safe to run repeatedly. See deploy/README.md.

set -euo pipefail

# Node 24 LTS, official linux-x64 build (needs glibc >= 2.28; the server has 2.28).
# The SHA-256 is from https://nodejs.org/dist/v24.21.0/SHASUMS256.txt and is checked again
# against that file on the server before installing.
NODE_VERSION=24.21.0
NODE_SHA256=6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff

HOST=${DEPLOY_HOST:-root@motiwala.ca}
RELEASES=/opt/logic2010/app/releases
CURRENT=/opt/logic2010/app/current
KEEP_RELEASES=5
DRY_RUN=0
SKIP_BUILD=0
ROLLBACK=0
ROLLBACK_TARGET=""

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --host) HOST=${2:?--host needs a value}; shift ;;
    --rollback)
      ROLLBACK=1
      if [[ ${2:-} != "" && ${2:-} != --* ]]; then ROLLBACK_TARGET=$2; shift; fi
      ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
run() {
  if [[ $DRY_RUN == 1 ]]; then
    printf '  would run:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)

# Runs deploy/remote.sh on the server with the given arguments.
remote() {
  # shellcheck disable=SC2029  # the arguments are meant to be expanded (and quoted) here
  ssh "${SSH_OPTS[@]}" "$HOST" "DRY_RUN=$DRY_RUN KEEP_RELEASES=$KEEP_RELEASES bash -s --$(printf ' %q' "$@")" <deploy/remote.sh
}

for cmd in ssh rsync; do command -v "$cmd" >/dev/null || die "missing command: $cmd"; done
[[ $DRY_RUN == 1 ]] && echo "DRY RUN: nothing will be changed."

if [[ $ROLLBACK == 1 ]]; then
  step "Rolling back on $HOST"
  remote rollback ${ROLLBACK_TARGET:+"$ROLLBACK_TARGET"}
  step "Done"
  exit 0
fi

# --- build -----------------------------------------------------------------------------

if [[ $SKIP_BUILD == 1 ]]; then
  step "Skipping the build (using the existing dist/)"
else
  step "Building"
  command -v npm >/dev/null || die "missing command: npm"
  run npm ci
  run npm run build
fi
if [[ $DRY_RUN == 1 && ! -f dist/index.html ]]; then
  echo "  (dist/ has not been built yet; a real run builds it first)"
else
  [[ -f dist/index.html ]] || die "dist/index.html is missing; the build did not produce the app"
fi
[[ -f server/server.mjs ]] || die "server/server.mjs is missing"

commit=$(git rev-parse --short HEAD 2>/dev/null || echo nogit)
if ! git diff --quiet HEAD -- 2>/dev/null; then commit="$commit-dirty"; fi
RELEASE="$(date -u +%Y%m%d-%H%M%S)-$commit"
echo "  release: $RELEASE"

# --- server preparation ----------------------------------------------------------------

step "Preparing $HOST (user, directories, Node v$NODE_VERSION)"
remote prepare "$NODE_VERSION" "$NODE_SHA256"

# --- upload ----------------------------------------------------------------------------

step "Uploading to $HOST:$RELEASES/$RELEASE/"
# -R keeps the dist/, server/ and deploy/ prefixes; unchanged files are hard-linked to the
# current release (--link-dest) so an upload only sends what changed.
# shellcheck disable=SC2054  # the commas belong to --chmod's value
RSYNC=(rsync -rltpR --chmod=D755,F644 --info=stats1 -e "ssh ${SSH_OPTS[*]}"
  --exclude=/server/data/ --exclude='*.test.*' --exclude=/server/tsconfig.json
  --link-dest="$CURRENT/"
  dist/ server/ deploy/ "$HOST:$RELEASES/$RELEASE/")
run "${RSYNC[@]}"

# --- activation ------------------------------------------------------------------------

step "Activating $RELEASE"
remote activate "$RELEASE"

step "Done: https://motiwala.ca/logic2010/ (release $RELEASE)"
