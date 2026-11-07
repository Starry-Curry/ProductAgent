"""Cloud first, Hunyuan mini fallback. Receipts prevent duplicate billable submissions."""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import io
import json
import os
import subprocess
import time
from dataclasses import replace
from pathlib import Path

import httpx
from PIL import Image, ImageOps

from .assets import inspect_glb, write_json
from .bailian import Bailian3DClient, ProviderError, safe_message
from .settings import GenerationSettings


class GenerationError(RuntimeError):
    pass


@contextlib.contextmanager
def run_lock(path, wait=0):
    with path.open('a+b') as stream:
        if stream.tell() == 0:
            stream.write(b'0')
            stream.flush()
        stream.seek(0)
        deadline = time.monotonic() + wait
        while True:
            try:
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise GenerationError('已有模型正在生成，请稍后重试。') from None
                time.sleep(1)
        yield


def prepare_image(raw):
    if len(raw) > 20 * 1024 * 1024:
        raise GenerationError('请使用20MB以内的照片。')
    with Image.open(io.BytesIO(raw)) as original:
        if original.width * original.height > 30_000_000:
            raise GenerationError('照片尺寸过大，请压缩后重试。')
        image = ImageOps.exif_transpose(original).convert('RGBA')
        image.thumbnail((1600, 1600))
        png = io.BytesIO()
        image.save(png, 'PNG')
        background = Image.new('RGB', image.size, 'white')
        background.paste(image, mask=image.getchannel('A'))
        jpeg = io.BytesIO()
        background.save(jpeg, 'JPEG', quality=94)
    return png.getvalue(), jpeg.getvalue()


def cloud_generate(config, folder):
    receipt = folder / 'cloud-state.json'
    state = json.loads(receipt.read_text(encoding='utf-8')) if receipt.exists() else {}
    if not config.cloud.api_key:
        raise ProviderError('MissingAPIKey', '未配置百炼密钥')
    if state.get('status') in {'submitting', 'submission_unknown', 'failed'}:
        raise ProviderError(state['status'], '已保留原云端任务，不自动重复提交')
    with Bailian3DClient(config.cloud) as client:
        if not state.get('task_id'):
            uploaded = client.upload(folder / 'input.jpg', config.model)
            state = {'status': 'submitting'}
            write_json(receipt, state)
            try:
                response = client.submit(uploaded, config.model, {
                    'texture_quality': 'standard', 'face_limit': config.faces,
                    'model_seed': 42, 'texture_seed': 42,
                    'texture_alignment': 'original_image', 'enable_image_autofix': False})
                output = response.get('output', {})
                if not output.get('task_id'):
                    raise ProviderError('MissingTaskId', '云端未返回任务号')
                state = {'status': 'pending', 'task_id': output['task_id']}
                write_json(receipt, state)
            except (ProviderError, httpx.RequestError, ValueError):
                write_json(receipt, {**state, 'status': 'submission_unknown'})
                raise
        started = time.monotonic()
        while True:
            output = client.task(state['task_id']).get('output', {})
            status = output.get('task_status')
            state['status'] = str(status or 'UNKNOWN')
            write_json(receipt, state)
            if status == 'SUCCEEDED':
                result = next((r for r in output.get('results', []) if r.get('pbr_model_url') or r.get('base_model_url')), None)
                if not result:
                    state['status'] = 'failed'
                    write_json(receipt, state)
                    raise ProviderError('MissingModel', '云端未返回模型')
                client.download(result.get('pbr_model_url') or result['base_model_url'], folder / 'cloud.glb')
                return folder / 'cloud.glb', {'task_id': state['task_id']}
            if status not in {'PENDING', 'RUNNING'}:
                state['status'] = 'failed'
                state['provider_code'] = safe_message(output.get('code', status), config.cloud.api_key)
                state['provider_message'] = safe_message(output.get('message', ''), config.cloud.api_key)
                write_json(receipt, state)
                raise ProviderError('TaskFailed', '云端任务未成功')
            if time.monotonic() - started >= config.cloud_wait:
                raise ProviderError('WaitTimeout', '云端超时，原任务号已保留')
            time.sleep(config.poll_interval)


def local_generate(config, folder):
    if not config.local_home or not config.local_python or not config.local_python.is_file():
        raise GenerationError('本地混元 mini 尚未配置。')
    environment = {key: value for key, value in os.environ.items()
                   if key not in {'DASHSCOPE_API_KEY', 'OPENAI_API_KEY'}}
    command = [str(config.local_python), str(Path(__file__).with_name('hunyuan_worker.py')),
               '--home', str(config.local_home), '--input', str(folder / 'input.png'),
               '--output', str(folder / 'local.glb'), '--faces', str(config.faces)]
    with run_lock(config.local_home / '.wujian-generation.lock', wait=config.local_timeout), (folder / 'local.log').open('ab') as log:
        try:
            result = subprocess.run(command, env=environment, cwd=config.local_home, stdout=log,
                                    stderr=subprocess.STDOUT, timeout=config.local_timeout,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        except (OSError, subprocess.TimeoutExpired):
            raise GenerationError('本地混元 mini 未能完成生成，已保留诊断记录。') from None
    if result.returncode != 0:
        raise GenerationError('本地混元 mini 生成失败，已保留诊断记录。')
    return folder / 'local.glb', {'model': 'tencent/Hunyuan3D-2mini', 'texture': False}


def generate_sync(config, owner_id, image):
    png, jpeg = prepare_image(image)
    scope = hashlib.sha256(owner_id.encode()).hexdigest()[:24]
    parameters = {'version': 1, 'cloud': config.model, 'faces': config.faces, 'local': 'Hunyuan3D-2mini/384/50'}
    if config.local_only:
        parameters['local_only'] = True
    fingerprint = hashlib.sha256(png + json.dumps(parameters, sort_keys=True).encode()).hexdigest()
    folder = config.cache / scope / fingerprint
    folder.mkdir(parents=True, exist_ok=True)
    with run_lock(folder / '.lock'):
        manifest = folder / 'result.json'
        if manifest.exists():
            saved = json.loads(manifest.read_text(encoding='utf-8'))
            model = folder / ('cloud.glb' if saved['provider'] == 'aliyun-bailian/tripo' else 'local.glb')
            try:
                if inspect_glb(model)['sha256'] == saved['geometry']['sha256']:
                    return {**saved, 'path': model, 'cache_hit': True}
            except (OSError, ValueError, TypeError, KeyError):
                pass  # Repair from the same cloud task; never resubmit it.
        (folder / 'input.png').write_bytes(png)
        (folder / 'input.jpg').write_bytes(jpeg)
        attempts = []
        providers = [('local/hunyuan-mini', local_generate)] if config.local_only else [
            ('aliyun-bailian/tripo', cloud_generate), ('local/hunyuan-mini', local_generate)]
        for provider, generate in providers:
            try:
                model, details = generate(config, folder)
                geometry = inspect_glb(model)
            except (ProviderError, GenerationError, httpx.RequestError, OSError, ValueError, KeyError, TypeError, AttributeError) as error:
                attempts.append({'provider': provider, 'status': 'failed',
                                 'code': getattr(error, 'code', type(error).__name__)})
                write_json(folder / 'attempts.json', attempts)
                continue
            attempts.append({'provider': provider, 'status': 'succeeded'})
            saved = {'provider': provider, 'model': config.model if provider.startswith('aliyun') else details['model'],
                     'geometry': geometry, 'input_sha256': hashlib.sha256(png).hexdigest(),
                     'details': details, 'attempts': attempts, 'physical_operation_verified': False}
            write_json(manifest, saved)
            return {**saved, 'path': model, 'cache_hit': False}
    raise GenerationError('云端与本地均未能生成可用模型，原步骤已保留。')


async def generate_model(settings, owner_id, image, *, local_only=False):
    config = replace(GenerationSettings.load(settings), local_only=local_only)
    return await asyncio.to_thread(generate_sync, config, owner_id, image)
