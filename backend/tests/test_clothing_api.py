from datetime import datetime
from decimal import Decimal

import httpx
import pytest

from muse_backend.domain.enums import BodyZone, GarmentCategory, default_body_zone_for
from tests.support import create_clothing_item

pytestmark = pytest.mark.integration


async def test_clothing_create_applies_default_zone_and_accepts_metadata_without_image(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post(
        "/api/v1/clothing-items",
        json={"name": "  Summer Shirt  ", "garment_category": "top"},
    )

    assert response.status_code == 201
    item = response.json()
    assert item["id"] > 0
    assert item["name"] == "Summer Shirt"
    assert item["garment_category"] == "top"
    assert item["default_body_zone"] == "upper_body"
    assert item["images"] == []
    assert item["purchase_price"] is None
    assert datetime.fromisoformat(item["created_at"]).tzinfo is not None
    assert datetime.fromisoformat(item["updated_at"]).tzinfo is not None

    explicit_none = await client.post(
        "/api/v1/clothing-items",
        json={
            "name": "Unplaced Keepsake",
            "garment_category": "other",
            "default_body_zone": None,
        },
    )
    assert explicit_none.status_code == 201
    assert explicit_none.json()["default_body_zone"] is None


@pytest.mark.unit
@pytest.mark.parametrize(
    ("category", "zone"),
    [
        (GarmentCategory.HAT, BodyZone.HEAD),
        (GarmentCategory.SCARF, BodyZone.NECK),
        (GarmentCategory.TOP, BodyZone.UPPER_BODY),
        (GarmentCategory.DRESS, BodyZone.FULL_BODY),
        (GarmentCategory.PANTS, BodyZone.LOWER_BODY),
        (GarmentCategory.SHOES, BodyZone.FEET),
        (GarmentCategory.OUTERWEAR, BodyZone.UPPER_BODY),
        (GarmentCategory.ACCESSORY, BodyZone.ACCESSORY),
        (GarmentCategory.OTHER, BodyZone.ACCESSORY),
    ],
)
def test_category_default_zone_contract(category: GarmentCategory, zone: BodyZone) -> None:
    assert default_body_zone_for(category) is zone


async def test_clothing_full_metadata_is_normalized_and_round_trips(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post(
        "/api/v1/clothing-items",
        json={
            "name": "  Wool Coat ",
            "garment_category": "outerwear",
            "default_body_zone": "full_body",
            "brand": "  Muse Atelier ",
            "size": "  M ",
            "color_name": " Camel ",
            "material": " Wool ",
            "season": " Autumn / Winter ",
            "purchase_price": "149.90",
            "purchase_currency": " eur ",
            "purchase_date": "2026-02-14",
            "notes": "  Dry clean only. ",
        },
    )

    assert response.status_code == 201, response.text
    item = response.json()
    assert item["name"] == "Wool Coat"
    assert item["default_body_zone"] == "full_body"
    assert item["brand"] == "Muse Atelier"
    assert item["size"] == "M"
    assert item["color_name"] == "Camel"
    assert item["material"] == "Wool"
    assert item["season"] == "Autumn / Winter"
    assert Decimal(item["purchase_price"]) == Decimal("149.90")
    assert item["purchase_currency"] == "EUR"
    assert item["purchase_date"] == "2026-02-14"
    assert item["notes"] == "Dry clean only."

    fetched = await client.get(f"/api/v1/clothing-items/{item['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == item


async def test_clothing_update_keeps_category_and_body_zone_as_separate_concepts(
    client: httpx.AsyncClient,
) -> None:
    created = await create_clothing_item(client, name="Layer", category="top")

    category_update = await client.patch(
        f"/api/v1/clothing-items/{created['id']}",
        json={"garment_category": "pants", "brand": "  ", "notes": " adjusted "},
    )
    assert category_update.status_code == 200
    updated = category_update.json()
    assert updated["garment_category"] == "pants"
    assert updated["default_body_zone"] == "upper_body"
    assert updated["brand"] is None
    assert updated["notes"] == "adjusted"

    zone_update = await client.patch(
        f"/api/v1/clothing-items/{created['id']}",
        json={"default_body_zone": "lower_body", "name": "  Updated Layer "},
    )
    assert zone_update.status_code == 200
    assert zone_update.json()["name"] == "Updated Layer"
    assert zone_update.json()["default_body_zone"] == "lower_body"


async def test_clothing_list_order_pagination_and_summary_shape(
    client: httpx.AsyncClient,
) -> None:
    first = await create_clothing_item(client, name="First", category="hat")
    second = await create_clothing_item(client, name="Second", category="pants")
    third = await create_clothing_item(client, name="Third", category="shoes")

    page = await client.get("/api/v1/clothing-items", params={"limit": 2, "offset": 0})
    assert page.status_code == 200
    assert page.json()["total"] == 3
    assert page.json()["limit"] == 2
    assert page.json()["offset"] == 0
    assert [item["id"] for item in page.json()["items"]] == [third["id"], second["id"]]
    assert all(item["primary_image"] is None for item in page.json()["items"])

    second_page = await client.get(
        "/api/v1/clothing-items",
        params={"limit": 2, "offset": 2},
    )
    assert [item["id"] for item in second_page.json()["items"]] == [first["id"]]

    touched = await client.patch(
        f"/api/v1/clothing-items/{first['id']}",
        json={"notes": "recently changed"},
    )
    assert touched.status_code == 200
    reordered = await client.get("/api/v1/clothing-items")
    assert reordered.json()["items"][0]["id"] == first["id"]


async def test_clothing_soft_delete_hides_item_without_erasing_row(
    client: httpx.AsyncClient,
) -> None:
    created = await create_clothing_item(client, name="Archived")
    item_url = f"/api/v1/clothing-items/{created['id']}"

    deleted = await client.delete(item_url)
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert (await client.get(item_url)).status_code == 404
    assert (await client.patch(item_url, json={"name": "Again"})).status_code == 404
    assert (await client.delete(item_url)).status_code == 404

    listing = await client.get("/api/v1/clothing-items")
    assert listing.json()["total"] == 0
    assert listing.json()["items"] == []


async def test_purchase_value_pair_is_validated_for_create_and_partial_updates(
    client: httpx.AsyncClient,
) -> None:
    incomplete_create = await client.post(
        "/api/v1/clothing-items",
        json={
            "name": "Priced wrong",
            "garment_category": "top",
            "purchase_price": "20.00",
        },
    )
    assert incomplete_create.status_code == 422
    assert incomplete_create.json()["error"]["code"] == "request_validation_failed"

    created = await create_clothing_item(client, name="No price")
    partial = await client.patch(
        f"/api/v1/clothing-items/{created['id']}",
        json={"purchase_currency": "EUR"},
    )
    assert partial.status_code == 422
    assert partial.json()["error"]["code"] == "invalid_purchase_value"

    paired = await client.patch(
        f"/api/v1/clothing-items/{created['id']}",
        json={"purchase_price": "25.50", "purchase_currency": "usd"},
    )
    assert paired.status_code == 200
    assert Decimal(paired.json()["purchase_price"]) == Decimal("25.50")
    assert paired.json()["purchase_currency"] == "USD"

    cleared = await client.patch(
        f"/api/v1/clothing-items/{created['id']}",
        json={"purchase_price": None, "purchase_currency": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["purchase_price"] is None
    assert cleared.json()["purchase_currency"] is None


@pytest.mark.parametrize(
    "payload",
    [
        {"name": None},
        {"garment_category": None},
        {"name": "\n\t"},
        {"name": "bad\x00name"},
        {"purchase_price": "-1", "purchase_currency": "EUR"},
        {"purchase_price": "1.001", "purchase_currency": "EUR"},
        {"purchase_price": "1.00", "purchase_currency": "EURO"},
    ],
)
async def test_clothing_rejects_invalid_updates(
    client: httpx.AsyncClient,
    payload: dict[str, object],
) -> None:
    created = await create_clothing_item(client)
    response = await client.patch(
        f"/api/v1/clothing-items/{created['id']}",
        json=payload,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] in {
        "request_validation_failed",
        "invalid_purchase_value",
    }


async def test_clothing_route_parameter_and_pagination_bounds_are_validated(
    client: httpx.AsyncClient,
) -> None:
    for path in (
        "/api/v1/clothing-items/0",
        "/api/v1/clothing-items?limit=0",
        "/api/v1/clothing-items?limit=101",
        "/api/v1/clothing-items?offset=-1",
        "/api/v1/clothing-items/9223372036854775808",
        "/api/v1/clothing-items?offset=1000001",
    ):
        response = await client.get(path)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "request_validation_failed"
