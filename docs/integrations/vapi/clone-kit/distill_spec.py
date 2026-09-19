#!/usr/bin/env python3
"""Distill the Vapi OpenAPI document into create-dtos.json.

Keeps, for every Create DTO the clone kit validates against, only the TOP-LEVEL
property names and required list. Deliberately shallow: the payloads are verbatim
API reads, so their nested internals are already known-valid by a stronger
guarantee than any schema check - what needs checking is the top-level shape a
POST will accept, which is exactly where the read and create schemas diverge.

Usage: python3 distill_spec.py /path/to/api-json.json
Regenerate whenever the pinned spec is refreshed; commit the output.
"""
import json, sys

def main(spec_path):
    spec = json.load(open(spec_path))
    comp = spec['components']['schemas']

    def top(name, seen=()):
        s = comp[name]
        props, req = dict(s.get('properties', {})), list(s.get('required', []))
        for sub in s.get('allOf', []):
            if '$ref' in sub and sub['$ref'].split('/')[-1] not in seen:
                p2, r2 = top(sub['$ref'].split('/')[-1], seen + (name,))
                props.update(p2); req += r2
        return props, req

    def discriminator(props):
        for key in ('type', 'provider'):
            t = props.get(key) or {}
            lits = t.get('enum') or ([t['const']] if 'const' in t else None)
            if lits:
                return key, lits
        return None, None

    def entry(name):
        props, req = top(name)
        dkey, dvals = discriminator(props)
        return {'properties': sorted(props), 'required': sorted(set(req)),
                'discriminatorKey': dkey, 'discriminatorValues': dvals}

    def variants(path):
        sch = spec['paths'][path]['post']['requestBody']['content']['application/json']['schema']
        refs = ([v['$ref'].split('/')[-1] for v in sch['oneOf']]
                if 'oneOf' in sch else [sch['$ref'].split('/')[-1]])
        return {r: entry(r) for r in refs}

    out = {
        'source': {'spec': 'https://api.vapi.ai/api-json',
                   'openapi': spec.get('openapi'),
                   'note': 'Top-level Create DTO shapes only; regenerate with distill_spec.py.'},
        'resources': {
            'file': {'endpoint': 'POST /file', 'contentType': 'multipart/form-data', 'dtos': {}},
            'tool': {'endpoint': 'POST /tool', 'dtos': variants('/tool')},
            'structured-output': {'endpoint': 'POST /structured-output',
                                  'dtos': variants('/structured-output')},
            'scorecard': {'endpoint': 'POST /observability/scorecard',
                          'dtos': variants('/observability/scorecard')},
            'assistant': {'endpoint': 'POST /assistant', 'dtos': variants('/assistant')},
            'squad': {'endpoint': 'POST /squad', 'dtos': variants('/squad')},
            'workflow': {'endpoint': 'POST /workflow',
                         'dtos': {'CreateWorkflowDTO': entry('CreateWorkflowDTO')},
                         'note': 'Path absent from the spec; live API serves GET /workflow. DTO taken from components.'},
            'phone-number': {'endpoint': 'POST /phone-number', 'dtos': variants('/phone-number')},
            'insight': {'endpoint': 'POST /reporting/insight', 'dtos': variants('/reporting/insight')},
            'board': {'endpoint': 'POST /reporting/board', 'dtos': variants('/reporting/board')},
        },
    }
    json.dump(out, open('create-dtos.json', 'w'), indent=2)
    n = sum(len(r['dtos']) for r in out['resources'].values())
    print(f'create-dtos.json written: {n} DTOs across {len(out["resources"])} resources')

if __name__ == '__main__':
    main(sys.argv[1])
