"""Independent hostile-input checks, using no live Bluetooth or models."""
import binascii
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from sqlalchemy import select

import test_earbud_console as fixtures

ADDRESS, Channel, frame = fixtures.ADDRESS, fixtures.Channel, fixtures.frame
from wujian.database import DeviceTarget, Grant, ItemRecord
from wujian.domain import DomainError
from wujian.earbuds import earbud_tool
from wujian.earbuds.service import register_routes
from wujian.earbuds.protocol import ANC_STATE, ANC_WRITE, BATTERY, INFO, Decoder, encode
from wujian.earbuds.windows import Connection, EarbudError, device_lock, operate


class Socket:
    def __init__(self, stale, response):
        self.pending, self.response, self.sent = list(stale), list(response), []

    def settimeout(self, value):
        self.timeout = value

    def recv(self, size):
        if self.pending:
            return self.pending.pop(0)
        raise TimeoutError()

    def sendall(self, payload):
        self.sent.append(payload)
        self.pending.extend(self.response)


class TransportAdversarialTests(unittest.TestCase):
    def test_queued_and_partial_anc_notifications_do_not_verify_fresh_query(self):
        light = encode(ANC_STATE, {1: b'\x01\x01'})
        off = encode(ANC_STATE, {1: b'\0\0'})
        connection = Connection(ADDRESS)
        connection.decoder.feed(light[:7])
        connection.sock = Socket([light[7:], light], [off[:5], off[5:]])
        actual = connection.query(ANC_STATE, {1: b''}, timeout=.05)
        self.assertEqual(actual.parameters[1], b'\0\0')
        self.assertEqual([x['frame'] for x in connection.evidence if x['direction'] == 'rx'], [off.hex()])

    def test_coalesced_latest_state_wins_and_unrelated_identity_not_retained(self):
        old = encode(ANC_STATE, {1: b'\x01\x01'})
        new = encode(ANC_STATE, {1: b'\0\0'})
        connection = Connection(ADDRESS)
        connection.sock = Socket([], [encode(INFO, {1: b'private-serial'}) +
                                     encode(b'\x02\xff', {1: b'private'}) + old + new])
        self.assertEqual(connection.query(ANC_STATE, {1: b''}).raw, new)
        self.assertEqual(len(connection.evidence), 3)
        self.assertNotIn(b'private'.hex(), str(connection.evidence))

    def test_timeout_and_disconnect_are_explicit(self):
        connection = Connection(ADDRESS)
        connection.sock = Socket([], [])
        with self.assertRaises(EarbudError) as timeout:
            connection.query(BATTERY, {}, timeout=.005)
        self.assertEqual(timeout.exception.status, 'read_timeout')
        connection.sock = Socket([b''], [])
        with self.assertRaises(EarbudError) as disconnected:
            connection.query(BATTERY, {})
        self.assertEqual(disconnected.exception.status, 'disconnected')

    def test_duplicate_tlv_and_nonzero_reserved_byte_are_rejected(self):
        raw = bytes.fromhex('5a0009000108020132020133')
        raw += binascii.crc_hqx(raw, 0).to_bytes(2, 'big')
        self.assertEqual(Decoder().feed(raw), [])
        raw = bytearray(encode(BATTERY, {}))
        raw[3] = 1
        raw[-2:] = binascii.crc_hqx(raw[:-2], 0).to_bytes(2, 'big')
        self.assertEqual(Decoder().feed(raw), [])

    def test_lost_ack_or_readback_and_malformed_ack_mean_unknown_outcome(self):
        for failure in ('ack-timeout', 'readback-timeout', 'bad-ack'):
            class FailingChannel(Channel):
                def query(self, command, parameters):
                    if command == ANC_WRITE and failure == 'ack-timeout':
                        raise EarbudError('lost ACK', 'read_timeout')
                    if command == ANC_WRITE and failure == 'bad-ack':
                        return frame(ANC_WRITE, {})
                    if command == ANC_STATE and failure == 'readback-timeout' and any(
                            cmd == ANC_WRITE for cmd, _ in self.commands):
                        raise EarbudError('lost readback', 'disconnected')
                    return super().query(command, parameters)
            channel = FailingChannel(ADDRESS)
            result = operate(ADDRESS, 'light', connector=lambda _: channel,
                             enumerate_devices=lambda: [{'address': ADDRESS}])
            self.assertEqual(result['status'], 'outcome_unknown', failure)
            self.assertIsNone(result['noise_mode'])
            self.assertFalse(result['write_verified'])

    def test_nonzero_ack_explicitly_rejects_write(self):
        class RejectingChannel(Channel):
            def query(self, command, parameters):
                if command == ANC_WRITE:
                    return frame(ANC_WRITE, {2: b'\x01'})
                return super().query(command, parameters)
        with self.assertRaises(EarbudError) as rejected:
            operate(ADDRESS, 'light', connector=RejectingChannel,
                    enumerate_devices=lambda: [{'address': ADDRESS}])
        self.assertEqual(rejected.exception.status, 'write_rejected')

    def test_device_mutex_canonicalises_address_aliases(self):
        with device_lock(ADDRESS):
            with self.assertRaises(EarbudError) as busy:
                with device_lock(ADDRESS.replace(':', '').lower()):
                    self.fail('same device entered concurrently')
        self.assertEqual(busy.exception.status, 'busy')


class BusinessAdversarialTests(unittest.TestCase):
    setUp = fixtures.EarbudBusinessTests.setUp
    tearDown = fixtures.EarbudBusinessTests.tearDown

    def test_multiple_paired_devices_require_explicit_binding(self):
        candidates = [{'address': ADDRESS}, {'address': 'AA:BB:CC:DD:EE:FF'}]
        with patch('wujian.earbuds.windows.list_devices', return_value=candidates), \
             patch('wujian.earbuds.windows.operate') as hardware:
            result = earbud_tool(self.db, 'owner', 'create_console', 'earbuds')
        self.assertEqual(result['status'], 'ambiguous_target')
        hardware.assert_not_called()
        self.assertEqual(self.db.scalars(select(DeviceTarget)).all(), [])

    def test_shared_reader_and_previous_owner_cannot_control_hardware(self):
        self.db.add(Grant(item_id='earbuds', user_id='other'))
        self.db.commit()
        with patch('wujian.earbuds.windows.operate') as hardware:
            for operation in ('read', 'set_anc', 'create_console', 'status', 'read_volume', 'set_volume'):
                with self.assertRaises(DomainError):
                    earbud_tool(self.db, 'other', operation, 'earbuds', mode='light')
            item = self.db.get(ItemRecord, 'earbuds')
            item.owner_id = 'other'
            self.db.commit()
            with self.assertRaises(DomainError):
                earbud_tool(self.db, 'owner', 'set_anc', 'earbuds', mode='light')
        hardware.assert_not_called()

    def test_disabled_http_connectors_never_touch_bluetooth_or_audio(self):
        app = FastAPI()

        @app.exception_handler(DomainError)
        async def domain_error(request, error):
            return JSONResponse({'detail': error.message}, status_code=error.status)

        register_routes(app, lambda: SimpleNamespace(id='owner'), lambda: self.db,
                        SimpleNamespace(rea_enabled=False))
        with TestClient(app) as client, patch('wujian.earbuds.windows.list_devices') as bluetooth, \
                patch('wujian.earbuds.service.operate_volume') as audio:
            for path, body in (('/api/earbuds/devices', None),
                               ('/api/items/earbuds/earbuds/read', {}),
                               ('/api/items/earbuds/earbuds/volume/read', {}),
                               ('/api/items/earbuds/earbuds/volume', {'volume': 30, 'endpoint_id': 'x'})):
                response = client.get(path) if body is None else client.post(path, json=body)
                self.assertEqual(response.status_code, 403)
        bluetooth.assert_not_called()
        audio.assert_not_called()

    def test_other_account_cannot_claim_already_bound_physical_address(self):
        self.db.add(DeviceTarget(user_id='owner', item_id='earbuds', kind='bluetooth_freebuds4e', address=ADDRESS))
        self.db.add(ItemRecord(id='copy', owner_id='other', name='Huawei FreeBuds 4E', identity_notes={}))
        self.db.commit()
        with patch('wujian.earbuds.windows.list_devices', return_value=[{'address': ADDRESS}]), \
             patch('wujian.earbuds.windows.operate') as hardware:
            result = earbud_tool(self.db, 'other', 'create_console', 'copy')
        self.assertEqual(result['status'], 'already_bound')
        hardware.assert_not_called()

    def test_cached_observation_does_not_claim_current_connection(self):
        fixtures.EarbudBusinessTests.test_main_agent_and_ui_share_sql_target_and_actual_receipt(self)
        with patch('wujian.earbuds.windows.operate') as hardware:
            result = earbud_tool(self.db, 'owner', 'status', 'earbuds')
        self.assertFalse(result['available'])
        hardware.assert_not_called()


if __name__ == '__main__':
    unittest.main()
