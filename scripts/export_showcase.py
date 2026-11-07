"""Export the explicitly approved demonstration accounts, never a database backup.

Run from the repository root with its virtualenv. Only this script reads the
local database; the published bundle contains ordinary JSON and referenced media.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sqlalchemy import JSON
from wujian.database import Base

DEMO_IDS = {"person_demo_owner", "person_demo_friend"}
DEMO_NAMES = {"xiaolin_mom_demo", "xiaolin_grandpa_demo"}
EXCLUDED = {"runs", "device_targets", "device_observations"}
# All supplied demonstration photos are explicitly approved for publication.
OMITTED_ASSETS = set()
MAC = re.compile(r"(?i)\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b")
KEY = re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b")
JWT = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")
LOCAL_PATH = re.compile(r"(?i)(?<![A-Za-z0-9])[A-Z]:[\\/][^\n\r\"<>]*")
SECRET_KEYS = {"password", "password_hash", "api_key", "access_token", "refresh_token", "cookie", "cookies", "authorization", "session_secret", "session_id", "bluetooth_address", "mac_address", "device_address"}


def scrub(value):
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items() if k.lower() not in SECRET_KEYS}
    if isinstance(value, list):
        return [scrub(v) for v in value if v not in OMITTED_ASSETS] if all(isinstance(v, str) for v in value) else [scrub(v) for v in value]
    if isinstance(value, str):
        return LOCAL_PATH.sub("[演示环境路径]", JWT.sub("[已移除网页令牌]", KEY.sub("[已移除密钥]", MAC.sub("[本机设备地址]", value))))
    return value


def export(database: Path, destination: Path):
    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    rows = {}
    for table in Base.metadata.sorted_tables:
        if table.name in EXCLUDED:
            continue
        values = [dict(row) for row in connection.execute(f'SELECT * FROM "{table.name}"')]
        for value in values:
            for column in table.columns:
                if isinstance(column.type, JSON) and isinstance(value.get(column.name), str):
                    value[column.name] = json.loads(value[column.name])
        rows[table.name] = values
    connection.close()
    users = [row for row in rows['users'] if row['id'] in DEMO_IDS or row['username'] in DEMO_NAMES]
    user_ids = {row['id'] for row in users}
    assert DEMO_IDS <= user_ids, 'Required demonstration identities are missing'
    rows['users'] = users
    # Apply explicit user ownership before reference closure. No other account
    # can be included merely because it is a friend or household participant.
    for table in Base.metadata.sorted_tables:
        if table.name not in rows or table.name == 'users':
            continue
        user_columns = [fk.parent.name for fk in table.foreign_keys if fk.column.table.name == 'users']
        if user_columns:
            rows[table.name] = [row for row in rows[table.name] if all(row[column] is None or row[column] in user_ids for column in user_columns)]
    product_ids = {row['product_id'] for row in rows['items'] if row['product_id']}
    rows['products'] = [row for row in rows['products'] if row['id'] in product_ids]
    for _ in range(len(rows)):
        changed = False
        for table in Base.metadata.sorted_tables:
            if table.name not in rows:
                continue
            checks = [(fk.parent.name, {row[fk.column.name] for row in rows[fk.column.table.name]})
                      for fk in table.foreign_keys if fk.column.table.name in rows]
            selected = [row for row in rows[table.name] if all(row[col] is None or row[col] in allowed for col, allowed in checks)]
            changed |= len(selected) != len(rows[table.name])
            rows[table.name] = selected
        if not changed:
            break
    assets = {row['id']: row for row in rows.pop('assets')}
    excluded_media = {identity for identity, row in assets.items() if row['media_type'] == 'text/html' or
                      (row['media_type'] == 'video/mp4' and row['original_name'].startswith('public-inspiration:'))}
    for row in rows['sources']:
        if row.get('asset_id') in excluded_media:
            row['asset_id'] = None
        if row.get('origin') == 'video_frame_sample':
            metadata = json.loads(row['content'])
            if metadata.get('video_asset_id') in excluded_media:
                metadata['video_asset_id'] = None
                metadata['video_cached'] = False
                metadata['distribution_note'] = '下载演示包保留原链接及已采样帧，不分发第三方整片；新时间窗请从parent_source_id联网解析。'
                metadata.pop('video_bytes', None)
                row['content'] = json.dumps(metadata, ensure_ascii=False)
    for row in rows['users']:
        row.pop('password_hash', None)
    for row in rows['conversations']:
        row['agent_state'] = None
    for row in rows['messages']:
        row['run_id'] = None
    rows = scrub(rows)
    serialized = json.dumps(rows, ensure_ascii=False)
    wanted = {identity for identity in assets if identity not in OMITTED_ASSETS | excluded_media and identity in serialized}
    # Source page lists and workbench manifests may themselves reference assets.
    # Iterate until all references in a retained workbench JSON have been found.
    source_blobs = {}
    for _ in range(len(assets) + 1):
        previous = set(wanted)
        for identity in wanted:
            asset = assets[identity]
            if asset['media_type'] == 'application/vnd.wujian.workbench+json' and identity not in source_blobs:
                raw = Path(asset['path']).read_bytes()
                value = json.loads(raw)
                if scrub(value) != value:
                    raise ValueError(f'Workbench {identity} needs actual revalidation after redaction; preserve its original check evidence')
                source_blobs[identity] = raw
        more = b'\n'.join(source_blobs.values()).decode('utf-8')
        wanted.update(identity for identity in assets if identity not in OMITTED_ASSETS | excluded_media and identity in more)
        if wanted == previous:
            break
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'media').mkdir(exist_ok=True)
    # Delete only obsolete generated outputs previously named in this bundle's
    # manifest; never touch source assets or arbitrary neighbouring files.
    old_catalog = destination/'catalog.json'
    if old_catalog.is_file():
        for row in json.loads(old_catalog.read_text(encoding='utf-8')).get('assets_manifest', []):
            if row['id'] not in wanted:
                target = (destination/row['path']).resolve()
                if target.parent != (destination/'media').resolve() or not target.stem.isalnum():
                    raise ValueError('Unexpected generated media path')
                target.unlink(missing_ok=True)
    manifest, exported_assets = [], []
    from PIL import Image, ImageOps
    teaching_hashes = {hashlib.sha256(path.read_bytes()).hexdigest() for path in (ROOT/'demo/as2').rglob('*') if path.is_file()}
    for identity in sorted(wanted):
        asset = assets[identity]
        original = Path(asset['path'])
        if not original.is_file():
            raise FileNotFoundError(f'Missing referenced demonstration asset {identity}')
        suffix = {'image/jpeg':'.jpg', 'image/png':'.png', 'application/pdf':'.pdf', 'text/html':'.html', 'video/mp4':'.mp4', 'application/vnd.wujian.workbench+json':'.json'}.get(asset['media_type'])
        if suffix is None:
            raise ValueError(f'Unsupported demonstration asset type {asset["media_type"]}')
        relative = f'media/{identity}{suffix}'
        target = destination / relative
        if asset['media_type'].startswith('image/'):
            with Image.open(original) as image:
                raw = original.read_bytes()
                if not image.getexif() and not image.info.get('xmp') and not image.info.get('XML:com.adobe.xmp'):
                    target.write_bytes(raw)
                elif hashlib.sha256(raw).hexdigest() in teaching_hashes and not image.getexif().get(34853):
                    # Published AS2 reference pixels/metadata have already been
                    # GPS-audited; preserve the teaching calibration digest.
                    target.write_bytes(raw)
                else:
                    image = ImageOps.exif_transpose(image)
                    clean = Image.frombytes(image.mode, image.size, image.tobytes())
                    if suffix == '.jpg':
                        clean.convert('RGB').save(target, quality=95)
                    else:
                        clean.save(target)
        elif identity in source_blobs:
            target.write_bytes(source_blobs[identity])
        elif asset['media_type'] == 'text/html':
            target.write_text(scrub(original.read_text(encoding='utf-8', errors='replace')), encoding='utf-8')
        else:
            target.write_bytes(original.read_bytes())
        if target.stat().st_size >= 95_000_000:
            raise ValueError(f'Asset {identity} exceeds ordinary Git file budget')
        value = scrub({**asset, 'path':relative, 'original_name':target.name})
        exported_assets.append(value)
        manifest.append({'id':identity,'path':relative,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'size':target.stat().st_size,'media_type':asset['media_type']})
    rows['assets'] = exported_assets
    payload = {'schema':'wujian-showcase/1','schema_revision':'0009','tables':rows,'assets_manifest':manifest,
               'publication':{'scope':'负责人授权的演示账号、实拍和对话记录','excluded':['passwords','authentication sessions','run logs','hardware bindings','third-party whole-video caches','raw web-page scripts'],'images':'GPS absent; supplied photo orientation normalized where metadata was removed; already-public AS2 calibration files retain their original bytes.'}}
    (destination/'catalog.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'tables':{name:len(values) for name,values in rows.items()},'media_files':len(manifest),'bytes':sum(row['size'] for row in manifest)},ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,default=ROOT/'var/wujian.sqlite3')
    parser.add_argument('--destination',type=Path,default=ROOT/'demo/showcase')
    args = parser.parse_args()
    export(args.database,args.destination)
