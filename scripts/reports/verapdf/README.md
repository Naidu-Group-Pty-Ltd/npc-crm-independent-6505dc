# Getting a PDF/UA validator

`scripts/reports/validateUa.mts` needs one and deliberately refuses to pass
without it. Its original instruction was to install veraPDF's own distribution
to `/opt/verapdf/verapdf`, which is what the render container does.

**That distribution is not reachable from every egress.** Measured 17 Sep 2026
from this environment, `https://software.verapdf.org/releases/` answers
`CONNECT tunnel failed, 403` while `https://repo1.maven.org/maven2/` answers
200. veraPDF publishes its *validation model* to Maven Central even though it
publishes its command-line application elsewhere, so the engine is obtainable
where the installer is not.

`./get.sh` resolves those libraries and compiles `UaCli.java`, a thin front end
that speaks the same command line `validateUa.mts` already expects
(`-f ua1 --format mrr <pdf>`, machine-readable report on stdout, non-zero exit
when the file does not conform). **It is the same rules and the same parser as
the official tool** — only the wrapper around them is local. It is not a
re-implementation of any check.

```sh
scripts/reports/verapdf/get.sh                       # once
VERAPDF=$(pwd)/scripts/reports/verapdf/verapdf \
  npx tsx scripts/reports/validateUa.mts
```

Needs a JDK (17+) and Maven. Both are present in the CI image; neither is a
dependency of the application.

## What a clean run means

veraPDF is a machine checker. It proves the structure tree exists, the heading
levels descend, every figure carries alternative text, the language is
declared, and the metadata claims what the file is. **It cannot tell you
whether the alternative text is any good** — that half is a person's job. A
clean run is evidence that the conformance claim on the file is not false on
its face, which is the thing an export setting cannot tell you.
