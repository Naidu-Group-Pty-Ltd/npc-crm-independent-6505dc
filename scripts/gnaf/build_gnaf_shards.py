#!/usr/bin/env python3
"""
G-NAF, built into the static register the address service serves.

WHAT THIS IS
    Geoscape's G-NAF release (the Commonwealth's national address register,
    published quarterly on data.gov.au under the Open G-NAF EULA) is ~1.85 GB
    of pipe-separated tables across nine jurisdictions. The geocoding chain
    needs one question answered of it — where is this number on this street,
    in this postal area? — so this reduces the release to one small gzipped
    file per (state, postal area), in the format
    `supabase/functions/_shared/geocode/gnafShard.pure.ts` reads, plus a
    locality index (which postal areas hold addresses in each locality) and a
    manifest that says which release it is.

    It is NOT loaded into the production database: that is ~3.7 GB (sixty per
    cent on top of the database), a disk resize, a credential this repository
    does not hold, and rows that would never reach a clone. See
    `docs/integrations/ADDRESS_SERVICE.md`.

THREE SUBCOMMANDS
    resolve   Ask data.gov.au which file is the current GDA2020 release and
              print its description as JSON. Never a hard-coded URL: the
              resource id changes every quarter, and CKAN lists GDA94 first,
              so "the first zip" is the wrong datum.
    build     Verify a downloaded zip against that description, extract only
              the tables needed, join them in DuckDB, collapse units that stand
              at their building's point, write the shards, and REFUSE — exit
              non-zero, write nothing — if the result does not add up.
    (download is `curl` in the workflow: a 1.85 GB file wants curl's retry
    and resume, not a hand-written loop.)

WHAT IT REFUSES
    A zip whose size is not the catalogue's, whose first bytes are not a zip,
    or which lacks a table for a served state; a header missing a column this
    reads; a national total below the floor (a truncated or partial release
    is a smaller register, and a smaller register reads as "no such address"
    for every address it lost); a state with no rows. Every figure it counted
    goes into the manifest, so a load is asserted by its effect.

LICENCE
    Open G-NAF EULA: CC BY 4.0 with one restriction (no mailing lists compiled
    from it without verifying each address elsewhere). The attribution line
    travels on every geocode answer (`GNAF_ATTRIBUTION` in gnafShard.pure.ts).
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import sys
import time
import urllib.request
import zipfile
from collections import Counter

PACKAGE_ID = '19432f89-dc3a-4ef3-b943-5326ef1dbecc'
CKAN_PACKAGE_SHOW = f'https://data.gov.au/data/api/3/action/package_show?id={PACKAGE_ID}'
# data.gov.au's CloudFront refused requests with no User-Agent (addressr, Apr 2026).
USER_AGENT = 'npc-property-dashboard/1.0 (+https://github.com/Naidu-Group-Pty-Ltd)'

SHARD_FORMAT = 1
SHARD_COLUMNS = ['n1p', 'n1', 'n1s', 'n2p', 'n2', 'n2s', 'lot', 'flat',
                 'street', 'type', 'suffix', 'locality', 'lat', 'lng', 'gt', 'pid']

# The chain serves the eight states and territories `AuState` names. Other
# Territories (Christmas Island, Cocos, Jervis Bay; ~4,300 addresses) are read
# but not served, and counted so the omission is visible.
SERVED_STATES = ('ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA')
ALL_STATES = SERVED_STATES + ('OT',)

MEMBER = re.compile(r'(?:^|/)Standard/(ACT|NSW|NT|OT|QLD|SA|TAS|VIC|WA)_([A-Z_]+?)_psv\.psv$')

REQUIRED_COLUMNS = {
    'ADDRESS_DETAIL': [
        'ADDRESS_DETAIL_PID', 'DATE_RETIRED', 'LOT_NUMBER_PREFIX', 'LOT_NUMBER', 'LOT_NUMBER_SUFFIX',
        'FLAT_TYPE_CODE', 'FLAT_NUMBER_PREFIX', 'FLAT_NUMBER', 'FLAT_NUMBER_SUFFIX',
        'LEVEL_TYPE_CODE', 'LEVEL_NUMBER', 'NUMBER_FIRST_PREFIX', 'NUMBER_FIRST', 'NUMBER_FIRST_SUFFIX',
        'NUMBER_LAST_PREFIX', 'NUMBER_LAST', 'NUMBER_LAST_SUFFIX', 'STREET_LOCALITY_PID', 'LOCALITY_PID',
        'ALIAS_PRINCIPAL', 'POSTCODE', 'CONFIDENCE',
    ],
    'ADDRESS_DEFAULT_GEOCODE': ['ADDRESS_DETAIL_PID', 'DATE_RETIRED', 'GEOCODE_TYPE_CODE', 'LONGITUDE', 'LATITUDE'],
    'STREET_LOCALITY': ['STREET_LOCALITY_PID', 'STREET_NAME', 'STREET_TYPE_CODE', 'STREET_SUFFIX_CODE'],
    'LOCALITY': ['LOCALITY_PID', 'LOCALITY_NAME', 'STATE_PID'],
    'STATE': ['STATE_PID', 'STATE_ABBREVIATION'],
    'LOCALITY_ALIAS': ['LOCALITY_PID', 'NAME', 'DATE_RETIRED'],
}
TABLES = tuple(REQUIRED_COLUMNS)

# A register a tenth smaller than the published one has lost ~1.6M addresses,
# every one of which would then read as "no such address". Aug 2026 publishes
# 15,949,543 current addresses; the floor is set well below that and far above
# any truncation that leaves a state standing.
DEFAULT_MIN_ADDRESSES = 14_000_000


class Refusal(Exception):
    """A reason to write nothing."""


def log(msg: str) -> None:
    print(msg, flush=True)


# ── resolve ──────────────────────────────────────────────────────────────────

def http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as res:
        body = res.read()
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise Refusal(f'the catalogue answered with something that is not JSON: {body[:200]!r}') from exc


def release_label(name: str) -> str:
    """`AUG 2026 - Geoscape G-NAF - GDA2020` → `AUG 2026`."""
    head = name.split(' - ')[0].strip()
    return head or name.strip()


def choose_release(package: dict) -> dict:
    """The current GDA2020 zip in a CKAN `package_show` answer — named, never guessed."""
    if not package.get('success'):
        raise Refusal(f'package_show did not succeed: {json.dumps(package)[:300]}')
    resources = package.get('result', {}).get('resources', []) or []
    candidates = []
    for r in resources:
        name = str(r.get('name') or '')
        url = str(r.get('url') or '')
        fmt = str(r.get('format') or '').upper()
        if 'GDA2020' not in name.upper() or 'GDA94' in name.upper():
            continue
        if fmt != 'ZIP' and not url.lower().endswith('.zip'):
            continue
        if str(r.get('state') or 'active') != 'active':
            continue
        candidates.append(r)
    if not candidates:
        names = '; '.join(str(r.get('name')) for r in resources)
        raise Refusal(f'no active GDA2020 zip among {len(resources)} resources: {names}')
    candidates.sort(key=lambda r: str(r.get('last_modified') or r.get('created') or ''), reverse=True)
    r = candidates[0]
    size = r.get('size')
    return {
        'name': str(r.get('name')),
        'label': release_label(str(r.get('name'))),
        'resource_id': str(r.get('id')),
        'url': str(r.get('url')),
        'bytes': int(size) if isinstance(size, (int, float)) or (isinstance(size, str) and size.isdigit()) else None,
        'last_modified': r.get('last_modified') or r.get('created'),
        'datum': 'GDA2020',
    }


def cmd_resolve(args: argparse.Namespace) -> int:
    release = choose_release(http_json(CKAN_PACKAGE_SHOW))
    text = json.dumps(release, indent=2)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as fh:
            fh.write(text + '\n')
    print(text)
    return 0


# ── build ────────────────────────────────────────────────────────────────────

def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def verify_zip(path: str, release: dict) -> dict:
    size = os.path.getsize(path)
    expected = release.get('bytes')
    if expected is not None and size != expected:
        raise Refusal(f'the zip is {size:,} bytes and the catalogue says {expected:,} — a truncated or different file')
    with open(path, 'rb') as fh:
        magic = fh.read(4)
    if magic != b'PK\x03\x04':
        raise Refusal(f'the file does not begin like a zip (first bytes {magic!r}) — probably an error page')
    return {'bytes': size, 'sha256': sha256_of(path)}


def select_members(zf: zipfile.ZipFile) -> dict[tuple[str, str], zipfile.ZipInfo]:
    chosen: dict[tuple[str, str], zipfile.ZipInfo] = {}
    for info in zf.infolist():
        m = MEMBER.search(info.filename)
        if not m:
            continue
        state, table = m.group(1), m.group(2)
        if table in TABLES:
            chosen[(state, table)] = info
    missing = [f'{s}_{t}' for s in SERVED_STATES for t in TABLES if (s, t) not in chosen]
    if missing:
        raise Refusal(f'the release lacks {len(missing)} table(s) a served state needs: {", ".join(missing[:12])}')
    return chosen


def extract(zf: zipfile.ZipFile, members: dict, work: str) -> dict[str, list[str]]:
    """Each chosen member to `work/<STATE>_<TABLE>.psv`, header checked against the columns this reads."""
    by_table: dict[str, list[str]] = {t: [] for t in TABLES}
    for (state, table), info in sorted(members.items()):
        dest = os.path.join(work, f'{state}_{table}.psv')
        with zf.open(info) as src, open(dest, 'wb') as out:
            shutil.copyfileobj(src, out, 8 * 1024 * 1024)
        with open(dest, 'r', encoding='utf-8-sig') as fh:
            header = fh.readline().strip().split('|')
        absent = [c for c in REQUIRED_COLUMNS[table] if c not in header]
        if absent:
            raise Refusal(f'{state}_{table} has no column {", ".join(absent)} (header: {"|".join(header)[:300]})')
        by_table[table].append(dest)
    return by_table


def build_addresses(con, by_table: dict[str, list[str]]) -> None:
    """Every current address with its street, locality, state and default point: the table `addr`."""
    for table, files in by_table.items():
        listing = '[' + ', '.join("'" + f.replace("'", "''") + "'" for f in files) + ']'
        con.execute(
            f"CREATE VIEW {table.lower()} AS SELECT * FROM read_csv({listing}, delim='|', header=true, "
            f"all_varchar=true, quote='', escape='', union_by_name=true)"
        )

    # Retirement is CONFIDENCE = -1 (G-NAF's own rule since 2018), and a
    # retired default geocode is not the default any more.
    con.execute("""
        CREATE TABLE addr AS
        SELECT
          st.state_abbreviation                                   AS state,
          nullif(trim(ad.postcode), '')                           AS postcode,
          ad.address_detail_pid                                   AS pid,
          ad.street_locality_pid                                  AS slp,
          ad.locality_pid                                         AS lpid,
          coalesce(ad.alias_principal = 'P', false)               AS principal,
          coalesce(ad.number_first_prefix, '')                    AS n1p,
          coalesce(ad.number_first, '')                           AS n1,
          coalesce(ad.number_first_suffix, '')                    AS n1s,
          coalesce(ad.number_last_prefix, '')                     AS n2p,
          coalesce(ad.number_last, '')                            AS n2,
          coalesce(ad.number_last_suffix, '')                     AS n2s,
          CASE WHEN coalesce(ad.number_first, '') = ''
               THEN coalesce(ad.lot_number_prefix, '') || coalesce(ad.lot_number, '') || coalesce(ad.lot_number_suffix, '')
               ELSE '' END                                        AS lot,
          coalesce(ad.flat_number_prefix, '') || coalesce(ad.flat_number, '') || coalesce(ad.flat_number_suffix, '') AS flat,
          (ad.flat_type_code IS NOT NULL OR ad.flat_number IS NOT NULL
             OR ad.level_type_code IS NOT NULL OR ad.level_number IS NOT NULL) AS is_sub,
          sl.street_name                                          AS street,
          coalesce(sl.street_type_code, '')                       AS type,
          coalesce(sl.street_suffix_code, '')                     AS suffix,
          l.locality_name                                         AS locality,
          round(TRY_CAST(adg.latitude AS DOUBLE), 6)              AS lat,
          round(TRY_CAST(adg.longitude AS DOUBLE), 6)             AS lng,
          coalesce(adg.geocode_type_code, '')                     AS gt
        FROM address_detail ad
        JOIN street_locality sl ON ad.street_locality_pid = sl.street_locality_pid
        JOIN locality l ON ad.locality_pid = l.locality_pid
        JOIN state st ON l.state_pid = st.state_pid
        LEFT JOIN (SELECT * FROM address_default_geocode WHERE date_retired IS NULL) adg
               ON ad.address_detail_pid = adg.address_detail_pid
        WHERE TRY_CAST(ad.confidence AS INTEGER) > -1
    """)


def count_by(con, sql: str) -> dict[str, int]:
    return {str(k): int(v) for k, v in con.execute(sql).fetchall()}


def write_gz(path: str, data: bytes) -> None:
    """Gzip with a zero mtime, so an unchanged release builds byte-identical files."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as raw:
        with gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=9, mtime=0) as gz:
            gz.write(data)


# What can be asked by number — a point, a postal area, a street, and a street
# number or a lot — in the register's own order: every address of one street
# number (or lot) on one street is contiguous, and so is every postal area.
#
# That order is what lets ONE PASS choose each site and write each file with
# nothing but the postal area in hand. DuckDB sorts out of core. The window
# function this replaced (`count(*) OVER (PARTITION BY …)` over every address,
# then DISTINCT ON and a join back) held the whole country at once, and the
# first national build ran out of memory in it: 4.6 GiB of 4.6 GiB, 24 Sep 2026.
USABLE_IN_ORDER = """
    SELECT state, postcode, slp, n1p, n1, n1s, n2p, n2, n2s, lot,
           lpid, flat, is_sub, principal, street, type, suffix, locality, lat, lng, gt, pid
    FROM addr
    WHERE lat IS NOT NULL AND lng IS NOT NULL
      AND postcode IS NOT NULL AND street IS NOT NULL
      AND (n1 <> '' OR lot <> '')
    ORDER BY state, postcode, slp, n1p, n1, n1s, n2p, n2, n2s, lot
"""
(STATE, POSTCODE, SLP, N1P, N1, N1S, N2P, N2, N2S, LOT,
 LPID, FLAT, IS_SUB, PRINCIPAL, STREET, TYPE, SUFFIX, LOCALITY, LAT, LNG, GT, PID) = range(22)
# state … lot: one street number (or lot) on one street, in one postal area.
KEY_WIDTH = 10


def choose_rows(group: list[tuple]) -> tuple[tuple, list[tuple]]:
    """One street number's (or lot's) addresses → its SITE row, and the units that keep a row of their own.

    The site stands at the base address's own point where there is one, else at
    the point most of its units share; then the principal address; then the
    lowest pid, so a rebuild chooses the same row. A unit keeps a row of its own
    only where the register places it somewhere other than the site — a
    townhouse on its own lot, a villa.
    """
    if len(group) == 1:
        return group[0], []
    shared = Counter((r[LAT], r[LNG]) for r in group)
    site = min(group, key=lambda r: (r[IS_SUB], not r[PRINCIPAL], -shared[(r[LAT], r[LNG])], r[PID]))
    units = [r for r in group
             if r[IS_SUB] and r[FLAT] != '' and (r[LAT] != site[LAT] or r[LNG] != site[LNG])]
    return site, units


def natural(value: str) -> tuple:
    """A number sorts as a number, before anything that is not one."""
    return (0, int(value), value) if value.isascii() and value.isdigit() else (1, 0, value)


def blank_first(value: str) -> tuple:
    """The building before its units, a single number before a range that starts at it."""
    return (value != '', natural(value))


def served_order(r: tuple, flat: str) -> tuple:
    """A file's lines by street, then locality, then number: a TOTAL order (the pid is unique), so a rebuild writes the same bytes."""
    return (r[STREET], r[TYPE], r[SUFFIX], r[LOCALITY] or '', natural(r[N1]), r[N1P], r[N1S],
            blank_first(r[N2]), r[N2P], r[N2S], natural(r[LOT]), blank_first(flat), r[PID])


def served_line(r: tuple, flat: str) -> str:
    text = (r[N1P], r[N1], r[N1S], r[N2P], r[N2], r[N2S], r[LOT], flat, r[STREET], r[TYPE], r[SUFFIX], r[LOCALITY])
    clean = [str(v or '').replace('|', ' ').replace('\n', ' ') for v in text]
    return '|'.join(clean + [f'{r[LAT]:.6f}', f'{r[LNG]:.6f}', r[GT] or '', r[PID] or ''])


def write_register(con, staging: str) -> dict:
    """The one pass: choose each street number's rows, count them, and write one file per postal area into `staging`."""
    header = '|'.join(SHARD_COLUMNS) + '\n'
    served = set(SERVED_STATES)
    tally = {'usable': 0, 'site_rows': 0, 'unit_rows': 0, 'shards': 0, 'rows_written': 0}
    rows_by_state: Counter = Counter()
    by_geocode_type: Counter = Counter()
    localities: dict[str, dict[str, set[str]]] = {}
    locality_postcodes: dict[tuple[str, str], set[str]] = {}

    area: tuple[str, str] | None = None
    lines: list[tuple[tuple, str]] = []
    group: list[tuple] = []
    group_key: tuple | None = None

    def close_group() -> None:
        site, units = choose_rows(group)
        state = site[STATE]
        tally['usable'] += len(group)
        tally['site_rows'] += 1
        tally['unit_rows'] += len(units)
        rows_by_state[state] += 1 + len(units)
        for r in (site, *units):
            by_geocode_type[r[GT] or ''] += 1
        if state not in served:
            return
        for r, flat in ((site, ''), *((u, u[FLAT]) for u in units)):
            lines.append((served_order(r, flat), served_line(r, flat)))
            if r[LOCALITY] is not None:
                localities.setdefault(state, {}).setdefault(r[LOCALITY], set()).add(r[POSTCODE])
            locality_postcodes.setdefault((state, r[LPID]), set()).add(r[POSTCODE])

    def close_area() -> None:
        if area is None or not lines:
            return
        lines.sort(key=lambda entry: entry[0])
        write_gz(os.path.join(staging, area[0], f'{area[1]}.psv.gz'),
                 (header + ''.join(line + '\n' for _, line in lines)).encode('utf-8'))
        tally['shards'] += 1
        tally['rows_written'] += len(lines)
        lines.clear()

    cur = con.execute(USABLE_IN_ORDER)
    while True:
        batch = cur.fetchmany(200_000)
        if not batch:
            break
        for row in batch:
            key = row[:KEY_WIDTH]
            if key == group_key:
                group.append(row)
                continue
            if group:
                close_group()
            if (row[STATE], row[POSTCODE]) != area:
                close_area()
                area = (row[STATE], row[POSTCODE])
            group = [row]
            group_key = key
    if group:
        close_group()
    close_area()

    return {
        **tally,
        'rows_by_state': dict(sorted(rows_by_state.items())),
        'by_geocode_type': dict(sorted(by_geocode_type.items(), key=lambda kv: (-kv[1], kv[0]))),
        'localities': localities,
        'locality_postcodes': locality_postcodes,
    }


def write_locality_index(con, staging: str, localities: dict, locality_postcodes: dict) -> int:
    """Which postal areas hold addresses in each locality — under its own name and every other name the register records for it."""
    states = {state: {name: set(pcs) for name, pcs in names.items()} for state, names in localities.items()}
    by_lpid: dict[str, list[tuple[str, set[str]]]] = {}
    for (state, lpid), postcodes in locality_postcodes.items():
        by_lpid.setdefault(lpid, []).append((state, postcodes))
    for lpid, name in con.execute(
        'SELECT locality_pid, name FROM locality_alias WHERE date_retired IS NULL AND name IS NOT NULL'
    ).fetchall():
        for state, postcodes in by_lpid.get(lpid, ()):
            states.setdefault(state, {}).setdefault(name, set()).update(postcodes)
    index = {
        'format': SHARD_FORMAT,
        'states': {s: {loc: sorted(pcs) for loc, pcs in sorted(locs.items())} for s, locs in sorted(states.items())},
    }
    write_gz(os.path.join(staging, 'localities.json.gz'),
             json.dumps(index, separators=(',', ':'), sort_keys=True).encode('utf-8'))
    return sum(len(v) for v in states.values())


def cmd_build(args: argparse.Namespace) -> int:
    import duckdb  # imported here so `resolve` needs nothing installed

    with open(args.release, 'r', encoding='utf-8') as fh:
        release = json.load(fh)
    t0 = time.time()
    log(f'release   {release.get("name")} ({release.get("resource_id")})')
    file_facts = verify_zip(args.zip, release)
    log(f'zip       {file_facts["bytes"]:,} bytes, sha256 {file_facts["sha256"]}')

    work = args.work
    os.makedirs(work, exist_ok=True)
    with zipfile.ZipFile(args.zip) as zf:
        members = select_members(zf)
        member_sizes = {f'{s}_{t}': info.file_size for (s, t), info in sorted(members.items())}
        by_table = extract(zf, members, work)
    log(f'extracted {len(members)} tables, {sum(member_sizes.values()):,} bytes unpacked ({time.time() - t0:.0f}s)')

    # A fresh database every build: a scratch directory kept from an earlier
    # run must not hand this one its tables.
    db_path = os.path.join(work, 'gnaf.duckdb')
    for stale in (db_path, db_path + '.wal'):
        if os.path.exists(stale):
            os.remove(stale)
    con = duckdb.connect(db_path)
    con.execute(f"SET memory_limit='{args.memory}'")
    con.execute(f"SET temp_directory='{os.path.join(work, 'duckdb-tmp')}'")
    con.execute('SET preserve_insertion_order=false')
    build_addresses(con, by_table)
    log(f'joined    ({time.time() - t0:.0f}s)')

    counts = {
        'addresses': con.execute('SELECT count(*) FROM addr').fetchone()[0],
        'addresses_by_state': count_by(con, 'SELECT state, count(*) FROM addr GROUP BY 1 ORDER BY 1'),
        'without_point': con.execute('SELECT count(*) FROM addr WHERE lat IS NULL OR lng IS NULL').fetchone()[0],
        'without_postcode': con.execute('SELECT count(*) FROM addr WHERE postcode IS NULL').fetchone()[0],
        'without_number_or_lot': con.execute("SELECT count(*) FROM addr WHERE n1 = '' AND lot = ''").fetchone()[0],
    }
    if counts['addresses'] < args.min_addresses:
        raise Refusal(f'{counts["addresses"]:,} current addresses, below the floor of {args.min_addresses:,} — a partial release')

    # Everything is written beside the served directory and moved into place
    # only once it adds up: a refusal, or a build that dies part-way, leaves
    # the previous register standing and nothing half-written in its place.
    final = os.path.join(args.out, f'v{SHARD_FORMAT}')
    staging = os.path.join(args.out, f'.v{SHARD_FORMAT}.partial')
    if os.path.exists(staging):
        shutil.rmtree(staging)
    try:
        written = write_register(con, staging)
        counts.update({k: written[k] for k in ('usable', 'site_rows', 'unit_rows', 'rows_by_state', 'by_geocode_type')})
        log(f'chose     {written["site_rows"]:,} sites and {written["unit_rows"]:,} units ({time.time() - t0:.0f}s)')

        # The refusals, before anything is served.
        empty = [s for s in SERVED_STATES if counts['rows_by_state'].get(s, 0) == 0]
        if empty:
            raise Refusal(f'no usable rows for {", ".join(empty)}')
        if counts['site_rows'] + counts['unit_rows'] < counts['usable'] * 0.4:
            raise Refusal('collapsing units removed more than 60% of usable addresses — the join is wrong, not the register')

        localities = write_locality_index(con, staging, written['localities'], written['locality_postcodes'])
        counts.update({'shards': written['shards'], 'rows_written': written['rows_written'], 'localities_indexed': localities})

        manifest = {
            'format': SHARD_FORMAT,
            'release': {**release, 'bytes': file_facts['bytes'], 'sha256': file_facts['sha256']},
            'members': member_sizes,
            'built_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'served_states': list(SERVED_STATES),
            'counts': counts,
            'licence': {
                'name': 'Open Geo-coded National Address File (G-NAF) End User Licence Agreement',
                'dataset': f'https://data.gov.au/data/dataset/{PACKAGE_ID}',
            },
        }
        with open(os.path.join(staging, 'manifest.json'), 'w', encoding='utf-8') as fh:
            json.dump(manifest, fh, indent=2, sort_keys=True)
            fh.write('\n')
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    if os.path.exists(final):
        shutil.rmtree(final)
    os.replace(staging, final)

    log(json.dumps(counts, indent=2))
    log(f'wrote     {counts["shards"]:,} shards, {counts["rows_written"]:,} rows, '
        f'{counts["localities_indexed"]:,} locality names ({time.time() - t0:.0f}s)')
    if args.summary:
        with open(args.summary, 'a', encoding='utf-8') as fh:
            fh.write(summary_markdown(release, file_facts, counts))
    return 0


def summary_markdown(release: dict, file_facts: dict, counts: dict) -> str:
    lines = [
        '### G-NAF register built',
        '',
        f'- release: **{release.get("name")}** (resource `{release.get("resource_id")}`)',
        f'- file: {file_facts["bytes"]:,} bytes, sha256 `{file_facts["sha256"]}`',
        f'- current addresses: {counts["addresses"]:,} '
        f'(no point {counts["without_point"]:,}; no postcode {counts["without_postcode"]:,}; '
        f'no number or lot {counts["without_number_or_lot"]:,})',
        f'- rows served: {counts["rows_written"]:,} in {counts["shards"]:,} postal areas '
        f'({counts["site_rows"]:,} sites, {counts["unit_rows"]:,} units with a point of their own)',
        '',
        '| State | Addresses | Rows served |',
        '|---|---:|---:|',
    ]
    for state in ALL_STATES:
        lines.append(f'| {state} | {counts["addresses_by_state"].get(state, 0):,} | {counts["rows_by_state"].get(state, 0):,} |')
    lines += ['', 'Geocode types served: ' + ', '.join(f'{k or "?"} {v:,}' for k, v in counts['by_geocode_type'].items()), '']
    return '\n'.join(lines) + '\n'


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = parser.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('resolve', help='print the current GDA2020 release as JSON')
    r.add_argument('--out', help='also write the JSON here')
    b = sub.add_parser('build', help='build the shards from a downloaded zip')
    b.add_argument('--zip', required=True)
    b.add_argument('--release', required=True, help='the JSON `resolve` printed')
    b.add_argument('--out', required=True, help='directory the service serves as /gnaf')
    b.add_argument('--work', required=True, help='scratch directory (needs ~8 GB for a national release)')
    b.add_argument('--memory', default='4GB')
    b.add_argument('--min-addresses', type=int, default=DEFAULT_MIN_ADDRESSES)
    b.add_argument('--summary', help='append a Markdown summary here (e.g. $GITHUB_STEP_SUMMARY)')
    args = parser.parse_args(argv)
    try:
        return cmd_resolve(args) if args.cmd == 'resolve' else cmd_build(args)
    except Refusal as refusal:
        log(f'REFUSED: {refusal}')
        return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
