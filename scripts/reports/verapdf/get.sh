#!/bin/sh
# Resolve veraPDF's validation model from Maven Central and compile the CLI
# front end. See README.md for why this route exists.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$here"
command -v mvn >/dev/null || { echo "maven is required"; exit 2; }
command -v javac >/dev/null || { echo "a JDK is required"; exit 2; }
mvn -q -B dependency:copy-dependencies -DoutputDirectory=lib
javac -cp "lib/*" -d classes UaCli.java
cat > verapdf <<SH
#!/bin/sh
exec java -cp "$here/classes:$here/lib/*" UaCli "\$@" 2>/dev/null
SH
chmod +x verapdf
echo "validator ready: $here/verapdf"
echo "  VERAPDF=$here/verapdf npx tsx scripts/reports/validateUa.mts"
