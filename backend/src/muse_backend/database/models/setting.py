from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from muse_backend.database.base import Base, TimestampMixin


class ApplicationSetting(TimestampMixin, Base):
    __tablename__ = "application_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False)
    value_type: Mapped[str] = mapped_column(String(32), nullable=False)
