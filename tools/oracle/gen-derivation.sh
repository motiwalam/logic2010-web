#!/usr/bin/env bash
# Fixtures for the derivation module (src/engine/modules/derivation): tests/fixtures/derivation/.
# Uses its own oracle build (tools/oracle/derivation), which shadows the dialog classes.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$HERE/../../tests/fixtures/derivation
mkdir -p "$OUT"
"$HERE/derivation/build.sh"
for s in 1 2; do
  for mode in check lines stack; do
    SYNTAX=$s "$HERE/derivation/run.sh" $mode > "$OUT/$mode-$s.json"
    SYNTAX=$s "$HERE/derivation/run.sh" $mode student > "$OUT/$mode-student-$s.json"
  done
done
SYNTAX=1 "$HERE/derivation/run.sh" edit > "$OUT/edit-1.json"
