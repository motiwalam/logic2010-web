#!/usr/bin/env bash
# Regenerates the Recognition module fixtures (tests/fixtures/recognition) in both notations.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$HERE/../../tests/fixtures/recognition
mkdir -p "$OUT"
for n in 1 2; do
    SYNTAX=$n "$HERE/run.sh" OracleRecognition > "$OUT/recognition-$n.json"
done
