from __future__ import annotations

import asyncio
import uuid
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass

from fastapi import HTTPException, Request, Response, status

_HOP_BY_HOP_HEADERS = {
    "connection",
    "content-encoding",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

_FORWARDED_REQUEST_HEADERS = {
    "accept",
    "content-type",
    "x-trace-id",
}


@dataclass(frozen=True)
class UpstreamConfig:
    name: str
    base_url: str
    timeout_seconds: float
    api_key: str = ""
    api_key_header: str = "X-API-Key"


def join_url(base: str, path: str, query: str) -> str:
    target = f"{base.rstrip('/')}/{path.lstrip('/')}"
    if query:
        target = f"{target}?{query}"
    return target


def request_headers(request: Request, trace_id: str, config: UpstreamConfig) -> dict[str, str]:
    headers: dict[str, str] = {}
    for key, value in request.headers.items():
        if key.lower() in _FORWARDED_REQUEST_HEADERS:
            headers[key] = value

    headers["X-Trace-Id"] = trace_id
    if config.api_key:
        headers[config.api_key_header] = config.api_key
    return headers


def response_headers(headers: Mapping[str, str], trace_id: str) -> dict[str, str]:
    response = {
        key: value
        for key, value in headers.items()
        if key.lower() not in _HOP_BY_HOP_HEADERS
    }
    response["X-Trace-Id"] = trace_id
    return response


def perform_request(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes,
    timeout: float,
    upstream_name: str,
) -> tuple[int, dict[str, str], bytes]:
    data = body if body and method.upper() not in {"GET", "HEAD"} else None
    req = urllib.request.Request(url=url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as upstream:
            return upstream.status, dict(upstream.headers.items()), upstream.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers.items()), exc.read()
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"{upstream_name} is unreachable: {exc.reason}",
        ) from exc
    except TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"{upstream_name} request timed out",
        ) from exc


async def proxy_request(path: str, request: Request, config: UpstreamConfig) -> Response:
    if request.method.upper() == "OPTIONS":
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    trace_id = request.headers.get("X-Trace-Id") or str(uuid.uuid4())
    body = await request.body()
    proxied_status, proxied_headers, proxied_body = await asyncio.to_thread(
        perform_request,
        request.method,
        join_url(config.base_url, path, request.url.query),
        request_headers(request, trace_id, config),
        body,
        config.timeout_seconds,
        config.name,
    )

    return Response(
        status_code=proxied_status,
        content=proxied_body,
        headers=response_headers(proxied_headers, trace_id),
        media_type=proxied_headers.get("content-type"),
    )
