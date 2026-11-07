"""OpenVINO Hunyuan mini DiT bridge. Importable without OpenVINO or torch.

Only explicit NPU/GPU devices are accepted. CFG batches are evaluated one row
at a time so the existing static batch-one IR does not need recompilation.
"""
import json
import time


def execution_devices(value):
    return [value] if isinstance(value, str) else list(value)


class DiTRuntime:
    def __init__(self, compiled, device):
        if device not in {'NPU', 'GPU'}:
            raise ValueError('Choose an explicit NPU or GPU')
        self.compiled = compiled
        self.device = device
        self.devices = execution_devices(compiled.get_property('EXECUTION_DEVICES'))
        if not self.devices or any(d.split('.')[0] != device for d in self.devices):
            raise RuntimeError('DiT execution device mismatch: ' + repr(self.devices))
        self.inputs = {}
        for port in compiled.inputs:
            shape = tuple(port.shape)
            if shape == (1, 512, 64):
                role = 'x'
            elif shape == (1, 1370, 1536):
                role = 'cond'
            elif shape == (1,):
                role = 't'
            else:
                raise ValueError('Unsupported mini IR input shape: ' + repr(shape))
            if role in self.inputs:
                raise ValueError('Ambiguous mini IR inputs')
            self.inputs[role] = port
        if set(self.inputs) != {'x', 'cond', 't'} or len(compiled.outputs) != 1:
            raise ValueError('Expected mini DiT x/t/cond inputs and one output')
        self.calls = 0
        self.seconds = 0.0

    def infer(self, x, t, cond):
        import numpy as np
        x, t, cond = np.asarray(x), np.asarray(t).reshape(-1), np.asarray(cond)
        if x.ndim != 3 or tuple(x.shape[1:]) != (512, 64):
            raise ValueError('Expected x[B,512,64]')
        batch = len(x)
        if batch < 1 or cond.shape != (batch, 1370, 1536) or t.size not in {1, batch}:
            raise ValueError('DiT batch/condition/timestep mismatch')
        if not all(np.isfinite(v).all() for v in (x, t, cond)):
            raise ValueError('Non-finite DiT inputs')
        outputs = []
        for index in range(batch):
            values = {'x': x[index:index + 1], 'cond': cond[index:index + 1],
                      't': t[:1] if t.size == 1 else t[index:index + 1]}
            feeds = {}
            for role, value in values.items():
                port = self.inputs[role]
                dtype = port.get_element_type().to_dtype()
                feeds[port.get_any_name()] = np.ascontiguousarray(value, dtype=dtype)
            started = time.monotonic()
            # Copy before the next invocation reuses OpenVINO output storage.
            output = np.array(self.compiled(feeds)[self.compiled.output(0)], copy=True)
            self.seconds += time.monotonic() - started
            self.calls += 1
            if output.shape != (1, 512, 64) or not np.isfinite(output).all():
                raise RuntimeError('Invalid DiT output')
            outputs.append(output)
        return np.concatenate(outputs, axis=0)

    def receipt(self):
        return {'backend': 'openvino', 'requested_device': self.device,
                'execution_devices': self.devices, 'inferences': self.calls,
                'inference_seconds': round(self.seconds, 3),
                'accelerator_executed': self.calls > 0,
                'components': {'dit': self.devices, 'conditioner': ['CPU'],
                               'vae': ['CPU'], 'mesh_extraction': ['CPU']}}


def compile_dit(ir, device, cache):
    import openvino as ov
    if device not in {'NPU', 'GPU'}:
        raise ValueError('Choose an explicit NPU or GPU')
    core = ov.Core()
    print(json.dumps({'stage': 'devices', 'available': core.available_devices,
                      'openvino': ov.__version__}), flush=True)
    if not any(d.split('.')[0] == device for d in core.available_devices):
        raise RuntimeError(device + ' is unavailable')
    if not ir.is_file() or not ir.with_suffix('.bin').is_file():
        raise FileNotFoundError('Missing IR XML/BIN pair: ' + str(ir))
    cache.mkdir(parents=True, exist_ok=True)
    model = core.read_model(ir)
    print(json.dumps({'stage': 'compiling', 'device': device, 'ir': str(ir),
                      'cache': str(cache)}), flush=True)
    started = time.monotonic()
    compiled = core.compile_model(model, device,
                                  {'CACHE_DIR': str(cache), 'PERFORMANCE_HINT': 'LATENCY'})
    runtime = DiTRuntime(compiled, device)
    print(json.dumps({'stage': 'compiled', 'seconds': round(time.monotonic() - started, 3),
                      'execution_devices': runtime.devices}), flush=True)
    return runtime


def torch_bridge(runtime):
    import torch

    class OpenVINODiT(torch.nn.Module):
        guidance_embed = False

        def forward(self, x, t, contexts, **kwargs):
            if kwargs.get('guidance') is not None:
                raise ValueError('Guidance-distilled checkpoints require a different IR')
            result = runtime.infer(x.detach().cpu().float().numpy(),
                                   t.detach().cpu().float().numpy(),
                                   contexts['main'].detach().cpu().float().numpy())
            return torch.from_numpy(result).to(device=x.device, dtype=x.dtype)

    return OpenVINODiT()
