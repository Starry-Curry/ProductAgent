"""Photo-based object portraits through the already configured Bailian account.

Generation creates a private preview Asset, like a photo upload. The existing
Item writer attaches its image_id only when the person saves the editor.
References:
https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
https://help.aliyun.com/en/model-studio/qwen-image-generation-and-editing-api-reference
"""
import base64
import io
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx
from fastapi import Depends
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from . import domain
from .database import Asset, uid
from .knowledge import download_public


class AvatarImageRequest(BaseModel):
    expected_version: int = Field(ge=1)


class AvatarImageResult(BaseModel):
    asset_id: str
    model: str


def generation_endpoint(base_url):
    """Keep the configured region/workspace; do not silently switch accounts."""
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        raise domain.DomainError("百炼服务地址无效", 503)
    return urlunsplit((parsed.scheme, parsed.netloc,
        "/api/v1/services/aigc/multimodal-generation/generation", "", ""))


def _image_bytes(data):
    try:
        with Image.open(io.BytesIO(data)) as original:
            if original.width * original.height > 30_000_000:
                raise domain.DomainError("照片尺寸过大，请先压缩后重试")
            image = ImageOps.exif_transpose(original).convert("RGBA")
            image.thumbnail((1536, 1536))
            background = Image.new("RGB", image.size, "#faf8f4")
            background.paste(image, mask=image.getchannel("A"))
            output = io.BytesIO()
            background.save(output, format="JPEG", quality=90)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise domain.DomainError("暂时读不到这张物品照片，可以换一张重试") from None


def image_request(source_bytes, *, item_name):
    def block(data):
        return {"image": "data:image/jpeg;base64," + base64.b64encode(_image_bytes(data)).decode()}
    content = [block(source_bytes)]
    content.append({"text":
        f"Create a plush version of the main physical object in the input photo: {item_name[:120]!r}. "
        "The object's own body IS the character. Keep its original recognizable silhouette, colors, "
        "openings and distinctive functional parts. Change its surfaces to soft short-pile felt. "
        "Stitch two tiny black bead eyes and a small friendly mouth directly onto the FRONT SURFACE "
        "of the object, with subtle pink cheeks. A single object character only. No separate human, "
        "animal, round mascot or doll inside or beside it. No costume around a different character. "
        "Warm ivory plain studio background, soft daylight, refined tactile plush toy photography. "
        "Full object centered with generous margins. Remove the room, people, lettering and watermarks. "
        "The result should feel gentle, minimal and collectible while still looking like this exact object."})
    return {"model": os.getenv("QWEN_AVATAR_IMAGE_MODEL") or "qwen-image-2.1-pro",
        "input": {"messages": [{"role": "user", "content": content}]},
        "parameters": {"n": 1, "size": "1024*1024", "watermark": False, "prompt_extend": False}}


async def generate_avatar_image(settings, source_bytes, *, item_name):
    if not settings.api_key:
        raise domain.DomainError("配置百炼后就能从照片生成形象，现在仍可选择已有样式", 503)
    payload = image_request(source_bytes, item_name=item_name)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(240, connect=15)) as client:
            response = await client.post(generation_endpoint(settings.base_url),
                headers={"Authorization": f"Bearer {settings.api_key}"}, json=payload)
            if response.status_code != 200:
                # Provider errors can include request input. Keep photos, signed
                # URLs and account configuration out of user-facing exceptions.
                raise domain.DomainError(f"这次形象没有生成成功（服务状态{response.status_code}），原来的样子仍然保留，可以重试", 502)
            body = response.json()
        choices = body.get("output", {}).get("choices", [])
        urls = [entry.get("image") for choice in choices
                for entry in choice.get("message", {}).get("content", []) if entry.get("image")]
        if not urls:
            raise domain.DomainError("这次没有收到形象图片，原来的样子仍然保留，可以重试", 502)
        _, _, generated = await download_public(urls[0], max_bytes=12 * 1024 * 1024)
        # Decode and re-encode instead of publishing arbitrary provider bytes.
        with Image.open(io.BytesIO(generated)) as image:
            if image.width * image.height > 16_000_000:
                raise domain.DomainError("生成图片尺寸异常，请重试", 502)
            image.thumbnail((1536, 1536))
            output = io.BytesIO()
            image.convert("RGBA").save(output, format="PNG")
        return output.getvalue(), {"model": payload["model"], "request_id": body.get("request_id", "")}
    except (httpx.HTTPError, ValueError, TypeError, AttributeError, UnidentifiedImageError,
            OSError, Image.DecompressionBombError) as error:
        raise domain.DomainError("形象服务暂时没有连接好，原来的样子仍然保留，可以稍后重试", 502) from error


def register_routes(app, current_user, db_session, settings):
    @app.post("/api/items/{item_id}/avatar-image", response_model=AvatarImageResult)
    async def create_image(item_id: str, payload: AvatarImageRequest,
                           user=Depends(current_user), db=Depends(db_session)):
        user_id = user.id
        item = domain.accessible_item(db, user_id, item_id, write=True)
        if item.archived or item.version != payload.expected_version:
            raise domain.DomainError("物品已变化，请刷新后再生成形象", 409)
        if not item.photo_id:
            raise domain.DomainError("先为这件物品放一张照片，就能长出属于它的形象")
        source_id = item.photo_id
        item_name = item.name
        source = domain.own_asset(db, user_id, source_id)
        try:
            source_bytes = Path(source.path).read_bytes()
        except OSError:
            raise domain.DomainError("物品照片暂时不可读，可以重新上传") from None
        # Release the read transaction while the provider is working. Results
        # are authorized again against the current item before any write.
        db.rollback()
        generated, metadata = await generate_avatar_image(settings, source_bytes,
            item_name=item_name)
        db.expire_all()
        current = domain.accessible_item(db, user_id, item_id, write=True)
        if current.archived or current.version != payload.expected_version or current.photo_id != source_id:
            raise domain.DomainError("生成时物品照片或资料已变化，请刷新后重试", 409)
        identity = uid()
        path = settings.data_dir / "assets" / identity
        path.write_bytes(generated)
        try:
            db.add(Asset(id=identity, owner_id=user_id, path=str(path), media_type="image/png",
                         original_name="物间-物品分身.png"))
            db.commit()
        except Exception:
            db.rollback()
            path.unlink(missing_ok=True)
            raise
        return AvatarImageResult(asset_id=identity, model=metadata["model"])
