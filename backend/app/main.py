from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.app.core.config import get_settings
from backend.app.db.database import init_db
from backend.app.routes.analysis import router as analysis_router
from backend.app.routes.auth import router as auth_router
from backend.app.routes.assessments import router as assessments_router
from backend.app.routes.battlespace import router as battlespace_router
from backend.app.routes.events import router as events_router
from backend.app.routes.missions import router as missions_router
from backend.app.routes.soldiers import router as soldiers_router
from backend.app.routes.system1 import router as system1_router
from backend.app.routes.system2 import router as system2_router
from backend.app.routes.system3 import router as system3_router
from backend.app.routes.training import router as training_router
from backend.app.routes.weather import router as weather_router
from backend.app.services.auth_service import hash_password


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize DB tables, seed default admin, and start background services."""
    init_db()
    _seed_default_user()
    yield


def _seed_default_user() -> None:
    """Create a default commander account if no users exist."""
    from backend.app.db.database import get_session_factory
    from backend.app.db.models import User
    import os

    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            email = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@c2d2.local")
            password = os.getenv("DEFAULT_ADMIN_PASSWORD", "changeme123")
            user = User(
                email=email,
                password_hash=hash_password(password),
                full_name="C2D2 Admin",
                role="commander",
            )
            db.add(user)
            db.commit()
            import logging
            logging.getLogger(__name__).info(
                "Default admin created: %s / %s", email, password
            )
    finally:
        db.close()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="C2D2 API",
        description="Collaborative Combat Decision Dominance — AI-Powered Force Intelligence Platform",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    prefix = "/api/v1"
    app.include_router(auth_router,        prefix=prefix)
    app.include_router(soldiers_router,    prefix=prefix)
    app.include_router(events_router,      prefix=prefix)
    app.include_router(assessments_router, prefix=prefix)
    app.include_router(missions_router,    prefix=prefix)
    app.include_router(battlespace_router, prefix=prefix)
    app.include_router(weather_router,     prefix=prefix)
    app.include_router(training_router,    prefix=prefix)
    app.include_router(analysis_router,    prefix=prefix)
    app.include_router(system1_router,     prefix=prefix)
    app.include_router(system2_router,     prefix=prefix)
    app.include_router(system3_router,     prefix=prefix)

    @app.exception_handler(Exception)
    async def _unhandled_exception(request: Request, exc: Exception):
        logging.getLogger(__name__).exception("Unhandled error: %s", exc)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "C2D2 API"}

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
