#!/usr/bin/env bash
# Runs the derivation oracle headless:  tools/oracle/derivation/run.sh <mode> [student]
# (bytecode verification is off: the shadow dialogs are panels, not windows)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ORACLE=$(cd "$HERE/.." && pwd)
JAVA_REPO=${JAVA_REPO:-$(cd "$ORACLE/../../../logic2010" && pwd)}
[ -d "$HERE/classes" ] || "$HERE/build.sh"
exec java -XX:+UnlockDiagnosticVMOptions -XX:-BytecodeVerificationRemote -Djava.awt.headless=true -Dlogic.local=true -Dlogic.syntax="${SYNTAX:-1}" \
     -Doracle.data="$(cd "$ORACLE/../.." && pwd)/data" \
     -Doracle.editScripts="$(cd "$ORACLE/../.." && pwd)/tests/fixtures/derivation/edit-scripts.txt" \
     -Doracle.student="${STUDENT_WORK:-$(cd "$ORACLE/../.." && pwd)/tests/fixtures/core/student-derivation.rec}" \
     -cp "$HERE/classes:$ORACLE/classes:$JAVA_REPO/build/logic-classes" edu.ucla.phil.logic.OracleDerivation "$@"
