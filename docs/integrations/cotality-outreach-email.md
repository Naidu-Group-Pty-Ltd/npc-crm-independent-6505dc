# Cotality Outreach Email (Send-Ready)

**To:** partnerships@cotality.com.au  *(also cc: dataapi@corelogic.com.au)*
**Subject:** Data integration scoping — NPC Services property reporting platform (Cotality Property Data API + Cordell + Climate)

---

Hi team,

We are scoping a Cotality / CoreLogic data integration for our internal property reporting platform at NPC Services. The platform produces investment-grade, client-facing PDF reports for residential property across Australia, and we are looking to replace our current patchwork of free public-API sources with a single licensed Cotality spine.

A few quick facts to size the conversation:

- **Use case:** internal SaaS used by our advisory and buyer's-agent team; reports are white-labelled PDFs delivered to end clients.
- **Coverage:** national — all states, metro and regional.
- **Volume:** ~400 unique-property reports/month at launch, scaling to ~1,500/month within 12 months. Each report consumes 6–10 data calls.
- **Branches we need to power:** property attributes & AVM, sales history & comparables, rental history & yield, suburb market analytics (growth/DOM/vendor discount), Cordell build-cost benchmarks, demographics, and climate/hazard risk. Crime and state planning overlays remain government feeds on our side.
- **Integration:** server-side (Supabase Edge Functions), Postgres caching with provenance metadata, no raw Cotality data exposed to end users.

We would appreciate guidance on:

1. The right account executive on the **Data Solutions / Platform Partnerships** team (rather than RP Data subscription sales).
2. Product fit — confirmation that **Cotality Property Data API + Cordell Insights + Climate Risk** is the right bundle for the use case.
3. **Indicative pricing** across three tiers: per-call metered, subscription at ~400 reports/month, and an enterprise tier sized for ~1,500 reports/month. Plus any onboarding/setup fees and minimum-term commitments.
4. **Sandbox / UAT access** so we can validate schema and integration against ~25 sample properties before commercial commitment.
5. Standard licence terms covering: permitted cache duration per dataset, redistribution rights for client-facing PDFs, and persistence of derived metrics (e.g. our investment scoring) computed from Cotality inputs.

A formal one-page scoping brief is attached as PDF (`Cotality_Integration_Scoping.pdf`) for distribution internally.

Happy to jump on a 30-minute call at your convenience.

Kind regards,

**[Your name]**
[Title] — NPC Services
[email]  |  [phone]
[website]
