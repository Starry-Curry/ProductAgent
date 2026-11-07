"""Import explicitly simulated possessions with verified domestic product images.

No provider calls. Defaults to read-only planning; downloads and imports are
separate explicit actions. Existing possessions are preserved except for an
explicitly requested, version-checked refresh of marked demo photos.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import httpx
from PIL import Image, ImageOps
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from wujian import domain, interactions
from wujian.api_models import AvatarSpec, ItemChange, ItemCreate
from wujian.config import Settings
from wujian.database import Asset, HouseholdItem, ItemRecord, Profile, User, uid

DEFAULT_CATALOG = ROOT / "fixtures/demo/2026-11-06_household_inventory.json"
PHOTO_HOSTS = {"file.app.ikea.cn", "www.ikea.cn", "c1.mifile.cn", "i1.mifile.cn", "i8.mifile.cn",
               "cdn.cnbj1.fds.api.mi-img.com", "cdn.cnbj0.fds.api.mi-img.com",
               "www.sonystyle.com.cn", "www.epson.com.cn", "eposs.epson.com.cn",
               "www.deliworld.com"}
CATALOG_ORIGIN = "simulated_household_inventory_2026_11_06"


def read_catalog(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("dataset_kind") != "development_simulation":
        raise ValueError("仅导入明确标记为 development_simulation 的演示清单")
    keys = set()
    for row in data["items"]:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", row["key"]):
            raise ValueError("清单 key 必须是简短的小写英文/数字/连字符标识")
        if row["key"] in keys:
            raise ValueError("清单 key 重复")
        keys.add(row["key"])
        payload = ItemCreate.model_validate(row["item"])
        if payload.kind == "standard_product":
            product = row["item"].get("product") or {}
            if not all(str(product.get(key) or "").strip() for key in ("brand", "commercial_name", "model")):
                raise ValueError(f"{row['key']} 标准商品必须有完整品牌、商品名和型号")
            if product.get("market") != "CN" or not product.get("source_urls"):
                raise ValueError(f"{row['key']} 标准商品必须有国内版本和可核对来源")
            if any(urlsplit(url).scheme != "https" or not urlsplit(url).hostname
                   for url in product["source_urls"]):
                raise ValueError(f"{row['key']} 商品来源必须是完整 HTTPS 网址")
        if not row.get("identity_verified") or not row.get("image_url"):
            raise ValueError(f"{row['key']} 未核对型号或缺少真实产品照片")
        _check_photo_url(row["image_url"])
    return data


def _check_photo_url(url):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in PHOTO_HOSTS or parsed.username or parsed.password:
        raise ValueError("产品图必须来自清单允许的一手官方 HTTPS 图片主机")


def _download_photo(client, url):
    for attempt in range(3):
        try:
            for _ in range(4):
                _check_photo_url(url)
                with client.stream("GET", url) as response:
                    if response.is_redirect:
                        url = urljoin(url, response.headers["location"])
                        continue
                    response.raise_for_status()
                    content = bytearray()
                    for chunk in response.iter_bytes():
                        content.extend(chunk)
                        if len(content) > 10 * 1024 * 1024:
                            raise ValueError("产品图超过10MiB")
                    return content, url
            raise ValueError("产品图重定向过多")
        except (httpx.TransportError, httpx.HTTPStatusError) as error:
            if attempt == 2 or (isinstance(error, httpx.HTTPStatusError) and error.response.status_code < 500):
                raise
            time.sleep(0.5 * (attempt + 1))


def prepare_photos(catalog, photo_dir):
    """Bounded official downloads; retain source URL/hash in the receipt."""
    photo_dir = Path(photo_dir)
    photo_dir.mkdir(parents=True, exist_ok=True)
    result = []
    with httpx.Client(timeout=30, follow_redirects=False) as client:
        for row in catalog["items"]:
            path = photo_dir / (row["key"] + ".jpg")
            receipt_path = photo_dir / (row["key"] + ".source.json")
            receipt = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.is_file() else {}
            if path.exists() and receipt.get("image_url") == row["image_url"] and receipt.get("sha256") == hashlib.sha256(path.read_bytes()).hexdigest():
                with Image.open(path) as image:
                    image.verify()
                result.append({"key": row["key"], "status": "cached", "path": str(path)})
                continue
            content, url = _download_photo(client, row["image_url"])
            with Image.open(io.BytesIO(content)) as source:
                source.load()
                image = ImageOps.exif_transpose(source)
                if image.mode in {"RGBA", "LA"}:
                    background = Image.new("RGB", image.size, "white")
                    background.paste(image, mask=image.getchannel("A"))
                    image = background
                else:
                    image = image.convert("RGB")
                image.thumbnail((1200, 1200))
                image.save(path, "JPEG", quality=88, optimize=True)
            receipt_path.write_text(json.dumps({"image_url": row["image_url"], "final_url": url,
                "source_sha256": hashlib.sha256(content).hexdigest(),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}, ensure_ascii=False, indent=2), encoding="utf-8")
            result.append({"key": row["key"], "status": "downloaded", "path": str(path),
                           "source_url": url, "source_sha256": hashlib.sha256(content).hexdigest()})
    return result


def prepared_photo(row, photo_dir):
    path = Path(photo_dir) / (row["key"] + ".jpg")
    receipt_path = path.with_suffix(".source.json")
    if not path.is_file() or not receipt_path.is_file():
        raise ValueError(f"缺少已验证产品图或来源回执：{path}；先执行 --prepare-photos")
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if receipt.get("image_url") != row["image_url"] or receipt.get("sha256") != hashlib.sha256(path.read_bytes()).hexdigest():
        raise ValueError(f"{row['key']} 图片与清单来源不一致；重新执行 --prepare-photos")
    with Image.open(path) as image:
        image.verify()
    return path


def import_inventory(db, user_id, household_id, catalog, photo_dir, asset_dir, *, apply=False, refresh_demo_photos=False):
    domain.require(db.get(User, user_id), "目标演示用户不存在")
    if household_id:
        interactions.member(db, user_id, household_id)
    existing = db.scalars(select(ItemRecord).where(ItemRecord.owner_id == user_id)).all()
    if refresh_demo_photos and user_id != "person_demo_owner":
        raise ValueError("--refresh-demo-photos 仅适用于明确授权的小林演示账号")
    imported = {(row.state or {}).get("demo_inventory_key"): row for row in existing
                if (row.state or {}).get("data_origin") == CATALOG_ORIGIN}
    signatures = {(row.product.get("brand", "").casefold(), row.product.get("model", "").casefold())
                  for row in existing if row.kind == "standard_product" and row.product.get("model")}
    result = []
    prepared = []
    resume_shares = []
    refreshes = []
    for row in catalog["items"]:
        payload = ItemCreate.model_validate(row["item"])
        signature = (payload.product.brand.casefold(), payload.product.model.casefold())
        old = imported.get(row["key"])
        if old is not None:
            result.append({"key": row["key"], "status": "already_imported", "item_id": old.id})
            # A previous import may have stopped after create_item committed.
            # Only our explicitly marked record may resume its requested share.
            if apply and household_id and db.get(HouseholdItem, (household_id, old.id)) is None:
                resume_shares.append(old.id)
            continue
        if payload.kind == "standard_product" and signature in signatures:
            candidates = [item for item in existing if item.kind == "standard_product"
                          and (item.product.get("brand", "").casefold(), item.product.get("model", "").casefold()) == signature
                          and (item.state or {}).get("data_origin") == "development_simulation"]
            if refresh_demo_photos and len(candidates) == 1:
                old = candidates[0]
                path = prepared_photo(row, photo_dir)
                old_asset = db.get(Asset, old.photo_id) if old.photo_id else None
                same_image = bool(old_asset and Path(old_asset.path).is_file() and
                    hashlib.sha256(Path(old_asset.path).read_bytes()).digest() == hashlib.sha256(path.read_bytes()).digest())
                same_provenance = (old.state or {}).get("photo_origin") == "official_product_reference_not_user_photo" and (old.state or {}).get("photo_source_url") == row["image_url"]
                if same_image and same_provenance:
                    result.append({"key": row["key"], "status": "photo_already_current", "item_id": old.id})
                    continue
                refreshes.append((row, old.id, old.version, path))
                result.append({"key": row["key"], "status": "refresh_photo" if apply else "would_refresh_photo",
                               "item_id": old.id, "old_photo_id": old.photo_id, "expected_version": old.version,
                               "image_url": row["image_url"]})
            else:
                result.append({"key": row["key"], "status": "existing_model_untouched"})
            continue
        path = prepared_photo(row, photo_dir)
        prepared.append((row, payload, path))
        signatures.add(signature)
        result.append({"key": row["key"], "name": payload.name, "status": "create" if apply else "would_create"})
    if not apply:
        return result
    Path(asset_dir).mkdir(parents=True, exist_ok=True)
    for item_id in resume_shares:
        interactions.household_item(db, user_id, household_id, item_id, True)
    for row, item_id, version, photo in refreshes:
        old = domain.accessible_item(db, user_id, item_id, write=True)
        profile = db.get(Profile, (user_id, item_id))
        old_photo = db.get(Asset, old.photo_id) if old.photo_id else None
        asset_id = uid()
        destination = Path(asset_dir) / (asset_id + ".jpg")
        shutil.copyfile(photo, destination)
        db.add(Asset(id=asset_id, owner_id=user_id, path=str(destination.resolve()), media_type="image/jpeg",
                     original_name=f"{old.name}.jpg"))
        db.flush()
        avatar = {key: value for key, value in ((profile.avatar or {}) if profile else {}).items() if key in AvatarSpec.model_fields}
        refreshed_state = {**(old.state or {}),
            "photo_origin": "official_product_reference_not_user_photo",
            "photo_source_url": row["image_url"]}
        domain.change_item(db, user_id, item_id, ItemChange(name=old.name, kind=old.kind,
            product=old.product, state=refreshed_state, description=profile.description if profile else "",
            avatar=AvatarSpec.model_validate(avatar), photo_id=asset_id, expected_version=version))
        entry = next(entry for entry in result if entry["key"] == row["key"])
        entry.update(new_photo_id=asset_id, old_photo_path=old_photo.path if old_photo else None,
                     new_photo_path=str(destination.resolve()))
    for row, payload, photo in prepared:
        asset_id = uid()
        destination = Path(asset_dir) / (asset_id + ".jpg")
        shutil.copyfile(photo, destination)
        db.add(Asset(id=asset_id, owner_id=user_id, path=str(destination.resolve()), media_type="image/jpeg",
                     original_name=f"{payload.name}.jpg"))
        db.flush()
        payload.photo_id = asset_id
        payload.state = {**payload.state, "data_origin": CATALOG_ORIGIN, "demo_inventory_key": row["key"],
                         "ownership": "simulated", "photo_origin": (
                             "official_product_reference_not_user_photo" if payload.kind == "standard_product"
                             else "public_object_photo_reference_not_user_photo"),
                         "photo_source_url": row["image_url"]}
        created = domain.create_item(db, user_id, payload)
        if household_id:
            interactions.household_item(db, user_id, household_id, created["id"], True)
        next(entry for entry in result if entry["key"] == row["key"])["item_id"] = created["id"]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--photo-dir", type=Path, default=ROOT / "tmp/demo-inventory/photos")
    parser.add_argument("--prepare-photos", action="store_true")
    parser.add_argument("--user-id")
    parser.add_argument("--household", help="显式家庭ID；使用 none 仅导入个人物品")
    parser.add_argument("--database-url", default="")
    parser.add_argument("--refresh-demo-photos", action="store_true", help="仅替换小林原演示记录中已匹配型号的照片，保留原图与历史")
    parser.add_argument("--data-dir", type=Path)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--dry-run", action="store_true")
    action.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    catalog = read_catalog(args.catalog)
    if args.prepare_photos:
        print(json.dumps(prepare_photos(catalog, args.photo_dir), ensure_ascii=False, indent=2))
        return
    if not args.user_id or args.household is None:
        parser.error("必须显式传入 --user-id 和 --household ID/none")
    settings = Settings.load()
    data_dir = args.data_dir or settings.data_dir
    database_url = args.database_url or settings.database_url or "sqlite:///" + (data_dir / "wujian.sqlite3").as_posix()
    if not database_url.startswith("sqlite:///") or database_url.endswith(":memory:"):
        parser.error("演示导入命令仅支持已有本地 SQLite 文件")
    database_path = Path(database_url.removeprefix("sqlite:///"))
    if not database_path.is_file():
        parser.error("数据库文件不存在；本命令不会自动创建、迁移或重建数据库")
    backup_path = None
    if args.apply:
        backup_dir = data_dir / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / ("before-demo-inventory-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".sqlite3")
        with sqlite3.connect(str(database_path)) as source, sqlite3.connect(str(backup_path)) as destination:
            source.backup(destination)
    engine = create_engine(database_url)
    try:
        with Session(engine, expire_on_commit=False) as db:
            receipt = import_inventory(db, args.user_id, None if args.household == "none" else args.household,
                                       catalog, args.photo_dir, data_dir / "assets", apply=args.apply,
                                       refresh_demo_photos=args.refresh_demo_photos)
            if args.apply and backup_path:
                backup_path.with_suffix(".receipt.json").write_text(json.dumps({"backup": str(backup_path),
                    "user_id": args.user_id, "items": receipt}, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({"applied": args.apply, "backup": str(backup_path) if backup_path else None,
                              "user_id": args.user_id, "household": args.household, "items": receipt}, ensure_ascii=False, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
