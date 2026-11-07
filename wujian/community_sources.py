"""Keep MediaCrawler public metadata in the existing source/permission store."""
from pathlib import Path

from sqlalchemy import select

from .database import Asset, SourceRecord
from .domain import accessible_item
from .knowledge import parse_document, source_excerpt, source_images
from .mediacrawler_adapter import request_public
from .source_video import canonical_video_url


async def fetch_bilibili_source(sessions, user_id, url, item_id=None, refresh=False, *, requester=None):
    url, bvid = canonical_video_url(url)
    with sessions() as db:
        if item_id:
            accessible_item(db, user_id, item_id)
        existing = db.scalar(select(SourceRecord).where(SourceRecord.owner_id == user_id,
            SourceRecord.url == url, SourceRecord.item_id == item_id,
            SourceRecord.origin == "public_web").order_by(SourceRecord.fetched_at.desc()))
        if existing and not refresh:
            asset = db.get(Asset, existing.asset_id) if existing.asset_id else None
            result = {**source_excerpt(existing), "images": source_images(existing, asset),
                      "retrieval_provider": "retained_public_source", "from_cache": True}
            if asset and asset.media_type != "application/pdf" and Path(asset.path).is_file():
                _, _, links, _, _ = parse_document(Path(asset.path).read_bytes(), asset.media_type, existing.url)
                result["links"] = links
            return result
    value = await (requester or request_public)({"operation": "detail", "bvid": bvid})
    # This is a metadata original, not a structured tutorial invented from a
    # title. Keep unknown method/mechanism/steps unknown until actually read.
    title = str(value.get("title") or bvid)[:300]
    lines = ["[MediaCrawler公开视频元数据；未观看视频或音频]", f"标题：{title}",
             f"作者：{str(value.get('author') or '')[:120]}",
             f"时长（秒）：{value.get('duration')}",
             "简介：", str(value.get("desc") or "")[:12000], "分P目录（不是步骤）："]
    for part in value.get("parts", [])[:30]:
        lines.append(f"P{part.get('page')}：{str(part.get('part') or '')[:300]}；{part.get('duration')}秒")
    with sessions() as db:
        if item_id:
            accessible_item(db, user_id, item_id)
        source = SourceRecord(owner_id=user_id, item_id=item_id, origin="public_web",
            url=url, title=title, content="\n".join(lines), pages=[])
        db.add(source)
        db.commit()
        return {**source_excerpt(source), "images": [], "retrieval_provider": "mediacrawler_public_bilibili_client",
                "case_evidence": {"video_observed": False, "audio_transcribed": False,
                    "mechanism_verified": False, "physical_result_verified": False}}
