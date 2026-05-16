import os
from contextlib import asynccontextmanager

import aioboto3
from botocore.exceptions import ClientError

R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET = os.getenv("R2_BUCKET")

R2_ENDPOINT = (
    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if R2_ACCOUNT_ID else None
)

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}

EXT_FOR_TYPE = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

_session = aioboto3.Session()


def is_configured() -> bool:
    return all([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET])


@asynccontextmanager
async def _client():
    if not is_configured():
        raise RuntimeError("R2 storage is not configured (missing R2_* env vars)")
    async with _session.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    ) as client:
        yield client


async def presign_put(key: str, content_type: str, expires: int = 300) -> str:
    async with _client() as c:
        return await c.generate_presigned_url(
            "put_object",
            Params={"Bucket": R2_BUCKET, "Key": key, "ContentType": content_type},
            ExpiresIn=expires,
        )


async def presign_get(key: str, expires: int = 3600) -> str:
    async with _client() as c:
        return await c.generate_presigned_url(
            "get_object",
            Params={"Bucket": R2_BUCKET, "Key": key},
            ExpiresIn=expires,
        )


async def object_exists(key: str) -> bool:
    async with _client() as c:
        try:
            await c.head_object(Bucket=R2_BUCKET, Key=key)
            return True
        except ClientError:
            return False


async def delete_object(key: str) -> None:
    async with _client() as c:
        await c.delete_object(Bucket=R2_BUCKET, Key=key)
