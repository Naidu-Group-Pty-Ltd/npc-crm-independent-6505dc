/**
 * Candidate sources for the Australian domestic PEP reference registry.
 *
 * ── What this file is for ─────────────────────────────────────────────
 * A list of sources somebody says are machine-readable is a hypothesis. This
 * is that hypothesis written down in a form a script can test, so the answer
 * comes from a download rather than from a document.
 *
 * It is deliberately shared between the spike and whatever loaders follow:
 * the thing the spike proves reachable is then the thing the loader reads,
 * named identically, so a source cannot be validated under one URL and
 * ingested from another.
 *
 * ── The AML/CTF Rules this is trying to cover ─────────────────────────
 * A domestic PEP is much broader than the federal Parliament. The Rules
 * name, among others: Commonwealth/State/Territory legislators; the
 * Governor-General, Governors and Administrators; High Court, Federal Court
 * and State/Territory Supreme Court judges; accountable authorities of
 * Commonwealth entities; heads of State/Territory departments; heads of
 * local government councils; specified senior Defence positions; and
 * specified Australian diplomatic positions.
 *
 * `category` below maps each candidate onto that vocabulary, so coverage can
 * be reported against the Rules rather than against a list of websites.
 *
 * ── Tiers ─────────────────────────────────────────────────────────────
 *   A  authoritative government STRUCTURED data (bulk export, CSV, API)
 *   B  authoritative government PAGES (HTML that must be parsed)
 *   C  reputable structured secondary data — reconciliation only, never the
 *      sole evidence behind a negative determination
 *
 * There is no tier D. A general web search is an investigative tool for a
 * person, not a source this registry ingests.
 */

/**
 * Two controls, and they are the reason the results mean anything.
 *
 * A bare list of status codes cannot distinguish "this source blocks
 * automated clients" from "this environment cannot reach .gov.au at all".
 * So the run includes one source known to WORK from GitHub Actions and fail
 * from the Supabase egress (DFAT — the sanctions loader pulls 3,846 entries
 * from a runner on a schedule), and one known to work from anywhere.
 *
 * If the DFAT control fails on the runner, the run is measuring the network
 * rather than the sources, and every other line in it is uninterpretable.
 */
export const CONTROLS = [
  {
    key: 'control_dfat_sanctions',
    label: 'CONTROL · DFAT consolidated list (known good from CI)',
    url: 'https://www.dfat.gov.au/sites/default/files/Australian_Sanctions_Consolidated_List.xlsx',
    expect: 'xlsx',
    note: 'The sanctions loader reads this from a GitHub runner on a schedule. '
      + 'If this fails here, the environment is the finding, not the source.',
  },
  {
    key: 'control_data_gov_au',
    label: 'CONTROL · data.gov.au CKAN API (known good anywhere)',
    url: 'https://data.gov.au/data/api/3/action/package_search?q=title:AGOR&rows=1',
    expect: 'json',
    note: 'A plain public API with no WAF. Distinguishes a proxy fault from a WAF.',
  },
];

export const CANDIDATE_SOURCES = [
  /* ── Commonwealth: organisations, appointments and senior officials ── */
  {
    key: 'finance_directory_export',
    label: 'Directory.gov.au bulk XML export (Dept of Finance)',
    tier: 'A',
    category: 'commonwealth_appointments',
    authority: 'Department of Finance',
    url: 'https://www.directory.gov.au/sites/default/files/export.xml',
    expect: 'xml',
    note: 'Listed active on data.gov.au as "Directory.gov.au XML data export". '
      + 'The claim under test is that it is a complete daily dump including '
      + 'appointments and SES contacts, not merely the organisations register.',
  },
  {
    key: 'finance_directory_export_legacy',
    label: 'Directory.gov.au export — legacy host (marked INACTIVE on data.gov.au)',
    tier: 'A',
    category: 'commonwealth_appointments',
    authority: 'Department of Finance',
    url: 'http://m.directory.gov.au/xml/directoryexport.xml',
    expect: 'xml',
    note: 'Probed only to confirm it is genuinely retired. Do NOT build on this.',
  },
  {
    key: 'agor_csv',
    label: 'Australian Government Organisations Register (AGOR)',
    tier: 'A',
    category: 'commonwealth_entities',
    authority: 'Department of Finance',
    url: 'https://data.gov.au/data/dataset/c77cface-69aa-4dd0-b99f-b065dc33c8e6/resource/55f33a8e-eebc-4342-8d63-ed53a4d4ea0a/download/agor-2026-06-30.csv',
    expect: 'csv',
    note: 'Known retrievable. Describes BODIES, not people — useful for '
      + 'organisation names, not for identifying an office holder.',
  },

  /* ── Commonwealth Parliament ─────────────────────────────────────── */
  /*
   * ── The APH registers, and how they were found ────────────────────
   * The proposal was right that Parliament publishes machine-readable
   * member data; the path it named for Members is a PDF wearing a `.csv`
   * extension (HTTP 200, 184 KB, body begins `%PDF-1.7`). Six symmetrical
   * guesses at the real name all returned the same 404 page.
   *
   * The canonical URLs come from the site's own index page, and they live
   * on `static.aph.gov.au` — a dedicated static host. That is the whole
   * explanation for the asymmetry measured earlier: APH's HTML pages sit
   * behind a WAF that refuses scripted clients, and the static host does
   * not. Any adapter must read the static host.
   *
   * Verified: 150 Members, 75 Senators, with honorific, salutation,
   * post-nominals, surname, given names, preferred name, initials,
   * electorate, state, party and gender.
   */
  {
    key: 'aph_members_csv',
    label: 'APH — all Members of the House of Representatives',
    tier: 'A',
    category: 'commonwealth_legislature',
    authority: 'Parliament of Australia',
    url: 'https://static.aph.gov.au/-/media/03_Senators_and_Members/Address_Labels_and_CSV_files/All_members_by_name/All_members_by_name.csv',
    expect: 'csv',
    /*
     * No longer a hypothesis. This URL is what the loader reads, and a test
     * asserts the two strings are identical — the catalogue's own rule is
     * that a source must not be validated under one URL and ingested from
     * another, and two copies of a URL is how that happens.
     */
    ingestedAs: 'aph_commonwealth_parliament',
    note: 'Canonical, from the APH index page. 150 rows when measured, and '
      + 'the register the office-holder index now loads weekly.',
  },
  {
    key: 'aph_senators_csv',
    label: 'APH — all Senators',
    tier: 'A',
    category: 'commonwealth_legislature',
    authority: 'Parliament of Australia',
    url: 'https://static.aph.gov.au/-/media/03_Senators_and_Members/Address_Labels_and_CSV_files/Senators/allsenel.csv',
    expect: 'csv',
    ingestedAs: 'aph_commonwealth_parliament',
    note: 'Canonical. 75 rows when measured, and loaded weekly.',
  },
  {
    key: 'aph_members_pdf_trap',
    label: 'APH — the Members path the proposal named (PDF trap)',
    tier: 'A',
    category: 'commonwealth_legislature',
    authority: 'Parliament of Australia',
    url: 'https://www.aph.gov.au/-/media/03_Senators_and_Members/32_Members/Lists/Members_List.csv',
    expect: 'csv',
    note: 'Kept deliberately. It answers 200 and it is a PDF — the case that '
      + 'justifies sniffing bytes rather than trusting an extension. If this '
      + 'ever reports usable, the prober has regressed.',
  },
  {
    key: 'aph_csv_index',
    label: 'APH — the address-labels and CSV index page',
    tier: 'B',
    category: 'commonwealth_legislature',
    authority: 'Parliament of Australia',
    url: 'https://www.aph.gov.au/Senators_and_Members/Contacting_Senators_and_Members/Address_labels_and_CSV_files',
    expect: 'html',
    note: 'Where the canonical URLs are published. Measured from a runner it '
      + 'answers 200 with a CAPTCHA page while the two files it links download '
      + 'fine — so a rename will surface as a 404 on the file, not as a diff '
      + 'here. Kept as the record of that asymmetry; the loader\'s row floor '
      + 'and its PDF sniff are the guards that actually hold.',
  },
  {
    key: 'aph_handbook',
    label: 'Parliamentary Handbook — current and former parliamentarians',
    tier: 'B',
    category: 'commonwealth_legislature_history',
    authority: 'Parliament of Australia',
    url: 'https://handbook.aph.gov.au/',
    expect: 'html',
    note: 'The proposal claims CSV download functionality. This probes whether '
      + 'the site answers a scripted client at all before anyone hunts for it.',
  },

  /* ── The ministry ────────────────────────────────────────────────── */
  {
    key: 'pmc_ministry_list',
    label: 'PM&C — Ministry List',
    tier: 'B',
    category: 'commonwealth_ministry',
    authority: 'Department of the Prime Minister and Cabinet',
    url: 'https://www.pmc.gov.au/government/ministry-list',
    expect: 'html',
  },

  /* ── State and territory legislatures ────────────────────────────── */
  {
    key: 'nsw_members_csv',
    label: 'NSW Parliament — all current members',
    tier: 'A',
    category: 'state_legislature',
    authority: 'Parliament of New South Wales',
    url: 'https://www.parliament.nsw.gov.au/members/Pages/all-members.aspx',
    expect: 'html',
    note: 'The proposal states NSW publishes a CSV generated from its database. '
      + 'If the page answers, the export URL can be found from it.',
  },
  {
    key: 'vic_members',
    label: 'Parliament of Victoria — members',
    tier: 'B', category: 'state_legislature',
    authority: 'Parliament of Victoria',
    url: 'https://www.parliament.vic.gov.au/members', expect: 'html',
  },
  {
    key: 'qld_members',
    label: 'Queensland Parliament — members',
    tier: 'B', category: 'state_legislature',
    authority: 'Parliament of Queensland',
    url: 'https://www.parliament.qld.gov.au/members/current/list', expect: 'html',
  },
  {
    key: 'wa_members',
    label: 'Parliament of Western Australia — members',
    tier: 'B', category: 'state_legislature',
    authority: 'Parliament of Western Australia',
    url: 'https://www.parliament.wa.gov.au/parliament/memblist.nsf/WAMembersAll',
    expect: 'html',
  },
  {
    key: 'sa_members',
    label: 'Parliament of South Australia — members',
    tier: 'B', category: 'state_legislature',
    authority: 'Parliament of South Australia',
    url: 'https://www.parliament.sa.gov.au/en/Members/Members-of-Parliament',
    expect: 'html',
  },
  {
    key: 'tas_members',
    label: 'Parliament of Tasmania — members',
    tier: 'B', category: 'state_legislature',
    authority: 'Parliament of Tasmania',
    url: 'https://www.parliament.tas.gov.au/members', expect: 'html',
  },
  {
    key: 'act_members',
    label: 'ACT Legislative Assembly — MLAs',
    tier: 'B', category: 'territory_legislature',
    authority: 'ACT Legislative Assembly',
    url: 'https://www.parliament.act.gov.au/members', expect: 'html',
  },
  {
    key: 'nt_members',
    label: 'NT Legislative Assembly — members',
    tier: 'B', category: 'territory_legislature',
    authority: 'Legislative Assembly of the Northern Territory',
    url: 'https://parliament.nt.gov.au/members', expect: 'html',
  },

  /* ── Judiciary ───────────────────────────────────────────────────── */
  {
    key: 'high_court_justices',
    label: 'High Court of Australia — current Justices',
    tier: 'B', category: 'judiciary',
    authority: 'High Court of Australia',
    url: 'https://www.hcourt.gov.au/justices/current-justices', expect: 'html',
  },
  {
    key: 'federal_court_judges',
    label: 'Federal Court of Australia — judges',
    tier: 'B', category: 'judiciary',
    authority: 'Federal Court of Australia',
    url: 'https://www.fedcourt.gov.au/about/judges', expect: 'html',
  },

  /* ── Specified Defence leadership ────────────────────────────────── */
  {
    key: 'defence_senior_leadership',
    label: 'Department of Defence — senior leadership',
    tier: 'B', category: 'defence',
    authority: 'Department of Defence',
    url: 'https://www.defence.gov.au/about/senior-leaders', expect: 'html',
  },

  /* ── Diplomatic ──────────────────────────────────────────────────── */
  {
    key: 'dfat_missions',
    label: 'DFAT — Australian embassies and missions',
    tier: 'B', category: 'diplomatic',
    authority: 'Department of Foreign Affairs and Trade',
    url: 'https://www.dfat.gov.au/about-us/our-locations/missions/list-of-australian-embassies-and-consulates',
    expect: 'html',
  },

  /* ── Local government ────────────────────────────────────────────── */
  {
    key: 'sa_local_government_api',
    label: 'SA — local government elected members (API)',
    tier: 'A', category: 'local_government',
    authority: 'Government of South Australia',
    url: 'https://data.sa.gov.au/data/api/3/action/package_search?q=elected+members&rows=3',
    expect: 'json',
    note: 'Probing the data portal rather than a guessed dataset id: if the '
      + 'portal answers, the dataset can be found; if it does not, no dataset '
      + 'id would have helped.',
  },

  /* ── Tier C · reconciliation only ────────────────────────────────── */
  {
    key: 'wikidata_sparql',
    label: 'Wikidata SPARQL (Tier C — reconciliation, already in use)',
    tier: 'C', category: 'reconciliation',
    authority: 'Wikimedia (collaboratively edited)',
    url: 'https://query.wikidata.org/sparql?format=json&query='
      + encodeURIComponent('SELECT ?x WHERE { wd:Q408 rdfs:label ?x . FILTER(LANG(?x)="en") } LIMIT 1'),
    expect: 'json',
    note: 'The register the engine already searches. Included so its behaviour '
      + 'from CI is measured on the same run as everything else.',
  },
];

/** Every category the Rules name, so coverage is reported against them. */
export const RULE_CATEGORIES = [
  'commonwealth_legislature',
  'commonwealth_legislature_history',
  'commonwealth_ministry',
  'commonwealth_appointments',
  'commonwealth_entities',
  'state_legislature',
  'territory_legislature',
  'judiciary',
  'defence',
  'diplomatic',
  'local_government',
  'reconciliation',
];
