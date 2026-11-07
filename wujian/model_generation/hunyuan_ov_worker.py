"""Experimental Hunyuan mini hybrid worker: DiT on NPU, other stages on CPU.

Run using the isolated Hunyuan Python environment. Hardware acceptance is
required before claiming deployment; no CUDA or remote-model fallback is used.
"""
import argparse
import gc
import json
import os
import sys
import time
from pathlib import Path

from hunyuan_openvino import compile_dit, torch_bridge


def load_component(config, name, checkpoint):
    import torch
    from accelerate import init_empty_weights
    from safetensors import safe_open
    from hy3dgen.shapegen.pipelines import instantiate_from_config
    with init_empty_weights():
        module = instantiate_from_config(config[name])
    if name == 'vae':
        module.encoder = torch.nn.Identity()
        module.pre_kl = torch.nn.Identity()
    wanted = module.state_dict()
    weights = {}
    with safe_open(str(checkpoint), framework='pt', device='cpu') as handle:
        for key in wanted:
            full_key = name + '.' + key
            if full_key not in handle.keys():
                raise RuntimeError('Missing checkpoint tensor: ' + full_key)
            value = handle.get_tensor(full_key)
            weights[key] = value.to(dtype=torch.float32) if value.is_floating_point() else value
    module.load_state_dict(weights, strict=True, assign=True)
    if any(p.is_meta for p in module.parameters()):
        raise RuntimeError('Incomplete component: ' + name)
    return module.eval().requires_grad_(False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', type=Path, required=True)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--faces', type=int, default=500000)
    parser.add_argument('--ir', type=Path)
    parser.add_argument('--device', choices=['NPU', 'GPU'], default='NPU')
    parser.add_argument('--steps', type=int, default=50)
    parser.add_argument('--resolution', type=int, default=128)
    parser.add_argument('--chunks', type=int, default=2048)
    parser.add_argument('--compile-only', action='store_true')
    args = parser.parse_args()
    if not args.compile_only and (args.input is None or args.output is None):
        parser.error('--input and --output are required for generation')
    if args.steps < 1 or not 32 <= args.resolution <= 384 or args.chunks < 1 or args.faces < 1:
        parser.error('Invalid generation limits')
    home = args.home.resolve()
    sys.path.insert(0, str(home / 'repos/Hunyuan3D-2'))
    for key, relative in {'HF_HOME': 'cache/hf', 'TORCH_HOME': 'cache/torch',
                          'TEMP': 'cache/temp', 'TMP': 'cache/temp'}.items():
        directory = home / relative
        directory.mkdir(parents=True, exist_ok=True)
        os.environ[key] = str(directory)
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                      HY3DGEN_DEBUG='0', USE_SAGEATTN='0')
    ir = args.ir or home.parent / 'dit_mini.xml'
    started = time.monotonic()
    runtime = compile_dit(ir, args.device, home.parent / 'ov-cache')
    import numpy as np
    if args.compile_only:
        runtime.infer(np.zeros((1, 512, 64), dtype=np.float32),
                      np.array([0.5], dtype=np.float32),
                      np.zeros((1, 1370, 1536), dtype=np.float32))
        print(json.dumps({'stage': 'probe_succeeded', **runtime.receipt()}), flush=True)
        return

    import torch
    import yaml
    from PIL import Image
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
    from hy3dgen.shapegen.pipelines import instantiate_from_config
    torch.set_num_threads(4)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    model_dir = home / 'models/hunyuan-mini/hunyuan3d-dit-v2-mini'
    checkpoint = model_dir / 'model.fp16.safetensors'
    config = yaml.safe_load((model_dir / 'config.yaml').read_text(encoding='utf-8'))
    if config['model']['params'].get('guidance_embed', False):
        raise RuntimeError('This IR bridge supports standard mini, not guidance-distilled mini')
    if 'FlowMatchEulerDiscreteScheduler' != config['scheduler']['target'].rsplit('.', 1)[-1]:
        raise RuntimeError('Expected standard mini FlowMatchEulerDiscreteScheduler configuration')
    if not checkpoint.is_file():
        raise FileNotFoundError(checkpoint)
    image = Image.open(args.input).convert('RGBA')
    # Preserve supplied alpha. Opaque photographs use the existing local U2Netp checkpoint.
    if image.getchannel('A').getextrema()[0] == 255:
        import onnxruntime as ort
        session = ort.InferenceSession(str(home / 'cache/u2net/u2netp.onnx'), providers=['CPUExecutionProvider'])
        pixels = np.asarray(image.convert('RGB').resize((320, 320))).astype('float32') / 255
        pixels = (pixels - np.array([.485, .456, .406], dtype='float32')) / np.array([.229, .224, .225], dtype='float32')
        mask = session.run(None, {session.get_inputs()[0].name: pixels.transpose(2, 0, 1)[None]})[0][0, 0]
        mask = (mask - mask.min()) / max(float(mask.max() - mask.min()), 1e-6)
        alpha = Image.fromarray((mask * 255).astype('uint8')).resize(image.size, Image.Resampling.LANCZOS)
        if not alpha.point(lambda value: 255 if value > 127 else 0).getbbox():
            raise RuntimeError('No foreground found')
        image.putalpha(alpha)
    bounds = image.getchannel('A').point(lambda value: 255 if value > 127 else 0).getbbox()
    if not bounds:
        raise RuntimeError('Empty foreground')
    image = image.crop(bounds)
    side = round(max(image.size) * 1.1)
    square = Image.new('RGBA', (side, side), (255, 255, 255, 0))
    square.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
    square.save(args.output.with_suffix('.input.png'))

    print(json.dumps({'stage': 'loading_cpu_components'}), flush=True)
    # Do not instantiate/load a second copy of the DiT on the CPU.
    conditioner = load_component(config, 'conditioner', checkpoint)
    class LatentShape(torch.nn.Module):
        latent_shape = (512, 64)
    vae = LatentShape()
    pipeline = Hunyuan3DDiTFlowMatchingPipeline(
        model=torch_bridge(runtime), conditioner=conditioner, vae=vae,
        scheduler=instantiate_from_config(config['scheduler']),
        image_processor=instantiate_from_config(config['image_processor']),
        device='cpu', dtype=torch.float32)
    print(json.dumps({'stage': 'generating', 'steps': args.steps,
                      'resolution': args.resolution}), flush=True)
    sampling_started = time.monotonic()
    latents = pipeline(image=square, num_inference_steps=args.steps,
                    octree_resolution=args.resolution, num_chunks=args.chunks,
                    generator=torch.Generator(device='cpu').manual_seed(42),
                    mc_algo='mc', output_type='latent')
    sampling_seconds = time.monotonic() - sampling_started
    torch.save(latents.cpu(), args.output.with_suffix('.latent.pt'))
    # Release DINOv2 before loading VAE to fit the 16 GB host reliably.
    pipeline.conditioner = torch.nn.Identity()
    del conditioner, vae
    gc.collect()
    print(json.dumps({'stage': 'decoding_mesh', 'sampling_seconds': round(sampling_seconds, 3)}), flush=True)
    decode_started = time.monotonic()
    pipeline.vae = load_component(config, 'vae', checkpoint)
    pipeline.vae.enable_flashvdm_decoder(enabled=False)
    mesh = pipeline._export(latents, output_type='trimesh',
                            octree_resolution=args.resolution, num_chunks=args.chunks,
                            mc_algo='mc')[0]
    decode_seconds = time.monotonic() - decode_started
    if mesh is None or not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
        raise RuntimeError('Empty or invalid shape prediction')
    if runtime.calls == 0:
        raise RuntimeError('DiT did not execute')
    raw_faces = len(mesh.faces)
    del pipeline, latents
    gc.collect()
    if raw_faces > args.faces:
        from hy3dgen.shapegen.postprocessors import FaceReducer
        mesh = FaceReducer()(mesh, max_facenum=args.faces)
    temporary = args.output.with_suffix('.tmp.glb')
    mesh.export(temporary)
    temporary.replace(args.output)
    report = {'model': 'tencent/Hunyuan3D-2mini', 'backend': 'openvino',
              'resolution': args.resolution, 'steps': args.steps, 'seed': 42,
              'raw_faces': raw_faces, 'faces': len(mesh.faces), 'texture': False,
              'elapsed_seconds': round(time.monotonic() - started, 2),
              'sampling_seconds': round(sampling_seconds, 3), 'decode_seconds': round(decode_seconds, 3),
              'local_ai': runtime.receipt(), 'physical_operation_verified': False}
    args.output.with_suffix('.generation.json').write_text(
        json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
