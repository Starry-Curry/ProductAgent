"""Exercise real PDFium pages, native lifetime serialization and image bounds.

PDFs are explicit synthetic document fixtures; no model/device is involved.
"""
import base64
import io
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pypdfium2 as pdfium
from PIL import Image
from pypdf import PdfWriter

from wujian.domain import DomainError
from wujian.knowledge import render_source_page


class PdfPageRendererTests(unittest.TestCase):
    def document(self, folder, width=600, height=800):
        path = Path(folder) / 'synthetic-layout-fixture.pdf'
        writer = PdfWriter()
        writer.add_blank_page(width=width, height=height)
        with path.open('wb') as stream:
            writer.write(stream)
        return SimpleNamespace(media_type='application/pdf', path=str(path))

    def test_large_manual_sheet_is_bounded_before_native_render_allocation(self):
        with tempfile.TemporaryDirectory() as folder:
            asset = self.document(folder, 2400, 1600)
            encoded = render_source_page(None, None, asset, 1)
        with Image.open(io.BytesIO(base64.b64decode(encoded))) as image:
            self.assertEqual(image.format, 'PNG')
            self.assertEqual(image.width, 2000)
            self.assertLessEqual(max(image.size), 2000)
            self.assertLessEqual(image.width * image.height, 4_000_000)

    def test_unavailable_pdf_page_returns_domain_error(self):
        with tempfile.TemporaryDirectory() as folder:
            asset = self.document(folder)
            for number in (0, 2):
                with self.subTest(page=number), self.assertRaisesRegex(DomainError, '页码'):
                    render_source_page(None, None, asset, number)

    def test_parallel_requests_never_overlap_pdfium_native_lifetimes(self):
        original = pdfium.PdfDocument
        guard = threading.Lock()
        ready = threading.Barrier(2)
        active, maximum = 0, 0

        class DocumentLifetime:
            def __init__(self, path):
                nonlocal active, maximum
                with guard:
                    active += 1
                    maximum = max(maximum, active)
                    if active != 1:
                        active -= 1
                        # Reject before entering PDFium, so a regression cannot
                        # itself crash the test process through unsafe C calls.
                        raise AssertionError('Concurrent PDFium native lifetimes')
                time.sleep(.03)
                self.document = original(path)

            def __len__(self):
                return len(self.document)

            def __getitem__(self, index):
                return self.document[index]

            def close(self):
                nonlocal active
                try:
                    self.document.close()
                finally:
                    with guard:
                        active -= 1

        with tempfile.TemporaryDirectory() as folder:
            asset = self.document(folder)

            def render():
                ready.wait(timeout=3)
                return render_source_page(None, None, asset, 1)

            with patch('pypdfium2.PdfDocument', DocumentLifetime), ThreadPoolExecutor(max_workers=2) as workers:
                futures = [workers.submit(render) for _ in range(2)]
                outputs = [future.result(timeout=8) for future in futures]
        self.assertEqual(maximum, 1)
        self.assertEqual(active, 0)
        self.assertEqual(outputs[0], outputs[1])


if __name__ == '__main__':
    unittest.main()
