from fastapi import APIRouter

from muse_backend.api.v1.clothing import router as clothing_router
from muse_backend.api.v1.health import router as health_router
from muse_backend.api.v1.media import router as media_router
from muse_backend.api.v1.outfits import router as outfits_router
from muse_backend.api.v1.phone_upload_sessions import router as phone_upload_sessions_router
from muse_backend.api.v1.settings import router as settings_router

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(health_router)
api_v1_router.include_router(clothing_router)
api_v1_router.include_router(outfits_router)
api_v1_router.include_router(media_router)
api_v1_router.include_router(phone_upload_sessions_router)
api_v1_router.include_router(settings_router)
