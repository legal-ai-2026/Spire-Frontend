from fastapi import APIRouter, Depends, Request, Response

from backend.app.core.config import get_settings
from backend.app.db.models import User
from backend.app.deps import get_current_user
from backend.app.routes.upstream_proxy import UpstreamConfig, proxy_request

router = APIRouter(prefix="/system2", tags=["System 2 Cognitive Mission Adaptation"])


def _config() -> UpstreamConfig:
    settings = get_settings()
    return UpstreamConfig(
        name="System 2 Cognitive Mission Adaptation Engine",
        base_url=settings.system2_base_url,
        timeout_seconds=settings.system2_timeout_seconds,
        api_key=settings.system2_api_key,
    )


@router.get("/proxy-config")
def system2_proxy_config(_: User = Depends(get_current_user)) -> dict[str, object]:
    """Return redacted proxy configuration for operator UI diagnostics."""
    settings = get_settings()
    return {
        "base_url_configured": bool(settings.system2_base_url),
        "api_key_configured": bool(settings.system2_api_key),
        "admin_api_key_configured": bool(settings.system2_admin_api_key),
        "proxy_path": "/api/v1/system2",
        "timeout_seconds": settings.system2_timeout_seconds,
    }


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_system2(
    path: str,
    request: Request,
    _: User = Depends(get_current_user),
) -> Response:
    return await proxy_request(path, request, _config())
