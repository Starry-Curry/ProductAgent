"""The owner-approved downloadable demo stays complete and free of runtime secrets."""
import hashlib
import json
import re
import unittest
from pathlib import Path

from PIL import Image

from wujian.config import ROOT


class PublishedShowcaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = ROOT / 'demo/showcase'
        cls.data = json.loads((cls.bundle / 'catalog.json').read_text(encoding='utf-8'))

    def test_only_demo_identities_and_business_history_are_published(self):
        tables = self.data['tables']
        self.assertEqual({row['username'] for row in tables['users']},
                         {'xiaolin', 'xiaoxia', 'xiaolin_mom_demo', 'xiaolin_grandpa_demo'})
        self.assertTrue(all('password_hash' not in row for row in tables['users']))
        self.assertFalse({'runs', 'device_targets', 'device_observations'} & set(tables))
        self.assertTrue(all(row.get('agent_state') is None for row in tables['conversations']))
        self.assertTrue(all(row.get('run_id') is None for row in tables['messages']))
        self.assertTrue(tables['messages'])
        items = {row['id']: row for row in tables['items']}
        for identity in ('2dd09151cf3645b594f4d5d529536d44',
                         'a8efb2d3393b40f2b03f2683d3067fa0',
                         '25d74ede12744f16bb6c74c7d77e74f2'):
            self.assertTrue(items[identity]['photo_id'])

    def test_all_published_asset_bytes_and_photo_links_are_complete(self):
        assets = {row['id']: row for row in self.data['tables']['assets']}
        self.assertEqual(set(assets), {row['id'] for row in self.data['assets_manifest']})
        for entry in self.data['assets_manifest']:
            path = (self.bundle / entry['path']).resolve()
            self.assertTrue(path.is_relative_to(self.bundle.resolve()))
            raw = path.read_bytes()
            self.assertEqual(len(raw), entry['size'])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), entry['sha256'])
            if entry['media_type'].startswith('image/'):
                with Image.open(path) as image:
                    self.assertFalse(image.getexif().get(34853), entry['id'])
        for table in ('items', 'experiences', 'messages'):
            for row in self.data['tables'][table]:
                photos = list(row.get('photo_ids', []))
                if row.get('photo_id'):
                    photos.append(row['photo_id'])
                self.assertTrue(set(photos) <= set(assets), row['id'])

    def test_parsed_text_has_no_provider_tokens_device_addresses_or_host_paths(self):
        patterns = [r'\bsk-[A-Za-z0-9_-]{16,}\b',
                    r'(?i)\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b',
                    r'(?i)(?<![A-Za-z0-9])[A-Z]:[\\/]',
                    r'eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}']

        def strings(value):
            if isinstance(value, str):
                yield value
            elif isinstance(value, dict):
                for child in value.values():
                    yield from strings(child)
            elif isinstance(value, list):
                for child in value:
                    yield from strings(child)

        for value in strings(self.data):
            for pattern in patterns:
                self.assertIsNone(re.search(pattern, value), 'Sensitive pattern in showcase text')
        for entry in self.data['assets_manifest']:
            if Path(entry['path']).suffix in {'.html', '.json'}:
                value = (self.bundle / entry['path']).read_text(encoding='utf-8')
                if Path(entry['path']).suffix == '.json':
                    values = strings(json.loads(value))
                else:
                    values = [value]
                for text in values:
                    for pattern in patterns:
                        self.assertIsNone(re.search(pattern, text), entry['id'])
