import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from storage import (
    ALLOWED_IMAGE_TYPES,
    EXT_FOR_TYPE,
    is_configured,
    presign_put,
)

router = APIRouter(prefix="/api/uploads")


class PresignRequest(BaseModel):
    content_type: str


@router.post("/presign")
async def presign(req: PresignRequest):
    if not is_configured():
        raise HTTPException(status_code=503, detail="Storage backend not configured")
    if req.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {req.content_type}",
        )
    ext = EXT_FOR_TYPE[req.content_type]
    key = f"events/{uuid.uuid4()}.{ext}"
    url = await presign_put(key, req.content_type)
    return {"upload_url": url, "key": key}
