# WeasyPrint microservice for the report design system.
# Targets Google Cloud Run (or any container host: Fly.io, Railway, Render).
#
# Build & deploy (Cloud Run example):
#   gcloud builds submit --tag gcr.io/PROJECT_ID/weasyprint-service .
#   gcloud run deploy weasyprint-service \
#     --image gcr.io/PROJECT_ID/weasyprint-service \
#     --region australia-southeast1 \
#     --memory 2Gi --cpu 2 --concurrency 4 --timeout 600 \
#     --set-env-vars WEASYPRINT_SERVICE_TOKEN=<long-random-string>
#
# ── The engine version is a correctness boundary ─────────────────────────────
# This image is the only thing that turns a report into a PDF, so the version it
# installs is the version the stylesheet must be true against — not the one a
# developer happens to have. While those were 62.3 here and 69 locally, 62.3
# rejected `width: calc(210mm - 44mm)` as an invalid value, dropped the
# declaration and rendered on: the cover's masthead row lost the width its
# `table-layout: fixed` depended on, and the classification and the reference
# printed as one word. The render succeeded. Nothing was red.
#
# `requirements.txt` is therefore mirrored by `PINNED_ENGINE` in
# `supabase/functions/_shared/reportDesign/engineSupport.pure.ts`, and a spec
# fails if the two drift.
#
# ── Fonts ────────────────────────────────────────────────────────────────────
# The font list below is a CONTRACT with
# `supabase/functions/_shared/reportDesign/typography.pure.ts`, asserted by
# `src/lib/reportDesign/__tests__/reportTypography.spec.ts`, which reads this
# file. A face a report names must be installed here, or it silently falls back
# to the engine default — invisible in review, obvious in a client's hands. The
# engine does not even warn: a `font-family` naming nothing installed produces
# no log line at all, which is why this is a build-time assertion.
#
# This previously installed `fonts-playfair-display`, `fonts-cormorant-garamond`,
# `fonts-fraunces` and `fonts-ibm-plex`. **None of the four exists as a binary
# package in Debian**, bookworm or trixie. `apt-get install -y` exits non-zero on
# an unknown package, so this layer failed and the image could not be built.
#
# `fonts-ibm-plex` is the subtle one: it is a Debian *source* package name, so
# packages.debian.org serves a page for it and it reads as available. Only the
# binary index says otherwise. Verify against
# `deb.debian.org/debian/dists/<release>/main/binary-amd64/Packages.gz`, not the
# website — the CI `render-container` job is what caught this.
#
# Playfair Display and IBM Plex Mono now arrive as COPY-ed TTFs; Cormorant and
# Fraunces are gone from the type stacks entirely.

# ── Stage 1: build the virtualenv ────────────────────────────────────────────
# Separated so the compiler and the headers do not travel to production. They
# are needed only if a dependency has no wheel for this interpreter — today none
# does, and the day one does, the build must still succeed rather than fail at
# 3am with a missing `ffi.h`.
#
# Pinned to the distribution, not just the Python version. The font contract
# is only checkable against a known Debian release, and an unpinned `-slim`
# silently moves from bookworm to trixie when the tag is rebuilt.
FROM python:3.12-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# A venv rather than the system site-packages, because a venv is one directory
# and can be COPY-ed whole into the runtime stage.
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv "$VIRTUAL_ENV"
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt
# No import check here. This stage has a compiler and no Pango, and WeasyPrint
# loads its native libraries at import time — so `import weasyprint` fails in
# the builder and the image cannot be built at all. That is what the first
# version of this file did, and CI caught it. The check belongs in the runtime
# stage, where the libraries and the fonts are; see selfcheck.py.

# ── Stage 2: the runtime image ───────────────────────────────────────────────
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    # Non-root has no writable home, and fontconfig falls back to writing a
    # per-user cache when it cannot use the system one. Point it somewhere
    # writable so a first render does not spend seconds failing to cache.
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache

# WeasyPrint's native deps + the packaged half of the font stack. No compiler:
# every one of these is a shared library the engine dlopen()s at runtime.
# Every package here is verified present in bookworm AND trixie.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 \
      libcairo2 libgdk-pixbuf-2.0-0 \
      libffi8 shared-mime-info \
      fontconfig \
      fonts-dejavu fonts-liberation fonts-noto fonts-noto-cjk \
      fonts-inter fonts-roboto fonts-lato \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The brand faces. None is packaged by Debian, so they travel with the
# service — which is also why they live here rather than in `public/fonts/`:
# Docker cannot COPY from outside its build context, and the documented build
# context is this directory. SIL OFL 1.1; the licence files ship beside them,
# which redistribution inside an image requires.
COPY fonts/ /usr/local/share/fonts/npc/

# Normalize copied font permissions independently of the caller's umask.
# Keep the assets root-owned and read-only while allowing the unprivileged
# runtime identity to traverse the directory and read every shipped face.
RUN chown -R root:root /usr/local/share/fonts/npc \
    && find /usr/local/share/fonts/npc -type d -exec chmod 0755 {} + \
    && find /usr/local/share/fonts/npc -type f -exec chmod 0644 {} + \
    && fc-cache -f \
    # Fail the build rather than the render. A missing brand face produces a
    # document set in the engine's default serif, and nothing detects that until
    # a client opens it.
    && for family in "Cinzel" "Playfair Display" "Inter" "IBM Plex Mono"; do \
         fc-list : family | grep -qi "$family" \
           || { echo "FATAL: font family '$family' is not installed"; exit 1; }; \
       done \
    && fc-match "Playfair Display:italic" | grep -qi "playfair" \
       || { echo "FATAL: Playfair Display italic is not installed"; exit 1; }

# veraPDF, the conformance validator.
#
# The reports claim PDF/UA-1, and a conformance claim that fails validation is
# worse than no claim: it tells a procurement officer, a screen-reader user and
# an accessibility auditor that the document is navigable, and none of them
# finds out otherwise until they try. So the checker travels with the engine
# that produces the file, and `selfcheck.py` runs it at build time on the
# specimen — the same pattern as the font check above, and for the same reason.
#
# The first run of it said FAIL on a document this repo had been tagging as
# accessible for months.
#
# Headless install via IzPack's auto-install descriptor. Only the CLI packs;
# the GUI, the corpus and the sample plugins are 300 MB of things a container
# never uses.
#
# ── One ARG pins the download, the directory and the jar ─────────────────────
# The URL below was `releases/verapdf-installer.zip`, which is upstream's
# *floating latest* — while the `java -jar` line four lines down unpacks a
# `verapdf-greenfield-${VERAPDF_VERSION}` directory. Those two agree only for as
# long as latest happens to be the pinned version. The day veraPDF ships 1.31
# the zip contains `verapdf-greenfield-1.31/`, the path does not exist, and this
# layer fails — a build broken by somebody else's release schedule, on a commit
# that changed nothing.
#
# `${VERAPDF_VERSION%.*}` is POSIX parameter expansion and `RUN` is `/bin/sh`,
# so 1.30.2 gives the 1.30 series directory this URL is filed under. Bumping the
# ARG now moves all three together.
ARG VERAPDF_VERSION=1.30.2
RUN apt-get update && apt-get install -y --no-install-recommends \
      default-jre-headless unzip curl \
    && curl -sSL -o /tmp/verapdf.zip \
         "https://software.verapdf.org/releases/${VERAPDF_VERSION%.*}/verapdf-greenfield-${VERAPDF_VERSION}-installer.zip" \
    && unzip -q /tmp/verapdf.zip -d /tmp/vp \
    && printf '%s\n' \
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>' \
      '<AutomatedInstallation langpack="eng">' \
      '  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>' \
      '  <com.izforge.izpack.panels.target.TargetPanel id="install_dir">' \
      '    <installpath>/opt/verapdf</installpath>' \
      '  </com.izforge.izpack.panels.target.TargetPanel>' \
      '  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">' \
      '    <pack index="0" name="veraPDF GUI" selected="true"/>' \
      '    <pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/>' \
      '    <pack index="3" name="veraPDF Corpus and Tests" selected="false"/>' \
      '    <pack index="4" name="veraPDF Documentation" selected="false"/>' \
      '    <pack index="5" name="veraPDF Sample Plugins" selected="false"/>' \
      '  </com.izforge.izpack.panels.packs.PacksPanel>' \
      '  <com.izforge.izpack.panels.install.InstallPanel id="install"/>' \
      '  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>' \
      '</AutomatedInstallation>' > /tmp/auto.xml \
    && java -jar /tmp/vp/verapdf-greenfield-${VERAPDF_VERSION}/verapdf-izpack-installer-${VERAPDF_VERSION}.jar /tmp/auto.xml \
    && /opt/verapdf/verapdf --version \
    && rm -rf /tmp/verapdf.zip /tmp/vp /tmp/auto.xml \
    && apt-get purge -y unzip curl && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY app.py selfcheck.py ./

# Fail the build rather than a client's document.
#
# An import would prove only that the wheels installed. This renders: it is the
# one thing that exercises the engine, its native libraries, fontconfig and the
# brand faces together, and every one of those fails silently on its own. A
# substituted face produces a perfectly valid PDF with somebody else's type in
# it, and the engine does not even log that it happened.
RUN python selfcheck.py

# Unprivileged. The service takes untrusted HTML from an authenticated caller
# and fetches the resources it names — a narrow surface, but not one to run as
# uid 0 when the cost of not doing so is three lines.
RUN useradd --system --no-create-home --uid 10001 weasy \
    && mkdir -p /tmp/.cache \
    && chown -R weasy:weasy /app /tmp/.cache
USER weasy

# Re-run the complete self-check as the exact runtime identity.
# The earlier check proves the image contents are valid; this one also proves
# that UID 10001 can read the fonts, run the engine and invoke veraPDF.
RUN python selfcheck.py

# Warm the engine in the gunicorn parent, before it forks. WeasyPrint's import
# and fontconfig's first scan are seconds, and paying them on a client's first
# report is the difference between a report that arrives and one somebody gives
# up waiting for. See `warm_up()` in app.py.
ENV WEASYPRINT_WARMUP=1

EXPOSE 8080

# Liveness from inside the container, so an orchestrator that has no probe of
# its own still restarts a wedged worker. Python rather than curl: it is already
# here, and curl would be another package on the attack surface.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import os,urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/healthz', timeout=4).status==200 else 1)"

# `--preload` so the fork happens after the engine is imported and warmed:
# every worker inherits the warm state instead of repeating it, and the image's
# memory footprint drops by roughly the size of one engine per worker.
#
# `--timeout 600` matches `WEASYPRINT_TIMEOUT_MS` in `weasyprintClient.ts`. A
# forty-page report with inlined assets is minutes; a shorter timeout turns a
# slow render into a killed worker.
CMD exec gunicorn --bind :$PORT --workers 2 --threads 4 --timeout 600 \
      --preload --graceful-timeout 30 --access-logfile - app:app
