#!/usr/bin/env bash
# Fixtures for the Truth Tables and Invalidity modules (tests/fixtures/truthinval), both notations.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$HERE/../../tests/fixtures/truthinval
mkdir -p "$OUT"
for n in 1 2; do
    SYNTAX=$n "$HERE/run.sh" OracleTruth > "$OUT/truth-$n.json"
    SYNTAX=$n "$HERE/run.sh" OracleInvalidity > "$OUT/invalidity-$n.json"
done
