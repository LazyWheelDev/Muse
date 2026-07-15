from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SQLITE_MAX_INTEGER = 9_223_372_036_854_775_807
MAX_PAGE_OFFSET = 1_000_000


class ApiSchema(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class TimestampedSchema(ApiSchema):
    created_at: datetime
    updated_at: datetime


class Page[ItemT](ApiSchema):
    items: list[ItemT]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0, le=MAX_PAGE_OFFSET)


class ErrorBody(ApiSchema):
    code: str
    message: str
    details: dict[str, object] | None = None
    request_id: str


class ErrorEnvelope(ApiSchema):
    error: ErrorBody


class HealthResponse(ApiSchema):
    status: Literal["ok"] = "ok"
    service: Literal["muse-backend"] = "muse-backend"
    version: str


class ReadinessCheck(ApiSchema):
    status: Literal["ok", "error"]
    message: str | None = None


class ReadinessResponse(ApiSchema):
    status: Literal["ready", "not_ready"]
    checks: dict[str, ReadinessCheck]
