from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, inspect, select

from muse_backend.database.models import ClothingItem, Outfit, OutfitItem
from muse_backend.repositories.outfits import OutfitRepository
from tests.support import create_clothing_item, outfit_item

pytestmark = pytest.mark.integration


async def create_outfit(
    client: httpx.AsyncClient,
    *,
    name: str,
    items: list[dict[str, object]],
) -> dict[str, Any]:
    response = await client.post("/api/v1/outfits", json={"name": name, "items": items})
    assert response.status_code == 201, response.text
    return cast(dict[str, Any], response.json())


async def test_outfit_create_allows_overlapping_zone_and_orders_by_layer(
    client: httpx.AsyncClient,
) -> None:
    shirt = await create_clothing_item(client, name="Shirt", category="top")
    coat = await create_clothing_item(client, name="Coat", category="outerwear")

    outfit = await create_outfit(
        client,
        name="  Layered Look  ",
        items=[
            outfit_item(
                coat["id"],
                body_zone="upper_body",
                layer_index=8,
                position_x=0.625,
                position_y=0.375,
                scale=1.35,
                rotation=-12.5,
            ),
            outfit_item(
                shirt["id"],
                body_zone="upper_body",
                layer_index=2,
                position_x=0.25,
                position_y=0.75,
                scale=0.8,
                rotation=15,
            ),
        ],
    )

    assert outfit["name"] == "Layered Look"
    assert outfit["item_count"] == 2
    assert [item["clothing_item_id"] for item in outfit["items"]] == [
        shirt["id"],
        coat["id"],
    ]
    assert [item["layer_index"] for item in outfit["items"]] == [2, 8]
    assert {item["body_zone"] for item in outfit["items"]} == {"upper_body"}
    assert outfit["items"][0]["position_x"] == 0.25
    assert outfit["items"][0]["position_y"] == 0.75
    assert outfit["items"][0]["scale"] == 0.8
    assert outfit["items"][0]["rotation"] == 15.0
    assert outfit["items"][1]["position_x"] == 0.625
    assert outfit["items"][1]["scale"] == 1.35
    assert outfit["items"][1]["rotation"] == -12.5

    fetched = await client.get(f"/api/v1/outfits/{outfit['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == outfit


async def test_outfit_update_replaces_items_atomically_and_preserves_normalized_transforms(
    client: httpx.AsyncClient,
) -> None:
    shirt = await create_clothing_item(client, name="Shirt")
    pants = await create_clothing_item(client, name="Pants", category="pants")
    outfit = await create_outfit(
        client,
        name="Original",
        items=[outfit_item(shirt["id"], layer_index=0)],
    )

    response = await client.patch(
        f"/api/v1/outfits/{outfit['id']}",
        json={
            "name": "  Revised ",
            "items": [
                outfit_item(
                    pants["id"],
                    layer_index=4,
                    body_zone="lower_body",
                    position_x=0.0,
                    position_y=1.0,
                    scale=4.0,
                    rotation=180.0,
                ),
                outfit_item(
                    shirt["id"],
                    layer_index=1,
                    body_zone="upper_body",
                    position_x=1.0,
                    position_y=0.0,
                    scale=0.1,
                    rotation=-180.0,
                ),
            ],
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["name"] == "Revised"
    assert updated["item_count"] == 2
    assert [item["clothing_item_id"] for item in updated["items"]] == [
        shirt["id"],
        pants["id"],
    ]
    assert updated["items"][0]["position_x"] == 1.0
    assert updated["items"][0]["position_y"] == 0.0
    assert updated["items"][0]["scale"] == 0.1
    assert updated["items"][0]["rotation"] == -180.0
    assert updated["items"][1]["position_x"] == 0.0
    assert updated["items"][1]["position_y"] == 1.0
    assert updated["items"][1]["scale"] == 4.0
    assert updated["items"][1]["rotation"] == 180.0


async def test_outfit_list_order_pagination_and_preview_url(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    garment = await create_clothing_item(client)
    first = await create_outfit(
        client,
        name="First",
        items=[outfit_item(garment["id"], layer_index=0)],
    )

    with app.state.database.session() as session, session.begin():
        persisted = session.get(Outfit, first["id"])
        assert persisted is not None
        persisted.preview_image_path = "outfits/previews/first.webp"

    second = await create_outfit(
        client,
        name="Second",
        items=[outfit_item(garment["id"], layer_index=0)],
    )

    page = await client.get("/api/v1/outfits", params={"limit": 1, "offset": 0})
    assert page.status_code == 200
    assert page.json()["total"] == 2
    assert page.json()["limit"] == 1
    assert page.json()["offset"] == 0
    assert page.json()["items"][0]["id"] == second["id"]

    second_page = await client.get("/api/v1/outfits", params={"limit": 1, "offset": 1})
    assert second_page.json()["items"][0]["id"] == first["id"]
    assert (
        second_page.json()["items"][0]["preview_url"] == "/api/v1/media/outfits/previews/first.webp"
    )

    touched = await client.patch(f"/api/v1/outfits/{first['id']}", json={"name": "First!"})
    assert touched.status_code == 200
    reordered = await client.get("/api/v1/outfits")
    assert reordered.json()["items"][0]["id"] == first["id"]

    with app.state.database.session() as session:
        summaries, total = OutfitRepository(session).list_active(limit=100, offset=0)
        assert total == 2
        assert [item_count for _, item_count in summaries] == [1, 1]
        assert all("items" in inspect(outfit).unloaded for outfit, _ in summaries)


async def test_missing_and_deleted_references_are_rejected_before_any_write(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    active = await create_clothing_item(client, name="Active")
    deleted = await create_clothing_item(client, name="Deleted")
    await client.delete(f"/api/v1/clothing-items/{deleted['id']}")

    rejected = await client.post(
        "/api/v1/outfits",
        json={
            "name": "Invalid",
            "items": [
                outfit_item(active["id"], layer_index=0),
                outfit_item(deleted["id"], layer_index=1),
                outfit_item(999_999, layer_index=2),
            ],
        },
    )
    assert rejected.status_code == 422
    assert rejected.json()["error"] == {
        "code": "invalid_clothing_reference",
        "message": "One or more clothing items cannot be used in this outfit.",
        "details": {"missing_ids": [999_999], "deleted_ids": [deleted["id"]]},
        "request_id": rejected.headers["x-request-id"],
    }

    listing = await client.get("/api/v1/outfits")
    assert listing.json()["total"] == 0
    with app.state.database.session() as session:
        assert session.scalar(select(func.count(Outfit.id))) == 0
        assert session.scalar(select(func.count(OutfitItem.id))) == 0


async def test_failed_outfit_update_keeps_existing_name_and_items(
    client: httpx.AsyncClient,
) -> None:
    garment = await create_clothing_item(client)
    outfit = await create_outfit(
        client,
        name="Stable",
        items=[outfit_item(garment["id"], layer_index=3, position_x=0.3)],
    )

    rejected = await client.patch(
        f"/api/v1/outfits/{outfit['id']}",
        json={
            "name": "Must Roll Back",
            "items": [outfit_item(999_999, layer_index=0)],
        },
    )
    assert rejected.status_code == 422

    unchanged = await client.get(f"/api/v1/outfits/{outfit['id']}")
    assert unchanged.status_code == 200
    assert unchanged.json()["name"] == "Stable"
    assert unchanged.json()["items"][0]["clothing_item_id"] == garment["id"]
    assert unchanged.json()["items"][0]["layer_index"] == 3
    assert unchanged.json()["items"][0]["position_x"] == 0.3


async def test_existing_outfit_may_retain_but_not_introduce_soft_deleted_garments(
    client: httpx.AsyncClient,
) -> None:
    retained = await create_clothing_item(client, name="Retained")
    unavailable = await create_clothing_item(client, name="Unavailable")
    outfit = await create_outfit(
        client,
        name="Preserved",
        items=[outfit_item(retained["id"], layer_index=0)],
    )
    await client.delete(f"/api/v1/clothing-items/{retained['id']}")
    await client.delete(f"/api/v1/clothing-items/{unavailable['id']}")

    fetched = await client.get(f"/api/v1/outfits/{outfit['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["items"][0]["clothing_item_status"] == "deleted"
    assert fetched.json()["items"][0]["clothing_item"]["deleted_at"] is not None

    rename = await client.patch(f"/api/v1/outfits/{outfit['id']}", json={"name": "Still Here"})
    assert rename.status_code == 200

    retain = await client.patch(
        f"/api/v1/outfits/{outfit['id']}",
        json={"items": [outfit_item(retained["id"], layer_index=7, scale=1.5)]},
    )
    assert retain.status_code == 200
    assert retain.json()["items"][0]["clothing_item_status"] == "deleted"
    assert retain.json()["items"][0]["layer_index"] == 7

    introduce = await client.patch(
        f"/api/v1/outfits/{outfit['id']}",
        json={
            "items": [
                outfit_item(retained["id"], layer_index=0),
                outfit_item(unavailable["id"], layer_index=1),
            ]
        },
    )
    assert introduce.status_code == 422
    assert introduce.json()["error"]["details"] == {
        "missing_ids": [],
        "deleted_ids": [unavailable["id"]],
    }

    create_with_deleted = await client.post(
        "/api/v1/outfits",
        json={"name": "No", "items": [outfit_item(retained["id"], layer_index=0)]},
    )
    assert create_with_deleted.status_code == 422


async def test_outfit_soft_delete_hides_outfit_but_preserves_persisted_items(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    garment = await create_clothing_item(client)
    outfit = await create_outfit(
        client,
        name="Archive",
        items=[outfit_item(garment["id"], layer_index=0)],
    )
    url = f"/api/v1/outfits/{outfit['id']}"

    deleted = await client.delete(url)
    assert deleted.status_code == 204
    assert (await client.get(url)).status_code == 404
    assert (await client.patch(url, json={"name": "Again"})).status_code == 404
    assert (await client.delete(url)).status_code == 404
    assert (await client.get("/api/v1/outfits")).json()["total"] == 0

    with app.state.database.session() as session:
        repository = OutfitRepository(session)
        persisted = repository.get_any(outfit["id"])
        assert persisted is not None
        assert persisted.deleted_at is not None
        assert len(persisted.items) == 1
        assert repository.get_active(outfit["id"]) is None
        assert session.get(ClothingItem, garment["id"]) is not None


@pytest.mark.parametrize(
    "items",
    [
        [],
        [outfit_item(1, layer_index=0), outfit_item(1, layer_index=1)],
        [outfit_item(1, layer_index=0), outfit_item(2, layer_index=0)],
        [outfit_item(1, position_x=-0.01)],
        [outfit_item(1, position_y=1.01)],
        [outfit_item(1, scale=0.09)],
        [outfit_item(1, scale=4.01)],
        [outfit_item(1, rotation=-180.01)],
        [outfit_item(1, rotation=180.01)],
        [outfit_item(1, layer_index=-1)],
    ],
)
async def test_outfit_payload_validation_rejects_invalid_collections_and_transforms(
    client: httpx.AsyncClient,
    items: list[dict[str, object]],
) -> None:
    response = await client.post("/api/v1/outfits", json={"name": "Invalid", "items": items})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request_validation_failed"


async def test_outfit_update_and_route_bounds_reject_invalid_input(
    client: httpx.AsyncClient,
) -> None:
    garment = await create_clothing_item(client)
    outfit = await create_outfit(
        client,
        name="Valid",
        items=[outfit_item(garment["id"])],
    )

    null_name = await client.patch(f"/api/v1/outfits/{outfit['id']}", json={"name": None})
    assert null_name.status_code == 422
    null_items = await client.patch(f"/api/v1/outfits/{outfit['id']}", json={"items": None})
    assert null_items.status_code == 422

    for path in (
        "/api/v1/outfits/0",
        "/api/v1/outfits?limit=0",
        "/api/v1/outfits?limit=101",
        "/api/v1/outfits?offset=-1",
        "/api/v1/outfits/9223372036854775808",
        "/api/v1/outfits?offset=1000001",
    ):
        response = await client.get(path)
        assert response.status_code == 422
