"""Runtime configuration, loaded from environment variables.

All settings come from the process environment (see ``liwan/.env.example`` and the
``liwan-api`` service block in ``docker-compose.yml``). Nothing here reaches a
cloud service; this is an on-prem, offline product.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process configuration.

    Field names map to the upper-cased env vars wired in docker-compose. Defaults
    are safe for local development but MUST be overridden in production (secrets,
    DB host, engine URL).
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Database (shared Postgres instance; Liwan owns the ``liwan`` schema) ---
    db_host: str = "liwan-postgres-db"
    db_port: int = 5432
    db_name: str = "liwan"
    db_user: str = "postgres"
    db_password: str = "change-me-in-production"
    db_min_conn: int = 1
    db_max_conn: int = 10

    # --- Liwan Vision Engine (recognition core) ---------------------------------
    # Canonical env vars are ENGINE_URL / ENGINE_API_KEY. The legacy
    # COMPREFACE_API_URL / COMPREFACE_API_KEY names are still accepted as
    # fallbacks so existing installs keep working after an upgrade.
    engine_url: str = Field(
        default="http://liwan-engine-api:8080",
        validation_alias=AliasChoices("engine_url", "compreface_api_url"),
    )
    engine_api_key: str = Field(
        default="00000000-0000-0000-0000-000000000002",
        validation_alias=AliasChoices("engine_api_key", "compreface_api_key"),
    )
    engine_timeout_seconds: float = Field(
        default=30.0,
        validation_alias=AliasChoices("engine_timeout_seconds", "compreface_timeout_seconds"),
    )

    @field_validator("engine_url", "engine_api_key", mode="before")
    @classmethod
    def _blank_engine_env_falls_back(cls, value: object, info) -> object:
        """Treat an empty/whitespace env value as unset (use the field default).

        docker-compose interpolates missing variables to empty strings; without
        this, ``ENGINE_URL=""`` would silently break the engine client.
        """
        if isinstance(value, str) and not value.strip():
            return cls.model_fields[info.field_name].default
        return value

    # --- Auth / security -------------------------------------------------------
    liwan_jwt_secret: str = "change-me-to-a-long-random-string"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12  # 12h operator session
    liwan_admin_email: str = "admin@liwan.local"
    liwan_admin_password: str = "liwan-admin"
    liwan_device_key: str = "change-me-device-shared-secret"

    # --- Behaviour flags -------------------------------------------------------
    # LIWAN_DEMO_MODE=1 lets /api/recognize return a random active demo member so
    # the Gate/Console can be demoed with no camera and no vision engine.
    liwan_demo_mode: bool = False

    # --- Storage ---------------------------------------------------------------
    media_root: str = "/data/media"

    # --- Schema bootstrap ------------------------------------------------------
    # Path to schema.sql inside the container; applied on startup if reachable so
    # the API is self-sufficient even when Postgres init scripts did not run.
    # Every db/migrations/*.sql next to it is then applied in filename order
    # (all migration files are idempotent).
    schema_sql_path: str = "/app/db/schema.sql"
    migrations_dir: str = "/app/db/migrations"

    # --- CORS ------------------------------------------------------------------
    # Console (:3000) and Gate (:3001) browsers call this API directly.
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ]

    @property
    def dsn(self) -> str:
        """libpq connection string for psycopg2."""
        return (
            f"host={self.db_host} port={self.db_port} dbname={self.db_name} "
            f"user={self.db_user} password={self.db_password}"
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached singleton of the resolved settings."""
    return Settings()
