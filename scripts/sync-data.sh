#!/usr/bin/env bash
# Copies the course data from the desktop repository (default ../logic2010) into data/.
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
SRC=${1:-$HERE/../logic2010}/data
rsync -a --delete "$SRC/" "$HERE/data/"
echo "data/ synced from $SRC"
