"""
C2D2 Edge Server

Routes:
  /api/*  → FastAPI backend (uvicorn on port 8000)
  /*      → Next.js frontend (next on port 3000)

Usage (Docker / Azure App Service):
  python server.py
"""
import asyncio
import os
import subprocess
import sys
import uuid
from aiohttp import web, ClientSession


BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))
FRONTEND_PORT = int(os.getenv("FRONTEND_PORT", "3000"))
EDGE_PORT = int(os.getenv("PORT", "8080"))
S1_PORT = int(os.getenv("S1_PORT", "8001"))
S2_PORT = int(os.getenv("S2_PORT", "8002"))
S3_PORT = int(os.getenv("S3_PORT", "8003"))

BACKEND_URL  = f"http://127.0.0.1:{BACKEND_PORT}"
FRONTEND_URL = f"http://127.0.0.1:{FRONTEND_PORT}"
S1_URL       = (
    os.getenv("SYSTEM1_INTERNAL_BASE_URL")
    or os.getenv("SYSTEM1_BASE_URL")
    or os.getenv("S1_BASE_URL")
    or f"http://127.0.0.1:{S1_PORT}"
)
SYSTEM_API_KEY = os.getenv("SYSTEM_API_KEY", "")
S1_API_KEY   = os.getenv("SYSTEM1_API_KEY", "") or SYSTEM_API_KEY
S2_URL       = (
    os.getenv("SYSTEM2_INTERNAL_BASE_URL")
    or os.getenv("SYSTEM2_BASE_URL")
    or os.getenv("S2_BASE_URL")
    or f"http://127.0.0.1:{S2_PORT}"
)
S2_API_KEY   = os.getenv("SYSTEM2_API_KEY", "") or SYSTEM_API_KEY
S3_URL       = (
    os.getenv("SYSTEM3_INTERNAL_BASE_URL")
    or os.getenv("SYSTEM3_BASE_URL")
    or os.getenv("S3_BASE_URL")
    or f"http://127.0.0.1:{S3_PORT}"
)
S3_API_KEY   = os.getenv("SYSTEM3_API_KEY", "") or SYSTEM_API_KEY


async def proxy(
    target_base: str,
    request: web.Request,
    strip_prefix: str = "",
    service_api_key: str = "",
) -> web.Response:
    path = request.path_qs
    if strip_prefix and path.startswith(strip_prefix):
        path = path[len(strip_prefix):]
        if not path.startswith("/"):
            path = "/" + path
    url = f"{target_base}{path}"
    headers = {k: v for k, v in request.headers.items() if k.lower() != "host"}
    trace_id = headers.get("X-Trace-Id")
    if service_api_key:
        trace_id = trace_id or str(uuid.uuid4())
        headers["X-Trace-Id"] = trace_id
        headers["X-API-Key"] = service_api_key

    async with ClientSession() as session:
        async with session.request(
            request.method,
            url,
            headers=headers,
            data=await request.read(),
        ) as resp:
            body = await resp.read()
            response_headers = {
                k: v for k, v in resp.headers.items()
                if k.lower() not in ("content-encoding", "transfer-encoding", "content-length")
            }
            if trace_id:
                response_headers["X-Trace-Id"] = trace_id
            return web.Response(
                status=resp.status,
                headers=response_headers,
                body=body,
            )


async def handle(request: web.Request) -> web.Response:
    if request.path.startswith("/s1"):
        return await proxy(S1_URL, request, strip_prefix="/s1", service_api_key=S1_API_KEY)
    if request.path.startswith("/s2"):
        return await proxy(S2_URL, request, strip_prefix="/s2", service_api_key=S2_API_KEY)
    if request.path.startswith("/s3"):
        return await proxy(S3_URL, request, strip_prefix="/s3", service_api_key=S3_API_KEY)
    if request.path.startswith("/api") or request.path == "/health":
        return await proxy(BACKEND_URL, request)
    return await proxy(FRONTEND_URL, request)


def start_servers():
    procs = []

    # Start FastAPI
    procs.append(subprocess.Popen([
        sys.executable, "-m", "uvicorn",
        "backend.app.main:app",
        "--host", "127.0.0.1",
        "--port", str(BACKEND_PORT),
    ]))

    # Start Next.js
    procs.append(subprocess.Popen(
        ["node", "frontend/.next/standalone/server.js"],
        env={**os.environ, "PORT": str(FRONTEND_PORT), "HOSTNAME": "0.0.0.0"},
    ))

    return procs


async def main():
    procs = start_servers()
    app = web.Application()
    app.router.add_route("*", "/{path_info:.*}", handle)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", EDGE_PORT)
    await site.start()
    print(f"C2D2 edge server running on :{EDGE_PORT}")

    try:
        await asyncio.Event().wait()
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    asyncio.run(main())
