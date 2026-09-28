#!/usr/bin/env bash
# Fixtures for the Symbolization module (tests/fixtures/symbolization/), both notations.
# The output is large, so it is stored gzipped.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$HERE/../../tests/fixtures/symbolization
mkdir -p "$OUT"
for n in 1 2; do
  SYNTAX=$n "$HERE/run.sh" OracleSymbolization | gzip -9n > "$OUT/symbolization-$n.json.gz"
done
