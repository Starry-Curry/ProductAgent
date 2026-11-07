"""Verify the explicitly published demonstration bundle; no external paths or downloads."""
import hashlib
import json
from pathlib import Path


def asset_path(folder, relative):
    folder=Path(folder).resolve();path=(folder/relative).resolve()
    if not path.is_relative_to(folder) or not path.is_file():
        raise ValueError(f'Demo asset is missing or outside the bundle: {relative}')
    return path


def verify_bundle(folder):
    folder=Path(folder).resolve()
    manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('schema')!='wujian-demo-assets/1' or manifest.get('id')!='loklik-as2':
        raise ValueError('Unsupported AS2 asset manifest')
    files={}
    for entry in manifest['files']:
        path=asset_path(folder,entry['path'])
        if path.stat().st_size!=entry['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:
            raise ValueError(f"Demo asset checksum failed: {entry['path']}; download the complete branch, including binary assets")
        files[entry['path']]=entry
    required=[manifest['manual'],manifest['walkthrough'],manifest['reference']['image_path'],
        *manifest['prepared_pictures'].values(),manifest['media_dir']+'/pic/movie.mp4',
        *(manifest['media_dir']+f'/pic/{number}.jpg' for number in range(1,6))]
    if any(name not in files for name in required):raise ValueError('Demo manifest has an unverified required asset')
    return manifest
