from sqlalchemy.orm import Session

from muse_backend.database.models.setting import ApplicationSetting


class ApplicationSettingsRepository:
    @staticmethod
    def get(session: Session, key: str) -> ApplicationSetting | None:
        return session.get(ApplicationSetting, key)

    @staticmethod
    def put(session: Session, *, key: str, value_json: str, value_type: str) -> None:
        row = session.get(ApplicationSetting, key)
        if row is None:
            session.add(ApplicationSetting(key=key, value_json=value_json, value_type=value_type))
            return
        row.value_json = value_json
        row.value_type = value_type
