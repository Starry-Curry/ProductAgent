"""Add a few explicitly fictional, photo-backed stories to the Xiaolin demo.

Uses the same authenticated API as the UI. Existing authored text is preserved;
only the two known seeded stories may receive a missing cover. No AI permission
or household sharing is enabled. Receipt stays in ignored var/.
"""
import argparse
import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8000')
    args = parser.parse_args()
    receipt_path = ROOT / 'var' / 'memory-demo-import.json'
    receipt = json.loads(receipt_path.read_text(encoding='utf-8')) if receipt_path.exists() else {'assets': {}, 'stories': {}}
    with httpx.Client(base_url=args.url, trust_env=False, timeout=30) as client:
        client.post('/api/auth/demo/xiaolin').raise_for_status()
        response = client.get('/api/experiences'); response.raise_for_status()
        existing = response.json()
        response = client.get('/api/items'); response.raise_for_status()
        items = response.json()
        def image(name):
            path = ROOT / 'frontend' / 'public' / 'illustrations' / name
            if name not in receipt['assets']:
                with path.open('rb') as photo:
                    response = client.post('/api/assets', files={'file': ('AI-generated-demo-' + name, photo, 'image/png')})
                response.raise_for_status()
                receipt['assets'][name] = response.json()['id']
                receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
            return receipt['assets'][name]
        reading = image('memory-reading-v1.png')
        gift = image('memory-gift-v1.png')
        sea_path = ROOT / 'frontend/public/illustrations/memory-sea-v1.png'
        sea = image(sea_path.name) if sea_path.exists() else None
        for identity, photo in [('experience_demo_reading_evening', reading), ('experience_demo_gift_story', gift)]:
            entry = next((row for row in existing if row['id'] == identity), None)
            if entry and not entry['photo_ids']:
                payload = {key: entry[key] for key in ['title', 'text', 'item_ids', 'photo_ids', 'occurred_on', 'allow_ai', 'household_id']}
                payload.update(photo_ids=[photo], expected_version=entry['version'])
                response = client.put('/api/experiences/' + identity, json=payload); response.raise_for_status()
        stories = [
            ('把晚上的一点时间还给自己', '忙完以后，把手机放远了一点，只开着书桌上的灯读了几页。旅行带回来的小石头压住书角，突然想起那天并没有赶时间。以后不必每天做很多事，留一点自己的时间也很好。', ['item_demo_lamp', 'item_demo_stone'], reading),
            ('一朵不用赶着盛开的向日葵', '朋友最近有些低落。我画了一朵向日葵，没有写“你一定要加油”，只留了一句：今天能好好吃饭、早点睡，就已经很好了。想把这份不催促的陪伴留下来。', ['item_demo_sunflower'], gift),
        ]
        if sea:
            stories.append(('带回来的是一颗石头，也是慢下来的那一天', '海边走了很久，最后没有买纪念品，只带回这颗摸起来很舒服的石头。现在把它放在桌上，偶尔握在手里，就会想起当时听见的海浪。它没有特别的功能，但能让我停一小会儿。', ['item_demo_stone'], sea))
        board = next((item for item in items if item['name'] == '书桌旁的洞洞板' and item.get('photo_id')), None)
        if board:
            desk = image('memory-desk-v1.png') if (ROOT / 'frontend/public/illustrations/memory-desk-v1.png').exists() else board['photo_id']
            stories.append(('桌面终于留出了一块空白', '把常用的工具挂到洞洞板上，桌面终于能摊开一本书。整理到最后发现，最喜欢的不是整齐本身，而是伸手就能找到东西、不必再打断正在做的事。', [board['id'], 'item_demo_lamp'], desk))
        for title, text, links, photo in stories:
            previous = next((row for row in existing if row['title'] == title), None)
            if previous:
                old_board_cover = bool(board and title == '桌面终于留出了一块空白' and previous['photo_ids'] == [board['photo_id']] and photo != board['photo_id'])
                if (receipt['stories'].get(title) == previous['id'] and (not previous['occurred_on'] or old_board_cover)
                        and previous['text'].endswith('（演示故事；生成配图或相关物品照片，可替换为你的真实经历与照片。）')):
                    payload = {key: previous[key] for key in ['title', 'text', 'item_ids', 'photo_ids', 'occurred_on', 'allow_ai', 'household_id']}
                    payload.update(occurred_on=previous['occurred_on'] or '2026-11-06', photo_ids=[photo], expected_version=previous['version'])
                    response = client.put('/api/experiences/' + previous['id'], json=payload); response.raise_for_status()
                continue
            response = client.post('/api/experiences', json={'title': title, 'text': text + '\n\n（演示故事；生成配图或相关物品照片，可替换为你的真实经历与照片。）', 'item_ids': links, 'photo_ids': [photo], 'occurred_on': '2026-11-06', 'allow_ai': False})
            response.raise_for_status()
            receipt['stories'][title] = response.json()['id']
            receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'demo_stories': len(receipt['stories']), 'private_by_default': True, 'receipt': str(receipt_path)}, ensure_ascii=True))


if __name__ == '__main__':
    main()
