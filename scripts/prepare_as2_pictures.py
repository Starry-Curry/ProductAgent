"""Prepare private photo crops / official PDF pages; never commit input media."""
import hashlib
from pathlib import Path
from PIL import Image
import pypdfium2 as pdfium


def prepare_pictures(media,manual,folder,register):
    folder=Path(folder);folder.mkdir(exist_ok=True,parents=True);assets={}
    # These rotations/crops belong to the supplied AS2 photograph revision only.
    calibration=__import__('json').loads((Path(__file__).resolve().parents[1]/'fixtures/teaching/loklik-as2-pictures.json').read_text(encoding='utf-8'))
    for spec in calibration['photos']:
        original=media/'pic'/spec['filename']
        if hashlib.sha256(original.read_bytes()).hexdigest()!=spec['sha256']:continue
        with Image.open(original) as image:
            image=image.convert('RGB').rotate(spec['rotation'],expand=True);image.thumbnail(tuple(spec['size']))
            path=folder/(spec['key']+'.jpg');image.crop(tuple(spec['crop'])).save(path,quality=94)
        assets[spec['key']]=register(path,'image/jpeg')
    with pdfium.PdfDocument(manual) as document:
        for index in [2,3]:
            if len(document)<=index:continue
            page=document[index];path=folder/f'manual-{index+1}.png';page.render(scale=1.6).to_pil().save(path);page.close()
            assets['manual_'+str(index+1)]=register(path,'image/png')
    return assets
