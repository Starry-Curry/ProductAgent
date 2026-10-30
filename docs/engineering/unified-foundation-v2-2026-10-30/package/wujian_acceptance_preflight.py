#!/usr/bin/env python3
"""Offline-only input/results validator for Wujian real-world acceptance suite.

Does not fetch official websites, run real AI models, test the application, or validate
product facts. Its output is an inventory audit, not a passed acceptance report.
"""
import argparse
import collections
import json
import pathlib
import sys

EXPECTED_MODES = {'live_model': 34, 'browser': 23, 'integration': 16,
                  'prototype': 9, 'software_lab': 3}
EXPECTED_CATEGORIES = {'INTAKE': 9, 'QA': 22, 'CONSTRAINT': 10, 'PERSONA': 8,
                       'FAMILY': 10, 'GIFT': 8, 'AGENT': 9, 'ENTRY': 9}
RESULT_STATES = {'not_run', 'pass', 'fail', 'blocked', 'blocked_model_budget', 'not_applicable'}


def load_lines(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        for line_no, line in enumerate(f, 1):
            if line.strip():
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError as exc:
                    raise ValueError(f'{path}:{line_no}: invalid JSON: {exc}') from exc
    return rows


def validate(suite, fixture, results=None):
    issues = []
    ids = [c.get('id') for c in suite]
    if len(suite) != 85: issues.append(f'Expected 85 cases; found {len(suite)}')
    if len(ids) != len(set(ids)): issues.append('Duplicate case ids')
    products = fixture.get('products', {})
    if not isinstance(products, dict) or len(products) != 9:
        issues.append('Expected 9 keyed product fixtures')
        products = {}
    links = 0
    for pid, p in products.items():
        official = p.get('official', [])
        if not official: issues.append(f'{pid}: no official sources')
        for src in official:
            links += 1
            if not src.get('url', '').startswith('https://'):
                issues.append(f'{pid}: official URL must be https')
    for c in suite:
        i = c.get('id') or '<missing-id>'
        if c.get('category') not in EXPECTED_CATEGORIES: issues.append(f'{i}: unknown category')
        if c.get('mode') not in EXPECTED_MODES: issues.append(f'{i}: unknown mode')
        for key in ('title', 'prompt', 'expected', 'forbidden', 'verification', 'value'):
            if not c.get(key): issues.append(f'{i}: missing {key}')
        for pid in c.get('product_ids', []):
            if pid not in products: issues.append(f'{i}: unknown product {pid}')
        if c.get('requires_real_hardware') not in [True, False]:
            issues.append(f'{i}: missing explicit hardware flag')
    mcount = collections.Counter(c.get('mode') for c in suite)
    ccount = collections.Counter(c.get('category') for c in suite)
    if dict(mcount) != EXPECTED_MODES: issues.append('Mode distribution drift')
    if dict(ccount) != EXPECTED_CATEGORIES: issues.append('Category distribution drift')
    result_counts = None
    if results is not None:
        result_counts = collections.Counter()
        result_ids = []
        for r in results:
            i, state = r.get('id'), r.get('status')
            result_ids.append(i)
            result_counts[state] += 1
            if state not in RESULT_STATES: issues.append(f'{i}: invalid result status {state}')
            if state == 'pass':
                if not r.get('evidence_ref'): issues.append(f'{i}: pass missing evidence_ref')
                if not r.get('verified_by'): issues.append(f'{i}: pass missing verified_by')
                if not r.get('method'): issues.append(f'{i}: pass missing method')
                if not r.get('actual_result'): issues.append(f'{i}: pass missing actual_result')
        if len(result_ids) != len(set(result_ids)): issues.append('Duplicate result ids')
        missing = sorted(set(ids) - set(result_ids))
        extra = sorted(set(result_ids) - set(ids))
        if missing: issues.append(f'{len(missing)} cases missing result rows')
        if extra: issues.append(f'{len(extra)} result rows not in suite')
    return {'cases': len(suite), 'products': len(products), 'official_source_urls': links,
            'modes': dict(mcount), 'categories': dict(ccount),
            'result_statuses': dict(result_counts) if result_counts else None,
            'issues': issues, 'outcome': 'input_validation_pass' if not issues else 'input_validation_fail',
            'note': 'This validates file structure and result documentation ONLY, never application quality.'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--suite', default='wujian_realworld_acceptance_v1.jsonl')
    p.add_argument('--fixtures', default='wujian_real_product_fixtures_v1.json')
    p.add_argument('--results', help='Optional JSONL execution results')
    p.add_argument('--write-template', help='Write 85 not_run result records for Codex to fill')
    a=p.parse_args()
    suite=load_lines(a.suite)
    fixture=json.loads(pathlib.Path(a.fixtures).read_text(encoding='utf8'))
    results=load_lines(a.results) if a.results else None
    report=validate(suite,fixture,results)
    if a.write_template:
        dest=pathlib.Path(a.write_template)
        if dest.exists(): raise FileExistsError(f'Will not overwrite existing result file: {dest}')
        with dest.open('w', encoding='utf8') as fh:
            for c in suite:
                fh.write(json.dumps({'id':c['id'], 'mode':c['mode'], 'status':'not_run',
                                     'method':'', 'actual_result':'', 'evidence_ref':'',
                                     'verified_by':'', 'note':''},ensure_ascii=False)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    sys.exit(0 if not report['issues'] else 1)

if __name__=='__main__':
    main()
