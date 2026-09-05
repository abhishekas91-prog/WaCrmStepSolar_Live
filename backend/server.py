"""
FastAPI ingress-proxy for the Abhiwacrm (Next.js) app.

Emergent's Kubernetes ingress routes /api/* -> :8001. But the CRM is a
Next.js app whose API routes live at /api/* on port 3000. This tiny
proxy forwards every /api/* request received on :8001 to Next.js on
localhost:3000, preserving method, headers, query string, and body.

Anything not under /api is served directly by the frontend at :3000
(ingress default), so we don't need to proxy /_next/*, /login, etc.
"""

from __future__ import annotations

import os
from urllib.parse import urlencode

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

NEXT_ORIGIN = os.environ.get("NEXT_ORIGIN", "http://127.0.0.1:3000")

app = FastAPI(title="Abhiwacrm ingress proxy")

# Long timeout — WhatsApp media uploads and Meta template submissions
# can take a while. httpx default (5s) is too aggressive.
_client = httpx.AsyncClient(timeout=httpx.Timeout(120.0), follow_redirects=False)


HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-encoding",
    "content-length",
}


@app.get("/api/_proxy/health")
async def health() -> JSONResponse:
    """Local health probe; never proxied."""
    return JSONResponse({"status": "ok", "upstream": NEXT_ORIGIN})


@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy(path: str, request: Request) -> Response:
    query = request.url.query
    target = f"{NEXT_ORIGIN}/api/{path}"
    if query:
        target = f"{target}?{query}"

    # Drop hop-by-hop and host headers; Next.js will set its own.
    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP and k.lower() != "host"
    }

    body = await request.body()

    try:
        upstream = await _client.request(
            request.method,
            target,
            headers=headers,
            content=body,
        )
    except httpx.ConnectError:
        return JSONResponse(
            {"error": "frontend_not_ready", "detail": "Next.js server at :3000 is unreachable"},
            status_code=502,
        )
    except httpx.ReadTimeout:
        return JSONResponse(
            {"error": "upstream_timeout"},
            status_code=504,
        )

    response_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in HOP_BY_HOP
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )
