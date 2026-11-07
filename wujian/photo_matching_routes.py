"""Photo recognition is a separate request after the wall record is saved."""
from fastapi import Depends

from .photo_matching import PhotoMatchRequest, PhotoMatchResult, match_experience_photos


def register_photo_matching(app, current_user, settings, sessions):
    @app.post("/api/experiences/{experience_id}/photo-matches", response_model=PhotoMatchResult,
              tags=["Experiences"])
    async def match(experience_id: str, payload: PhotoMatchRequest, user=Depends(current_user)):
        return await match_experience_photos(settings, sessions, user.id, experience_id, payload)
