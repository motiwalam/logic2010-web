#!/usr/bin/env bash
# Regenerates the Parsing module fixtures (tests/fixtures/parsing) in both notations.
# Uses the formula corpus of gen-formula.sh (tests/fixtures/formula/formula-inputs-N.txt).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$HERE/../../tests/fixtures/parsing
mkdir -p "$OUT"
for n in 1 2; do
    [ -f "$HERE/../../tests/fixtures/formula/formula-inputs-$n.txt" ] || node "$HERE/formula-corpus.mjs" $n "$HERE/../../tests/fixtures/formula"
    SYNTAX=$n "$HERE/run.sh" OracleParsing trees "$HERE/../../tests/fixtures/formula/formula-inputs-$n.txt" > "$OUT/trees-$n.json"
    SYNTAX=$n "$HERE/run.sh" OracleParsing work > "$OUT/work-$n.json"
done
