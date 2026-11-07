"""Generation-only configuration, separate from the application's AI settings."""
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .bailian import Config


@dataclass(frozen=True)
class GenerationSettings:
    cache: Path
    cloud: Config
    model: str = 'Tripo/Tripo-H3.1'
    faces: int = 500000
    cloud_wait: float = 240
    poll_interval: float = 5
    local_home: Path | None = None
    local_python: Path | None = None
    local_timeout: float = 900
    local_only: bool = False
    local_backend: str = 'cuda'
    local_ir: Path | None = None
    local_resolution: int = 128
    local_steps: int = 50

    @classmethod
    def load(cls, settings):
        workspace = os.getenv('DASHSCOPE_WORKSPACE_ID', '')
        import re
        if workspace and not re.fullmatch(r'[A-Za-z0-9_-]+', workspace):
            raise ValueError('Invalid DashScope workspace')
        base = os.getenv('WUJIAN_3D_HTTP_BASE_URL') or (
            f'https://{workspace}.cn-beijing.maas.aliyuncs.com/api/v1' if workspace else Config.http_base)
        endpoint = urlsplit(base)
        if endpoint.scheme != 'https' or not (endpoint.hostname or '').endswith('.aliyuncs.com') or endpoint.username or endpoint.query or endpoint.fragment:
            raise ValueError('3D endpoint must be an official Aliyun HTTPS endpoint')
        home = Path(os.environ['WUJIAN_3D_LOCAL_HOME']).resolve() if os.getenv('WUJIAN_3D_LOCAL_HOME') else None
        python = Path(os.environ['WUJIAN_3D_LOCAL_PYTHON']).resolve() if os.getenv('WUJIAN_3D_LOCAL_PYTHON') else (
            home / ('envs/hunyuan3d/python.exe' if os.name == 'nt' else 'envs/hunyuan3d/bin/python') if home else None)
        backend = os.getenv('WUJIAN_3D_LOCAL_BACKEND', 'cuda')
        if backend not in {'cuda', 'openvino'}:
            raise ValueError('Unsupported local 3D backend')
        resolution = int(os.getenv('WUJIAN_3D_LOCAL_RESOLUTION', '128'))
        steps = int(os.getenv('WUJIAN_3D_LOCAL_STEPS', '50'))
        if not 32 <= resolution <= 384 or not 1 <= steps <= 100:
            raise ValueError('Invalid local 3D generation limits')
        ir = Path(os.environ['WUJIAN_3D_LOCAL_IR']).resolve() if os.getenv('WUJIAN_3D_LOCAL_IR') else None
        return cls(cache=Path(os.getenv('WUJIAN_3D_CACHE_DIR', str(settings.data_dir / 'model-generation'))),
                   cloud=Config(settings.api_key, base.rstrip('/'), timeout=30),
                   local_home=home, local_python=python, local_backend=backend,
                   local_ir=ir, local_resolution=resolution, local_steps=steps,
                   local_only=os.getenv('WUJIAN_3D_LOCAL_ONLY', 'false').lower() == 'true',
                   local_timeout=float(os.getenv('WUJIAN_3D_LOCAL_TIMEOUT', '900')))
