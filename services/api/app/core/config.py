"""Runtime configuration, loaded from environment variables.

All settings come from the process environment (see ``liwan/.env.example`` and the
``liwan-api`` service block in ``docker-compose.yml``). Nothing here reaches a
cloud service; this is an on-prem, offline product.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process configuration.

    Field names map to the upper-cased env vars wired in docker-compose. Defaults
    are safe for local development but MUST be overridden in production (secrets,
    DB host, CompreFace URL).
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

    # --- CompreFace recognition engine -----------------------------------------
    compreface_api_url: str = "http://liwan-compreface-api:8080"
    compreface_api_key: str = "00000000-0000-0000-0000-000000000002"
    compreface_timeout_seconds: float = 30.0

    # --- Auth / security -------------------------------------------------------
    liwan_jwt_secret: str = "change-me-to-a-long-random-string"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12  # 12h operator session
    liwan_admin_email: str = "admin@liwan.local"
    liwan_admin_password: str = "liwan-admin"
    liwan_device_key: str = "change-me-device-shared-secret"

    # --- Behaviour flags -------------------------------------------------------
    # LIWAN_DEMO_MODE=1 lets /api/recognize return a random active demo member so
    # the Gate/Console can be demoed with no camera and no CompreFace engine.
    liwan_demo_mode: bool = False

    # --- Storage ---------------------------------------------------------------
    media_root: str = "/data/media"

    # --- Schema bootstrap ------------------------------------------------------
    # Path to schema.sql inside the container; applied on startup if reachable so
    # the API is self-sufficient even when Postgres init scripts did not run.
    schema_sql_path: str = "/app/db/schema.sql"

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
