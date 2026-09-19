#!/usr/bin/env python3
"""Push the built payloads into a NEW Vapi account. NOTHING RUNS WITHOUT --execute.

Subcommands
  plan               (default) print the ordered plan, env-var status, url-map status
  probe   --execute  settle the contested-field question: create ONE throwaway
                     assistant and ONE transferCall tool carrying the fields the
                     spec omits, read them back, print an accepted/dropped verdict
                     per field, then DELETE both. The only writes it makes.
  run     --execute  create everything in dependency order, remapping ids as it
                     goes; resumable via clone-state.json; read-back diff after
                     every create
  verify             re-read every created object and re-diff; check every
                     cross-reference resolves in the target org

Safety
  - Every write path requires --execute AND the VAPI_TARGET_TOKEN env var.
  - Before the first write, the target org is fingerprinted: if any assistant it
    returns carries the SOURCE org id or an id from this snapshot, the run
    aborts - that is the source account, not the new one.
  - Secrets are substituted from the environment in memory at send time; they are
    never written to disk. clone-state.json holds only ids and timestamps.
  - VAPI_WEBHOOK_SECRET must be the NEW secret minted after rotation, never the
    leaked one (see ../SECURITY-INCIDENT.md).

Optional env: TWILIO_AUTH_TOKEN (attached to Twilio number creates when set).
"""
import argparse, json, os, ssl, sys, time, urllib.request, urllib.error, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://api.vapi.ai'
SOURCE_ORG_ID = 'c9015cd5-3701-4ac5-aa9c-be6cdcaaecdd'
# sipUri is NOT server-assigned: CreateVapiPhoneNumberDTO accepts it, and the
# username is ours to choose. It must therefore survive into the request body,
# or the new number is minted at an address nothing has been told to dial.
SERVER_FIELDS = {'id', 'orgId', 'createdAt', 'updatedAt', 'latestVersion',
                 'isServerUrlSecretSet', 'status'}
STATE_PATH = os.path.join(HERE, 'clone-state.json')
CONTESTED_ASSISTANT = {'serverUrl', 'recordingEnabled', 'hipaaEnabled',
                       'silenceTimeoutSeconds', 'backchannelingEnabled',
                       'backgroundDenoisingEnabled', 'endCallFunctionEnabled',
                       'dialKeypadFunctionEnabled', 'voicemailDetectionEnabled'}


def die(msg):
    print(f'ABORT: {msg}', file=sys.stderr)
    sys.exit(1)


def token():
    t = os.environ.get('VAPI_TARGET_TOKEN')
    if not t:
        die('VAPI_TARGET_TOKEN is not set. It must be an API key for the NEW account.')
    return t


def http(method, path, body=None, raw=None, content_type='application/json'):
    url = BASE + path
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Authorization', f'Bearer {token()}')
    if data is not None:
        req.add_header('Content-Type', content_type)
    ctx = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE') or None)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=120) as r:
            t = r.read()
            return r.status, json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        t = e.read().decode(errors='replace')
        try:
            return e.code, json.loads(t)
        except Exception:
            return e.code, {'raw': t}


def load_index():
    return json.load(open(os.path.join(HERE, 'index.json')))


def load_state():
    if os.path.exists(STATE_PATH):
        return json.load(open(STATE_PATH))
    return {'idMap': {}, 'done': {}, 'log': []}


def save_state(st):
    with open(STATE_PATH, 'w') as f:
        json.dump(st, f, indent=2)
        f.write('\n')


def guard_target(index):
    """Refuse to write into anything that looks like the source account."""
    st, body = http('GET', '/assistant?limit=100')
    if st != 200:
        die(f'target fingerprint failed: GET /assistant -> {st} {body}')
    listing = body if isinstance(body, list) else (body or {}).get('results', [])
    old_ids = {p['oldId'] for p in index['payloads'] if p['oldId']}
    for a in listing:
        if a.get('orgId') == SOURCE_ORG_ID:
            die('the target token belongs to the SOURCE org - refusing to write')
        if a.get('id') in old_ids:
            die('the target already contains an object from this snapshot - wrong account?')
    return len(listing)


def substitute(obj, env_needed, url_map):
    """Replace {{REDACTED:X}} from the environment and remap webhook URLs. In memory only."""
    import re
    pat = re.compile(r'\{\{REDACTED:([A-Z0-9_]+)\}\}')

    def sub(v):
        if isinstance(v, dict):
            return {k: sub(x) for k, x in v.items()}
        if isinstance(v, list):
            return [sub(x) for x in v]
        if isinstance(v, str):
            if v in url_map:
                v = url_map[v]
            m = pat.fullmatch(v)
            if m:
                val = os.environ.get(m.group(1))
                if val is None:
                    die(f'env var {m.group(1)} is required by this payload and not set')
                return val
        return v
    return sub(obj)


def remap(obj, refs, id_map):
    """Rewrite each recorded reference pointer to the new id."""
    for pointer, ref in refs.items():
        parts = [p for p in pointer.split('/') if p]
        tgt = obj
        for p in parts[:-1]:
            tgt = tgt[int(p)] if isinstance(tgt, list) else tgt[p]
        leaf = int(parts[-1]) if isinstance(tgt, list) else parts[-1]
        new = id_map.get(ref['oldId'])
        if new is None:
            die(f'reference {pointer} -> {ref["oldId"]} has no mapped id yet '
                f'(create {ref["resource"]} first, or resume a broken run)')
        tgt[leaf] = new
    return obj


def readback_diff(sent, got):
    """What did the POST keep? Ignores server-assigned fields."""
    missing = [k for k in sent if k not in (got or {})]
    changed = [k for k in sent if k in (got or {}) and got[k] != sent[k]]
    return missing, changed


def post_file(entry):
    """Multipart upload; Vapi mints the file id."""
    meta = json.load(open(entry['file']))
    bytes_path = os.path.join(HERE, entry['bytesFile'])
    blob = open(bytes_path, 'rb').read()
    boundary = uuid.uuid4().hex
    name = meta.get('originalName') or os.path.basename(bytes_path)
    mime = meta.get('mimetype') or 'application/octet-stream'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
            f'filename="{name}"\r\nContent-Type: {mime}\r\n\r\n').encode() + blob + f'\r\n--{boundary}--\r\n'.encode()
    return http('POST', '/file', raw=body,
                content_type=f'multipart/form-data; boundary={boundary}')


def cmd_plan(args):
    index = load_index()
    st = load_state()
    print(f"clone plan - {index['summary']['payloads']} payloads "
          f"({index['summary']['optional']} optional), "
          f"{index['summary']['crossReferences']} cross-references\n")
    for ph in index['phases']:
        print(f"  {ph['phase']:24} {ph['count']:3} payloads")
    print('\nenv vars needed :', ', '.join(index['summary']['envVars']),
          '(+ TWILIO_AUTH_TOKEN optional)')
    for v in index['summary']['envVars']:
        print(f"  {v:22} {'SET' if os.environ.get(v) else 'not set'}")
    print(f"target token    : {'SET' if os.environ.get('VAPI_TARGET_TOKEN') else 'not set'}")
    um = os.path.join(HERE, 'url-map.json')
    print(f"url map         : {'url-map.json present' if os.path.exists(um) else 'NOT present - tools would keep legacy eu2 Make URLs'}")
    print(f"state           : {len(st['done'])} of {index['summary']['payloads']} already created" if st['done'] else 'state           : fresh run')
    print('\nnothing was sent. run `push.py probe --execute` first, then `push.py run --execute`.')


def load_url_map(args):
    if not args.url_map:
        return {}
    m = json.load(open(args.url_map))
    empty = [k for k, v in m.items() if not v]
    if empty:
        die(f'url map has {len(empty)} unfilled entries (empty values); fill or remove them')
    return m


def cmd_run(args):
    index = load_index()
    if not args.execute:
        cmd_plan(args)
        return
    url_map = load_url_map(args)
    st = load_state()
    n = guard_target(index)
    print(f'target fingerprint ok ({n} assistants there, none from this snapshot)')
    phases = args.phases.split(',') if args.phases else None
    for p in index['payloads']:
        if phases and p['phase'] not in phases:
            continue
        if p['optional'] and not args.include_optional:
            continue
        if p['file'] in st['done']:
            continue
        if p['resource'] == 'file':
            code, got = post_file(p)
        else:
            body = json.load(open(os.path.join(HERE, p['file'])))
            body = remap(body, p['refs'], st['idMap'])
            body = substitute(body, p['env'], url_map)
            if p['dto'] == 'CreateTwilioPhoneNumberDTO' and os.environ.get('TWILIO_AUTH_TOKEN'):
                body['twilioAuthToken'] = os.environ['TWILIO_AUTH_TOKEN']
            path = p['endpoint'].split(' ', 1)[1]
            code, got = http('POST', path, body=body)
        if code not in (200, 201):
            die(f"{p['file']} -> {code} {json.dumps(got)[:400]}")
        new_id = (got or {}).get('id')
        st['idMap'][p['oldId']] = new_id
        st['done'][p['file']] = new_id
        st['log'].append({'file': p['file'], 'newId': new_id, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        save_state(st)
        if p['resource'] != 'file':
            missing, changed = readback_diff(body, got)
            flag = ''
            dropped_contested = [k for k in missing if k in CONTESTED_ASSISTANT | {'function', 'async', 'metadata'}]
            if dropped_contested:
                flag = f"  ** POST DROPPED CONTESTED FIELDS: {dropped_contested} **"
            print(f"created {p['resource']:18} {str(p['name'])[:40]:42} {new_id}"
                  f"{' missing=' + str(missing) if missing else ''}{flag}")
            if args.strict and missing:
                die('--strict: POST response is missing fields that were sent')
        else:
            print(f"uploaded file {p['name']} -> {new_id}")
    backfill(index, st, phases)
    print('\nrun complete. now: push.py verify')


def backfill(index, st, phases=None):
    """PATCH the deferred reverse references (structured-output / scorecard
    assistantIds) once the assistants they name exist. Breaks the create cycle:
    assistants forward-reference these objects, these objects reverse-reference
    the assistants."""
    for p in index['payloads']:
        deferred = p.get('deferred')
        if not deferred or p['file'] not in st['done']:
            continue
        if phases and p['phase'] not in phases:
            continue
        key = f"backfill:{p['file']}"
        if key in st['done']:
            continue
        body = {}
        for field, old_ids in deferred.items():
            mapped = [st['idMap'].get(i) for i in old_ids]
            missing = [i for i, m in zip(old_ids, mapped) if m is None]
            if missing:
                die(f'backfill for {p["file"]}: unmapped assistant ids {missing} - '
                    f'run phase 04-assistant first')
            body[field] = mapped
        path = p['endpoint'].split(' ', 1)[1] + '/' + st['done'][p['file']]
        code, got = http('PATCH', path, body=body)
        if code != 200:
            die(f'backfill PATCH {path} -> {code} {json.dumps(got)[:300]}')
        st['done'][key] = True
        st['log'].append({'file': key, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        save_state(st)
        print(f"backfilled {p['resource']:18} {str(p['name'])[:40]:42} {list(body)}")


def cmd_probe(args):
    if not args.execute:
        print('probe is a WRITE (it creates and deletes two throwaway objects). add --execute.')
        return
    guard_target(load_index())
    probe_tool = {
        'type': 'transferCall',
        'function': {'name': 'probe_transfer', 'description': 'PROBE - delete me'},
        'async': False,
        'destinations': [{'type': 'number', 'number': '+61000000000'}],
    }
    probe_assistant = {
        'name': 'ZZ PROBE - delete me',
        'backgroundDenoisingEnabled': True, 'backchannelingEnabled': True,
        'hipaaEnabled': False, 'endCallFunctionEnabled': True,
        'dialKeypadFunctionEnabled': False, 'voicemailDetectionEnabled': False,
        'recordingEnabled': True, 'silenceTimeoutSeconds': 30,
        'serverUrl': 'https://example.com/probe',
    }
    for label, path, body in (('tool', '/tool', probe_tool),
                              ('assistant', '/assistant', probe_assistant)):
        code, got = http('POST', path, body=body)
        print(f'\nPOST {path} -> {code}')
        if code not in (200, 201):
            print('  rejected outright:', json.dumps(got)[:300])
            continue
        missing, changed = readback_diff(body, got)
        for k in body:
            verdict = 'DROPPED' if k in missing else ('normalised' if k in changed else 'accepted')
            print(f'  {k:28} {verdict}')
        dcode, _ = http('DELETE', f"{path}/{got['id']}")
        print(f'  DELETE {path}/{got["id"]} -> {dcode}')
    print('\nprobe done. if fields were DROPPED, decide their replacements '
          '(backgroundSpeechDenoisingPlan, keypadInputPlan, server.url, artifactPlan.recordingEnabled) '
          'before push.py run.')


def cmd_verify(args):
    index = load_index()
    st = load_state()
    if not st['done']:
        die('nothing in clone-state.json - run has not happened')
    bad = 0
    for p in index['payloads']:
        new_id = st['done'].get(p['file'])
        if not new_id:
            continue
        path = p['endpoint'].split(' ', 1)[1]
        code, got = http('GET', f'{path}/{new_id}')
        if code != 200:
            print(f'MISSING {p["resource"]} {p["name"]} -> {code}')
            bad += 1
            continue
        for pointer, ref in p['refs'].items():
            want = st['idMap'].get(ref['oldId'])
            if want and want not in json.dumps(got):
                print(f'DANGLING in target: {p["name"]} {pointer} should hold {want}')
                bad += 1
        for field, old_ids in (p.get('deferred') or {}).items():
            have = set(got.get(field) or [])
            want = {st['idMap'][i] for i in old_ids if i in st['idMap']}
            if want - have:
                print(f'BACKFILL MISSING on {p["name"]}: {field} lacks {sorted(want - have)}')
                bad += 1
    print(f'\nverify: {len(st["done"])} objects checked, {bad} problems')
    sys.exit(1 if bad else 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd')
    for name, fn in (('plan', cmd_plan), ('run', cmd_run), ('probe', cmd_probe), ('verify', cmd_verify)):
        s = sub.add_parser(name)
        s.set_defaults(fn=fn)
        s.add_argument('--execute', action='store_true', help='actually send writes')
        s.add_argument('--strict', action='store_true')
        s.add_argument('--include-optional', action='store_true')
        s.add_argument('--phases', help='comma-separated phase filter, e.g. 01-tool')
        s.add_argument('--url-map', help='JSON {oldUrl: newUrl} for the Make webhook re-point')
    args = ap.parse_args()
    if not args.cmd:
        args = ap.parse_args(['plan'])
    args.fn(args)


if __name__ == '__main__':
    main()
