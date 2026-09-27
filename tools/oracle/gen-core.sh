#!/usr/bin/env bash
# Fixtures for the engine core (src/engine/{util,data,program,problems}): tests/fixtures/core/.
# STUDENT_WORK: a real derivation work file (default: the desktop's local runtime).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$HERE/../../tests/fixtures/core
JAVA_REPO=${JAVA_REPO:-$(cd "$HERE/../../../logic2010" && pwd)}
STUDENT=${STUDENT_WORK:-$JAVA_REPO/runtime/local/Contents/Resources/work/derivation.rec}
mkdir -p "$OUT"
# keep a copy of the student work with the fixtures, so the fixtures can be regenerated anywhere
[ -f "$STUDENT" ] && cp "$STUDENT" "$OUT/student-derivation.rec"
export JAVA_TOOL_OPTIONS="-Doracle.student=$OUT/student-derivation.rec"
"$HERE/run.sh" OracleCore datafiles > "$OUT/datafiles.json"
"$HERE/run.sh" OracleCore codecs > "$OUT/codecs.json"
"$HERE/run.sh" OracleCore sets > "$OUT/sets.json"
"$HERE/run.sh" OracleCore tips > "$OUT/tips.json"
for s in 1 2; do
  for m in messages options problems work; do
    SYNTAX=$s "$HERE/run.sh" OracleCore $m > "$OUT/$m-$s.json"
  done
done
SYNTAX=1 "$HERE/run.sh" OracleCore list > "$OUT/list.json"
for s in 1 2; do SYNTAX=$s "$HERE/run.sh" OracleCore local > "$OUT/local-$s.json"; done
