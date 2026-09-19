# Vercel deployment

Vercel builds **one** thing from this repository: the Vite single-page app at
the root. That is what `vercel.json` says, and saying it is the whole point of
the file.

## Why the file exists

The Vercel project's framework is set to **Services**, which builds a
repository as a set of independently-built units rather than one app. With no
`services` key to read, Vercel went looking, found the FastAPI app in
`services/aml-verification-service`, and failed the deployment:

```
Service "aml-verification-service" detected framework "fastapi" in
"services/aml-verification-service" and must specify an "entrypoint" for
runtime "python".
```

Under services mode the declared services are the only services, so naming the
web app is what stops the search. Nothing about how the SPA builds changes:
`framework: "vite"` is the preset Vercel was already applying, the install and
build commands are still the preset's own, and the catch-all rewrite to
`/index.html` is the ordinary SPA fallback — Vercel checks the filesystem
before applying a rewrite, so hashed assets under `/assets/…` are served
directly and only unmatched paths reach the router.

## Why the verification service is NOT a Vercel service

`services/aml-verification-service` is a **container**, and giving it an
`entrypoint` would have deployed it to a runtime it cannot work in:

- `pytesseract` is a wrapper around the **tesseract binary**, installed by
  `apt-get` in the service's Dockerfile. Vercel's Python runtime installs pip
  packages; the binary would be absent and every MRZ read would fail at
  request time rather than at build time.
- The two OpenCV Zoo model files are fetched **at image build** by
  `scripts/fetch_models.sh`, which verifies each object's sha256 precisely so
  that a container cannot start against a half-populated model directory. A
  serverless build has nowhere to put them.

So the failure mode of "just add the entrypoint" is the one the service's own
health check was rewritten to prevent: something that answers, reports itself
up, and cannot verify anybody.

It is reached over HTTP from `aml-verification` / `_shared/aml/providers`
using `AML_VERIFICATION_SERVICE_URL` and `AML_VERIFICATION_SERVICE_TOKEN`, the
same shape as the other two sidecars in this repository
(`pdf-parse-service/`, `weasyprint-service/`), both of which deploy as Cloud
Run images from their own workflows. Where it runs is a deployment decision
that belongs with those, not with the front end.

## If it should run on Vercel after all

Vercel can build the Dockerfile rather than the source. That is one entry, and
it is the only correct spelling of it — the `python` runtime is not:

```json
"aml_verification": {
  "root": "services/aml-verification-service/",
  "runtime": "container"
}
```

It stays internal unless a top-level rewrite exposes it, which it should not
have: the edge functions hold a shared token and call it directly, and the
service handles biometric images. Before adding it, read the service's README
on model licensing and `docs/aml/kyc-zero-cost-solution.md` — and note that
production currently runs `didit_standalone` as the active IdV provider, so
nothing is waiting on this service today.
