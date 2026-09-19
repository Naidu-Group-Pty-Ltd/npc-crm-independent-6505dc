-- Activate one production master for each of the eight formats that had none.
--
-- ## What this is
--
-- Every report format resolves its template from `report_templates`, and a row
-- is a candidate only when it is `is_active` and not draft
-- (`_shared/reports/reportTemplateSelection.pure.ts`). Eight of the nine
-- production formats — borrowing_capacity, cashflow, client_details,
-- commercial_capacity, comparison, market_intelligence, portfolio, qa — had
-- ZERO active rows, so their pickers offered nothing and every document fell
-- back to the legacy generator. The 543-row template library
-- (`template_library_entries`) holds fifty validated WeasyPrint masters per
-- format, but the library's only exit (`instantiate`) deliberately creates
-- inactive user drafts, and the only activation surface is the Template
-- Builder's superadmin button, one template at a time. No path ever produced
-- an active row for these formats.
--
-- This seed copies ONE curated master per format into `report_templates` in
-- exactly the state the Builder's activation gate produces — the contract
-- stated by `reportTemplateInsertGuard.pure.ts` and the selection module's
-- header: privileged actor, `approval_status = 'approved'`, a report type with
-- a production Template Builder adapter, engine `weasyprint`, published and
-- production-ready. It was dispatched by the product owner through
-- `apply-migration.yml`, which is this project's human-authorised write
-- channel; the ingestion self-healing paths remain forbidden from touching
-- this table (`pdf-import-release-gate.mjs`, `no_automatic_template_mutation_pattern`).
--
-- ## Which master, and why
--
-- Private Banking, variant A (reference) — "Chancery". Family 01 of the
-- approved Investment Compass Template Catalogue, the family the catalogue
-- leads with, in the voice of the house brand (gold on obsidian). The
-- A-variant is the one expression of each family that is fully drawn; the
-- other four are declared as overrides on it
-- (`docs/template-library/07-investment-compass-families.md`). The master's
-- authored default palette ships as-is: no colourway is baked, exactly as an
-- `instantiate` call without a `colourwayId` behaves.
--
-- ## The rules this file keeps
--
-- 1. **A format that already has an active template is left alone.** The
--    check is per-format, so re-running this file is a no-op wherever it has
--    already run, and a template a person has since activated by hand is never
--    displaced. investment_compass is not in the list at all — its pilot row
--    stays exactly as it is.
-- 2. **Insert only.** No UPDATE, no DELETE, no touching existing rows. The
--    blast radius of this file is eight new rows and their lineage.
-- 3. **All or nothing.** One DO block is one statement: if any format's
--    candidate is missing or ambiguous the whole block raises and nothing is
--    written — the mid-apply partial-write failure recorded in CLAUDE.md's
--    template-library section cannot recur here.
-- 4. **Lineage as `instantiate` writes it.** A `template_library_instantiations`
--    row and a `template_audit_log` entry per template, plus the
--    `libraryLineage` config block in the exact shape
--    `buildWorkingCopyPayload` produces, so a person reading the row months
--    from now can see what it is and where it came from. `usage_count` is NOT
--    bumped: that counter means "a person made a working copy", and a
--    control-plane seed is not usage.
--
-- Selection behaviour after this applies: the picker lists the master for its
-- format, and generation with no stored selection resolves it by ranking —
-- which routes those documents through the design system
-- (`routeReportThroughTemplate` skips non-weasyprint resolutions). A stored
-- selection continues to beat the ranking, and every failure path still falls
-- back to the legacy generator.

do $$
declare
  formats constant text[] := array[
    'borrowing_capacity',
    'cashflow',
    'client_details',
    'commercial_capacity',
    'comparison',
    'market_intelligence',
    'portfolio',
    'qa'
  ];
  fmt text;
  e record;
  n integer;
  created_id uuid;
begin
  -- Assert the whole candidate set before writing anything: a missing or
  -- ambiguous master for ANY format aborts the block, and the block is one
  -- statement, so nothing partial can land.
  foreach fmt in array formats loop
    select count(*) into n
    from public.template_library_entries t
    where t.report_type = fmt
      and t.tier = 'compass'
      and t.design_meta->>'familyKey' = 'private_banking'
      and t.design_meta->>'variantAxis' like 'A %'
      and t.status = 'published'
      and t.production_ready = true
      and t.engine = 'weasyprint';
    if n <> 1 then
      raise exception
        'activate_production_masters: expected exactly one published, production-ready Private Banking reference master for %, found %',
        fmt, n;
    end if;
  end loop;

  foreach fmt in array formats loop
    -- Never displace an active template, whoever activated it and however.
    if exists (
      select 1 from public.report_templates rt
      where rt.report_type = fmt and rt.is_active = true
    ) then
      raise notice
        'activate_production_masters: % already has an active template — leaving it alone',
        fmt;
      continue;
    end if;

    select * into strict e
    from public.template_library_entries t
    where t.report_type = fmt
      and t.tier = 'compass'
      and t.design_meta->>'familyKey' = 'private_banking'
      and t.design_meta->>'variantAxis' like 'A %'
      and t.status = 'published'
      and t.production_ready = true
      and t.engine = 'weasyprint';

    insert into public.report_templates (
      name,
      description,
      schema,
      config,
      custom_css,
      report_type,
      tier,
      variant,
      engine,
      version,
      is_active,
      is_default,
      is_draft,
      approval_status,
      locked_for_review,
      priority,
      parent_template_id,
      created_by,
      scope,
      owner_user_id,
      agency_id,
      active_theme
    ) values (
      'Private Banking — Chancery',
      e.description,
      e.schema,
      -- The lineage block in the exact shape buildWorkingCopyPayload writes,
      -- with the colourway keys null because the authored palette ships as-is.
      coalesce(e.config, '{}'::jsonb) || jsonb_build_object(
        'libraryLineage', jsonb_build_object(
          'entryId', e.id,
          'entrySlug', e.slug,
          'entryVersion', e.version,
          'familyKey', e.design_meta->>'familyKey',
          'familyName', e.design_meta->>'familyName',
          'templateCode', e.design_meta->>'templateCode',
          'variantAxis', e.design_meta->>'variantAxis',
          'density', e.design_meta->>'density',
          'colourway', null,
          'colourwayName', null,
          'ground', null
        )
      ),
      e.custom_css,
      e.report_type,   -- verbatim: the adapters' routing strings and the
                       -- resolver's eq-filter both match this exact spelling
      e.tier,
      null,            -- variant NULL = the ranking's global catch-all
      e.engine,
      1,
      true,            -- is_active: the point of this file
      true,            -- is_default: the house default for the format
      false,           -- is_draft
      'approved',      -- the state the activation gate requires
      false,
      0,
      null,
      null,            -- created_by is an FK to auth.users; custom-auth ids
                       -- are not in it (same decision as buildWorkingCopyPayload)
      'global',
      null,
      null,
      'light'          -- Private Banking leads with a light ground
    )
    returning id into created_id;

    insert into public.template_library_instantiations (
      entry_id, entry_version_at_copy, template_id, created_by_user_id
    ) values (
      e.id, e.version, created_id, null
    );

    insert into public.template_audit_log (
      template_id, actor_id, action, summary, metadata
    ) values (
      created_id,
      null,
      'library_instantiated',
      format(
        'Activated as the %s production default from library master "%s" v%s (seed 20260814190000, dispatched by the product owner)',
        fmt, e.name, e.version
      ),
      jsonb_build_object(
        'entry_id', e.id,
        'entry_version', e.version,
        'entry_slug', e.slug,
        'seed', '20260814190000_activate_production_masters_eight_formats'
      )
    );

    raise notice
      'activate_production_masters: seeded % from % as template %',
      fmt, e.slug, created_id;
  end loop;
end $$;
