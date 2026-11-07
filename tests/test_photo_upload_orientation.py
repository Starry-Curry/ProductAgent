"""Actual multipart JPEG upload, temporary SQLite and saved-asset round trip.

The four colour blocks are synthetic test fixtures, not a photograph of a real
person or object. EXIF Orientation 6/8 are the actual JPEG metadata used by many
phone cameras. No model, public network, device or primary data is used.
"""

import io
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from wujian.config import Settings
from wujian.server import create_app


COLOURS = {
    "red": (230, 25, 25), "green": (25, 200, 25),
    "blue": (25, 25, 230), "yellow": (230, 210, 25),
}
EXPECTED_CORNERS = {
    1: ["red", "green", "blue", "yellow"],
    6: ["yellow", "red", "green", "blue"],
    8: ["green", "blue", "yellow", "red"],
}


def jpeg_fixture(orientation):
    """Corners clockwise from top-left: red, green, blue, yellow."""
    image = Image.new("RGB", (120, 80))
    draw = ImageDraw.Draw(image)
    for rectangle, colour in [((0, 0, 59, 39), "red"),
                              ((60, 0, 119, 39), "green"),
                              ((60, 40, 119, 79), "blue"),
                              ((0, 40, 59, 79), "yellow")]:
        draw.rectangle(rectangle, fill=COLOURS[colour])
    exif = Image.Exif()
    exif[274] = orientation
    output = io.BytesIO()
    image.save(output, "JPEG", quality=95, subsampling=0, exif=exif)
    image.close()
    return output.getvalue()


def corner_colours(image):
    width, height = image.size
    positions = [(width // 4, height // 4), (3 * width // 4, height // 4),
                 (3 * width // 4, 3 * height // 4), (width // 4, 3 * height // 4)]
    return [min(COLOURS, key=lambda name: sum(
        (actual - expected) ** 2 for actual, expected in zip(image.getpixel(point), COLOURS[name])))
        for point in positions]


def upload_observation(client, orientation):
    body = jpeg_fixture(orientation)
    with Image.open(io.BytesIO(body)) as original:
        assert original.getexif()[274] == orientation
        assert original.size == (120, 80)
    uploaded = client.post('/api/assets', files={
        'file': (f'synthetic-phone-orientation-{orientation}.jpg', body, 'image/jpeg')})
    uploaded.raise_for_status()
    saved = client.get(uploaded.json()['url'])
    saved.raise_for_status()
    with Image.open(io.BytesIO(saved.content)) as image:
        actual = {'size': list(image.size), 'corners_clockwise': corner_colours(image),
                  'orientation_tag': image.getexif().get(274)}
    return {'fixture_orientation': orientation, 'fixture_raw_size': [120, 80],
            'expected': {'size': [120, 80] if orientation == 1 else [80, 120],
                         'corners_clockwise': EXPECTED_CORNERS[orientation]},
            'actual': actual, 'upload_status': uploaded.status_code, 'asset_status': saved.status_code}


class PhotoUploadOrientationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Settings(data_dir=Path(self.temp.name),
            api_key='', demo_mode=False, rea_enabled=False))
        self.client = TestClient(self.app).__enter__()
        registered = self.client.post('/api/auth/register', json={
            'username': 'synthetic_photo_orientation',
            'password': 'local-photo-fixture-only-123', 'display_name': '合成照片方向测试'})
        self.assertEqual(registered.status_code, 200, registered.text)

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.temp.cleanup()

    def check_orientation(self, orientation):
        observed = upload_observation(self.client, orientation)
        self.assertEqual(observed['actual']['size'], observed['expected']['size'], observed)
        self.assertEqual(observed['actual']['corners_clockwise'],
                         observed['expected']['corners_clockwise'], observed)
        self.assertIn(observed['actual']['orientation_tag'], (None, 1), observed)

    def test_upright_jpeg_keeps_geometry_and_colours(self):
        self.check_orientation(1)

    def test_phone_orientation_6_saved_as_upright_portrait(self):
        self.check_orientation(6)

    def test_phone_orientation_8_saved_as_upright_portrait(self):
        self.check_orientation(8)


if __name__ == '__main__':
    unittest.main()
