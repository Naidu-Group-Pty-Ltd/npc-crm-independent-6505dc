# Market Updates Phase 12 — security and legal safeguards

Phase 12 strengthens, rather than relaxes, the existing Market Updates security boundary. Source retrieval remains allowlist-only with manual redirect handling, DNS validation, timeouts and response limits; reserved, documentation, carrier-grade NAT, benchmark, multicast and metadata-network addresses are now rejected in addition to private/loopback ranges. The unified RSS feed now requires the same Market Updates module view permission as the page.

Source excerpts are HTML-stripped and bounded, while link-and-metadata-only sources store no excerpt. An additive database constraint caps both internal and public excerpts at 1,200 characters and records an explicit legal storage policy. Only source metadata, short permitted excerpts, links and transformative summaries are retained; adapters do not fetch article-detail pages or bypass paywalls.

Existing admin-only ingestion/source mutations, CSRF, conversation ownership, published-only Q&A retrieval, rate limits, service-role isolation and RLS/grant restrictions remain intact. This repository phase does not replace authorised penetration, legal or live deployment review.
