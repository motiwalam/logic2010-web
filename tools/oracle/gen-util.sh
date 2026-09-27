#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); OUT=$HERE/../../tests/fixtures
"$HERE/run.sh" OracleHashtable > "$OUT/hashtable-order.json"
