"""Self-contained GLB validation and atomic private generation receipts."""
import hashlib
import json
import struct
from pathlib import Path


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    temporary.replace(path)


def inspect_glb(path: Path):
    try:
        return _inspect_glb(path)
    except (KeyError, TypeError, AttributeError, IndexError, UnicodeDecodeError) as error:
        raise ValueError('Invalid GLB structure') from error


def _inspect_glb(path: Path):
    total = path.stat().st_size
    if total > 256 * 1024 * 1024:
        raise ValueError('GLB exceeds size limit')
    with path.open('rb') as stream:
        header = stream.read(12)
        if len(header) != 12 or struct.unpack('<4sII', header) != (b'glTF', 2, total):
            raise ValueError('Invalid GLB header')
        document = None
        binary_size = 0
        while stream.tell() < total:
            chunk_header = stream.read(8)
            if len(chunk_header) != 8:
                raise ValueError('Truncated GLB chunk')
            size, kind = struct.unpack('<II', chunk_header)
            if size % 4 or stream.tell() + size > total:
                raise ValueError('Invalid GLB chunk length')
            if document is None:
                if kind != 0x4E4F534A or size > 32 * 1024 * 1024:
                    raise ValueError('Missing GLB JSON')
                document = json.loads(stream.read(size))
            else:
                if kind == 0x004E4942:
                    binary_size += size
                stream.seek(size, 1)
    if not isinstance(document, dict) or document.get('asset', {}).get('version') != '2.0':
        raise ValueError('Invalid glTF document')
    if any(resource.get('uri') for resource in [*document.get('buffers', []), *document.get('images', [])]):
        raise ValueError('Only embedded GLB resources are supported')
    buffers = document.get('buffers', [])
    if not buffers or len(buffers) != 1 or not 0 < buffers[0].get('byteLength', 0) <= binary_size:
        raise ValueError('Missing GLB binary buffer')
    views = document.get('bufferViews', [])
    for view in views:
        if view.get('buffer', 0) != 0 or view.get('byteOffset', 0) < 0 or view.get('byteLength', 0) < 0 or view.get('byteOffset', 0) + view.get('byteLength', 0) > buffers[0]['byteLength']:
            raise ValueError('GLB buffer view out of bounds')
    primitives = [p for mesh in document.get('meshes', []) for p in mesh.get('primitives', [])]
    accessors = document.get('accessors', [])
    if not primitives or not document.get('nodes') or not document.get('scenes'):
        raise ValueError('GLB has no scene geometry')
    faces = 0
    for primitive in primitives:
        position = primitive.get('attributes', {}).get('POSITION')
        if type(position) is not int or not 0 <= position < len(accessors) or accessors[position].get('count', 0) < 3:
            raise ValueError('GLB has no usable positions')
        if primitive.get('mode', 4) != 4 or primitive.get('extensions', {}).get('KHR_draco_mesh_compression'):
            raise ValueError('Expected uncompressed triangle geometry')
        indices = primitive.get('indices', position)
        if type(indices) is not int or not 0 <= indices < len(accessors):
            raise ValueError('Invalid GLB indices')
        faces += accessors[indices].get('count', 0) // 3
    if not faces:
        raise ValueError('Empty GLB')
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'sha256': digest, 'bytes': total, 'faces': faces, 'format': 'glb'}
