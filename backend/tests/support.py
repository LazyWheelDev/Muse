from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast

import httpx
from asgi_lifespan import LifespanManager
from fastapi import FastAPI

from muse_backend.application import create_app
from muse_backend.config import Settings


@asynccontextmanager
async def running_client(
    settings: Settings,
    *,
    application: FastAPI | None = None,
) -> AsyncIterator[httpx.AsyncClient]:
    active_app = application or create_app(settings)
    async with LifespanManager(active_app):
        transport = httpx.ASGITransport(app=active_app, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            yield client


async def create_clothing_item(
    client: httpx.AsyncClient,
    *,
    name: str = "Linen Shirt",
    category: str = "top",
    **metadata: Any,
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/clothing-items",
        json={"name": name, "garment_category": category, **metadata},
    )
    assert response.status_code == 201, response.text
    return cast(dict[str, Any], response.json())


def outfit_item(
    clothing_item_id: int,
    *,
    layer_index: int = 0,
    body_zone: str = "upper_body",
    position_x: float = 0.5,
    position_y: float = 0.5,
    scale: float = 1.0,
    rotation: float = 0.0,
) -> dict[str, object]:
    return {
        "clothing_item_id": clothing_item_id,
        "body_zone": body_zone,
        "position_x": position_x,
        "position_y": position_y,
        "scale": scale,
        "rotation": rotation,
        "layer_index": layer_index,
    }
