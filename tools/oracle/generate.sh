#!/usr/bin/env bash
# Regenerates every fixture in tests/fixtures from the desktop program (the oracle).
# Each area has its own script, tools/oracle/gen-<area>.sh.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
"$HERE/build.sh"
for g in "$HERE"/gen-*.sh; do echo "== $g"; "$g"; done
