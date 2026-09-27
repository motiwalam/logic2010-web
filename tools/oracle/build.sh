#!/usr/bin/env bash
# Compiles the oracle programs against the desktop program's classes.
#   JAVA_REPO  the desktop repository (default ../logic2010 next to this repo);
#              ./build.sh there must have produced build/logic-classes.
# Run one with:  tools/oracle/run.sh <ClassName> [args...]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
JAVA_REPO=${JAVA_REPO:-$(cd "$HERE/../../../logic2010" && pwd)}
CLASSES=$JAVA_REPO/build/logic-classes
[ -d "$CLASSES" ] || (cd "$JAVA_REPO" && ./build.sh)
rm -rf "$HERE/classes"; mkdir -p "$HERE/classes/patched"
# Headless AWT cannot report a screen size, which two classes ask for while initializing.
# Compile copies of them that assume a 1920x1080 screen; they shadow the originals.
SRC=$JAVA_REPO/logic/src/main/java/edu/ucla/phil/logic
for c in LogicProgram ProgressDialog; do
    sed 's/Toolkit\.getDefaultToolkit()\.getScreenSize()/new Dimension(1920, 1080)/g' "$SRC/$c.java" > "$HERE/classes/patched/$c.java"
done
javac -encoding UTF-8 -nowarn -Xlint:none -cp "$CLASSES" -d "$HERE/classes" \
      $(find "$HERE/src" -name '*.java') "$HERE/classes/patched/"*.java
echo "oracle compiled against $CLASSES"
