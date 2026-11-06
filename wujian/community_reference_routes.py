"""Authenticated, rate-limited public reference collection, without a model call.

Uses the same temporary collector as the Agent. No cookies, browser profiles,
arbitrary worker operations or internal URLs are accepted from callers.
"""
import asyncio
import time

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field

from .domain import DomainError


class ReferenceSearch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    query: str = Field(min_length=1, max_length=200)
    limit: int = Field(default=5, ge=1, le=5)


class ReferenceRead(BaseModel):
    model_config = ConfigDict(extra='forbid')
    url: str = Field(min_length=1, max_length=300)
    item_id: str | None = None


def register_reference_routes(app, current_user, sessions, runner):
    lock = asyncio.Lock()
    last_request = [0.0]

    async def request(user_id, operation):
        async with lock:
            if not (await runner.communities.status(user_id)).get('connected'):
                raise DomainError('请先为当前账号扫码登录 B 站', 503)
            # Shared bound across curator accounts; never run concurrent fetches.
            delay = 4.0 - (time.monotonic() - last_request[0])
            if delay > 0:
                await asyncio.sleep(delay)
            try:
                return await runner.communities.request(user_id, operation)
            finally:
                last_request[0] = time.monotonic()

    @app.post('/api/community/bilibili/references/search', tags=['Community references'])
    async def search(payload: ReferenceSearch, user=Depends(current_user)):
        return await request(user.id, {'operation': 'search', 'query': payload.query, 'limit': payload.limit})

    @app.post('/api/community/bilibili/references/read', tags=['Community references'])
    async def read(payload: ReferenceRead, user=Depends(current_user)):
        from .community_sources import fetch_bilibili_source
        return await fetch_bilibili_source(sessions, user.id, payload.url, payload.item_id,
            requester=lambda operation: request(user.id, operation))
