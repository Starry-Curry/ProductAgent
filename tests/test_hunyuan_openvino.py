"""Offline bridge regression; does not claim NPU hardware acceptance."""
import unittest
import numpy as np
from wujian.model_generation.hunyuan_openvino import DiTRuntime, execution_devices


class ElementType:
    def to_dtype(self):
        return np.float16


class Port:
    def __init__(self, name, shape):
        self.name, self.shape = name, shape

    def get_any_name(self):
        return self.name

    def get_element_type(self):
        return ElementType()


class Compiled:
    inputs = [Port('x', (1, 512, 64)), Port('t', (1,)),
              Port('cond', (1, 1370, 1536))]
    outputs = ['v']

    def __init__(self, devices='NPU'):
        self.devices = devices
        self.buffer = np.zeros((1, 512, 64), np.float16)
        self.feeds = []

    def get_property(self, name):
        return self.devices

    def output(self, index):
        return 'v'

    def __call__(self, feed):
        self.feeds.append(feed)
        self.buffer[:] = feed['x'] + feed['cond'][0, 0, 0] + feed['t'][0]
        return {'v': self.buffer}


class OpenVINOBridgeTests(unittest.TestCase):
    def test_scalar_and_vector_device_receipts(self):
        self.assertEqual(execution_devices('NPU'), ['NPU'])
        self.assertEqual(execution_devices(['NPU.0']), ['NPU.0'])
        with self.assertRaises(RuntimeError):
            DiTRuntime(Compiled(['CPU']), 'NPU')
        with self.assertRaises(ValueError):
            DiTRuntime(Compiled(), 'AUTO')

    def test_cfg_rows_keep_condition_order_and_copy_shared_outputs(self):
        compiled = Compiled()
        runtime = DiTRuntime(compiled, 'NPU')
        x = np.ones((2, 512, 64), np.float32)
        cond = np.zeros((2, 1370, 1536), np.float32)
        cond[0, 0, 0], cond[1, 0, 0] = 2, 4
        output = runtime.infer(x, np.array([0.5, 0.25]), cond)
        self.assertTrue(np.all(output[0] == 3.5))
        self.assertTrue(np.all(output[1] == 5.25))
        self.assertEqual(runtime.calls, 2)
        self.assertEqual(compiled.feeds[0]['x'].dtype, np.float16)
        self.assertTrue(runtime.receipt()['accelerator_executed'])

    def test_rejects_mismatched_batch_and_nonfinite_input(self):
        runtime = DiTRuntime(Compiled(), 'NPU')
        x = np.zeros((1, 512, 64), np.float32)
        cond = np.zeros((1, 1370, 1536), np.float32)
        with self.assertRaises(ValueError):
            runtime.infer(x, [0.5], cond[:0])
        x[0, 0, 0] = np.nan
        with self.assertRaises(ValueError):
            runtime.infer(x, [0.5], cond)

    def test_rejects_nonfinite_output(self):
        compiled = Compiled()
        def invalid(feed):
            return {'v': np.full((1, 512, 64), np.nan, np.float16)}
        class Invalid(Compiled):
            __call__ = staticmethod(invalid)
        runtime = DiTRuntime(Invalid(), 'NPU')
        with self.assertRaises(RuntimeError):
            runtime.infer(np.zeros((1, 512, 64)), [0.5],
                          np.zeros((1, 1370, 1536)))


if __name__ == '__main__':
    unittest.main()

class OpenVINOServiceTests(unittest.TestCase):
    def test_worker_selection_and_verified_receipt(self):
        import json, sys, tempfile
        from pathlib import Path
        from unittest.mock import patch
        from wujian.model_generation.settings import GenerationSettings
        from wujian.model_generation.bailian import Config
        from wujian.model_generation.service import local_generate, GenerationError
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            config = GenerationSettings(cache=folder, cloud=Config('offline'),
                        local_home=folder, local_python=Path(sys.executable),
                        local_backend='openvino', local_resolution=64)
            def run(command, **kwargs):
                self.assertTrue(command[1].endswith('hunyuan_ov_worker.py'))
                self.assertIn('NPU', command)
                self.assertIn('64', command)
                self.assertNotIn('DASHSCOPE_API_KEY', kwargs['env'])
                (folder/'local.generation.json').write_text(json.dumps({
                    'backend': 'openvino', 'resolution': 64, 'steps': 50,
                    'elapsed_seconds': 1, 'local_ai': {'execution_devices': ['NPU'],
                    'inferences': 100}}))
                from types import SimpleNamespace
                return SimpleNamespace(returncode=0)
            with patch('wujian.model_generation.service.subprocess.run', side_effect=run):
                path, details = local_generate(config, folder)
            self.assertEqual(details['local_ai']['inferences'], 100)
            def cpu_run(command, **kwargs):
                run(command, **kwargs)
                report = json.loads((folder/'local.generation.json').read_text())
                report['local_ai']['execution_devices'] = ['CPU']
                (folder/'local.generation.json').write_text(json.dumps(report))
                from types import SimpleNamespace
                return SimpleNamespace(returncode=0)
            with patch('wujian.model_generation.service.subprocess.run', side_effect=cpu_run):
                with self.assertRaises(GenerationError):
                    local_generate(config, folder)

    def test_local_only_environment_survives_default_api_argument(self):
        import asyncio
        from types import SimpleNamespace
        from pathlib import Path
        from unittest.mock import patch
        from wujian.model_generation.service import generate_model
        settings = SimpleNamespace(data_dir=Path('.'), api_key='')
        with patch.dict('os.environ', {'WUJIAN_3D_LOCAL_ONLY': 'true',
                                      'WUJIAN_3D_LOCAL_BACKEND': 'openvino'}, clear=True):
            with patch('wujian.model_generation.service.generate_sync', return_value={}) as generate:
                asyncio.run(generate_model(settings, 'owner', b'image'))
            self.assertTrue(generate.call_args.args[0].local_only)
