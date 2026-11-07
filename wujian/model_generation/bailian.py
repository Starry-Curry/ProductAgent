"""Bailian asynchronous Tripo API. Credentials never reach asset download hosts."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
from dotenv import dotenv_values

MODELS = ('Tripo/Tripo-H3.1', 'Tripo/Tripo-P1.0')
ACTIVATION_MESSAGE = '百炼任务返回“产品未开通”。请核对当前 API Key 所属业务空间和北京地域的 Tripo 授权；授权已开通时保留 task_id 向服务方排查。程序不会自动开通服务。'


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str, status: int | None = None):
        super().__init__(message)
        self.code, self.status = code, status


def safe_message(value: object, secret: str = '') -> str:
    text = str(value)
    if secret:
        text = text.replace(secret, '[REDACTED]')
    text = re.sub(r'\bsk-[A-Za-z0-9_-]+', '[REDACTED]', text)
    text = re.sub(r'https?://[^\s"<>]+\?[^\s"<>]+', '[signed URL omitted]', text)
    return text[:1200]


@dataclass(frozen=True)
class Config:
    api_key: str = field(repr=False)
    http_base: str = 'https://dashscope.aliyuncs.com/api/v1'
    timeout: float = 60

    @classmethod
    def from_env(cls, env_file: Path) -> 'Config':
        values = {**dotenv_values(env_file), **os.environ}
        key = values.get('DASHSCOPE_API_KEY', '')
        if not key:
            raise ProviderError('MissingAPIKey', f'请在 {env_file} 配置 DASHSCOPE_API_KEY。')
        base = values.get('WUJIAN_3D_HTTP_BASE_URL', '')
        workspace = values.get('DASHSCOPE_WORKSPACE_ID', '')
        if not base and workspace:
            if not re.fullmatch(r'[A-Za-z0-9_-]+', workspace):
                raise ProviderError('InvalidWorkspace', 'DASHSCOPE_WORKSPACE_ID 格式不合法。')
            base = f'https://{workspace}.cn-beijing.maas.aliyuncs.com/api/v1'
        base = (base or cls.http_base).rstrip('/')
        parsed = urlsplit(base)
        if parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.aliyuncs.com') or parsed.query or parsed.username:
            raise ProviderError('InvalidEndpoint', '3D API 地址必须为阿里云官方 HTTPS 地址。')
        return cls(api_key=key, http_base=base)


def read_json_response(response: httpx.Response, secret: str = '') -> dict:
    try:
        data = response.json()
    except ValueError:
        raise ProviderError('InvalidResponse', f'服务返回非 JSON 内容（HTTP {response.status_code}）。', response.status_code) from None
    if not isinstance(data, dict):
        raise ProviderError('InvalidResponse', '服务返回了不支持的数据结构。')
    if not response.is_success or data.get('success') is False or (data.get('code') and not data.get('output') and not data.get('data')):
        detail = data.get('message')
        if not detail and isinstance(data.get('error'), dict):
            detail = data['error'].get('message')
        raise ProviderError(str(data.get('code') or f'HTTP{response.status_code}'), safe_message(detail or '百炼请求失败。', secret), response.status_code)
    return data


class Bailian3DClient:
    def __init__(self, config: Config, transport: httpx.BaseTransport | None = None):
        self.config = config
        self.http = httpx.Client(timeout=config.timeout, follow_redirects=False, transport=transport)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.http.close()

    @property
    def headers(self) -> dict[str, str]:
        return {'Authorization': 'Bearer ' + self.config.api_key}

    def _json(self, response: httpx.Response) -> dict:
        return read_json_response(response, self.config.api_key)

    def submit(self, image_url: str, model: str, parameters: dict[str, Any]) -> dict:
        if model not in MODELS:
            raise ValueError('Unsupported model')
        if not image_url.startswith(('https://', 'http://', 'oss://')):
            raise ValueError('Image must be an HTTP(S) or Bailian temporary OSS URL')
        headers = {**self.headers, 'X-DashScope-Async': 'enable'}
        if image_url.startswith('oss://'):
            headers['X-DashScope-OssResourceResolve'] = 'enable'
        # Do not retry this POST automatically: a timed-out request may already be billed.
        response = self.http.post(self.config.http_base + '/services/aigc/video-generation/3d-generation',
                                  headers=headers, json={'model': model, 'input': {'image': image_url}, 'parameters': parameters})
        return self._json(response)

    def task(self, task_id: str) -> dict:
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', task_id):
            raise ValueError('Invalid provider task id')
        return self._json(self.http.get(self.config.http_base + '/tasks/' + task_id, headers=self.headers))

    def upload(self, path: Path, model: str) -> str:
        policy = self._json(self.http.get(self.config.http_base + '/uploads', headers=self.headers,
                                         params={'action': 'getPolicy', 'model': model}))['data']
        host = policy['upload_host']
        parsed = urlsplit(host)
        if parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.aliyuncs.com'):
            raise ProviderError('InvalidUploadHost', '百炼上传凭证返回了非阿里云地址。')
        object_key = policy['upload_dir'].rstrip('/') + '/' + path.name
        fields = {
            'OSSAccessKeyId': (None, policy['oss_access_key_id']),
            'Signature': (None, policy['signature']),
            'policy': (None, policy['policy']),
            'x-oss-object-acl': (None, policy['x_oss_object_acl']),
            'x-oss-forbid-overwrite': (None, str(policy['x_oss_forbid_overwrite'])),
            'key': (None, object_key), 'success_action_status': (None, '200'),
        }
        with path.open('rb') as handle:
            response = self.http.post(host, files={**fields, 'file': (path.name, handle, 'image/jpeg')})
        if not response.is_success:
            raise ProviderError('UploadFailed', f'百炼临时照片上传失败（HTTP {response.status_code}）。', response.status_code)
        return 'oss://' + object_key

    def download(self, url: str, destination: Path, max_bytes: int = 256 * 1024 * 1024, *, _redirects: int = 3):
        parsed = urlsplit(url)
        host = parsed.hostname or ''
        if parsed.scheme != 'https' or parsed.username or parsed.port not in {None, 443} or not any(
                host == domain or host.endswith('.' + domain) for domain in ['aliyuncs.com', 'tripo3d.com', 'tripo3d.ai', 'amazonaws.com', 'cloudfront.net']):
            raise ProviderError('InvalidAssetURL', '资产下载地址必须为模型服务的官方 HTTPS 地址。')
        temporary = destination.with_suffix(destination.suffix + '.part')
        try:
            # Deliberately no Authorization header on CDN/image hosts.
            with self.http.stream('GET', url, follow_redirects=False) as response:
                if response.is_redirect:
                    if _redirects <= 0 or not response.headers.get('location'):
                        raise ProviderError('DownloadRedirect', '模型下载重定向次数超限。')
                    return self.download(urljoin(url, response.headers['location']), destination, max_bytes,
                                         _redirects=_redirects - 1)
                if not response.is_success:
                    raise ProviderError('DownloadFailed', f'文件下载失败（HTTP {response.status_code}）。请恢复原任务，不要重复生成。')
                written = 0
                with temporary.open('wb') as handle:
                    for chunk in response.iter_bytes():
                        written += len(chunk)
                        if written > max_bytes:
                            raise ProviderError('AssetTooLarge', '下载文件超过大小上限。')
                        handle.write(chunk)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
