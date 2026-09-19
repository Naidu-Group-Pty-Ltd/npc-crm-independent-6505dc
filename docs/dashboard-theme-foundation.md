# Dashboard Theme Foundation

The dashboard theme foundation is built on global CSS variables and Tailwind token classes. Brand and whitelabel overrides flow through tokens such as `--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`, `--dashboard-surface`, `--surface-1`, `--topbar-background`, `--sidebar-surface`, and related dashboard variables.

Future redesigns should not copy long one-off Tailwind class strings from page to page. New pages, redesigned page headers, dashboard sections, cards, chart containers, and toolbars should start with `DashboardThemeFrame` and then add only the small amount of local layout styling that is specific to the feature.

Use `DashboardThemeFrame` variants such as:

- `page`
- `hero`
- `section`
- `sectionAccent`
- `card`
- `premiumCard`
- `chartCard`
- `toolbar`

Preserve existing shadcn primitives and compose them inside the dashboard frame instead of replacing their APIs. Preserve whitelabel theme compatibility by avoiding hardcoded colours where tokens already exist. Prefer `hsl(var(--token-name))`, `bg-card`, `text-foreground`, `text-primary`, `border-border`, `bg-background`, `text-muted-foreground`, and the existing dashboard CSS variables.

Always test light mode, dark mode, mobile, desktop, focus states, hover states, forms, charts, and sidebar layout when adopting the shared theme foundation.

## Client Page design source of truth

This client-page-specific prompt applies only to Client Page work. Do not cascade these instructions into unrelated dashboards, finance portal pages, reports, or admin surfaces unless a future request explicitly widens the scope.

For Client Page updates, review `dashboard-theme-foundation.md` as the primary design source of truth before implementation. Use it to understand and replicate the established visual identity, including the full colour palette, typography, font hierarchy, spacing, layout structure, button styles, imagery treatment, icon style, borders, shadows, and recurring UI/UX patterns.

All new Client Page sections, components, pages, and updates must follow the same format, theme, tone, and design system already established by this foundation. The goal is for new Client Page work to feel fully consistent and seamlessly cascaded from the existing brand and interface.

Do not introduce conflicting colours, fonts, layouts, or styling patterns on the Client Page unless clearly necessary. Where a detail is not explicitly defined, infer the closest matching style from this foundation and maintain consistency throughout the Client Page experience.

## Mandatory implementation planning rule

For every future UI redesign plan in this codebase, include a dedicated step called:

`Global Theme Foundation / Cascading UI Subcomponent`

That step must check whether the UI can use `DashboardThemeFrame` or existing dashboard CSS variables before creating new page-local styling.

## CRM Conversations Page design source of truth

This CRM-Conversations-specific prompt applies only to `/conversations` and CRM conversation surfaces. Do not cascade these instructions into unrelated dashboards, finance portal pages, reports, or admin surfaces unless a future request explicitly widens the scope.

For CRM Conversations Page updates, review `dashboard-theme-foundation.md` as the primary design source of truth before implementation. Use it to understand and replicate the established visual identity, including the full colour palette, typography, font hierarchy, spacing, layout structure, button styles, imagery treatment, icon style, borders, shadows, and recurring UI/UX patterns.

All new CRM Conversations Page sections, components, pages, and updates must follow the same format, theme, tone, and design system already established by this foundation. The goal is for new CRM conversation work to feel fully consistent and seamlessly cascaded from the existing brand and interface.

Do not introduce conflicting colours, fonts, layouts, or styling patterns on the CRM Conversations Page unless clearly necessary. Where a detail is not explicitly defined, infer the closest matching style from this foundation and maintain consistency throughout the CRM conversation experience.

For implementation plans and code changes on this page, include the `Global Theme Foundation / Cascading UI Subcomponent` step and first check whether `DashboardThemeFrame` variants or existing dashboard CSS variables can provide the required styling before adding page-local classes.

## Deal Pipeline Page design source of truth

This Deal-Pipeline-specific prompt applies only to the Deal Pipeline page and deal pipeline surfaces. Do not cascade these instructions into unrelated dashboards, finance portal pages, reports, admin surfaces, Client Page work, or CRM conversation surfaces unless a future request explicitly widens the scope.

For Deal Pipeline Page updates, review `dashboard-theme-foundation.md` as the primary design source of truth before implementation. Use it to understand and replicate the established visual identity, including the full colour palette, typography, font hierarchy, spacing, layout structure, button styles, imagery treatment, icon style, borders, shadows, and recurring UI/UX patterns.

All new Deal Pipeline sections, components, pages, and updates must follow the same format, theme, tone, and design system already established by this foundation. The goal is for new Deal Pipeline work to feel fully consistent and seamlessly cascaded from the existing brand and interface.

Do not introduce conflicting colours, fonts, layouts, or styling patterns on the Deal Pipeline Page unless clearly necessary. Where a detail is not explicitly defined, infer the closest matching style from this foundation and maintain consistency throughout the Deal Pipeline experience.

For implementation plans and code changes on this page, include the `Global Theme Foundation / Cascading UI Subcomponent` step and first check whether `DashboardThemeFrame` variants or existing dashboard CSS variables can provide the required styling before adding page-local classes.

## Agreements Page design source of truth

This Agreements-specific prompt applies only to the Agreements page and agreement workflow surfaces. Do not cascade these instructions into unrelated dashboards, finance portal pages, reports, admin surfaces, Client Page work, CRM conversation surfaces, or deal pipeline surfaces unless a future request explicitly widens the scope.

For Agreements Page updates, review `dashboard-theme-foundation.md` as the primary design source of truth before implementation. Use it to understand and replicate the established visual identity, including the full colour palette, typography, font hierarchy, spacing, layout structure, button styles, imagery treatment, icon style, borders, shadows, and recurring UI/UX patterns.

All new Agreements Page sections, components, pages, and updates must follow the same format, theme, tone, and design system already established by this foundation. The goal is for new agreement workflow work to feel fully consistent and seamlessly cascaded from the existing brand and interface.

Do not introduce conflicting colours, fonts, layouts, or styling patterns on the Agreements Page unless clearly necessary. Where a detail is not explicitly defined, infer the closest matching style from this foundation and maintain consistency throughout the agreement workflow experience.

For implementation plans and code changes on this page, include the `Global Theme Foundation / Cascading UI Subcomponent` step and first check whether `DashboardThemeFrame` variants or existing dashboard CSS variables can provide the required styling before adding page-local classes.

## Portal Configuration Page design source of truth

This Portal-Configuration-specific prompt applies only to the `/portal-config` page and Portal Configuration administration surfaces. Do not cascade these instructions into unrelated dashboards, finance portal pages, reports, Client Page work, CRM conversation surfaces, deal pipeline surfaces, or agreement workflow surfaces unless a future request explicitly widens the scope.

For Portal Configuration updates, review `dashboard-theme-foundation.md` as the primary design source of truth before implementation. Use it to understand and replicate the established visual identity, including the full colour palette, typography, font hierarchy, spacing, layout structure, button styles, imagery treatment, icon style, borders, shadows, and recurring UI/UX patterns.

All new Portal Configuration sections, components, pages, and updates must follow the same format, theme, tone, and design system already established by this foundation. The goal is for modules, welcome content, booking controls, access defaults, save states, alerts, and tab surfaces to feel fully consistent and seamlessly cascaded from the existing brand and dashboard interface.

Do not introduce conflicting colours, fonts, layouts, or styling patterns on Portal Configuration unless clearly necessary. Where a detail is not explicitly defined, infer the closest matching style from this foundation and maintain consistency throughout the Portal Configuration experience.

For implementation plans and code changes on this page, include the `Global Theme Foundation / Cascading UI Subcomponent` step and first check whether `DashboardThemeFrame` variants or existing dashboard CSS variables can provide the required styling before adding page-local classes.
