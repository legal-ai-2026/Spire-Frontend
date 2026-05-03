from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

# Load .env files: first the backend-local one, then the project root.
# Variables already set in the environment take precedence (override=False).
_here = Path(__file__).resolve()
for _candidate in [
    _here.parents[3] / "backend" / ".env",   # <project>/backend/.env
    _here.parents[3] / ".env",               # <project>/.env
]:
    if _candidate.exists():
        load_dotenv(_candidate, override=False)


class Settings:
    # App
    app_name: str = "C2D2 API"
    version: str = "0.1.0"
    debug: bool = os.getenv("DEBUG", "true").lower() in ("1", "true", "yes")

    # Database — PostgreSQL is the runtime default. Set DATABASE_URL explicitly
    # for every shared deployment; SQLite is only supported for isolated dev.
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://c2d2:c2d2local@localhost:5432/c2d2",
    )

    # JWT
    jwt_secret: str = os.getenv("JWT_SECRET", "change-me-in-production-please")
    jwt_expire_hours: int = int(os.getenv("JWT_EXPIRE_HOURS", "168"))

    # CORS
    cors_origins: str = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001",
    )

    # AI — Anthropic (scoring + adversarial + OCR vision)
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")

    # AI — OpenAI (Whisper STT)
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")

    # Claude model
    claude_model: str = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

    # Azure Blob Storage (optional, for photo/audio uploads)
    photos_backend: str = os.getenv("PHOTOS_BACKEND", "local")
    azure_blob_connection_string: str = os.getenv("AZURE_BLOB_CONNECTION_STRING", "")
    azure_blob_container: str = os.getenv("AZURE_BLOB_CONTAINER", "c2d2-media")
    data_local_dir: str = os.getenv("DATA_LOCAL_DIR", "data_local")

    # System 1 Ranger AI proxy. Prefer the in-cluster Service DNS when present.
    system1_base_url: str = (
        os.getenv("SYSTEM1_INTERNAL_BASE_URL")
        or os.getenv("SYSTEM1_BASE_URL")
        or os.getenv("S1_BASE_URL")
        or "http://127.0.0.1:8001"
    )
    system_api_key: str = os.getenv("SYSTEM_API_KEY", "")
    system1_api_key: str = os.getenv("SYSTEM1_API_KEY", "") or system_api_key
    system1_timeout_seconds: float = float(os.getenv("SYSTEM1_TIMEOUT_SECONDS", "60"))

    system2_base_url: str = (
        os.getenv("SYSTEM2_INTERNAL_BASE_URL")
        or os.getenv("SYSTEM2_BASE_URL")
        or os.getenv("S2_BASE_URL")
        or "http://127.0.0.1:8000"
    )
    system2_api_key: str = os.getenv("SYSTEM2_API_KEY", "") or system_api_key
    system2_admin_api_key: str = os.getenv("SYSTEM2_ADMIN_API_KEY", "")
    system2_timeout_seconds: float = float(os.getenv("SYSTEM2_TIMEOUT_SECONDS", "60"))

    system3_base_url: str = (
        os.getenv("SYSTEM3_INTERNAL_BASE_URL")
        or os.getenv("SYSTEM3_BASE_URL")
        or os.getenv("S3_BASE_URL")
        or "http://127.0.0.1:8000"
    )
    system3_api_key: str = os.getenv("SYSTEM3_API_KEY", "") or system_api_key
    system3_timeout_seconds: float = float(os.getenv("SYSTEM3_TIMEOUT_SECONDS", "60"))

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
