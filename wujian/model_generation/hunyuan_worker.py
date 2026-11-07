"""Isolated CUDA worker for the tested Hunyuan mini FP16 shape pipeline.

Run with the Hunyuan environment's Python, not the application's Python.
Weights, upstream code, caches and temporary data stay under --home.
"""
import argparse
import gc
import json
import os
import sys
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', type=Path, required=True)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--faces', type=int, default=500000)
    args = parser.parse_args()
    home = args.home.resolve()
    sys.path.insert(0, str(home / 'repos/Hunyuan3D-2'))
    for key, relative in {'HF_HOME': 'cache/hf', 'TORCH_HOME': 'cache/torch',
                          'TEMP': 'cache/temp', 'TMP': 'cache/temp',
                          'CUDA_CACHE_PATH': 'cache/cuda',
                          'TORCH_EXTENSIONS_DIR': 'cache/torch-extensions'}.items():
        directory = home / relative
        directory.mkdir(parents=True, exist_ok=True)
        os.environ[key] = str(directory)
    os.environ.update(HF_HUB_OFFLINE='1', PYTORCH_CUDA_ALLOC_CONF='expandable_segments:True')
    import numpy as np
    import torch
    import yaml
    from accelerate import init_empty_weights
    from PIL import Image
    from safetensors.torch import load_file
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
    import hy3dgen.shapegen.pipelines as implementation
    from hy3dgen.shapegen.postprocessors import FaceReducer

    if not torch.cuda.is_available():
        raise RuntimeError('Hunyuan mini fallback requires NVIDIA CUDA; Intel NPU is not supported')
    torch.set_num_threads(4)
    started = time.monotonic()

    def mmap_load(cls, ckpt_path, config_path, device='cuda', dtype=torch.float16, **kwargs):
        kwargs.pop('use_safetensors', None)
        config = yaml.safe_load(Path(config_path).read_text())
        state = load_file(str(ckpt_path).replace('.ckpt', '.safetensors'), device='cpu')
        parts = {}
        for name in ['model', 'vae', 'conditioner']:
            with init_empty_weights():
                module = implementation.instantiate_from_config(config[name])
            # Stream each tensor directly to CUDA; do not retain a second CPU FP16 copy.
            weights = {key[len(name) + 1:]: value.to(device=device, dtype=dtype if value.is_floating_point() else value.dtype)
                       for key, value in state.items() if key.startswith(name + '.')}
            module.load_state_dict(weights, strict=name != 'vae', assign=True)
            if name == 'vae':
                module.encoder = torch.nn.Identity()
                module.pre_kl = torch.nn.Identity()
            if any(parameter.is_meta for parameter in module.parameters()):
                raise RuntimeError('Incomplete checkpoint: ' + name)
            parts[name] = module
        return cls(**parts, scheduler=implementation.instantiate_from_config(config['scheduler']),
                   image_processor=implementation.instantiate_from_config(config['image_processor']),
                   device=device, dtype=dtype, **kwargs)

    Hunyuan3DDiTFlowMatchingPipeline.from_single_file = classmethod(mmap_load)
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
    original_dtype = torch.get_default_dtype()
    torch.set_default_dtype(torch.float16)
    try:
        pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(str(home / 'models/hunyuan-mini'),
            subfolder='hunyuan3d-dit-v2-mini', variant='fp16', use_safetensors=True, device='cuda')
    finally:
        torch.set_default_dtype(original_dtype)
    torch.cuda.reset_peak_memory_stats()
    mesh = pipeline(image=square, num_inference_steps=50, octree_resolution=384, num_chunks=6000,
                    generator=torch.Generator().manual_seed(42), mc_algo='mc', output_type='trimesh')[0]
    if mesh is None or not len(mesh.faces):
        raise RuntimeError('Empty shape prediction')
    raw_faces = len(mesh.faces)
    mesh.export(args.output.with_suffix('.raw.glb'))
    del pipeline
    gc.collect()
    torch.cuda.empty_cache()
    if len(mesh.faces) > args.faces:
        mesh = FaceReducer()(mesh, max_facenum=args.faces)
    temporary = args.output.with_suffix('.tmp.glb')
    mesh.export(temporary)
    temporary.replace(args.output)
    report = {'model': 'tencent/Hunyuan3D-2mini', 'resolution': 384, 'steps': 50,
              'seed': 42, 'raw_faces': raw_faces, 'faces': len(mesh.faces), 'texture': False,
              'elapsed_seconds': round(time.monotonic() - started, 2),
              'peak_cuda_bytes': torch.cuda.max_memory_allocated(), 'physical_operation_verified': False}
    args.output.with_suffix('.generation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
