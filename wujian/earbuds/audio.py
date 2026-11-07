"""Bound Windows output endpoint volume through mature Pycaw/Core Audio.

This is Windows playback endpoint volume, never a claim about earbud firmware
volume or audible loudness. It never switches outputs or clears mute.
"""
from __future__ import annotations

import math
import re
import sys
from contextlib import contextmanager

try:
    from _ctypes import COMError
except ImportError:  # Offline tests also run on non-Windows hosts.
    COMError = OSError

from .windows import EarbudError, device_lock, normalize_address


@contextmanager
def _audio_session():
    if sys.platform != 'win32':
        raise EarbudError('电脑输出音量需要 Windows', 'unsupported_host')
    try:
        import comtypes
        from pycaw.pycaw import AudioUtilities
    except ImportError as error:
        raise EarbudError('尚未安装 Windows 音量连接器依赖', 'missing_dependency') from error
    comtypes.CoInitialize()
    try:
        yield AudioUtilities.GetSpeakers
    except (OSError, comtypes.COMError) as error:
        raise EarbudError('无法读取 Windows 输出端点，请检查声音设置', 'audio_unavailable') from error
    finally:
        comtypes.CoUninitialize()


def _endpoint_result(get_default, address, volume, endpoint_id):
    device = get_default()
    if device is None:
        raise EarbudError('Windows 尚未选择声音输出设备', 'audio_unavailable')
    # Identical friendly names are common for old pairing records. Require the
    # endpoint's actual BTHENUM instance path to match the bound Bluetooth MAC.
    paths = [value.upper() for value in device.properties.values()
             if isinstance(value, str) and 'BTHENUM' in value.upper()]
    mac = address.replace(':', '')
    if not re.search(r'\bHUAWEI\s+FreeBuds\s+4E\b', device.FriendlyName or '', re.IGNORECASE) or not any(
            re.search(r'(?:[&\\#])' + re.escape(mac) + r'(?:[_\\#]|$)', path) for path in paths):
        raise EarbudError('当前 Windows 输出不是绑定的这台华为耳机，请先在系统声音设置中选择它', 'wrong_audio_output')
    control = device.EndpointVolume
    before = float(control.GetMasterVolumeLevelScalar()) * 100
    result = {'status': 'observed', 'scope': 'windows_output_endpoint',
              'endpoint_id': device.id, 'endpoint_name': device.FriendlyName,
              'volume': round(before, 2), 'muted': bool(control.GetMute()),
              'write_verified': False, 'physical_effect_verified': False}
    if volume is None:
        return result
    if not endpoint_id or endpoint_id != device.id:
        raise EarbudError('输出设备已变更或尚未确认，请刷新音量后再设置', 'audio_output_changed')
    # Pin the actual object: never resolve and write to a newly selected speaker.
    current = get_default()
    if current is None or current.id != device.id:
        raise EarbudError('Windows 输出设备已变更，请刷新后重试', 'audio_output_changed')
    try:
        # Some Windows Bluetooth drivers implicitly unmute a scalar write.
        # Preserve the independently observed mute state explicitly.
        try:
            control.SetMasterVolumeLevelScalar(volume / 100, None)
        finally:
            control.SetMute(result["muted"], None)
        actual = float(control.GetMasterVolumeLevelScalar()) * 100
        muted = bool(control.GetMute())
        verified = abs(actual - volume) <= 1 and muted == result['muted']
        result.update(status='verified' if verified else 'unverified',
                      requested_volume=volume, previous_volume=round(before, 2),
                      volume=round(actual, 2), write_verified=verified, muted=muted)
    except (OSError, COMError):
        result.update(status='outcome_unknown', volume=None, muted=None, requested_volume=volume,
                      message='Windows 输出音量/静音状态设置结果未知，请先刷新状态')
    return result


def operate_volume(address, volume=None, *, endpoint_id=None, provider=_audio_session):
    address = normalize_address(address)
    if volume is not None and (isinstance(volume, bool) or not isinstance(volume, (int, float))
                               or not math.isfinite(volume) or not 0 <= volume <= 100):
        raise EarbudError('电脑输出音量必须为0到100之间的数字', 'invalid_volume')
    with device_lock(address), provider() as get_default:
        return _endpoint_result(get_default, address, volume, endpoint_id)
