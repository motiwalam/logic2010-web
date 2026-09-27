#!/usr/bin/env bash
# Runs an oracle program headless:  tools/oracle/run.sh <ClassName> [args...]
# Environment: SYNTAX=1|2 (default 1).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
JAVA_REPO=${JAVA_REPO:-$(cd "$HERE/../../../logic2010" && pwd)}
[ -d "$HERE/classes" ] || "$HERE/build.sh" >&2
CLS=$1; shift
exec java -Djava.awt.headless=true -Dlogic.local=true -Dlogic.syntax="${SYNTAX:-1}" \
     -Doracle.data="$(cd "$HERE/../.." && pwd)/data" \
     -cp "$HERE/classes:$JAVA_REPO/build/logic-classes" "edu.ucla.phil.logic.$CLS" "$@"
