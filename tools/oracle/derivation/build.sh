#!/usr/bin/env bash
# Compiles the derivation oracle (and its shadows of BaseDialog / MessageDialog, which hand the
# dialogs to OracleDialogs instead of showing them) into tools/oracle/derivation/classes.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ORACLE=$(cd "$HERE/.." && pwd)
JAVA_REPO=${JAVA_REPO:-$(cd "$ORACLE/../../../logic2010" && pwd)}
[ -d "$ORACLE/classes" ] || "$ORACLE/build.sh" >&2
rm -rf "$HERE/classes"; mkdir -p "$HERE/classes"
javac -encoding UTF-8 -nowarn -Xlint:none -XDignore.symbol.file \
      -cp "$ORACLE/classes:$JAVA_REPO/build/logic-classes" -d "$HERE/classes" \
      $(find "$HERE/src" -name '*.java') 2>&1 | grep -v 'warning\|^Note:\|sun.misc.Unsafe\|^\s*\^\|^[0-9]* warning' >&2 || true
[ -f "$HERE/classes/edu/ucla/phil/logic/OracleDerivation.class" ] || { echo "derivation oracle did not compile" >&2; exit 1; }
echo "derivation oracle compiled" >&2
