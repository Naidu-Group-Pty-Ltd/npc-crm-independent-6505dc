"""
The G-NAF builder, run against a miniature release with the real layout.

Every rule the builder states is exercised here on rows chosen to break it: a
retired address, an address with no point, a lot with no street number, units
that share their building's point and a villa that does not, a building with
no base row, an alias, two towns in one postal area, a street suffix, and the
refusals — a short file, a missing table, a missing column, a release below
the floor. The national build runs in CI against the real file; this is what
makes a failure there a statement about the data rather than about the code.

    python3 -m unittest scripts/gnaf/test_build_gnaf_shards.py
"""
from __future__ import annotations

import gzip
import json
import os
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
import build_gnaf_shards as b  # noqa: E402

ROOT = 'G-NAF/G-NAF AUGUST 2026/Standard'

HEADERS = {
    'ADDRESS_DETAIL': (
        'ADDRESS_DETAIL_PID|DATE_CREATED|DATE_LAST_MODIFIED|DATE_RETIRED|BUILDING_NAME|LOT_NUMBER_PREFIX|LOT_NUMBER|'
        'LOT_NUMBER_SUFFIX|FLAT_TYPE_CODE|FLAT_NUMBER_PREFIX|FLAT_NUMBER|FLAT_NUMBER_SUFFIX|LEVEL_TYPE_CODE|'
        'LEVEL_NUMBER_PREFIX|LEVEL_NUMBER|LEVEL_NUMBER_SUFFIX|NUMBER_FIRST_PREFIX|NUMBER_FIRST|NUMBER_FIRST_SUFFIX|'
        'NUMBER_LAST_PREFIX|NUMBER_LAST|NUMBER_LAST_SUFFIX|STREET_LOCALITY_PID|LOCATION_DESCRIPTION|LOCALITY_PID|'
        'ALIAS_PRINCIPAL|POSTCODE|PRIVATE_STREET|LEGAL_PARCEL_ID|CONFIDENCE|ADDRESS_SITE_PID|LEVEL_GEOCODED_CODE|'
        'PROPERTY_PID|GNAF_PROPERTY_PID|PRIMARY_SECONDARY'
    ),
    'ADDRESS_DEFAULT_GEOCODE': 'ADDRESS_DEFAULT_GEOCODE_PID|DATE_CREATED|DATE_RETIRED|ADDRESS_DETAIL_PID|GEOCODE_TYPE_CODE|LONGITUDE|LATITUDE',
    'STREET_LOCALITY': (
        'STREET_LOCALITY_PID|DATE_CREATED|DATE_RETIRED|STREET_CLASS_CODE|STREET_NAME|STREET_TYPE_CODE|STREET_SUFFIX_CODE|'
        'LOCALITY_PID|GNAF_STREET_PID|GNAF_STREET_CONFIDENCE|GNAF_RELIABILITY_CODE'
    ),
    'LOCALITY': 'LOCALITY_PID|DATE_CREATED|DATE_RETIRED|LOCALITY_NAME|PRIMARY_POSTCODE|LOCALITY_CLASS_CODE|STATE_PID|GNAF_LOCALITY_PID|GNAF_RELIABILITY_CODE',
    'STATE': 'STATE_PID|DATE_CREATED|DATE_RETIRED|STATE_NAME|STATE_ABBREVIATION',
    'LOCALITY_ALIAS': 'LOCALITY_ALIAS_PID|DATE_CREATED|DATE_RETIRED|LOCALITY_PID|NAME|POSTCODE|ALIAS_TYPE_CODE|STATE_PID',
}
AD_COLS = HEADERS['ADDRESS_DETAIL'].split('|')


def ad(pid: str, slp: str, lpid: str, postcode: str, *, n1='', n1s='', n2='', lot='', flat='', flat_type='',
       level='', alias='P', confidence='2') -> str:
    row = {c: '' for c in AD_COLS}
    row.update({
        'ADDRESS_DETAIL_PID': pid, 'DATE_CREATED': '2020-01-01', 'STREET_LOCALITY_PID': slp, 'LOCALITY_PID': lpid,
        'POSTCODE': postcode, 'NUMBER_FIRST': n1, 'NUMBER_FIRST_SUFFIX': n1s, 'NUMBER_LAST': n2, 'LOT_NUMBER': lot,
        'FLAT_NUMBER': flat, 'FLAT_TYPE_CODE': flat_type, 'LEVEL_NUMBER': level, 'ALIAS_PRINCIPAL': alias,
        'CONFIDENCE': confidence,
    })
    return '|'.join(row[c] for c in AD_COLS)


def geo(pid: str, lat: str, lng: str, gt='PC', retired='') -> str:
    return f'G{pid}|2020-01-01|{retired}|{pid}|{gt}|{lng}|{lat}'


def street(slp: str, name: str, typ: str, lpid: str, suffix='') -> str:
    return f'{slp}|2020-01-01||C|{name}|{typ}|{suffix}|{lpid}|||'


def locality(lpid: str, name: str, state_pid: str) -> str:
    return f'{lpid}|2020-01-01||{name}||G|{state_pid}||'


STATE_PIDS = {'ACT': '8', 'NSW': '1', 'NT': '7', 'OT': '9', 'QLD': '3', 'SA': '4', 'TAS': '6', 'VIC': '2', 'WA': '5'}


def mini_release() -> dict[tuple[str, str], list[str]]:
    """Rows per (state, table). NSW carries every case; every other served state one plain address."""
    t: dict[tuple[str, str], list[str]] = {}
    for state, spid in STATE_PIDS.items():
        t[(state, 'STATE')] = [f'{spid}|2020-01-01||{state} NAME|{state}']
        t[(state, 'ADDRESS_DETAIL')] = []
        t[(state, 'ADDRESS_DEFAULT_GEOCODE')] = []
        t[(state, 'STREET_LOCALITY')] = []
        t[(state, 'LOCALITY')] = []
        t[(state, 'LOCALITY_ALIAS')] = []
        if state != 'NSW':
            lp, sl = f'L{state}', f'S{state}'
            t[(state, 'LOCALITY')].append(locality(lp, f'{state} TOWN', spid))
            t[(state, 'STREET_LOCALITY')].append(street(sl, 'MAIN', 'STREET', lp))
            t[(state, 'ADDRESS_DETAIL')].append(ad(f'A{state}1', sl, lp, '0800' if state == 'NT' else '9999', n1='1'))
            t[(state, 'ADDRESS_DEFAULT_GEOCODE')].append(geo(f'A{state}1', '-30.000001', '140.000001'))

    L, S = t[('NSW', 'LOCALITY')], t[('NSW', 'STREET_LOCALITY')]
    A, G = t[('NSW', 'ADDRESS_DETAIL')], t[('NSW', 'ADDRESS_DEFAULT_GEOCODE')]
    L += [locality('LBT', 'BLACKTOWN', '1'), locality('LGU', 'GUNNING', '1'), locality('LCO', 'COLLECTOR', '1')]
    t[('NSW', 'LOCALITY_ALIAS')].append('LA1|2020-01-01||LBT|BLACKTOWN WEST|2148|SYN|1')
    S += [street('S2ND', 'SECOND', 'AVENUE', 'LBT'), street('SMAIN', 'MAIN', 'STREET', 'LBT'),
          street('SKIL', 'KILDA', 'ROAD', 'LBT', suffix='N'), street('SHUN', 'HUNZA', 'ROAD', 'LBT'),
          street('SCHG', 'CHURCH', 'STREET', 'LGU'), street('SCHC', 'CHURCH', 'STREET', 'LCO')]
    # 5 Second Avenue: a building with a base row and 3 units, two at the
    # building's point and one (a villa) with a point of its own.
    A += [ad('P5', 'S2ND', 'LBT', '2148', n1='5'),
          ad('P5U1', 'S2ND', 'LBT', '2148', n1='5', flat='1', flat_type='UNIT'),
          ad('P5U2', 'S2ND', 'LBT', '2148', n1='5', flat='2', flat_type='UNIT'),
          ad('P5V3', 'S2ND', 'LBT', '2148', n1='5', flat='3', flat_type='VLLA')]
    G += [geo('P5', '-33.768512', '150.907511', 'BC'), geo('P5U1', '-33.768512', '150.907511', 'BC'),
          geo('P5U2', '-33.768512', '150.907511', 'BC'), geo('P5V3', '-33.768900', '150.908000', 'UC')]
    # 9 Second Avenue: units only, no base row — the site is the point most share.
    A += [ad('P9U1', 'S2ND', 'LBT', '2148', n1='9', flat='1401', flat_type='UNIT'),
          ad('P9U2', 'S2ND', 'LBT', '2148', n1='9', flat='1402', flat_type='UNIT'),
          ad('P9U3', 'S2ND', 'LBT', '2148', n1='9', flat='G1', flat_type='SHOP')]
    G += [geo('P9U1', '-33.769000', '150.909000', 'BC'), geo('P9U2', '-33.769000', '150.909000', 'BC'),
          geo('P9U3', '-33.769100', '150.909100', 'UC')]
    # A range, a suffix, a lot, a retired address, one with no point, an alias.
    A += [ad('P225', 'SMAIN', 'LBT', '2148', n1='225', n2='245'),
          ad('P12N', 'SKIL', 'LBT', '2148', n1='12'),
          ad('PLOT', 'SHUN', 'LBT', '2148', lot='1037'),
          ad('PRET', 'S2ND', 'LBT', '2148', n1='7', confidence='-1'),
          ad('PNOPT', 'S2ND', 'LBT', '2148', n1='11'),
          ad('PALIAS', 'SMAIN', 'LBT', '2148', n1='227', alias='A'),
          ad('PNONUM', 'SMAIN', 'LBT', '2148')]
    G += [geo('P225', '-33.770000', '150.910000'), geo('P12N', '-33.771000', '150.911000', 'FCS'),
          geo('PLOT', '-33.772000', '150.912000'), geo('PRET', '-33.773000', '150.913000'),
          geo('PALIAS', '-33.770050', '150.910050'), geo('PNONUM', '-33.774', '150.914')]
    # PNOPT's only geocode was retired: no current point.
    G.append(geo('PNOPT', '-33.775', '150.915', retired='2024-01-01'))
    # Two towns, one postal area.
    A += [ad('PG5', 'SCHG', 'LGU', '2581', n1='5'), ad('PC8', 'SCHC', 'LCO', '2581', n1='8')]
    G += [geo('PG5', '-34.78', '149.26'), geo('PC8', '-34.91', '149.43')]
    return t


def make_zip(path: str, tables: dict, drop: tuple[str, str] | None = None, header_fix=None) -> None:
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('G-NAF/Extras/GNAF_View_Scripts/address_view.sql', '-- view')
        for (state, table), rows in tables.items():
            if drop == (state, table):
                continue
            header = HEADERS[table]
            if header_fix:
                header = header_fix(state, table, header)
            zf.writestr(f'{ROOT}/{state}_{table}_psv.psv', '\n'.join([header, *rows]) + '\n')


def release_for(path: str) -> dict:
    return {'name': 'AUG 2026 - Geoscape G-NAF - GDA2020', 'label': 'AUG 2026', 'resource_id': 'r1',
            'url': 'https://example/g.zip', 'bytes': os.path.getsize(path), 'datum': 'GDA2020'}


def read_shard(out: str, state: str, postcode: str) -> list[dict]:
    with gzip.open(os.path.join(out, 'v1', state, f'{postcode}.psv.gz'), 'rt', encoding='utf-8') as fh:
        lines = fh.read().splitlines()
    header = lines[0].split('|')
    assert header == b.SHARD_COLUMNS, header
    return [dict(zip(header, line.split('|'))) for line in lines[1:]]


class BuildTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.zip = os.path.join(self.dir, 'g.zip')
        self.out = os.path.join(self.dir, 'out')

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def build(self, release: dict | None = None, min_addresses: int = 1) -> int:
        rel = os.path.join(self.dir, 'release.json')
        with open(rel, 'w') as fh:
            json.dump(release or release_for(self.zip), fh)
        return b.main(['build', '--zip', self.zip, '--release', rel, '--out', self.out,
                       '--work', os.path.join(self.dir, 'work'), '--memory', '512MB',
                       '--min-addresses', str(min_addresses)])

    def test_the_register_as_served(self) -> None:
        make_zip(self.zip, mini_release())
        self.assertEqual(self.build(), 0)
        rows = read_shard(self.out, 'NSW', '2148')
        by_pid = {r['pid']: r for r in rows}

        # A building's units at its point collapse into its one site row; the
        # villa with a point of its own keeps a row of its own.
        five = [r for r in rows if r['n1'] == '5' and r['street'] == 'SECOND']
        self.assertEqual({(r['flat'], r['pid']) for r in five}, {('', 'P5'), ('3', 'P5V3')})
        self.assertEqual(by_pid['P5']['gt'], 'BC')
        self.assertEqual((by_pid['P5']['lat'], by_pid['P5']['lng']), ('-33.768512', '150.907511'))

        # A building with no base row stands at the point most of its units share.
        nine = [r for r in rows if r['n1'] == '9']
        site = [r for r in nine if r['flat'] == '']
        self.assertEqual(len(site), 1)
        self.assertEqual((site[0]['lat'], site[0]['lng']), ('-33.769000', '150.909000'))
        self.assertEqual({r['flat'] for r in nine if r['flat']}, {'G1'})

        # A range, a suffix, a lot, an alias: each its own row, as G-NAF writes it.
        self.assertEqual((by_pid['P225']['n1'], by_pid['P225']['n2']), ('225', '245'))
        self.assertEqual(by_pid['P12N']['suffix'], 'N')
        self.assertEqual((by_pid['PLOT']['lot'], by_pid['PLOT']['n1']), ('1037', ''))
        self.assertIn('PALIAS', by_pid)

        # Retired, pointless and numberless addresses are not served.
        for pid in ('PRET', 'PNOPT', 'PNONUM'):
            self.assertNotIn(pid, by_pid)

        # One postal area, two towns: both kept, each under its own locality.
        two = read_shard(self.out, 'NSW', '2581')
        self.assertEqual({(r['n1'], r['locality']) for r in two}, {('5', 'GUNNING'), ('8', 'COLLECTOR')})

    def test_the_manifest_and_the_index(self) -> None:
        make_zip(self.zip, mini_release())
        self.assertEqual(self.build(), 0)
        with open(os.path.join(self.out, 'v1', 'manifest.json')) as fh:
            manifest = json.load(fh)
        self.assertEqual(manifest['format'], 1)
        self.assertEqual(manifest['release']['label'], 'AUG 2026')
        self.assertEqual(len(manifest['release']['sha256']), 64)
        counts = manifest['counts']
        self.assertEqual(counts['without_point'], 1)
        self.assertEqual(counts['without_number_or_lot'], 1)
        # Other Territories are read and counted, never served.
        self.assertEqual(counts['addresses_by_state']['OT'], 1)
        self.assertFalse(os.path.exists(os.path.join(self.out, 'v1', 'OT')))
        for state in b.SERVED_STATES:
            self.assertGreater(counts['rows_by_state'][state], 0, state)
        with gzip.open(os.path.join(self.out, 'v1', 'localities.json.gz'), 'rt') as fh:
            index = json.load(fh)
        self.assertEqual(index['format'], 1)
        self.assertEqual(index['states']['NSW']['BLACKTOWN'], ['2148'])
        # Another name the register records for a locality reaches its postal areas.
        self.assertEqual(index['states']['NSW']['BLACKTOWN WEST'], ['2148'])
        self.assertEqual(index['states']['NSW']['GUNNING'], ['2581'])

    def test_an_unchanged_release_builds_the_same_bytes(self) -> None:
        make_zip(self.zip, mini_release())
        self.assertEqual(self.build(), 0)
        first = open(os.path.join(self.out, 'v1', 'NSW', '2148.psv.gz'), 'rb').read()
        self.assertEqual(self.build(), 0)
        self.assertEqual(open(os.path.join(self.out, 'v1', 'NSW', '2148.psv.gz'), 'rb').read(), first)

    def test_a_file_lists_each_street_by_number(self) -> None:
        # 5A is its own street number: after 5 and 5's own villa, before 9.
        tables = mini_release()
        tables[('NSW', 'ADDRESS_DETAIL')].append(ad('P5A', 'S2ND', 'LBT', '2148', n1='5', n1s='A'))
        tables[('NSW', 'ADDRESS_DEFAULT_GEOCODE')].append(geo('P5A', '-33.768600', '150.907600'))
        make_zip(self.zip, tables)
        self.assertEqual(self.build(), 0)
        second = [(r['n1'], r['n1s'], r['flat']) for r in read_shard(self.out, 'NSW', '2148') if r['street'] == 'SECOND']
        self.assertEqual(second, [('5', '', ''), ('5', '', '3'), ('5', 'A', ''), ('9', '', ''), ('9', '', 'G1')])

    def test_a_refusal_after_the_pass_leaves_nothing_served(self) -> None:
        # Tasmania's addresses are all unusable: the pass completes, then the
        # empty state refuses — and neither the register nor its half-written
        # staging directory is left behind.
        tables = mini_release()
        tables[('TAS', 'ADDRESS_DEFAULT_GEOCODE')] = []
        make_zip(self.zip, tables)
        self.assertEqual(self.build(), 2)
        self.assertFalse(os.path.exists(os.path.join(self.out, 'v1')))
        self.assertFalse(os.path.exists(os.path.join(self.out, '.v1.partial')))

    def test_a_refused_rebuild_leaves_the_last_register_standing(self) -> None:
        make_zip(self.zip, mini_release())
        self.assertEqual(self.build(), 0)
        tables = mini_release()
        tables[('TAS', 'ADDRESS_DEFAULT_GEOCODE')] = []
        make_zip(self.zip, tables)
        self.assertEqual(self.build(), 2)
        self.assertTrue(os.path.exists(os.path.join(self.out, 'v1', 'manifest.json')))
        self.assertTrue(os.path.exists(os.path.join(self.out, 'v1', 'TAS', '9999.psv.gz')))

    def test_refuses_a_file_that_is_not_the_catalogue_s(self) -> None:
        make_zip(self.zip, mini_release())
        rel = release_for(self.zip)
        rel['bytes'] += 1
        self.assertEqual(self.build(release=rel), 2)
        self.assertFalse(os.path.exists(os.path.join(self.out, 'v1')))

    def test_refuses_an_error_page_saved_as_a_zip(self) -> None:
        with open(self.zip, 'w') as fh:
            fh.write('<html>Access denied</html>')
        self.assertEqual(self.build(), 2)

    def test_refuses_a_release_missing_a_table_a_served_state_needs(self) -> None:
        make_zip(self.zip, mini_release(), drop=('QLD', 'ADDRESS_DEFAULT_GEOCODE'))
        self.assertEqual(self.build(), 2)

    def test_refuses_a_header_without_a_column_it_reads(self) -> None:
        make_zip(self.zip, mini_release(),
                 header_fix=lambda s, t, h: h.replace('|CONFIDENCE|', '|CONF|') if t == 'ADDRESS_DETAIL' else h)
        self.assertEqual(self.build(), 2)

    def test_refuses_a_release_below_the_floor(self) -> None:
        make_zip(self.zip, mini_release())
        self.assertEqual(self.build(min_addresses=10_000), 2)
        self.assertFalse(os.path.exists(os.path.join(self.out, 'v1')))


class ResolveTest(unittest.TestCase):
    def test_takes_the_gda2020_zip_even_when_gda94_is_listed_first(self) -> None:
        package = {'success': True, 'result': {'resources': [
            {'id': 'a', 'name': 'AUG 2026 - Geoscape G-NAF - GDA94', 'format': 'ZIP', 'url': 'https://x/94.zip', 'size': 1,
             'last_modified': '2026-08-17T03:30:21'},
            {'id': 'eula', 'name': 'End User Licence Agreement', 'format': 'PDF', 'url': 'https://x/eula.pdf'},
            {'id': 'b', 'name': 'AUG 2026 - Geoscape G-NAF - GDA2020', 'format': 'ZIP', 'url': 'https://x/2020.zip',
             'size': 1854931188, 'last_modified': '2026-08-17T03:30:21'},
            {'id': 'c', 'name': 'MAY 2026 - Geoscape G-NAF - GDA2020', 'format': 'ZIP', 'url': 'https://x/old.zip',
             'size': 5, 'last_modified': '2026-05-15T00:00:00'},
        ]}}
        release = b.choose_release(package)
        self.assertEqual(release['resource_id'], 'b')
        self.assertEqual(release['label'], 'AUG 2026')
        self.assertEqual(release['bytes'], 1854931188)

    def test_refuses_a_catalogue_with_no_gda2020_zip(self) -> None:
        with self.assertRaises(b.Refusal):
            b.choose_release({'success': True, 'result': {'resources': [{'name': 'EULA', 'format': 'PDF'}]}})


if __name__ == '__main__':
    unittest.main()
