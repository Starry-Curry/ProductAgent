"""No real device access: verify Windows audio output target and write boundaries."""

import unittest
from contextlib import contextmanager

from wujian.earbuds.audio import operate_volume
from wujian.earbuds.windows import EarbudError


ADDRESS = "00:11:22:33:44:55"


class Control:
    def __init__(self):
        self.value, self.muted, self.writes = .4, True, []

    def GetMasterVolumeLevelScalar(self):
        return self.value

    def GetMute(self):
        return self.muted

    def SetMasterVolumeLevelScalar(self, value, _):
        self.writes.append(value)
        self.value = value
        self.muted = False  # Actual Windows Bluetooth driver behavior.

    def SetMute(self, muted, _):
        self.muted = bool(muted)


class Device:
    def __init__(self, address=ADDRESS, identifier="endpoint-4e"):
        self.id, self.FriendlyName = identifier, "耳机 (2- HUAWEI FreeBuds 4E)"
        self.properties = {"instance": "{1}.BTHENUM\\7&TEST&0&" + address.replace(":", "") + "_C00000000"}
        self.EndpointVolume = Control()


def provider(*devices):
    @contextmanager
    def session():
        pending = iter(devices)
        yield lambda: next(pending)
    return session


class EarbudAudioTests(unittest.TestCase):
    def test_same_name_other_physical_device_cannot_be_written(self):
        wrong = Device("AA:BB:CC:DD:EE:FF")
        with self.assertRaises(EarbudError) as error:
            operate_volume(ADDRESS, 30, endpoint_id=wrong.id, provider=provider(wrong))
        self.assertEqual(error.exception.status, "wrong_audio_output")
        self.assertEqual(wrong.EndpointVolume.writes, [])

    def test_speaker_or_unknown_device_path_is_never_fallback(self):
        for properties, name in (({}, "HUAWEI FreeBuds 4E"), ({"x": "USB&" + ADDRESS}, "电脑扬声器")):
            device = Device()
            device.properties, device.FriendlyName = properties, name
            with self.assertRaises(EarbudError):
                operate_volume(ADDRESS, 30, endpoint_id=device.id, provider=provider(device))
            self.assertEqual(device.EndpointVolume.writes, [])

    def test_read_and_set_use_endpoint_scalar_and_keep_mute_unchanged(self):
        device = Device()
        read = operate_volume(ADDRESS, provider=provider(device))
        self.assertEqual(read["scope"], "windows_output_endpoint")
        self.assertEqual(read["volume"], 40)
        self.assertTrue(read["muted"])
        result = operate_volume(ADDRESS, 30, endpoint_id=read["endpoint_id"], provider=provider(device, device))
        self.assertEqual(device.EndpointVolume.writes, [.3])
        self.assertTrue(result["write_verified"])
        self.assertTrue(result["muted"])
        self.assertFalse(result["physical_effect_verified"])

    def test_stale_or_missing_endpoint_token_and_output_switch_block_write(self):
        for token, next_device in ((None, Device()), ("old-endpoint", Device()), ("endpoint-4e", Device(identifier="speaker"))):
            device = Device()
            with self.assertRaises(EarbudError) as error:
                operate_volume(ADDRESS, 30, endpoint_id=token, provider=provider(device, next_device))
            self.assertEqual(error.exception.status, "audio_output_changed")
            self.assertEqual(device.EndpointVolume.writes, [])

    def test_invalid_volume_rejected_before_any_audio_provider(self):
        for value in (True, "30", -1, 101, float("nan"), float("inf")):
            with self.assertRaises(EarbudError) as error:
                operate_volume(ADDRESS, value, provider=lambda: self.fail("must not open audio provider"))
            self.assertEqual(error.exception.status, "invalid_volume")

    def test_write_without_reliable_readback_is_outcome_unknown(self):
        device = Device()
        def failed_write(*_):
            raise OSError("audio endpoint went away after possible write")
        device.EndpointVolume.SetMasterVolumeLevelScalar = failed_write
        result = operate_volume(ADDRESS, 30, endpoint_id=device.id, provider=provider(device, device))
        self.assertEqual(result["status"], "outcome_unknown")
        self.assertIsNone(result["volume"])
        self.assertFalse(result["write_verified"])


if __name__ == "__main__":
    unittest.main()
