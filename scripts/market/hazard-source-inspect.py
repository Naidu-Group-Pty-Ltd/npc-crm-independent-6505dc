"""
Read the publishers of bushfire and flood mapping, from a GitHub runner.

The development container cannot reach any .gov.au host. A runner can, so
this prints what each candidate ANSWERS into the job log: the services a
publisher lists, the layers inside them, and what each hazard layer says at
real report addresses. It writes nothing anywhere and holds no secret.

The question it exists to settle (27 Sep 2026): the 37 Bolin Street Compass
printed bushfire and flood as "Not assessed" although the NSW hazard map was
asked at the lot and answered nothing. Whether "nothing mapped" is a finding
depends on what the map COVERS: a statewide statutory designation that shows
nothing over a lot says the lot is not designated; a map only some councils
publish says nothing about the councils that did not. So for each layer this
reads its own description, and counts features by council where it can.

Three kinds of read:
  - DIRECTORY: an ArcGIS services directory, filtered to hazard-shaped names.
  - LAYER: a layer's own metadata (name, description, copyright).
  - POINT: an identify or query at a real report address.
"""
import json, re, sys, urllib.parse, urllib.request, urllib.error

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
HAZARD = re.compile(r'flood|bush|fire|hazard|inund|storm|coastal|overland|riverine|prone', re.I)

# Real report addresses, one per jurisdiction, as (label, lng, lat).
POINTS = {
  'NSW': ('37 Bolin Street, Tallawong', 150.882147, -33.690695),
  'NSW2': ('Cowra (48 Redfern Street)', 148.6948, -33.8345),
  'VIC': ('Golden Square (9 Hollow Street)', 144.2482, -36.7768),
  'QLD': ('Maryborough (262 Pallas Street)', 152.7003, -25.5395),
  'SA': ('Prospect', 138.5947, -34.8840),
  'WA': ('Spalding, Geraldton (60 Lawley Street)', 114.6310, -28.7470),
  'TAS': ('Hobart', 147.3272, -42.8821),
  'ACT': ('Canberra (Braddon)', 149.1334, -35.2750),
  'NT': ('Darwin (Parap)', 130.8410, -12.4330),
}

NSW = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services'
DIRECTORIES = [
  f'{NSW}/ePlanning',
  f'{NSW}/Hazards',
  f'{NSW}',
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment',
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/FloodCheck',
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre',
  'https://maps.six.nsw.gov.au/arcgis/rest/services/public',
  'https://portal.spatial.nsw.gov.au/server/rest/services',
  'https://services.ga.gov.au/gis/rest/services',
  'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services',
  'https://services.thelist.tas.gov.au/arcgis/rest/services/Public',
  'https://dpti.geohub.sa.gov.au/server/rest/services/Hosted',
  'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services',
]
LAYERS = [
  f'{NSW}/ePlanning/Planning_Portal_Hazard/MapServer',
  f'{NSW}/ePlanning/Planning_Portal_Hazard/MapServer/229',
  f'{NSW}/ePlanning/Planning_Portal_Hazard/MapServer/230',
  f'{NSW}/ePlanning/Planning_Portal_Hazard/MapServer/231',
  f'{NSW}/ePlanning/Planning_Portal_Hazard/MapServer/232',
  'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Bushfire_Prone_Land/MapServer',
  'https://services.ga.gov.au/gis/services/NFRAG_Floodplain_Risk_Information/MapServer/WFSServer?service=WFS&request=GetCapabilities',
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Environment/BushfireProneAreas/MapServer',
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/FloodCheck/RapidHazardAssessment/MapServer',
]


def fetch(url, accept='application/json,*/*'):
  req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': accept})
  try:
    with urllib.request.urlopen(req, timeout=60) as r:
      return r.status, r.headers.get('content-type', ''), r.read()
  except urllib.error.HTTPError as e:
    return e.code, e.headers.get('content-type', ''), e.read()[:4000]
  except Exception as e:  # noqa: BLE001 — the log is the product
    return None, '', repr(e).encode()


def as_json(body):
  try:
    return json.loads(body.decode('utf-8', 'replace'))
  except Exception:  # noqa: BLE001
    return None


def clip(s, n=600):
  s = re.sub(r'\s+', ' ', str(s or '')).strip()
  return s if len(s) <= n else s[:n] + ' …'


def directory(url):
  status, ctype, body = fetch(url + ('&' if '?' in url else '?') + 'f=json')
  print(f'\n=== DIRECTORY {url} status={status}')
  j = as_json(body)
  if not isinstance(j, dict):
    print('  ', clip(body.decode('utf-8', 'replace'), 300))
    return
  folders = j.get('folders') or []
  services = j.get('services') or []
  print(f'  folders {len(folders)} · services {len(services)}')
  hazardish = [f for f in folders if HAZARD.search(f)]
  if hazardish:
    print('  hazard-shaped folders:', hazardish)
  for s in services:
    name = s.get('name') or s.get('title') or ''
    if HAZARD.search(name):
      print(f"  service {name} ({s.get('type')})")


def layer(url):
  sep = '&' if '?' in url else '?'
  status, ctype, body = fetch(url if 'GetCapabilities' in url else url + sep + 'f=json')
  print(f'\n=== LAYER {url} status={status} type={ctype}')
  j = as_json(body)
  if not isinstance(j, dict):
    text = body.decode('utf-8', 'replace')
    names = re.findall(r'<(?:wfs:)?Name>([^<]+)</(?:wfs:)?Name>', text)
    print('   feature types:', names[:40])
    print('  ', clip(text, 400))
    return
  if j.get('error'):
    print('   error:', j['error'])
    return
  for k in ('name', 'mapName', 'description', 'serviceDescription', 'copyrightText', 'type', 'geometryType',
            'defaultVisibility', 'maxRecordCount'):
    if j.get(k) not in (None, ''):
      print(f'   {k}: {clip(j[k])}')
  if j.get('layers'):
    for l in j['layers']:
      if HAZARD.search(l.get('name', '')):
        print(f"   layer {l.get('id')}: {l.get('name')}")
  if j.get('fields'):
    print('   fields:', [f.get('name') for f in j['fields']][:30])


def identify(base, lng, lat, layers='all'):
  d = 0.0005
  p = urllib.parse.urlencode({
    'f': 'json', 'geometry': json.dumps({'x': lng, 'y': lat}), 'geometryType': 'esriGeometryPoint', 'sr': '4326',
    'layers': layers, 'tolerance': '0', 'mapExtent': f'{lng-d},{lat-d},{lng+d},{lat+d}',
    'imageDisplay': '400,400,96', 'returnGeometry': 'false',
  })
  status, _, body = fetch(f'{base}/identify?{p}')
  j = as_json(body)
  results = (j or {}).get('results') if isinstance(j, dict) else None
  print(f'  identify {base.split("/services/")[-1]} layers={layers} status={status} results={None if results is None else len(results)}')
  if isinstance(j, dict) and j.get('error'):
    print('   error:', j['error'])
  for r in (results or [])[:12]:
    attrs = {k: v for k, v in (r.get('attributes') or {}).items() if v not in (None, '', 'Null')}
    print(f"   · {r.get('layerId')} {r.get('layerName')}: {clip(json.dumps(attrs)[:500], 500)}")


def query(url, lng, lat, label):
  p = urllib.parse.urlencode({
    'f': 'json', 'geometry': f'{lng},{lat}', 'geometryType': 'esriGeometryPoint', 'inSR': '4326',
    'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*', 'returnGeometry': 'false',
  })
  status, _, body = fetch(f'{url}/query?{p}')
  j = as_json(body)
  feats = (j or {}).get('features') if isinstance(j, dict) else None
  print(f'  query {label} status={status} features={None if feats is None else len(feats)}')
  if isinstance(j, dict) and j.get('error'):
    print('   error:', j['error'])
  for f in (feats or [])[:6]:
    attrs = {k: v for k, v in (f.get('attributes') or {}).items() if v not in (None, '', 'Null')}
    print('   ·', clip(json.dumps(attrs), 500))


def count_by(url, field):
  """How much of the state a layer covers: its features grouped by a field."""
  p = urllib.parse.urlencode({
    'f': 'json', 'where': '1=1', 'groupByFieldsForStatistics': field,
    'outStatistics': json.dumps([{'statisticType': 'count', 'onStatisticField': field, 'outStatisticFieldName': 'n'}]),
  })
  status, _, body = fetch(f'{url}/query?{p}')
  j = as_json(body)
  feats = (j or {}).get('features') if isinstance(j, dict) else None
  print(f'  count by {field} status={status} groups={None if feats is None else len(feats)}')
  if isinstance(j, dict) and j.get('error'):
    print('   error:', j['error'])
  groups = sorted(((f.get('attributes') or {}).get(field), (f.get('attributes') or {}).get('n')) for f in (feats or []))
  print('   ', clip(json.dumps(groups), 3000))


ROUND = 2
# Round 2 (27 Sep 2026). Round 1 established that NSW layer 229 is the
# RFS-certified Bush Fire Prone Land map (statewide) and that NSW layer 230
# carries flood planning maps for ten named councils. It also found services
# nothing here reads: NSW's own `Fire` and `Flood` folders, Victoria's
# `bushfire_prone_area` feature type (the statutory designation, separate from
# the planning scheme's overlay), the ACT's `Bushfire_Prone_Area_Details_2026`,
# its flood extent, Tasmania's SES flood mapping and South Australia's hosted
# flooding layers. This round reads each one and asks it at a real address.

VIC_WFS = 'https://opendata.maps.vic.gov.au/geoserver/wfs'
ACT = 'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services'

for url in (f'{NSW}/Fire', f'{NSW}/Flood'):
  directory(url)
  status, _, body = fetch(url + '?f=json')
  for s2 in (as_json(body) or {}).get('services') or []:
    svc = f"{NSW}/{s2.get('name')}/{s2.get('type')}"
    layer(svc)

for svc in (f'{ACT}/Bushfire_Prone_Area_Details_2026/FeatureServer', f'{ACT}/Bushfire_Prone_Area_Overview_2026/FeatureServer',
            f'{ACT}/ACTGOV_FLOOD_EXTENT/FeatureServer', f'{ACT}/Flood_Boundary/FeatureServer',
            f'{ACT}/Bushfire_Prone_Area_Details_2026/FeatureServer/0', f'{ACT}/ACTGOV_FLOOD_EXTENT/FeatureServer/0',
            'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/SES_FloodMapping/MapServer',
            'https://dpti.geohub.sa.gov.au/server/rest/services/Hosted/Flooding_v15_WFL1/FeatureServer',
            'https://dpti.geohub.sa.gov.au/server/rest/services/Hosted/Flooding_v15_WFL1/FeatureServer/0',
            'https://dpti.geohub.sa.gov.au/server/rest/services/Hosted/Code_Amendment__BaseLayers/FeatureServer'):
  layer(svc)

print('\n\n######## POINT READINGS')
label, lng, lat = POINTS['ACT']
print(f'\n--- {label}')
query(f'{ACT}/Bushfire_Prone_Area_Details_2026/FeatureServer/0', lng, lat, 'ACT BPA details')
query(f'{ACT}/ACTGOV_FLOOD_EXTENT/FeatureServer/0', lng, lat, 'ACT flood extent')
# A point known to be bush-edge in Canberra (Chapman, on Mount Arawang's slope).
query(f'{ACT}/Bushfire_Prone_Area_Details_2026/FeatureServer/0', 149.0395, -35.3565, 'ACT BPA details — Chapman')

for key, extra in (('VIC', None), ('VIC_BUSH', (145.3580, -37.8450))):
  label, lng, lat = POINTS['VIC'] if key == 'VIC' else ('Belgrave (Dandenong Ranges)', *extra)
  print(f'\n--- {label}')
  p = urllib.parse.urlencode({
    'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': 'open-data-platform:bushfire_prone_area',
    'outputFormat': 'application/json', 'count': '5',
    'CQL_FILTER': f'INTERSECTS(geom,POINT({lat} {lng}))',
  })
  status, _, body = fetch(f'{VIC_WFS}?{p}')
  j = as_json(body)
  feats = (j or {}).get('features') if isinstance(j, dict) else None
  print(f'  VIC BPA (lat lng) status={status} features={None if feats is None else len(feats)}')
  if feats is None:
    print('  ', clip(body.decode('utf-8', 'replace'), 400))
  for f in (feats or [])[:3]:
    print('   ·', clip(json.dumps(f.get('properties')), 400))
  p2 = urllib.parse.urlencode({'service': 'WFS', 'version': '2.0.0', 'request': 'DescribeFeatureType',
                               'typeNames': 'open-data-platform:bushfire_prone_area'})
  if key == 'VIC':
    status, _, body = fetch(f'{VIC_WFS}?{p2}', 'application/xml')
    print('  schema:', re.findall(r'name="([^"]+)"', body.decode('utf-8', 'replace'))[:20])

label, lng, lat = POINTS['TAS']
print(f'\n--- {label}')
identify('https://services.thelist.tas.gov.au/arcgis/rest/services/Public/SES_FloodMapping/MapServer', lng, lat)
label, lng, lat = POINTS['SA']
print(f'\n--- {label}')
query('https://dpti.geohub.sa.gov.au/server/rest/services/Hosted/Flooding_v15_WFL1/FeatureServer/0', lng, lat, 'SA flooding v15')


# Round 3 (27 Sep 2026). Round 2 read Victoria's `bushfire_prone_area` with the
# point written latitude-first and no SRID, and found Belgrave inside and Golden
# Square outside. Before a report says "not mapped" on the strength of it, the
# axis order has to be settled against points whose answer is known both ways,
# in every spelling a reader might write — a wrong axis answers "nothing here"
# everywhere, which is the one failure a designation map must never have. The
# ACT answered nothing at Braddon and at Chapman; this asks it where a
# designated area cannot be absent, and reads what the service says of itself.
print('\n\n######## ROUND 3 — axis order and known points')
VIC_POINTS = [
  ('Belgrave (expected inside)', 145.3580, -37.8450),
  ('Kinglake (expected inside)', 145.3450, -37.5280),
  ('Melbourne CBD (expected outside)', 144.9631, -37.8136),
  ('Golden Square', 144.2610, -36.7755),
]
FORMS = [
  ('POINT(lat lng)', lambda lng, lat: f'INTERSECTS(geom,POINT({lat} {lng}))'),
  ('SRID=4326;POINT(lng lat)', lambda lng, lat: f'INTERSECTS(geom,SRID=4326;POINT({lng} {lat}))'),
  ('POINT(lng lat)', lambda lng, lat: f'INTERSECTS(geom,POINT({lng} {lat}))'),
]
for label, lng, lat in VIC_POINTS:
  print(f'\n--- {label}')
  for form, cql in FORMS:
    p = urllib.parse.urlencode({
      'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': 'open-data-platform:bushfire_prone_area',
      'outputFormat': 'application/json', 'count': '3',
      'propertyName': 'lga_name,plan_number,gazettal_date', 'CQL_FILTER': cql(lng, lat),
    })
    status, _, body = fetch(f'{VIC_WFS}?{p}')
    j = as_json(body)
    feats = (j or {}).get('features') if isinstance(j, dict) else None
    first = json.dumps((feats or [{}])[0].get('properties')) if feats else ''
    print(f'  {form:26s} status={status} features={None if feats is None else len(feats)} {clip(first, 200)}')
    if feats is None:
      print('   ', clip(body.decode('utf-8', 'replace'), 300))
  p = urllib.parse.urlencode({
    'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': 'open-data-platform:plan_overlay',
    'outputFormat': 'application/json', 'count': '10', 'propertyName': 'zone_code',
    'CQL_FILTER': f'INTERSECTS(geom,SRID=4326;POINT({lng} {lat}))',
  })
  status, _, body = fetch(f'{VIC_WFS}?{p}')
  j = as_json(body)
  codes = [(f.get('properties') or {}).get('zone_code') for f in ((j or {}).get('features') or [])]
  print(f'  plan_overlay (production form) status={status} codes={codes}')

print('\n--- ACT: what the services say of themselves')
for svc in (f'{ACT}/Bushfire_Prone_Area_Details_2026/FeatureServer', f'{ACT}/Bushfire_Prone_Area_Overview_2026/FeatureServer'):
  status, _, body = fetch(svc + '?f=json')
  j = as_json(body) or {}
  print(f'  {svc.rsplit("/", 2)[-2]} copyrightText={clip(str(j.get("copyrightText")), 200)!r}')
  print(f'    description={clip(str(j.get("description") or j.get("serviceDescription")), 400)!r}')
  print(f'    spatialReference={j.get("spatialReference")}')
  status, _, body = fetch(svc + '/0/query?' + urllib.parse.urlencode({'f': 'json', 'where': '1=1', 'returnCountOnly': 'true'}))
  print(f'    count status={status} {clip(body.decode("utf-8", "replace"), 120)}')
  status, _, body = fetch(svc + '/0/query?' + urllib.parse.urlencode({'f': 'json', 'where': '1=1', 'returnExtentOnly': 'true', 'outSR': '4326'}))
  print(f'    extent status={status} {clip(body.decode("utf-8", "replace"), 300)}')
for label, lng, lat in (('Tharwa village', 149.0697, -35.5092), ('Stromlo', 149.0250, -35.3200),
                        ('Namadgi (Orroral)', 148.9500, -35.6300), ('Braddon', 149.1334, -35.2750)):
  query(f'{ACT}/Bushfire_Prone_Area_Details_2026/FeatureServer/0', lng, lat, f'ACT BPA details — {label}')
  query(f'{ACT}/Bushfire_Prone_Area_Overview_2026/FeatureServer/0', lng, lat, f'ACT BPA overview — {label}')
