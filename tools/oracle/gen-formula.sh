#!/usr/bin/env bash
# Regenerates the formula and rules fixtures (tests/fixtures/formula) in both notations.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$HERE/../../tests/fixtures/formula
mkdir -p "$OUT"
for n in 1 2; do
    node "$HERE/formula-corpus.mjs" $n "$OUT"
    SYNTAX=$n "$HERE/run.sh" OracleFormula "$OUT/formula-inputs-$n.txt" > "$OUT/formula-$n.json"
done
for n in 1 2; do
    SYNTAX=$n "$HERE/run.sh" OracleRules "$OUT/recognition-args-$n.txt" "$OUT/instantiations-$n.txt" "$OUT/formula-inputs-$n.txt" > "$OUT/rules-$n.json"
done
