"""Offline contract/protocol regression; never opens Bluetooth or paid models."""

import binascii
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from wujian.database import Base, DeviceObservation, DeviceTarget, ItemRecord, User
from wujian.domain import DomainError
from wujian.earbuds import earbud_tool
from wujian.earbuds.protocol import ANC_STATE, ANC_WRITE, BATTERY, INFO, Decoder, battery_state, encode, noise_state
from wujian.earbuds.windows import EarbudError, operate


ADDRESS = "00:11:22:33:44:55"


def frame(command, parameters):
    return Decoder().feed(encode(command, parameters))[0]


class Channel:
    def __init__(self, address, *, product=b"\x01\x35", echo="light"):
        self.evidence, self.commands, self.product, self.echo = [], [], product, echo

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def query(self, command, parameters):
        self.commands.append((command, parameters))
        if command == INFO:
            return frame(INFO, {2: self.product, 7: b"test"})
        if command == BATTERY:
            return frame(BATTERY, {2: bytes([78, 0, 32])})
        if command == ANC_WRITE:
            return frame(ANC_WRITE, {2: b"\0"})
        return frame(ANC_STATE, {1: {"light": b"\x01\x01", "off": b"\0\0"}[self.echo]})


class EarbudCodecTests(unittest.TestCase):
    def test_off_readback_retains_preceding_level(self):
        # Actual captured 4E response after light -> off; CRC validated by Decoder.
        decoded = Decoder().feed(bytes.fromhex("5a0007002b2a010201002600"))
        self.assertEqual(len(decoded), 1)
        self.assertEqual(noise_state(decoded[0]), "off")
        self.assertEqual(noise_state(frame(ANC_STATE, {1: b"\x01\x02"})), None)

    def test_retained_level_off_readback_verifies_only_requested_off(self):
        class RetainedLevelChannel(Channel):
            def query(self, command, parameters):
                if command == ANC_STATE and any(cmd == ANC_WRITE for cmd, _ in self.commands):
                    self.commands.append((command, parameters))
                    return Decoder().feed(bytes.fromhex("5a0007002b2a010201002600"))[0]
                return super().query(command, parameters)
        for requested, verified in (("off", True), ("light", False)):
            with self.subTest(requested=requested):
                channel=RetainedLevelChannel(ADDRESS)
                result=operate(ADDRESS, requested, connector=lambda _: channel,
                    enumerate_devices=lambda: [{"address": ADDRESS}])
                self.assertEqual(result["previous_mode"], "light")
                self.assertEqual(result["noise_mode"], "off")
                self.assertEqual(result["write_verified"], verified)
                self.assertEqual(result["status"], "verified" if verified else "unverified")
                self.assertFalse(result["physical_effect_verified"])
                self.assertEqual([cmd for cmd, _ in channel.commands],
                    [INFO, BATTERY, ANC_STATE, ANC_WRITE, ANC_STATE])

    def test_off_parser_still_requires_valid_command_length_and_crc(self):
        for value in (b"", b"\x00", b"\x01\x00\x00", b"\x00\x02", b"\x01\x02", b"\x02\x01"):
            with self.subTest(value=value.hex()):
                self.assertIsNone(noise_state(frame(ANC_STATE, {1: value})))
        self.assertIsNone(noise_state(frame(ANC_WRITE, {1: b"\x01\x00"})))
        damaged=bytearray.fromhex("5a0007002b2a010201002600")
        damaged[-1] ^= 1
        self.assertEqual(Decoder().feed(bytes(damaged)), [])

    def test_battery_golden_packet_and_fragmented_stream(self):
        request = encode(BATTERY, {1: b"", 2: b"", 3: b""})
        self.assertEqual(request.hex(), "5a0009000108010002000300fbb9")
        raw = bytes.fromhex("5a001400010801014e02034e002003030000000402140a6485")
        decoder = Decoder()
        self.assertEqual(decoder.feed(b"noise" + raw[:7]), [])
        decoded = decoder.feed(raw[7:] + encode(ANC_STATE, {1: b"\0\0"}))
        self.assertEqual(len(decoded), 2)
        self.assertEqual(noise_state(decoded[1]), "off")
        battery = battery_state(decoded[0])
        self.assertEqual((battery["left"], battery["right"], battery["case"]), (78, None, 32))
        self.assertEqual(battery["reported_levels"], [78, 0, 32])

    def test_corruption_resynchronises_and_case_zero_is_valid(self):
        bad = bytearray(encode(BATTERY, {2: b"\x32\xff\0"}))
        bad[-1] ^= 1
        good = encode(BATTERY, {2: b"\x32\xff\0"})
        found = Decoder().feed(bytes(bad) + good)
        self.assertEqual(len(found), 1)
        self.assertEqual(battery_state(found[0])["case"], 0)
        self.assertIsNone(battery_state(found[0])["right"])

    def test_malformed_tlv_rejected_even_with_valid_crc(self):
        raw = bytes.fromhex("5a0006000108020801")
        raw += binascii.crc_hqx(raw, 0).to_bytes(2, "big")
        self.assertEqual(Decoder().feed(raw), [])

    def test_identity_and_actual_readback_gate_noise_write(self):
        channel = Channel(ADDRESS, product=b"\x02\x44")
        with self.assertRaises(EarbudError):
            operate(ADDRESS, "light", connector=lambda _: channel,
                    enumerate_devices=lambda: [{"address": ADDRESS}])
        self.assertNotIn(ANC_WRITE, [command for command, _ in channel.commands])
        channel = Channel(ADDRESS, echo="off")
        result = operate(ADDRESS, "light", connector=lambda _: channel,
                         enumerate_devices=lambda: [{"address": ADDRESS}])
        self.assertEqual(result["status"], "unverified")
        self.assertFalse(result["write_verified"])
        self.assertEqual(result["noise_mode"], "off")

    def test_invalid_address_and_unpaired_target_rejected(self):
        with self.assertRaises(EarbudError):
            operate("localhost;cmd", enumerate_devices=lambda: [])
        with self.assertRaises(EarbudError):
            operate(ADDRESS, enumerate_devices=lambda: [])


class EarbudBusinessTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add_all([User(id="owner", username="owner", display_name="小林", password_hash="unused"),
                         User(id="other", username="other", display_name="其他人", password_hash="unused")])
        self.db.flush()
        self.db.add(ItemRecord(id="earbuds", owner_id="owner", name="我的华为耳机",
            identity_notes={"brand": "HUAWEI", "model": "FreeBuds 4E"}))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_main_agent_and_ui_share_sql_target_and_actual_receipt(self):
        state = {"status": "observed", "address": ADDRESS, "battery": {"left": 78, "right": None, "case": 32}}
        with patch("wujian.earbuds.windows.list_devices", return_value=[{"address": ADDRESS}]), \
             patch("wujian.earbuds.windows.operate", return_value=state) as actual:
            result = earbud_tool(self.db, "owner", "create_console", "earbuds")
            self.assertTrue(result["available"])
            self.assertEqual(result["state"]["battery"]["left"], 78)
            self.assertEqual(len(self.db.scalars(select(DeviceTarget)).all()), 1)
            actual.assert_called_once_with(ADDRESS)
        with self.assertRaises(DomainError):
            earbud_tool(self.db, "other", "read", "earbuds")
        with patch("wujian.earbuds.windows.operate", side_effect=EarbudError("设备断开", "disconnected")):
            result = earbud_tool(self.db, "owner", "read", "earbuds")
        self.assertFalse(result["available"])
        self.assertEqual(result["status"], "disconnected")
        self.assertNotIn("battery", result["state"])
        self.assertEqual(len(self.db.scalars(select(DeviceObservation)).all()), 2)

    def test_set_anc_cannot_silently_bind_device(self):
        with patch("wujian.earbuds.windows.operate") as hardware:
            result = earbud_tool(self.db, "owner", "set_anc", "earbuds", mode="light")
            self.assertEqual(result["status"], "not_bound")
            hardware.assert_not_called()


if __name__ == "__main__":
    unittest.main()
